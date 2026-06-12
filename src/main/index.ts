import { BrowserWindow, Menu, dialog, app, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { InMemoryObservationStore } from '@core/observation-store'
import type { ListObservationEventsOptions } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import { detectShell, detectProvider, detectVscode } from '@core/settings-detector'
import { SessionEvidenceStore } from '@core/memory/session-evidence-store'
import { buildSessionCommandEnv } from '@core/session-command-env'
import { SessionBootstrapPromptService } from '@core/session-bootstrap-prompt-service'
import { createSessionControlServer } from '@core/session-control-server'
import { SessionVisibilityService } from '@core/session-visibility-service'
import { allocateSubagentShortName, SubagentSupervisor } from '@core/subagent-supervisor'
import { createStoaCtlGate } from '@core/stoa-ctl-feature'
import { ensureStoaCtlShim, ensureStoaCtlSystemShim, unregisterStoaCtlShim, unregisterStoaCtlSystemShim } from '@core/stoa-ctl-shim'
import { writePortFile as writeCtlPortFile, deletePortFile as deleteCtlPortFile, generateSecret } from '@core/stoa-ctl-port-file'
import { openWorkspace } from '@core/workspace-launcher'
import { resolveRuntimePaths as resolveProviderRuntimePaths } from '@core/provider-path-resolver'
import { readSidebarState, writeSidebarState, cleanupSidebarTempFile } from '@core/sidebar-state-store'
import { getProvider } from '@extensions/providers'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { derivePresencePhase } from '@shared/session-state-reducer'
import { SessionRuntimeController } from './session-runtime-controller'
import { SessionEventBridge } from './session-event-bridge'
import { SessionInputRouter } from './session-input-router'
import { launchTrackedSessionRuntime } from './launch-tracked-session-runtime'
import { SessionTitleController } from './session-title-controller'
import { syncObservabilitySessionsFromManager } from './observability-sync'
import { syncManagedSidecars } from './managed-sidecar-maintenance'
import { UpdateService } from './update-service'
import { resolveDefaultStoaRuntimeRoot } from './stoa-runtime-root'
import { StoaServerSpawner, type StoaServerConfig, type SpawnerDeps } from './stoa-server-spawner'
import type { StoaRuntimeClient } from './stoa-runtime-client'
import { createHookLeaseManager } from './hook-lease-manager'
import { mergeSessionDimensions, SessionDimensionsRegistry, type PartialSessionDimensions } from './session-dimensions'
import { registerFilesystemHandlers } from './sidebar-fs-handlers'
import { registerGitHandlers } from './sidebar-git-handlers'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import {
  type AppSettings,
  type CreateProjectRequest,
  type CreateSessionRequest,
  type OpenWorkspaceRequest,
  type SessionGraphEvent,
  type SessionNodeSnapshot,
  type SessionSummary,
  type SessionTitleGenerationNotification,
  sanitizeBootstrapStateForGenericProjection,
  sanitizeSessionGraphEventForGenericProjection,
  sanitizeSessionSummaryForGenericProjection
} from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'
import type { PtyHost } from '@core/pty-host'

let mainWindow: BrowserWindow | null = null
let projectSessionManager: ProjectSessionManager | null = null
let ptyHost: PtyHost | null = null
let runtimeController: SessionRuntimeController | null = null
let sessionEventBridge: SessionEventBridge | null = null
let srSpawner: StoaServerSpawner | null = null
let sessionInputRouter: SessionInputRouter | null = null
let observationStore: InMemoryObservationStore | null = null
let observabilityService: ObservabilityService | null = null
let updateService: UpdateService | null = null
let evidenceStore: SessionEvidenceStore | null = null
let hookLeaseManager: ReturnType<typeof createHookLeaseManager> | null = null
let sessionTitleController: SessionTitleController | null = null
const e2eWorkspaceOpenRequests: OpenWorkspaceRequest[] = []
let isQuittingAfterBridgeStop = false
const stoaCtlGate = createStoaCtlGate(false)
const unsubscribeStoaCtlGate = stoaCtlGate.on('enabledChanged', async (enabled) => {
  const stoaCtlBinDir = join(app.getPath('userData'), 'bin')
  if (!enabled) {
    await unregisterStoaCtlShim(stoaCtlBinDir)
    await unregisterStoaCtlSystemShim()
  } else {
    await ensureStoaCtlShim({
      binDir: stoaCtlBinDir,
      appRootPath: app.getAppPath(),
      appExecutablePath: process.execPath,
      isPackaged: app.isPackaged
    })
    void ensureStoaCtlSystemShim({
      appRootPath: app.getAppPath(),
      appExecutablePath: process.execPath,
      isPackaged: app.isPackaged
    })
  }
})
const pendingE2EPickFolders: Array<string | null> = []
const isE2EMode = process.env.VIBECODING_E2E === '1'

const DEBUG_CODE = '114514'
let debugModeActive = false
const INPUT_DEBUG = process.env.VIBECODING_E2E === '1'

function handleDebugToggleDevTools(): void {
  debugModeActive = !debugModeActive
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (debugModeActive) {
    win.webContents.openDevTools()
  } else {
    win.webContents.closeDevTools()
  }
}

function readProcessArg(name: string): string | null {
  const prefix = `--${name}=`
  const matched = process.argv.find((value) => value.startsWith(prefix))
  return matched ? matched.slice(prefix.length) : null
}

function readSmokeSetting(envName: string, argName: string): string | null {
  const envValue = process.env[envName]?.trim()
  if (envValue) {
    return envValue
  }

  const argValue = readProcessArg(argName)?.trim()
  return argValue && argValue.length > 0 ? argValue : null
}

interface PackagedSmokeRequest {
  smokeFile: string | null
  projectDir: string | null
  marker: string | null
  stateDir: string | null
}

function readPackagedSmokeRequest(): PackagedSmokeRequest {
  try {
    const requestPath = join(dirname(process.execPath), 'stoa-packaged-smoke-request.json')
    const parsed = JSON.parse(readFileSync(requestPath, 'utf8')) as Partial<PackagedSmokeRequest>
    return {
      smokeFile: typeof parsed.smokeFile === 'string' && parsed.smokeFile.trim().length > 0 ? parsed.smokeFile.trim() : null,
      projectDir: typeof parsed.projectDir === 'string' && parsed.projectDir.trim().length > 0 ? parsed.projectDir.trim() : null,
      marker: typeof parsed.marker === 'string' && parsed.marker.trim().length > 0 ? parsed.marker.trim() : null,
      stateDir: typeof parsed.stateDir === 'string' && parsed.stateDir.trim().length > 0 ? parsed.stateDir.trim() : null
    }
  } catch {
    return {
      smokeFile: null,
      projectDir: null,
      marker: null,
      stateDir: null
    }
  }
}

const packagedSmokeRequest = readPackagedSmokeRequest()
const packagedSmokeRequestPath = join(dirname(process.execPath), 'stoa-packaged-smoke-request.json')

const e2eGlobalStatePath = process.env.VIBECODING_STATE_DIR
  ? join(process.env.VIBECODING_STATE_DIR, 'global.json')
  : undefined
const packagedSmokeFilePath =
  readSmokeSetting('STOA_PACKAGED_SMOKE_FILE', 'stoa-packaged-smoke-file')
  ?? packagedSmokeRequest.smokeFile
const packagedSmokeProjectDir =
  readSmokeSetting('STOA_PACKAGED_SMOKE_PROJECT_DIR', 'stoa-packaged-smoke-project-dir')
  ?? packagedSmokeRequest.projectDir
const packagedSmokeMarker =
  readSmokeSetting('STOA_PACKAGED_SMOKE_MARKER', 'stoa-packaged-smoke-marker')
  ?? packagedSmokeRequest.marker
  ?? '__STOA_PACKAGED_SMOKE__'
const isPackagedSmokeMode = packagedSmokeFilePath !== null
const packagedSmokeProbePath = existsSync(packagedSmokeRequestPath)
  ? join(dirname(process.execPath), 'stoa-packaged-smoke-probe.log')
  : null

if (isPackagedSmokeMode) {
  const smokeStateDir = process.env.VIBECODING_STATE_DIR ?? packagedSmokeRequest.stateDir
  if (smokeStateDir) {
    app.setPath('userData', smokeStateDir)
  }
}

interface MainE2EDebugState {
  webhookPort: number | null
  sessionSecrets: Record<string, string>
  snapshot: ReturnType<ProjectSessionManager['snapshot']> | null
}

interface MainE2EDebugApi {
  getDebugState: () => MainE2EDebugState
  queueDialogPickFolder: (path: string | null) => void
  getTerminalReplay: (sessionId: string) => Promise<string>
  appendTerminalData: (sessionId: string, data: string) => Promise<void>
  getDebugModeActive: () => boolean
  getWorkspaceOpenRequests: () => OpenWorkspaceRequest[]
  clearWorkspaceOpenRequests: () => void
}

declare global {
  var __VIBECODING_MAIN_E2E__: MainE2EDebugApi | undefined
}

function installMainE2EDebugApi(): void {
  if (!isE2EMode) {
    return
  }

  globalThis.__VIBECODING_MAIN_E2E__ = {
    getDebugState() {
      return {
        webhookPort: projectSessionManager?.snapshot().terminalWebhookPort ?? null,
        sessionSecrets: hookLeaseManager?.debugSnapshotSessionSecrets() ?? sessionEventBridge?.debugSnapshotSessionSecrets() ?? {},
        snapshot: projectSessionManager?.snapshot() ?? null
      }
    },
    queueDialogPickFolder(path) {
      pendingE2EPickFolders.push(path)
    },
    async getTerminalReplay(sessionId) {
      return await runtimeController?.getTerminalReplay(sessionId) ?? ''
    },
    async appendTerminalData(sessionId, data) {
      await runtimeController?.appendTerminalData({ sessionId, data })
    },
    getDebugModeActive() {
      return debugModeActive
    },
    getWorkspaceOpenRequests() {
      return e2eWorkspaceOpenRequests.map((request) => ({ ...request }))
    },
    clearWorkspaceOpenRequests() {
      e2eWorkspaceOpenRequests.length = 0
    }
  }
}

async function recordPackagedSmoke(step: string, detail: Record<string, unknown> = {}): Promise<void> {
  if (!packagedSmokeFilePath) {
    if (!packagedSmokeProbePath) {
      return
    }

    await appendFile(
      packagedSmokeProbePath,
      `${JSON.stringify({
        step,
        at: new Date().toISOString(),
        ...detail
      })}\n`,
      'utf8'
    )
    return
  }

  await mkdir(dirname(packagedSmokeFilePath), { recursive: true })
  await appendFile(
    packagedSmokeFilePath,
    `${JSON.stringify({
      step,
      at: new Date().toISOString(),
      ...detail
    })}\n`,
    'utf8'
  )
}

function recordPackagedSmokeSync(step: string, detail: Record<string, unknown> = {}): void {
  if (!packagedSmokeFilePath) {
    if (!packagedSmokeProbePath) {
      return
    }

    appendFileSync(
      packagedSmokeProbePath,
      `${JSON.stringify({
        step,
        at: new Date().toISOString(),
        ...detail
      })}\n`,
      'utf8'
    )
    return
  }

  mkdirSync(dirname(packagedSmokeFilePath), { recursive: true })
  appendFileSync(
    packagedSmokeFilePath,
    `${JSON.stringify({
      step,
      at: new Date().toISOString(),
      ...detail
    })}\n`,
    'utf8'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForValue<T>(
  readValue: () => Promise<T | null>,
  description: string,
  timeoutMs = 30_000,
  intervalMs = 250
): Promise<T> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const value = await readValue()
    if (value !== null) {
      return value
    }

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for ${description}.`)
}

if (isPackagedSmokeMode) {
  recordPackagedSmokeSync('process-started', {
    pid: process.pid,
    packaged: app.isPackaged
  })
  process.on('uncaughtException', (error) => {
    recordPackagedSmokeSync('failed', {
      message: error instanceof Error ? error.message : String(error),
      source: 'uncaughtException'
    })
  })

  process.on('unhandledRejection', (reason) => {
    recordPackagedSmokeSync('failed', {
      message: reason instanceof Error ? reason.message : String(reason),
      source: 'unhandledRejection'
    })
  })
}

async function stopSessionEventBridge(): Promise<void> {
  const activeBridge = sessionEventBridge
  sessionEventBridge = null
  await activeBridge?.stop()
}

async function prepareForQuitAndInstall(): Promise<void> {
  if (isQuittingAfterBridgeStop) {
    return
  }

  isQuittingAfterBridgeStop = true
  try {
    await projectSessionManager?.flush()
  } catch (error) {
    console.error('[shutdown] State flush failed, proceeding with cleanup', error)
  }
  await ptyHost?.disposeAndWait()
  ptyHost = null
  sessionInputRouter?.dispose()
  sessionInputRouter = null
  await stopSessionEventBridge()
  await hookLeaseManager?.stop()
  hookLeaseManager = null
}

function handleShutdownSignal(signal: string): void {
  console.log(`[main] Received ${signal}, initiating graceful shutdown`)
  app.quit()
}

process.on('SIGINT', () => handleShutdownSignal('SIGINT'))
process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'))

function createDisabledUpdateState(): UpdateState {
  return {
    phase: 'disabled',
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: 'Updates are only available in packaged builds.',
    requiresSessionWarning: false
  }
}

function pushUpdateState(state: UpdateState): void {
  const win = mainWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.updateState, state)
  }
}

function pushTitleGenerationNotification(event: SessionTitleGenerationNotification): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send(IPC_CHANNELS.titleGenerationNotification, event)
}

function pushObservabilitySnapshotsForSession(sessionId: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || !projectSessionManager || !observabilityService) {
    return
  }

  const session = projectSessionManager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
  const sessionPresence = observabilityService.getSessionPresence(sessionId)

  if (sessionPresence) {
    mainWindow.webContents.send(IPC_CHANNELS.observabilitySessionPresenceChanged, sessionPresence)
  }

  const projectObservability = session
    ? observabilityService.getProjectObservability(session.projectId)
    : null

  if (projectObservability) {
    mainWindow.webContents.send(IPC_CHANNELS.observabilityProjectChanged, projectObservability)
  }

  mainWindow.webContents.send(IPC_CHANNELS.observabilityAppChanged, observabilityService.getAppObservability())
}

function syncObservabilitySessions(): void {
  if (!projectSessionManager || !observabilityService) {
    return
  }

  syncObservabilitySessionsFromManager(projectSessionManager, observabilityService)
}

function syncObservabilityAndPushForSession(sessionId: string): void {
  syncObservabilitySessions()
  pushObservabilitySnapshotsForSession(sessionId)
}

function normalizeObservationListOptions(options: ListObservationEventsOptions | undefined): ListObservationEventsOptions {
  return {
    limit: Math.min(Math.max(options?.limit ?? 50, 0), 200),
    cursor: options?.cursor,
    categories: options?.categories,
    includeEphemeral: options?.includeEphemeral
  }
}

async function syncUpdateStateToWindow(): Promise<void> {
  if (updateService) {
    updateService.publishState()
    return
  }

  pushUpdateState(createDisabledUpdateState())
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: !isE2EMode,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  Menu.setApplicationMenu(null)
  window.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  if (isPackagedSmokeMode) {
    await recordPackagedSmoke('ready')
  }

  projectSessionManager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath: e2eGlobalStatePath
  })
  if (projectSessionManager) {
    // 旧 state 缺 stoaCtlEnabled 字段时,运行时补 DEFAULT_SETTINGS.stoaCtlEnabled = false
    const settings = projectSessionManager.getSettings()
    stoaCtlGate.setEnabled(settings.stoaCtlEnabled === true)
  }
  observationStore = new InMemoryObservationStore()
  observabilityService = new ObservabilityService(observationStore)
  evidenceStore = new SessionEvidenceStore()

  syncObservabilitySessions()

  const { PtyHost } = await import('@core/pty-host')
  ptyHost = new PtyHost()
  sessionInputRouter = new SessionInputRouter(
    {
      getSessionType(sessionId) {
        return projectSessionManager?.snapshot().sessions.find((candidate) => candidate.id === sessionId)?.type ?? null
      }
    },
    {
      write(sessionId, data) {
        ptyHost?.write(sessionId, data)
      },
      writeBinary(sessionId, data) {
        ptyHost?.writeBinary(sessionId, data)
      }
    },
    {
      async onUserInterrupt(sessionId, sessionType) {
        await runtimeController?.markAgentTurnInterrupted(sessionId, `${sessionType} turn interrupted by user`)
      }
    }
  )

  const pendingLaunchSessions = new Map<string, {
    resolve: (dims: { cols: number; rows: number }) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const sessionDimensions = new SessionDimensionsRegistry()
  const sessionLaunchTokens = new Map<string, number>()

  function reserveSessionLaunchToken(sessionId: string): number {
    const nextToken = (sessionLaunchTokens.get(sessionId) ?? 0) + 1
    sessionLaunchTokens.set(sessionId, nextToken)
    return nextToken
  }

  function isSessionLaunchTokenCurrent(sessionId: string, launchToken: number): boolean {
    return sessionLaunchTokens.get(sessionId) === launchToken
  }

  function rememberSessionDimensions(sessionId: string, dims: { cols: number; rows: number }): void {
    sessionDimensions.set(sessionId, dims)
  }

  function getSessionDimensions(sessionId: string): { cols: number; rows: number } | null {
    return sessionDimensions.get(sessionId)
  }

  function waitForSessionDimensions(sessionId: string, timeoutMs: number): Promise<{ cols: number; rows: number }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingLaunchSessions.delete(sessionId)
        console.log(`[pty-dimensions] Timeout waiting for renderer dimensions for ${sessionId}, using defaults`)
        resolve({ cols: 120, rows: 30 })
      }, timeoutMs)
      pendingLaunchSessions.set(sessionId, { resolve, timer })
    })
  }

  function hasCompleteSessionDimensions(dims: { cols?: number; rows?: number } | undefined): dims is { cols: number; rows: number } {
    return dims?.cols !== undefined && dims.rows !== undefined
  }

  runtimeController = new SessionRuntimeController(
    projectSessionManager,
    () => mainWindow,
    () => {
      void syncUpdateStateToWindow()
    },
    observabilityService
  )
  const activeProjectSessionManager = projectSessionManager
  const activeRuntimeController = runtimeController
  const activeObservationStore = observationStore
  const activeObservabilityService = observabilityService
  const activeSessionInputRouter = sessionInputRouter
  const sessionTokenRegistry = new Map<string, string>()
  const sessionBootstrapPromptService = new SessionBootstrapPromptService()
  let sessionGraphVersion = 0
  const runtimeRoot = resolveDefaultStoaRuntimeRoot()
  hookLeaseManager = createHookLeaseManager({
    runtimeRoot,
    instanceId: `stoa-${process.pid}-${Date.now()}`
  })
  const activeHookLeaseManager = hookLeaseManager

  function listSessionNodeSnapshots(): SessionNodeSnapshot[] {
    return activeProjectSessionManager.snapshot().sessions
      .map((session) => activeProjectSessionManager.getSessionNodeSnapshot(session.id))
      .filter((node): node is SessionNodeSnapshot => node !== null)
  }

  function buildSessionVisibilityService(): SessionVisibilityService {
    return new SessionVisibilityService(listSessionNodeSnapshots)
  }

  function getSessionSubtreeIds(rootSessionId: string): string[] {
    const sessions = activeProjectSessionManager.snapshot().sessions
    const byParent = new Map<string, string[]>()
    for (const session of sessions) {
      if (!session.parentSessionId) {
        continue
      }
      const children = byParent.get(session.parentSessionId) ?? []
      children.push(session.id)
      byParent.set(session.parentSessionId, children)
    }

    const visited = new Set<string>()
    const ordered: string[] = []
    const queue = [rootSessionId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) {
        continue
      }
      visited.add(current)
      ordered.push(current)
      for (const childId of byParent.get(current) ?? []) {
        queue.push(childId)
      }
    }

    return ordered
  }

  function pushSessionGraphSnapshotEvent(
    node: SessionNodeSnapshot,
    options: {
      kind?: SessionGraphEvent['kind']
      origin?: SessionGraphEvent['origin']
      initiatorSessionId?: string | null
    } = {}
  ): void {
    const win = mainWindow
    if (!win || win.isDestroyed()) {
      return
    }

    sessionGraphVersion += 1
    win.webContents.send(IPC_CHANNELS.sessionGraphEvent, sanitizeSessionGraphEventForGenericProjection({
      kind: options.kind ?? 'updated',
      graphVersion: sessionGraphVersion,
      origin: options.origin ?? 'system',
      initiatorSessionId: options.initiatorSessionId ?? null,
      node
    } satisfies SessionGraphEvent))
  }

  function pushSessionGraphEvent(
    sessionId: string,
    options: {
      kind?: SessionGraphEvent['kind']
      origin?: SessionGraphEvent['origin']
      initiatorSessionId?: string | null
    } = {}
  ): void {
    const node = activeProjectSessionManager.getSessionNodeSnapshot(sessionId)
    if (!node) {
      return
    }

    pushSessionGraphSnapshotEvent(node, options)
  }

  function pushSessionGraphEvents(
    sessionIds: string[],
    options: {
      kind?: SessionGraphEvent['kind']
      origin?: SessionGraphEvent['origin']
      initiatorSessionId?: string | null
    } = {}
  ): void {
    for (const sessionId of new Set(sessionIds)) {
      pushSessionGraphEvent(sessionId, options)
    }
  }

  const originalRegisterSessionToken = activeRuntimeController.registerSessionToken.bind(activeRuntimeController)
  activeRuntimeController.registerSessionToken = (sessionId: string, token: string) => {
    sessionTokenRegistry.set(sessionId, token)
    originalRegisterSessionToken(sessionId, token)
  }

  const originalMarkRuntimeStarting = activeRuntimeController.markRuntimeStarting.bind(activeRuntimeController)
  activeRuntimeController.markRuntimeStarting = async (sessionId: string, summary: string, externalSessionId: string | null) => {
    await originalMarkRuntimeStarting(sessionId, summary, externalSessionId)
    pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
  }

  const originalMarkRuntimeAlive = activeRuntimeController.markRuntimeAlive.bind(activeRuntimeController)
  activeRuntimeController.markRuntimeAlive = async (sessionId: string, externalSessionId: string | null) => {
    await originalMarkRuntimeAlive(sessionId, externalSessionId)
    pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
  }

  const originalMarkRuntimeExited = activeRuntimeController.markRuntimeExited.bind(activeRuntimeController)
  activeRuntimeController.markRuntimeExited = async (sessionId: string, exitCode: number | null, summary: string) => {
    await originalMarkRuntimeExited(sessionId, exitCode, summary)
    sessionTokenRegistry.delete(sessionId)
    pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
  }

  const originalMarkRuntimeFailedToStart = activeRuntimeController.markRuntimeFailedToStart.bind(activeRuntimeController)
  activeRuntimeController.markRuntimeFailedToStart = async (sessionId: string, summary: string) => {
    await originalMarkRuntimeFailedToStart(sessionId, summary)
    sessionTokenRegistry.delete(sessionId)
    pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
  }

  const originalApplyProviderStatePatch = activeRuntimeController.applyProviderStatePatch.bind(activeRuntimeController)
  activeRuntimeController.applyProviderStatePatch = async (patch: import('@shared/project-session').SessionStatePatchEvent) => {
    await originalApplyProviderStatePatch(patch)
    pushSessionGraphEvent(patch.sessionId, { kind: 'updated', origin: 'system' })
  }

  const originalMarkAgentTurnInterrupted = activeRuntimeController.markAgentTurnInterrupted.bind(activeRuntimeController)
  activeRuntimeController.markAgentTurnInterrupted = async (sessionId: string, summary: string) => {
    await originalMarkAgentTurnInterrupted(sessionId, summary)
    pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
  }

  sessionTitleController = new SessionTitleController({
    snapshotSource: activeProjectSessionManager,
    async updateSessionTitleGenerationContext(sessionId, patch) {
      return await activeProjectSessionManager.updateSessionTitleGenerationContext(sessionId, patch)
    },
    async updateSessionTitle(sessionId, title, options) {
      const updated = await activeProjectSessionManager.updateSessionTitle(sessionId, title, options)
      if (updated) {
        syncObservabilityAndPushForSession(sessionId)
        pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
      }
      return updated
    },
    onNotification(event) {
      pushTitleGenerationNotification(event)
    }
  })
  const originalApplyProviderPatchWithTitle = activeRuntimeController.applyProviderStatePatch.bind(activeRuntimeController)
  activeRuntimeController.applyProviderStatePatch = async (patch: import('@shared/project-session').SessionStatePatchEvent) => {
    await originalApplyProviderPatchWithTitle(patch)
    if (patch.intent === 'agent.turn_completed') {
      await sessionTitleController?.maybeAutoGenerateForCompletedTurn(patch.sessionId)
    }
  }

  const ctlSecret = generateSecret()
  const createChildSessionForCtl = async (request: CreateSessionRequest & {
    parentId: string
    title: string
    subagentName?: string | null
    externalSessionId?: string | null
    initialCols?: number
    initialRows?: number
  }) => {
    const resolvedProjectId = request.projectId
      || (request.parentId
        ? activeProjectSessionManager.getSessionNodeSnapshot(request.parentId)?.session.projectId ?? ''
        : '')
    if (!resolvedProjectId) {
      throw new Error('Work session creation requires a project id.')
    }

    const origin: SessionGraphEvent['origin'] = request.parentId && !request.projectId
      ? 'session'
      : 'local-cli'
    const initiatorSessionId = request.parentId && !request.projectId
      ? request.parentId
      : null

    const created = await createWorkSessionWithRuntime({
      projectId: resolvedProjectId,
      type: request.type,
      title: request.title ?? '',
      parentSessionId: request.parentId || null,
      createdBySessionId: request.parentId || null,
      subagentName: request.subagentName ?? null,
      externalSessionId: request.externalSessionId,
      initialCols: request.initialCols,
      initialRows: request.initialRows
    }, {
      graphOrigin: origin,
      initiatorSessionId,
      preserveActiveSession: true
    })
    if (!created) {
      throw new Error('Work session creation is unavailable.')
    }
    return created
  }
  const rollbackDispatchedSessionForCtl = async (sessionId: string) => {
    sessionInputRouter?.resetSession(sessionId)
    await ptyHost?.killAndWait(sessionId)
    await hookLeaseManager?.releaseLease(sessionId)
    sessionTokenRegistry.delete(sessionId)
    activeRuntimeController.invalidateSessionToken(sessionId)
    const destroyedNode = activeProjectSessionManager.getSessionNodeSnapshot(sessionId)

    const removed = await activeProjectSessionManager.deleteSessionRecord(sessionId)
    if (!removed) {
      return
    }

    syncObservabilitySessions()
    const nextActiveSessionId = activeProjectSessionManager.snapshot().activeSessionId
    if (nextActiveSessionId) {
      pushObservabilitySnapshotsForSession(nextActiveSessionId)
    }
    if (destroyedNode) {
      pushSessionGraphSnapshotEvent(destroyedNode, {
        kind: 'destroyed',
        origin: 'system',
        initiatorSessionId: null
      })
    }
    await syncUpdateStateToWindow()
  }
  const destroySessionForCtl = async (sessionId: string) => {
    await archiveWorkSessionWithRuntime(sessionId, {
      graphKind: 'archived',
      graphOrigin: 'system',
      initiatorSessionId: null
    })
  }
  const subagentSupervisor = new SubagentSupervisor({
    getSnapshot() {
      return listSessionNodeSnapshots()
    },
    visibilityService: buildSessionVisibilityService(),
    sessionInput: {
      async send(sessionId: string, data: string) {
        await activeSessionInputRouter?.send(sessionId, data)
      }
    },
    async createChildSession(request) {
      return await createChildSessionForCtl(request)
    },
    async destroySession(sessionId: string) {
      await destroySessionForCtl(sessionId)
    },
    async rollbackDispatchedSession(sessionId: string) {
      await rollbackDispatchedSessionForCtl(sessionId)
    },
    async getTerminalReplay(sessionId: string) {
      return await activeRuntimeController.getTerminalReplay(sessionId)
    },
    async waitForSessionStateChange(sessionId: string, timeoutMs: number) {
      return await activeRuntimeController.waitForSessionStateChange(sessionId, timeoutMs)
    },
    async updateSessionFacade(sessionId, facade) {
      const updated = await activeProjectSessionManager.updateSubagentFacade(sessionId, facade)
      if (updated) {
        syncObservabilityAndPushForSession(sessionId)
        pushSessionGraphEvent(sessionId, { kind: 'updated', origin: 'system' })
        return updated
      }
      throw new Error(`Unknown session: ${sessionId}`)
    },
    async interruptSession(sessionId: string) {
      const session = activeProjectSessionManager.getSessionNodeSnapshot(sessionId)?.session
      if (!session) {
        return false
      }
      await activeSessionInputRouter?.send(sessionId, '\u0003')
      return true
    }
  })
  sessionEventBridge = new SessionEventBridge(activeProjectSessionManager, activeRuntimeController, activeObservabilityService, {
    captureEvidence: false,
    captureObservation(event) {
      return sessionTitleController?.captureObservation(event)
    },
    authorizeHookRequest: activeHookLeaseManager
      ? async (input) => await activeHookLeaseManager.authorizeHookRequest(input)
      : undefined,
    getSessionBootstrapPrompt(sessionId: string) {
      const session = activeProjectSessionManager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
      if (!session) {
        return null
      }
      return sessionBootstrapPromptService.getPrompt(session.type, {
        isChild: session.parentSessionId !== null
      })
    },
    isCtlEnabled: () => stoaCtlGate.isEnabled(),
    configureServerApp(app) {
      const sessionControlServer = createSessionControlServer({
        getSnapshot() {
          return listSessionNodeSnapshots()
        },
        visibilityService: buildSessionVisibilityService(),
        sessionInput: {
          async send(sessionId: string, data: string) {
            await activeSessionInputRouter?.send(sessionId, data)
          }
        },
        async recordSubagentInput(sessionId: string, text: string) {
          return await subagentSupervisor.recordInput(sessionId, text)
        },
        async getTerminalReplay(sessionId: string) {
          return await activeRuntimeController.getTerminalReplay(sessionId)
        },
        async waitForSessionStateChange(sessionId: string, timeoutMs: number) {
          return await activeRuntimeController.waitForSessionStateChange(sessionId, timeoutMs)
        },
        createChildSession: createChildSessionForCtl,
        destroySession: destroySessionForCtl,
        async rollbackDispatchedSession(sessionId: string) {
          await rollbackDispatchedSessionForCtl(sessionId)
        },
        async updateSessionFacade(sessionId, facade) {
          const updated = await activeProjectSessionManager.updateSubagentFacade(sessionId, facade)
          if (!updated) {
            throw new Error(`Unknown session: ${sessionId}`)
          }
          return updated
        },
        async interruptSession(sessionId: string) {
          const session = activeProjectSessionManager.getSessionNodeSnapshot(sessionId)?.session
          if (!session) {
            return false
          }
          await activeSessionInputRouter?.send(sessionId, '\u0003')
          return true
        },
        ctlSecret,
        sessionTokenRegistry,
        isCtlEnabled: () => stoaCtlGate.isEnabled()
      })
      app.use(sessionControlServer.app)

      const legacyControlPlaneHooks = {
        workSessionLifecycle: {
          createSession: createWorkSessionWithRuntime,
          archiveSession: archiveWorkSessionWithRuntime
        }
      }
      void legacyControlPlaneHooks
    }
  })
  updateService = new UpdateService({
    app,
    updater: autoUpdater,
    sessionManager: projectSessionManager,
    showSessionWarningDialog: async () => {
      const options = {
        type: 'warning' as const,
        buttons: ['Install and Quit Sessions', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Install Update',
        message: 'Installing the update will close active sessions.',
        detail: 'Continue only if you are ready to stop running sessions and install the downloaded update.'
      }

      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)

      return result.response === 0
    },
    prepareToInstall: prepareForQuitAndInstall,
    onStateChange: pushUpdateState
  })
  const webhookPort = await sessionEventBridge.start()

  async function refreshCtlPortFile(): Promise<void> {
    await writeCtlPortFile({
      port: webhookPort,
      pid: process.pid,
      secret: ctlSecret,
      startedAt: new Date().toISOString()
    })
  }
  await refreshCtlPortFile()

  await syncManagedSidecars({
    snapshotSource: projectSessionManager,
    webhookPort,
    logger: console
  })
  installMainE2EDebugApi()
  await cleanupSidebarTempFile()

  async function resolveRuntimePaths(sessionType: CreateSessionRequest['type']): Promise<{
    shellPath: string | null
    providerPath: string | null
    claudeDangerouslySkipPermissions: boolean
  }> {
    const settings = projectSessionManager?.getSettings() ?? DEFAULT_SETTINGS
    const resolvedPaths = await resolveProviderRuntimePaths(
      sessionType,
      settings,
      {
        detectShell,
        detectProvider
      }
    )

    return {
      ...resolvedPaths,
      claudeDangerouslySkipPermissions: settings.claudeDangerouslySkipPermissions === true
    }
  }

  async function launchSessionRuntimeWithGuard(
    sessionId: string,
    source: 'session-create' | 'session-restore' | 'session-restart' | 'bootstrap-recovery' | 'packaged-smoke',
    options?: {
      awaitDimensions?: boolean
      initialDimensions?: { cols?: number; rows?: number }
      launchToken?: number
      requireExternalSessionIdForResume?: boolean
    }
  ): Promise<boolean> {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      console.log(`[${source}] Aborted runtime launch for ${sessionId}: manager=${!!projectSessionManager} pty=${!!ptyHost} ctrl=${!!runtimeController} bridge=${!!sessionEventBridge}`)
      return false
    }

    try {
      const launchToken = options?.launchToken ?? reserveSessionLaunchToken(sessionId)
      const explicitDimensions = options?.initialDimensions
      let initialDimensions = mergeSessionDimensions(getSessionDimensions(sessionId), explicitDimensions)
      if (options?.awaitDimensions && !explicitDimensions) {
        initialDimensions = await waitForSessionDimensions(sessionId, 5000)
        console.log(`[pty-dimensions] Launching ${sessionId} with dimensions ${initialDimensions.cols}x${initialDimensions.rows}`)
      }

      if (hasCompleteSessionDimensions(initialDimensions)) {
        rememberSessionDimensions(sessionId, initialDimensions)
      }

      const stoaCtlBinDir = join(app.getPath('userData'), 'bin')
      if (stoaCtlGate.isEnabled()) {
        await ensureStoaCtlShim({
          binDir: stoaCtlBinDir,
          appRootPath: app.getAppPath(),
          appExecutablePath: process.execPath,
          isPackaged: app.isPackaged
        })
      } else {
        await unregisterStoaCtlShim(stoaCtlBinDir)
      }

      if (stoaCtlGate.isEnabled()) {
        void ensureStoaCtlSystemShim({
          appRootPath: app.getAppPath(),
          appExecutablePath: process.execPath,
          isPackaged: app.isPackaged
        })
      } else {
        void unregisterStoaCtlSystemShim()
      }

      sessionInputRouter?.resetSession(sessionId)
      const launched = await launchTrackedSessionRuntime({
        sessionId,
        manager: projectSessionManager,
        webhookPort,
        ptyHost,
        runtimeController,
        sessionEventBridge,
        hookLeaseManager: activeHookLeaseManager,
        resolveRuntimePaths,
        initialDimensions,
        commandEnv: buildSessionCommandEnv({
          sessionId,
          sessionToken: activeRuntimeController.getSessionToken(sessionId) ?? '',
          webhookPort,
          stoaCtlBinDir,
          stoaCtlEnabled: stoaCtlGate.isEnabled()
        }),
        launchToken,
        isLaunchTokenCurrent: (candidateLaunchToken) => isSessionLaunchTokenCurrent(sessionId, candidateLaunchToken),
        requireExternalSessionIdForResume: options?.requireExternalSessionIdForResume
      })

      if (launched) {
        console.log(`[${source}] Session ${sessionId} started successfully`)
      } else {
        console.warn(`[${source}] Session ${sessionId} could not be launched because its state was missing.`)
      }

      return launched
    } catch (err: unknown) {
      console.error(`[${source}] Failed to start session ${sessionId}:`, err)
      await runtimeController.markRuntimeFailedToStart(sessionId, `启动失败: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  async function createWorkSessionWithRuntime(
    payload: CreateSessionRequest,
    options: {
      graphOrigin?: SessionGraphEvent['origin']
      initiatorSessionId?: string | null
      preserveActiveSession?: boolean
    } = {}
  ): Promise<SessionSummary | null> {
    const previousActiveSessionId = projectSessionManager?.snapshot().activeSessionId ?? null
    let request = payload
    if (projectSessionManager && payload.parentSessionId) {
      const parentNode = activeProjectSessionManager.getSessionNodeSnapshot(payload.parentSessionId)
      const rootSessionId = parentNode?.tree.rootSessionId ?? payload.parentSessionId
      request = {
        ...payload,
        subagentName: allocateSubagentShortName(listSessionNodeSnapshots(), rootSessionId, payload.subagentName ?? undefined)
      }
    }

    const session = await projectSessionManager?.createSession(request)
    if (!session) {
      return null
    }

    if (options.preserveActiveSession && previousActiveSessionId && previousActiveSessionId !== session.id) {
      await projectSessionManager?.setActiveSession(previousActiveSessionId)
    }

    syncObservabilitySessions()
    const observabilityFocusSessionId = options.preserveActiveSession && previousActiveSessionId
      ? previousActiveSessionId
      : session.id
    pushObservabilitySnapshotsForSession(observabilityFocusSessionId)
    pushSessionGraphEvent(session.id, {
      kind: 'created',
      origin: options.graphOrigin ?? 'renderer',
      initiatorSessionId: options.initiatorSessionId ?? null
    })
    await syncUpdateStateToWindow()
    const explicitDimensions: PartialSessionDimensions = {}
    if (payload.initialCols !== undefined) {
      explicitDimensions.cols = payload.initialCols
    }
    if (payload.initialRows !== undefined) {
      explicitDimensions.rows = payload.initialRows
    }
    const hasExplicitDimensions = Object.keys(explicitDimensions).length > 0
    void launchSessionRuntimeWithGuard(session.id, 'session-create', {
      awaitDimensions: !hasExplicitDimensions,
      initialDimensions: hasExplicitDimensions ? explicitDimensions : undefined
    })
    return session
  }

  async function archiveWorkSessionWithRuntime(
    sessionId: string,
    options: {
      graphKind?: SessionGraphEvent['kind']
      graphOrigin?: SessionGraphEvent['origin']
      initiatorSessionId?: string | null
    } = {}
  ): Promise<SessionSummary | null> {
    if (!projectSessionManager || !ptyHost) {
      return null
    }

    const subtreeSessionIds = getSessionSubtreeIds(sessionId)
    if (subtreeSessionIds.length === 0) {
      return null
    }

    for (const subtreeSessionId of subtreeSessionIds) {
      sessionInputRouter?.resetSession(subtreeSessionId)
      await ptyHost.killAndWait(subtreeSessionId)
      await hookLeaseManager?.releaseLease(subtreeSessionId)
      sessionTokenRegistry.delete(subtreeSessionId)
      activeRuntimeController.invalidateSessionToken(subtreeSessionId)
    }

    await projectSessionManager.archiveSession(sessionId)
    syncObservabilitySessions()
    const nextActiveSessionId = projectSessionManager.snapshot().activeSessionId
    if (nextActiveSessionId) {
      pushObservabilitySnapshotsForSession(nextActiveSessionId)
    }
    pushSessionGraphEvents(subtreeSessionIds, {
      kind: options.graphKind ?? 'archived',
      origin: options.graphOrigin ?? 'renderer',
      initiatorSessionId: options.initiatorSessionId ?? null
    })
    await syncUpdateStateToWindow()
    return projectSessionManager.snapshot().sessions.find((candidate) => candidate.id === sessionId) ?? null
  }

  async function restoreWorkSessionWithRuntime(
    sessionId: string,
    options: {
      graphOrigin?: SessionGraphEvent['origin']
      initiatorSessionId?: string | null
    } = {}
  ): Promise<void> {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      return
    }

    const subtreeSessionIds = getSessionSubtreeIds(sessionId)
    sessionInputRouter?.resetSession(sessionId)
    await projectSessionManager.restoreSession(sessionId)
    syncObservabilitySessions()
    pushObservabilitySnapshotsForSession(sessionId)
    pushSessionGraphEvents(subtreeSessionIds, {
      kind: 'restored',
      origin: options.graphOrigin ?? 'renderer',
      initiatorSessionId: options.initiatorSessionId ?? null
    })
    await syncUpdateStateToWindow()
    void launchSessionRuntimeWithGuard(sessionId, 'session-restore')
  }

  async function runPackagedSmoke(): Promise<void> {
    if (!isPackagedSmokeMode) {
      return
    }

    try {
      if (!app.isPackaged) {
        throw new Error('Packaged smoke mode requires a packaged Electron app.')
      }

      if (!packagedSmokeProjectDir) {
        throw new Error('Missing STOA_PACKAGED_SMOKE_PROJECT_DIR.')
      }

      if (!mainWindow || !projectSessionManager || !ptyHost || !runtimeController) {
        throw new Error('Packaged smoke boot dependencies were not initialized.')
      }

      await recordPackagedSmoke('app-ready', { version: app.getVersion() })

      if (mainWindow.webContents.isLoading()) {
        await new Promise<void>((resolve) => {
          mainWindow?.webContents.once('did-finish-load', () => resolve())
        })
      }
      await recordPackagedSmoke('window-ready')

      await mkdir(packagedSmokeProjectDir, { recursive: true })
      const project = await projectSessionManager.createProject({
        name: 'Packaged Smoke',
        path: packagedSmokeProjectDir,
        defaultSessionType: 'shell'
      })
      await recordPackagedSmoke('project-created', { projectId: project.id })

      const session = await projectSessionManager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'packaged-smoke-shell'
      })
      syncObservabilityAndPushForSession(session.id)
      await syncUpdateStateToWindow()
      await recordPackagedSmoke('session-created', { sessionId: session.id })

      const launched = await launchSessionRuntimeWithGuard(session.id, 'packaged-smoke')
      if (!launched) {
        throw new Error(`Unable to launch packaged smoke session ${session.id}.`)
      }

      const liveStatus = await waitForValue(async () => {
        const currentSession = projectSessionManager?.snapshot().sessions.find((candidate) => candidate.id === session.id)
        if (!currentSession) {
          return null
        }

        const phase = derivePresencePhase({
          runtimeState: currentSession.runtimeState,
          turnState: currentSession.turnState,
          turnEpoch: currentSession.turnEpoch,
          lastTurnOutcome: currentSession.lastTurnOutcome,
          blockingReason: currentSession.blockingReason,
          failureReason: currentSession.failureReason,
          hasUnseenCompletion: currentSession.hasUnseenCompletion,
          runtimeExitCode: currentSession.runtimeExitCode,
          runtimeExitReason: currentSession.runtimeExitReason,
          provider: currentSession.type
        })

        return phase === 'running' || phase === 'ready'
          ? phase
          : null
      }, 'the packaged smoke shell session to become live')
      await recordPackagedSmoke('session-live', {
        sessionId: session.id,
        status: liveStatus
      })

      ptyHost.resize(session.id, 120, 32)
      ptyHost.write(session.id, `echo ${packagedSmokeMarker}\r`)

      const terminalReplay = await waitForValue(async () => {
        const replay = await runtimeController?.getTerminalReplay(session.id) ?? ''
        return replay.includes(packagedSmokeMarker) ? replay : null
      }, 'the packaged smoke marker in terminal replay', 45_000)
      await recordPackagedSmoke('terminal-marker-observed', {
        sessionId: session.id,
        marker: packagedSmokeMarker,
        replayLength: terminalReplay.length
      })

      const claudeProvider = getProvider('claude-code')
      await claudeProvider.installSidecar({
        session_id: 'packaged-smoke-claude',
        project_id: project.id,
        path: packagedSmokeProjectDir,
        title: 'packaged-smoke-claude',
        type: 'claude-code',
        external_session_id: 'packaged-smoke-claude'
      }, {
        webhookPort,
        sessionSecret: 'packaged-smoke-secret',
        providerPort: 0
      })

      const hookSettings = JSON.parse(await readFile(join(packagedSmokeProjectDir, '.claude', 'settings.json'), 'utf8')) as {
        hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string; allowedEnvVars?: string[]; timeout?: number }> }>>
      }
      const sessionStartHook = hookSettings.hooks?.SessionStart?.[0]?.hooks?.[0]
      if (!sessionStartHook) {
        throw new Error('Packaged smoke Claude SessionStart hook is missing.')
      }
      if (sessionStartHook.type !== 'command') {
        throw new Error(`Packaged smoke Claude SessionStart hook must be a command hook.\nHook: ${JSON.stringify(sessionStartHook)}`)
      }
      if (sessionStartHook.command !== '.stoa/hook-dispatch claude-code SessionStart') {
        throw new Error(`Packaged smoke Claude SessionStart hook points to the wrong command.\nHook: ${JSON.stringify(sessionStartHook)}`)
      }
      const expectedAllowedEnvVars = [
        'STOA_HOOK_LEASE_PATH',
        'STOA_HOOK_MANAGED',
        'STOA_HOOK_SESSION_ID',
        'STOA_HOOK_PROJECT_ID',
        'STOA_HOOK_PROVIDER',
        'STOA_HOOK_SPAWN_OWNER_INSTANCE_ID',
        'STOA_HOOK_SPAWN_GENERATION'
      ]
      if (JSON.stringify(sessionStartHook.allowedEnvVars ?? []) !== JSON.stringify(expectedAllowedEnvVars)) {
        throw new Error(`Packaged smoke Claude SessionStart hook allowedEnvVars are invalid.\nHook: ${JSON.stringify(sessionStartHook)}`)
      }
      if (sessionStartHook.timeout !== 5) {
        throw new Error(`Packaged smoke Claude SessionStart hook timeout is invalid.\nHook: ${JSON.stringify(sessionStartHook)}`)
      }
      for (const artifact of [
        '.stoa/hook-dispatch',
        '.stoa/hook-dispatch.cmd',
        '.stoa/hook-dispatch.mjs',
        '.stoa/hook-contract.json'
      ]) {
        await readFile(join(packagedSmokeProjectDir, artifact), 'utf8')
      }
      await recordPackagedSmoke('claude-session-start-hook-verified', {
        hook: sessionStartHook
      })

      await ptyHost.killAndWait(session.id)
      await recordPackagedSmoke('completed', {
        sessionId: session.id
      })
      app.quit()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await recordPackagedSmoke('failed', { message })
      console.error('[packaged-smoke] Failed:', error)
      app.exit(1)
    }
  }

  registerGitHandlers(ipcMain)

  // -------------------------------------------------------------------------
  // Stoa Server (SR) spawning — Phase 5 Desktop Shell Integration
  // Conditionally enabled via stoaServerEnabled setting or STOA_USE_SERVER=true env var.
  // This is additive: existing servers (webhook, session-control) are NOT removed.
  // -------------------------------------------------------------------------
  const persistedSettings = projectSessionManager?.getSettings() ?? null
  const useStoaServer = persistedSettings?.stoaServerEnabled === true || process.env.STOA_USE_SERVER === 'true'

  if (useStoaServer) {
    try {
      const stoaDir = join(homedir(), '.stoa')
      const srConfig: StoaServerConfig = {
        portRange: [3270, 3280],
        stoaDir,
        authToken: ''
      }
      const srDeps: SpawnerDeps = {
        getResourcesPath: () => process.resourcesPath,
        isPackaged: app.isPackaged,
        getAppRootPath: () => app.getAppPath(),
        createRuntimeClient(port: number, authToken: string): StoaRuntimeClient | null {
          return null // Will be wired in Phase 5+ when runtime bridge is fully integrated
        }
      }

      srSpawner = new StoaServerSpawner(srConfig, srDeps)
      const srPort = await srSpawner.spawn()
      console.log(`[main] Stoa Server spawned on port ${srPort}`)
      await srSpawner.waitForHealth()
      await srSpawner.connectRuntime()
      console.log('[main] Stoa Server fully initialized')
    } catch (error) {
      console.error('[main] Stoa Server initialization failed:', error)
      // Non-fatal: existing behaviour continues without SR
    }
  }


  ipcMain.handle(IPC_CHANNELS.projectBootstrap, async () => {
    const snapshot = projectSessionManager?.snapshot() ?? {
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }
    return sanitizeBootstrapStateForGenericProjection(snapshot)
  })

  ipcMain.handle(IPC_CHANNELS.projectCreate, async (_event, payload: CreateProjectRequest) => {
    return projectSessionManager?.createProject(payload) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.projectDelete, async (_event, projectId: string) => {
    if (!projectSessionManager) return

    const snapshot = projectSessionManager.snapshot()
    const project = snapshot.projects.find(p => p.id === projectId)
    const projectSessions = snapshot.sessions.filter(s => s.projectId === projectId)
    for (const session of projectSessions) {
      sessionInputRouter?.resetSession(session.id)
      await ptyHost?.killAndWait(session.id)
      await hookLeaseManager?.releaseLease(session.id)
    }

    if (project) {
      const MANAGED_PROVIDER_TYPES = ['claude-code', 'codex', 'opencode'] as const
      for (const providerType of MANAGED_PROVIDER_TYPES) {
        try {
          const providerId = getProviderDescriptorBySessionType(providerType).providerId
          const provider = getProvider(providerId)
          await provider.uninstallSidecar?.(project.path)
        } catch (error) {
          console.warn(`[project-delete] Failed to uninstall ${providerType} sidecar for ${project.path}:`, error)
        }
      }
    }

    await projectSessionManager.deleteProject(projectId)
    syncObservabilitySessions()
    await syncUpdateStateToWindow()
  })

  ipcMain.handle(IPC_CHANNELS.sessionCreate, async (_event, payload: CreateSessionRequest) => {
    const session = await createWorkSessionWithRuntime(payload, {
      graphOrigin: 'renderer',
      initiatorSessionId: null,
      preserveActiveSession: false
    })
    if (!session) {
      console.log('[session-create] Aborted: no session was created.')
      return null
    }
    return session
  })

  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async (_event, payload: OpenWorkspaceRequest) => {
    if (!projectSessionManager) {
      throw new Error('Unable to open workspace: session manager is not available.')
    }

    if (isE2EMode) {
      e2eWorkspaceOpenRequests.push({ ...payload })
      return
    }

    const snapshot = projectSessionManager.snapshot()
    await openWorkspace({
      request: payload,
      projects: snapshot.projects,
      sessions: snapshot.sessions,
      settings: projectSessionManager.getSettings(),
      shellOpenPath: shell.openPath.bind(shell),
      spawnProcess: spawn
    })
  })

  ipcMain.handle(IPC_CHANNELS.projectSetActive, async (_event, projectId: string) => {
    await projectSessionManager?.setActiveProject(projectId)
    syncObservabilitySessions()
    const activeSessionId = projectSessionManager?.snapshot().activeSessionId ?? null
    if (activeSessionId) {
      pushObservabilitySnapshotsForSession(activeSessionId)
    }
  })

  ipcMain.handle(IPC_CHANNELS.sessionSetActive, async (_event, sessionId: string) => {
    await projectSessionManager?.setActiveSession(sessionId)
    syncObservabilitySessions()
    pushObservabilitySnapshotsForSession(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.observabilityGetSessionPresence, async (_event, sessionId: string) => {
    return observabilityService?.getSessionPresence(sessionId) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.observabilityGetProject, async (_event, projectId: string) => {
    return observabilityService?.getProjectObservability(projectId) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.observabilityGetApp, async () => {
    return observabilityService?.getAppObservability() ?? null
  })

  ipcMain.handle(
    IPC_CHANNELS.observabilityListSessionEvents,
    async (_event, sessionId: string, options: ListObservationEventsOptions) => {
      return observationStore?.listSessionEvents(sessionId, normalizeObservationListOptions(options)) ?? {
        events: [],
        nextCursor: null
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.sessionTerminalReplay, async (_event, sessionId: string) => {
    return runtimeController?.getTerminalReplay(sessionId) ?? ''
  })

  ipcMain.on(IPC_CHANNELS.sessionInput, (_event, sessionId: string, data: string) => {
    if (INPUT_DEBUG) {
      console.log('[input-debug] sessionInput', {
        sessionId,
        data,
        codes: [...data].map((char) => char.charCodeAt(0))
      })
    }
    void sessionInputRouter?.send(sessionId, data)
  })

  ipcMain.on(IPC_CHANNELS.sessionBinaryInput, (_event, sessionId: string, data: Uint8Array) => {
    void sessionInputRouter?.sendBinary(sessionId, data)
  })

  ipcMain.handle(IPC_CHANNELS.sessionResize, async (_event, sessionId: string, cols: number, rows: number) => {
    const pending = pendingLaunchSessions.get(sessionId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingLaunchSessions.delete(sessionId)
      pending.resolve({ cols, rows })
    }
    rememberSessionDimensions(sessionId, { cols, rows })
    ptyHost?.resize(sessionId, cols, rows)
  })

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => {
    return projectSessionManager?.getSettings() ?? null
  })

  ipcMain.handle(IPC_CHANNELS.settingsSet, async (_event, key: string, value: unknown) => {
    await projectSessionManager?.setSetting(key, value)
  })

  projectSessionManager.on('settings:updated', (settings: AppSettings) => {
    void stoaCtlGate.setEnabled(settings.stoaCtlEnabled === true)
  })

  ipcMain.handle(IPC_CHANNELS.titleGenerationFetchModels, async (_event, baseUrl: string, apiKey: string) => {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/models`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const data = await response.json() as any
      if (data && Array.isArray(data.data)) {
        return data.data.map((m: any) => typeof m === 'object' && m !== null && typeof m.id === 'string' ? m.id : String(m))
      }
      if (Array.isArray(data)) {
        return data.map((m: any) => String(m))
      }
      throw new Error('Unexpected models response format')
    } catch (error: any) {
      throw new Error(`Failed to fetch models: ${error?.message || String(error)}`)
    }
  })

  ipcMain.handle(IPC_CHANNELS.dialogPickFolder, async (_event, options?: { title?: string }) => {
    if (isE2EMode) {
      return pendingE2EPickFolders.shift() ?? null
    }

    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: options?.title ?? 'Select Folder'
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC_CHANNELS.dialogPickFile, async (_event, options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: options?.title ?? 'Select File',
      filters: options?.filters
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  registerFilesystemHandlers(ipcMain, () => mainWindow)

  ipcMain.handle(IPC_CHANNELS.shellShowItemInFolder, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC_CHANNELS.fsOpenFile, async (_event, filePath: string, _line?: number, _column?: number) => {
    await shell.openPath(filePath)
  })

  ipcMain.handle(IPC_CHANNELS.sidebarGetState, async () => {
    return await readSidebarState()
  })

  ipcMain.handle(IPC_CHANNELS.sidebarSetState, async (_event, state: Partial<import('@shared/sidebar-types').SidebarState>) => {
    const current = await readSidebarState() ?? { open: false, activeTab: 'explorer' as const, width: 280, sessionListWidth: 240, activeTabByProject: {} as Record<string, string> }
    await writeSidebarState({ ...current, ...state, activeTabByProject: state.activeTabByProject ?? current.activeTabByProject ?? {} })
  })

  ipcMain.handle(IPC_CHANNELS.settingsDetectShell, async () => {
    return detectShell()
  })

  ipcMain.handle(IPC_CHANNELS.settingsDetectProvider, async (_event, providerId: string) => {
    const descriptor = getProviderDescriptorByProviderId(providerId)
    return detectProvider(descriptor?.executableName ?? providerId, projectSessionManager?.getSettings().shellPath ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.settingsDetectVscode, async () => {
    return detectVscode()
  })

  ipcMain.handle(IPC_CHANNELS.windowMinimize, () => {
    mainWindow?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.windowMaximize, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle(IPC_CHANNELS.windowClose, () => {
    mainWindow?.close()
  })

  ipcMain.handle(IPC_CHANNELS.windowIsMaximized, () => {
    return mainWindow?.isMaximized() ?? false
  })

  ipcMain.handle(IPC_CHANNELS.sessionArchive, async (_event, sessionId: string) => {
    await archiveWorkSessionWithRuntime(sessionId, {
      graphKind: 'archived',
      graphOrigin: 'renderer',
      initiatorSessionId: null
    })
  })

  ipcMain.handle(IPC_CHANNELS.sessionRegenerateTitle, async (_event, sessionId: string) => {
    const session = await sessionTitleController?.regenerateSessionTitle(sessionId) ?? null
    return session ? sanitizeSessionSummaryForGenericProjection(session) : null
  })

  ipcMain.handle(IPC_CHANNELS.sessionRestore, async (_event, sessionId: string) => {
    await restoreWorkSessionWithRuntime(sessionId, {
      graphOrigin: 'renderer',
      initiatorSessionId: null
    })
  })

  ipcMain.handle(IPC_CHANNELS.sessionRestart, async (_event, sessionId: string) => {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      throw new Error('Unable to restart session: runtime dependencies are unavailable.')
    }

    const snapshot = projectSessionManager.snapshot()
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId && !candidate.archived)
    if (!session) {
      throw new Error(`Unable to restart session: ${sessionId} was not found.`)
    }

    const descriptor = getProviderDescriptorBySessionType(session.type)
    const provider = getProvider(descriptor.providerId)
    if (descriptor.supportsResume && provider.supportsResume() && !session.externalSessionId) {
      throw new Error(`Cannot restart ${session.type} session before its external session id is stored.`)
    }

    const launchToken = reserveSessionLaunchToken(sessionId)
    await projectSessionManager.setActiveSession(sessionId)
    syncObservabilitySessions()
    pushObservabilitySnapshotsForSession(sessionId)

    sessionInputRouter?.resetSession(sessionId)
    await ptyHost.killAndWait(sessionId)
    await activeHookLeaseManager.releaseLease(sessionId)

    const launched = await launchSessionRuntimeWithGuard(sessionId, 'session-restart', {
      launchToken,
      requireExternalSessionIdForResume: true
    })

    if (!launched) {
      throw new Error(`Unable to restart session ${sessionId}.`)
    }

    await syncUpdateStateToWindow()
  })

  ipcMain.handle(IPC_CHANNELS.sessionListArchived, async () => {
    return (projectSessionManager?.getArchivedSessions() ?? []).map(sanitizeSessionSummaryForGenericProjection)
  })

  ipcMain.handle(IPC_CHANNELS.updateGetState, async () => {
    return updateService?.getState() ?? createDisabledUpdateState()
  })

  ipcMain.handle(IPC_CHANNELS.updateCheck, async () => {
    return updateService?.checkForUpdates() ?? createDisabledUpdateState()
  })

  ipcMain.handle(IPC_CHANNELS.updateDownload, async () => {
    return updateService?.downloadUpdate() ?? createDisabledUpdateState()
  })

  ipcMain.handle(IPC_CHANNELS.updateQuitAndInstall, async () => {
    await updateService?.quitAndInstall()
  })

  ipcMain.handle(IPC_CHANNELS.updateDismiss, async () => {
    await updateService?.dismiss()
  })

  ipcMain.handle(IPC_CHANNELS.sidecarUninstall, async (_event, projectId: string) => {
    if (!projectSessionManager) return

    const snapshot = projectSessionManager.snapshot()
    const project = snapshot.projects.find(p => p.id === projectId)
    if (!project) return

    const MANAGED_PROVIDER_TYPES = ['claude-code', 'codex', 'opencode'] as const
    for (const providerType of MANAGED_PROVIDER_TYPES) {
      try {
        const providerId = getProviderDescriptorBySessionType(providerType).providerId
        const provider = getProvider(providerId)
        await provider.uninstallSidecar?.(project.path)
      } catch (error) {
        console.warn(`[sidecar-uninstall] Failed to uninstall ${providerType} sidecar for ${project.path}:`, error)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.serverGetInfo, () => {
    // Priority 1: Stoa Server spawner (when STOA_USE_SERVER=true)
    if (srSpawner) {
      const port = srSpawner.getPort()
      const token = srSpawner.getAuthToken()
      return {
        available: true,
        port,
        url: `http://localhost:${port}`,
        token
      }
    }
    // Priority 2: Fall back to existing webhook/session-control server port
    // This is always running, so the user always sees a reachable URL.
    const fallbackPort = webhookPort
    if (fallbackPort) {
      return {
        available: true,
        port: fallbackPort,
        url: `http://localhost:${fallbackPort}`,
        token: ctlSecret
      }
    }
    return { available: false, port: 0, url: '', token: '' }
  })

  ipcMain.handle(IPC_CHANNELS.evidenceListSessionSnapshots, async (_event, sessionId: string) => {
    if (!projectSessionManager || !evidenceStore) return []

    const state = projectSessionManager.snapshot()
    const session = state.sessions.find(s => s.id === sessionId)
    if (!session) return []
    const project = state.projects.find(p => p.id === session.projectId)
    if (!project) return []
    return evidenceStore.listSnapshots(project.path, sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.contextExportFullText, async (_event, sessionId: string, options?: { includeThinking?: boolean; includeToolDetails?: boolean; maxChars?: number; cursor?: string }) => {
    if (!projectSessionManager || !runtimeController) {
      return { text: '', truncated: false, totalTurns: 0 }
    }
    const { handleContextExportFullText } = await import('@core/context/session-context-exporter')
    return handleContextExportFullText(sessionId, options ?? {}, { projectSessionManager, runtimeController })
  })

  ipcMain.handle(IPC_CHANNELS.contextExportSlimText, async (_event, sessionId: string, options?: { maxChars?: number; cursor?: string }) => {
    if (!projectSessionManager) {
      return { text: '', truncated: false, totalTurns: 0 }
    }
    const { handleContextExportSlimText } = await import('@core/context/session-context-exporter')
    return handleContextExportSlimText(sessionId, options ?? {}, { projectSessionManager })
  })

  mainWindow = createMainWindow()
  await syncUpdateStateToWindow()

  ipcMain.on(IPC_CHANNELS.debugToggleDevTools, () => {
    handleDebugToggleDevTools()
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.windowMaximizeChanged, true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.windowMaximizeChanged, false)
  })

  if (isPackagedSmokeMode) {
    void runPackagedSmoke()
  }

  for (const plan of projectSessionManager.buildBootstrapRecoveryPlan()) {
    void launchSessionRuntimeWithGuard(plan.sessionId, 'bootstrap-recovery')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      void syncUpdateStateToWindow()
    }
  })
}).catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  await recordPackagedSmoke('failed', { message })
  console.error('[main] Failed during startup:', error)
  app.exit(1)
})

app.on('before-quit', async (event) => {
  if (isQuittingAfterBridgeStop) {
    unsubscribeStoaCtlGate()
    return
  }

  event.preventDefault()
  try {
    await deleteCtlPortFile()
    await prepareForQuitAndInstall()
    if (srSpawner) {
      await srSpawner.shutdown()
    }
  } finally {
    unsubscribeStoaCtlGate()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
