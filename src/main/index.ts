import { BrowserWindow, Menu, dialog, app, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { InMemoryObservationStore } from '@core/observation-store'
import type { ListObservationEventsOptions } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import { detectShell, detectProvider, detectVscode } from '@core/settings-detector'
import { HermesCommandDispatcher } from '@core/hermes-command-dispatcher'
import { HermesContextAssembler } from '@core/hermes-context-assembler'
import { createHermesControlServer } from '@core/hermes-control-server'
import { HermesManager } from '@core/hermes-manager'
import { SessionEvidenceStore } from '@core/memory/session-evidence-store'
import { HermesProposalStore } from '@core/hermes-proposal-store'
import { deriveHermesProviderSessionPatch } from '@core/hermes-provider-patch'
import { buildHermesCommandEnv } from '@core/hermes-command-env'
import { resolveHermesStateFilePath } from '@core/hermes-state-store'
import { ensureStoaCtlShim } from '@core/stoa-ctl-shim'
import { openWorkspace } from '@core/workspace-launcher'
import { resolveRuntimePaths as resolveProviderRuntimePaths } from '@core/provider-path-resolver'
import { getProvider } from '@extensions/providers'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { derivePresencePhase } from '@shared/session-state-reducer'
import { SessionRuntimeController } from './session-runtime-controller'
import { SessionEventBridge } from './session-event-bridge'
import { SessionInputRouter } from './session-input-router'
import { launchTrackedSessionRuntime } from './launch-tracked-session-runtime'
import { syncObservabilitySessionsFromManager } from './observability-sync'
import { syncManagedSidecars } from './managed-sidecar-maintenance'
import { UpdateService } from './update-service'
import { resolveDefaultStoaRuntimeRoot } from './stoa-runtime-root'
import { createHookLeaseManager } from './hook-lease-manager'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import type {
  CreateProjectRequest,
  CreateSessionRequest,
  OpenWorkspaceRequest
} from '@shared/project-session'
import type { CreateHermesSessionRequest, HermesSessionSummary } from '@shared/hermes'
import type { UpdateState } from '@shared/update-state'
import type { PtyHost } from '@core/pty-host'

let mainWindow: BrowserWindow | null = null
let projectSessionManager: ProjectSessionManager | null = null
let ptyHost: PtyHost | null = null
let runtimeController: SessionRuntimeController | null = null
let sessionEventBridge: SessionEventBridge | null = null
let sessionInputRouter: SessionInputRouter | null = null
let observationStore: InMemoryObservationStore | null = null
let observabilityService: ObservabilityService | null = null
let updateService: UpdateService | null = null
let hermesManager: HermesManager | null = null
let evidenceStore: SessionEvidenceStore | null = null
let hookLeaseManager: ReturnType<typeof createHookLeaseManager> | null = null
const e2eWorkspaceOpenRequests: OpenWorkspaceRequest[] = []
let isQuittingAfterBridgeStop = false
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
  sessionInputRouter?.dispose()
  sessionInputRouter = null
  await stopSessionEventBridge()
  await hookLeaseManager?.stop()
  hookLeaseManager = null
}

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

