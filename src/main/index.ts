import { BrowserWindow, Menu, dialog, app, ipcMain } from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { PtyHost } from '@core/pty-host'
import { detectShell, detectProvider } from '@core/settings-detector'
import { startSessionRuntime } from '@core/session-runtime'
import { getProvider } from '@extensions/providers'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { SessionRuntimeController } from './session-runtime-controller'
import { SessionEventBridge } from './session-event-bridge'
import { launchTrackedSessionRuntime } from './launch-tracked-session-runtime'
import { UpdateService } from './update-service'
import type { CreateProjectRequest, CreateSessionRequest } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'

let mainWindow: BrowserWindow | null = null
let projectSessionManager: ProjectSessionManager | null = null
let ptyHost: PtyHost | null = null
let runtimeController: SessionRuntimeController | null = null
let sessionEventBridge: SessionEventBridge | null = null
let updateService: UpdateService | null = null
let isQuittingAfterBridgeStop = false
const pendingE2EPickFolders: Array<string | null> = []
const isE2EMode = process.env.VIBECODING_E2E === '1'
const e2eGlobalStatePath = process.env.VIBECODING_STATE_DIR
  ? join(process.env.VIBECODING_STATE_DIR, 'global.json')
  : undefined

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
    }
  }
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

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
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
  projectSessionManager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath: e2eGlobalStatePath
  })

  ptyHost = new PtyHost()

  runtimeController = new SessionRuntimeController(
    projectSessionManager,
    () => mainWindow
  )
  sessionEventBridge = new SessionEventBridge(projectSessionManager, runtimeController)
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
    if (!session || !projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      console.log(`[session-create] Aborted: session=${!!session} manager=${!!projectSessionManager} pty=${!!ptyHost} ctrl=${!!runtimeController} bridge=${!!sessionEventBridge}`)
      return null
    }

    const snapshot = projectSessionManager.snapshot()
    const project = snapshot.projects.find(p => p.id === session.projectId)
    if (!project) {
      console.log(`[session-create] No project found for session ${session.id}`)
      return session
    }

    const descriptor = getProviderDescriptorBySessionType(session.type)
    const provider = getProvider(descriptor.providerId)
    const sessionSecret = sessionEventBridge.issueSessionSecret(session.id)
    const { shellPath, providerPath, claudeDangerouslySkipPermissions } = await resolveRuntimePaths(session.type)
    console.log(`[session-create] Starting ${descriptor.providerId} session ${session.id} in ${project.path}`)

    void startSessionRuntime({
      session: {
        id: session.id,
        projectId: session.projectId,
        path: project.path,
        title: session.title,
        type: session.type,
        status: session.status,
        externalSessionId: session.externalSessionId,
        sessionSecret
      },
      webhookPort,
      provider,
      ptyHost,
      manager: runtimeController,
      shellPath,
      providerPath,
      claudeDangerouslySkipPermissions
    }).then(() => {
      console.log(`[session-runtime] Session ${session.id} started successfully`)
    }).catch((err: unknown) => {
      console.error(`[session-runtime] Failed to start session ${session.id}:`, err)
      void runtimeController?.markSessionExited(session.id, `启动失败: ${err instanceof Error ? err.message : String(err)}`)
    })

    return session
  })

  ipcMain.handle(IPC_CHANNELS.projectSetActive, async (_event, projectId: string) => {
    await projectSessionManager?.setActiveProject(projectId)
  })

  ipcMain.handle(IPC_CHANNELS.sessionSetActive, async (_event, sessionId: string) => {
    await projectSessionManager?.setActiveSession(sessionId)
  })

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
  })

  ipcMain.handle(IPC_CHANNELS.sessionRestore, async (_event, sessionId: string) => {
    if (!projectSessionManager || !ptyHost || !runtimeController || !sessionEventBridge) {
      return
    }

    await projectSessionManager.restoreSession(sessionId)

    void launchTrackedSessionRuntime({
      sessionId,
      manager: projectSessionManager,
      webhookPort,
      ptyHost,
      runtimeController,
      sessionEventBridge,
      resolveRuntimePaths
    }).catch((err: unknown) => {
      console.error(`[session-restore] Failed to restore session ${sessionId}:`, err)
      void runtimeController?.markSessionExited(sessionId, `恢复失败: ${err instanceof Error ? err.message : String(err)}`)
    })
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
  pushUpdateState(await (updateService?.getState() ?? Promise.resolve(createDisabledUpdateState())))

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-changed', false)
  })

  for (const plan of projectSessionManager.buildBootstrapRecoveryPlan()) {
    void launchTrackedSessionRuntime({
      sessionId: plan.sessionId,
      manager: projectSessionManager,
      webhookPort,
      ptyHost,
      runtimeController,
      sessionEventBridge,
      resolveRuntimePaths
    }).catch((err: unknown) => {
      const sessionId = plan.sessionId
      console.error(`[bootstrap-recovery] Failed to recover session ${sessionId}:`, err)
      void runtimeController?.markSessionExited(sessionId, `恢复失败: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
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
