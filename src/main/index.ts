import { BrowserWindow, Menu, dialog, app, ipcMain } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { InMemoryObservationStore } from '@core/observation-store'
import type { ListObservationEventsOptions } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import { detectShell, detectProvider } from '@core/settings-detector'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { derivePresencePhase } from '@shared/session-state-reducer'
import { SessionRuntimeController } from './session-runtime-controller'
import { SessionEventBridge } from './session-event-bridge'
import { launchTrackedSessionRuntime } from './launch-tracked-session-runtime'
import { syncObservabilitySessionsFromManager } from './observability-sync'
import { UpdateService } from './update-service'
import type { CreateProjectRequest, CreateSessionRequest } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'
import type { PtyHost } from '@core/pty-host'

let mainWindow: BrowserWindow | null = null
let projectSessionManager: ProjectSessionManager | null = null
let ptyHost: PtyHost | null = null
let runtimeController: SessionRuntimeController | null = null
let sessionEventBridge: SessionEventBridge | null = null
let observationStore: InMemoryObservationStore | null = null
let observabilityService: ObservabilityService | null = null
let updateService: UpdateService | null = null
let isQuittingAfterBridgeStop = false
const pendingE2EPickFolders: Array<string | null> = []
const isE2EMode = process.env.VIBECODING_E2E === '1'

const DEBUG_CODE = '114514'
let debugModeActive = false

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
        sessionSecrets: sessionEventBridge?.debugSnapshotSessionSecrets() ?? {},
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
  await stopSessionEventBridge()
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
  observationStore = new InMemoryObservationStore()
  observabilityService = new ObservabilityService(observationStore)

  syncObservabilitySessions()

  const { PtyHost } = await import('@core/pty-host')
  ptyHost = new PtyHost()

  runtimeController = new SessionRuntimeController(
    projectSessionManager,
    () => mainWindow,
    () => {
      void syncUpdateStateToWindow()
    },
    observabilityService
  )
  sessionEventBridge = new SessionEventBridge(projectSessionManager, runtimeController, observabilityService)
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
  installMainE2EDebugApi()

  async function resolveRuntimePaths(sessionType: CreateSessionRequest['type']): Promise<{
    shellPath: string | null
    providerPath: string | null
    claudeDangerouslySkipPermissions: boolean
  }> {
    const descriptor = getProviderDescriptorBySessionType(sessionType)
    const settings = projectSessionManager?.getSettings()
    const configuredShellPath = settings?.shellPath?.trim() ?? ''
    const shellPath = configuredShellPath.length > 0 ? configuredShellPath : await detectShell()

    if (descriptor.providerId === 'local-shell') {
      return {
        shellPath,
        providerPath: null,
        claudeDangerouslySkipPermissions: settings?.claudeDangerouslySkipPermissions === true
      }
    }

    const configuredProviderPath = settings?.providers[descriptor.providerId]?.trim() ?? ''
    const providerPath =
      configuredProviderPath.length > 0
        ? configuredProviderPath
        : await detectProvider(descriptor.executableName, shellPath)

    return {
      shellPath,
      providerPath,
      claudeDangerouslySkipPermissions: settings?.claudeDangerouslySkipPermissions === true
    }
  }

  async function launchSessionRuntimeWithGuard(
    sessionId: string,
    source: 'session-create' | 'session-restore' | 'bootstrap-recovery' | 'packaged-smoke'
  ): Promise<boolean> {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      console.log(`[${source}] Aborted runtime launch for ${sessionId}: manager=${!!projectSessionManager} pty=${!!ptyHost} ctrl=${!!runtimeController} bridge=${!!sessionEventBridge}`)
      return false
    }

    try {
      const launched = await launchTrackedSessionRuntime({
        sessionId,
        manager: projectSessionManager,
        webhookPort,
        ptyHost,
        runtimeController,
        sessionEventBridge,
        resolveRuntimePaths
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
          agentState: currentSession.agentState,
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

    void launchSessionRuntimeWithGuard(session.id, 'session-create')
    return session
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

  ipcMain.handle(IPC_CHANNELS.sessionInput, async (_event, sessionId: string, data: string) => {
    ptyHost?.write(sessionId, data)
  })

  ipcMain.handle(IPC_CHANNELS.sessionResize, async (_event, sessionId: string, cols: number, rows: number) => {
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
    ptyHost.kill(sessionId)
    await projectSessionManager.archiveSession(sessionId)
    syncObservabilitySessions()
    pushObservabilitySnapshotsForSession(sessionId)
    await syncUpdateStateToWindow()
  })

  ipcMain.handle(IPC_CHANNELS.sessionRestore, async (_event, sessionId: string) => {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      return
    }

    await projectSessionManager.restoreSession(sessionId)
    syncObservabilityAndPushForSession(sessionId)
    await syncUpdateStateToWindow()
    void launchSessionRuntimeWithGuard(sessionId, 'session-restore')
  })

  ipcMain.handle(IPC_CHANNELS.sessionListArchived, async () => {
    return projectSessionManager?.getArchivedSessions() ?? []
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