function pushHermesSessionEvent(session: HermesSessionSummary): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send(IPC_CHANNELS.hermesSessionEvent, { session })
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
  hermesManager = await HermesManager.create({
    statePath: resolveHermesStateFilePath(e2eGlobalStatePath)
  })
  observationStore = new InMemoryObservationStore()
  observabilityService = new ObservabilityService(observationStore)
  evidenceStore = new SessionEvidenceStore()

  syncObservabilitySessions()

  const { PtyHost } = await import('@core/pty-host')
  ptyHost = new PtyHost()
  sessionInputRouter = new SessionInputRouter(
    {
      getSessionType(sessionId) {
        const projectSessionType = projectSessionManager?.snapshot().sessions.find((candidate) => candidate.id === sessionId)?.type ?? null
        if (projectSessionType) {
          return projectSessionType
        }

        return hermesManager?.hasSession(sessionId) ? 'hermes-agent' : null
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
  const activeHermesManager = hermesManager
  const runtimeRoot = resolveDefaultStoaRuntimeRoot()
  hookLeaseManager = createHookLeaseManager({
    runtimeRoot,
    instanceId: `stoa-${process.pid}-${Date.now()}`
  })
  const activeHookLeaseManager = hookLeaseManager
  const hermesProposalStore = await HermesProposalStore.create({
    statePath: resolveHermesStateFilePath(e2eGlobalStatePath)
  })
  const hermesContextAssembler = new HermesContextAssembler({
    snapshotSource: activeProjectSessionManager,
    getSessionPresence(sessionId) {
      return activeObservabilityService?.getSessionPresence(sessionId) ?? null
    },
    listSessionEvents(sessionId, options) {
      return activeObservationStore?.listSessionEvents(sessionId, {
        limit: options?.limit ?? 100,
        cursor: options?.cursor,
        categories: options?.categories,
        includeEphemeral: options?.includeEphemeral ?? true
      }) ?? {
        events: [],
        nextCursor: null
      }
    },
    async getTerminalReplay(sessionId) {
      return await activeRuntimeController?.getTerminalReplay(sessionId) ?? ''
    }
  })
  const hermesCommandDispatcher = new HermesCommandDispatcher({
    snapshotSource: activeProjectSessionManager,
    sessionInput: {
      async send(sessionId, data) {
        await activeSessionInputRouter?.send(sessionId, data)
      }
    },
    proposals: hermesProposalStore
  })
  const compositeRuntimeController = {
    async applyProviderStatePatch(patch: import('@shared/project-session').SessionStatePatchEvent) {
      if (activeHermesManager?.hasSession(patch.sessionId)) {
        const hermesSession = activeHermesManager.getSession(patch.sessionId)
        if (!hermesSession) {
          return
        }

        await activeHermesManager.updateSession(
          patch.sessionId,
          deriveHermesProviderSessionPatch(hermesSession, patch)
        )
        const next = activeHermesManager.getSession(patch.sessionId)
        if (next) {
          pushHermesSessionEvent(next)
        }
        return
      }

      await activeRuntimeController.applyProviderStatePatch(patch)
    }
  }
  sessionEventBridge = new SessionEventBridge(activeProjectSessionManager, compositeRuntimeController, activeObservabilityService, {
    captureEvidence: false,
    authorizeHookRequest: activeHookLeaseManager
      ? async (input) => await activeHookLeaseManager.authorizeHookRequest(input)
      : undefined,
    configureServerApp(app) {
      const hermesControlServer = createHermesControlServer({
        app,
        getSessionSecret(sessionId) {
          return activeHookLeaseManager?.debugSnapshotSessionSecrets()[sessionId]
            ?? sessionEventBridge?.debugSnapshotSessionSecrets()[sessionId]
            ?? null
        },
        hermesSessionSource: activeHermesManager!,
        snapshotSource: activeProjectSessionManager,
        getSessionPresence(sessionId) {
          return activeObservabilityService?.getSessionPresence(sessionId) ?? null
        },
        contextAssembler: hermesContextAssembler,
        dispatcher: hermesCommandDispatcher,
        proposals: hermesProposalStore
      })
      void hermesControlServer
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
  await syncManagedSidecars({
    snapshotSource: projectSessionManager,
    webhookPort,
    logger: console
  })
  installMainE2EDebugApi()

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
    source: 'session-create' | 'session-restore' | 'bootstrap-recovery' | 'packaged-smoke',
    options?: { awaitDimensions?: boolean }
  ): Promise<boolean> {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      console.log(`[${source}] Aborted runtime launch for ${sessionId}: manager=${!!projectSessionManager} pty=${!!ptyHost} ctrl=${!!runtimeController} bridge=${!!sessionEventBridge}`)
      return false
    }

    try {
      let initialDimensions: { cols: number; rows: number } | undefined
      if (options?.awaitDimensions) {
        initialDimensions = await waitForSessionDimensions(sessionId, 5000)
        console.log(`[pty-dimensions] Launching ${sessionId} with dimensions ${initialDimensions.cols}x${initialDimensions.rows}`)
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
        initialDimensions
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

  async function launchHermesRuntimeWithGuard(
    sessionId: string,
    source: 'hermes-create' | 'hermes-restore'
  ): Promise<boolean> {
    if (!hermesManager || !ptyHost || !runtimeController || !sessionEventBridge || !projectSessionManager) {
      return false
    }

    const hermesSession = hermesManager.getSession(sessionId)
    if (!hermesSession) {
      return false
    }

    const sessionSecret = activeHookLeaseManager?.debugSnapshotSessionSecrets()[sessionId]
      ?? sessionEventBridge.issueSessionSecret(sessionId)
    const hermesBinDir = join(app.getPath('userData'), 'bin')
    const stoaCtlShim = await ensureStoaCtlShim({
      binDir: hermesBinDir,
      appRootPath: app.getAppPath(),
      appExecutablePath: process.execPath,
      isPackaged: app.isPackaged
    })

    const workingDirectory = projectSessionManager.snapshot().projects[0]?.path ?? process.cwd()
    const runtimeManager = {
      snapshot() {
        return {
          activeProjectId: 'stoa-hermes',
          activeSessionId: sessionId,
          terminalWebhookPort: projectSessionManager?.snapshot().terminalWebhookPort ?? null,
          projects: [{
            id: 'stoa-hermes',
            name: 'Hermes',
            path: workingDirectory,
            createdAt: hermesSession.createdAt,
            updatedAt: hermesSession.updatedAt
          }],
          sessions: [{
            id: hermesSession.id,
            projectId: 'stoa-hermes',
            type: hermesSession.backendSessionType,
            runtimeState: hermesSession.status === 'failed'
              ? 'failed_to_start'
              : hermesSession.status === 'closed'
                ? 'exited'
                : hermesSession.status === 'created'
                  ? 'created'
                  : hermesSession.status === 'starting'
                    ? 'starting'
                    : 'alive',
            turnState: hermesSession.status === 'running' ? 'running' : 'idle',
            turnEpoch: 0,
            lastTurnOutcome: 'none' as const,
            hasUnseenCompletion: false,
            runtimeExitCode: null,
            runtimeExitReason: hermesSession.status === 'closed' ? 'clean' : null,
            lastStateSequence: 0,
            blockingReason: hermesSession.status === 'waiting_approval' ? 'permission' : null,
            failureReason: hermesSession.status === 'failed' ? 'failed_to_start' : null,
            title: hermesSession.title,
            summary: hermesSession.lastSummary,
            recoveryMode: 'resume-external' as const,
            externalSessionId: hermesSession.resumeSessionId,
            createdAt: hermesSession.createdAt,
            updatedAt: hermesSession.updatedAt,
            lastActivatedAt: hermesSession.lastActivatedAt,
            archived: false
          }]
        }
      }
    }

    const runtimeHooks = {
      async markRuntimeStarting(targetSessionId: string, summary: string, externalSessionId: string | null) {
        await hermesManager?.updateSession(targetSessionId, {
          status: 'starting',
          lastSummary: summary,
          resumeSessionId: externalSessionId
        })
        const next = hermesManager?.getSession(targetSessionId)
        if (next) {
          pushHermesSessionEvent(next)
        }
      },
      async markRuntimeAlive(targetSessionId: string, externalSessionId: string | null) {
        await hermesManager?.updateSession(targetSessionId, {
          status: 'running',
          resumeSessionId: externalSessionId
        })
        const next = hermesManager?.getSession(targetSessionId)
        if (next) {
          pushHermesSessionEvent(next)
        }
      },
      async markRuntimeExited(targetSessionId: string, _exitCode: number | null, summary: string) {
        await hermesManager?.updateSession(targetSessionId, {
          status: 'idle',
          lastSummary: summary
        })
        const next = hermesManager?.getSession(targetSessionId)
        if (next) {
          pushHermesSessionEvent(next)
        }
      },
      async markRuntimeFailedToStart(targetSessionId: string, summary: string) {
        await hermesManager?.updateSession(targetSessionId, {
          status: 'failed',
          lastSummary: summary
        })
        const next = hermesManager?.getSession(targetSessionId)
        if (next) {
          pushHermesSessionEvent(next)
        }
      },
      async appendTerminalData(chunk: { sessionId: string; data: string }) {
        await runtimeController?.appendTerminalData(chunk)
      }
    }

    sessionInputRouter?.resetSession(sessionId)
    const launched = await launchTrackedSessionRuntime({
      sessionId,
      manager: runtimeManager as never,
      webhookPort,
      ptyHost,
      runtimeController: runtimeHooks as never,
      sessionEventBridge,
      hookLeaseManager: activeHookLeaseManager,
      resolveRuntimePaths,
      initialDimensions: { cols: 120, rows: 30 },
      commandEnv: buildHermesCommandEnv({
        sessionId,
        sessionSecret,
        webhookPort,
        stoaCtlBinDir: stoaCtlShim.binDir
      })
    })

    void source
    return launched
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

      ptyHost.kill(session.id)
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

  ipcMain.handle(IPC_CHANNELS.projectBootstrap, async () => {
    return projectSessionManager?.snapshot() ?? {
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }
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
      ptyHost?.kill(session.id)
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
    const session = await projectSessionManager?.createSession(payload)
    if (session) {
      syncObservabilityAndPushForSession(session.id)
    }
    await syncUpdateStateToWindow()
    if (!session) {
      console.log('[session-create] Aborted: no session was created.')
      return null
    }

    void launchSessionRuntimeWithGuard(session.id, 'session-create', { awaitDimensions: true })
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
    ptyHost?.resize(sessionId, cols, rows)
  })

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => {
    return projectSessionManager?.getSettings() ?? null
  })

  ipcMain.handle(IPC_CHANNELS.settingsSet, async (_event, key: string, value: unknown) => {
    await projectSessionManager?.setSetting(key, value)
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
    if (!projectSessionManager || !ptyHost) return
    sessionInputRouter?.resetSession(sessionId)
    ptyHost.kill(sessionId)
    await hookLeaseManager?.releaseLease(sessionId)
    await projectSessionManager.archiveSession(sessionId)
    syncObservabilitySessions()
    pushObservabilitySnapshotsForSession(sessionId)
    await syncUpdateStateToWindow()
  })

  ipcMain.handle(IPC_CHANNELS.sessionRestore, async (_event, sessionId: string) => {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      return
    }

    sessionInputRouter?.resetSession(sessionId)
    await projectSessionManager.restoreSession(sessionId)
    syncObservabilityAndPushForSession(sessionId)
    await syncUpdateStateToWindow()
    void launchSessionRuntimeWithGuard(sessionId, 'session-restore')
  })

  ipcMain.handle(IPC_CHANNELS.sessionListArchived, async () => {
    return projectSessionManager?.getArchivedSessions() ?? []
  })

  ipcMain.handle(IPC_CHANNELS.hermesBootstrap, async () => {
    const snapshot = hermesManager?.snapshot()
    return {
      activeHermesSessionId: snapshot?.activeHermesSessionId ?? null,
      sessions: snapshot?.sessions ?? [],
      inspectorTarget: snapshot?.inspectorTarget ?? { kind: 'app' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.hermesSessionCreate, async (_event, payload: CreateHermesSessionRequest) => {
    const created = await hermesManager?.createSession(payload)
    if (!created) {
      return null
    }

    pushHermesSessionEvent(created)
    void launchHermesRuntimeWithGuard(created.id, 'hermes-create')
    return created
  })

  ipcMain.handle(IPC_CHANNELS.hermesSessionSetActive, async (_event, sessionId: string) => {
    await hermesManager?.setActiveSession(sessionId)
    const session = hermesManager?.getSession(sessionId)
    if (session) {
      pushHermesSessionEvent(session)
    }
  })

  ipcMain.handle(IPC_CHANNELS.hermesSessionClose, async (_event, sessionId: string) => {
    ptyHost?.kill(sessionId)
    await hookLeaseManager?.releaseLease(sessionId)
    await hermesManager?.closeSession(sessionId)
    const session = hermesManager?.getSession(sessionId)
    if (session) {
      pushHermesSessionEvent(session)
    }
  })

  ipcMain.handle(IPC_CHANNELS.hermesProposalList, async () => {
    return hermesProposalStore.list()
  })

  ipcMain.handle(IPC_CHANNELS.hermesProposalGet, async (_event, proposalId: string) => {
    return hermesProposalStore.get(proposalId)
  })

  ipcMain.handle(IPC_CHANNELS.hermesProposalApprove, async (_event, proposalId: string) => {
    const proposal = await hermesProposalStore.markApproved(proposalId)
    const snapshot = hermesManager?.snapshot()
    const hermesSessionId = proposal?.hermesSessionId
    if (proposal && hermesSessionId) {
      const nextCount = hermesProposalStore.list().filter((candidate) => {
        return candidate.hermesSessionId === hermesSessionId && candidate.status === 'pending_approval'
      }).length
      await hermesManager?.updateSession(hermesSessionId, {
        pendingProposalCount: nextCount
      })
      const session = snapshot?.sessions.find((candidate) => candidate.id === hermesSessionId)
      if (session) {
        pushHermesSessionEvent({
          ...session,
          pendingProposalCount: nextCount
        })
      }
    }
    return proposal
  })

  ipcMain.handle(IPC_CHANNELS.hermesProposalReject, async (_event, proposalId: string, reason?: string) => {
    const proposal = await hermesProposalStore.markRejected(proposalId, reason)
    const snapshot = hermesManager?.snapshot()
    const hermesSessionId = proposal?.hermesSessionId
    if (proposal && hermesSessionId) {
      const nextCount = hermesProposalStore.list().filter((candidate) => {
        return candidate.hermesSessionId === hermesSessionId && candidate.status === 'pending_approval'
      }).length
      await hermesManager?.updateSession(hermesSessionId, {
        pendingProposalCount: nextCount
      })
      const session = snapshot?.sessions.find((candidate) => candidate.id === hermesSessionId)
      if (session) {
        pushHermesSessionEvent({
          ...session,
          pendingProposalCount: nextCount
        })
      }
    }
    return proposal
  })

  ipcMain.handle(IPC_CHANNELS.hermesProposalDispatch, async (_event, proposalId: string) => {
    await hermesCommandDispatcher.dispatchProposal(proposalId)
    const proposal = hermesProposalStore.get(proposalId)
    const snapshot = hermesManager?.snapshot()
    const hermesSessionId = proposal?.hermesSessionId
    if (proposal && hermesSessionId) {
      const nextCount = hermesProposalStore.list().filter((candidate) => {
        return candidate.hermesSessionId === hermesSessionId && candidate.status === 'pending_approval'
      }).length
      await hermesManager?.updateSession(hermesSessionId, {
        pendingProposalCount: nextCount
      })
      const session = snapshot?.sessions.find((candidate) => candidate.id === hermesSessionId)
      if (session) {
        pushHermesSessionEvent({
          ...session,
          pendingProposalCount: nextCount
        })
      }
    }
    return proposal
  })

  ipcMain.handle(IPC_CHANNELS.hermesInspectorSetTarget, async (_event, target) => {
    await hermesManager?.setInspectorTarget(target)
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

  for (const plan of hermesManager.buildBootstrapRecoveryPlan()) {
    void launchHermesRuntimeWithGuard(plan.sessionId, 'hermes-restore')
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
    return
  }

  event.preventDefault()
  try {
    await prepareForQuitAndInstall()
  } finally {
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
