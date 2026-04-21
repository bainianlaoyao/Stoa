import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { PtyHost } from '@core/pty-host'
import { startSessionRuntime } from '@core/session-runtime'
import { getProvider } from '@extensions/providers'
import { SessionRuntimeController } from './session-runtime-controller'
import type { CreateProjectRequest, CreateSessionRequest } from '@shared/project-session'

let mainWindow: BrowserWindow | null = null
let projectSessionManager: ProjectSessionManager | null = null
let ptyHost: PtyHost | null = null
let runtimeController: SessionRuntimeController | null = null

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(async () => {
  projectSessionManager = await ProjectSessionManager.create({
    webhookPort: null
  })

  ptyHost = new PtyHost()

  runtimeController = new SessionRuntimeController(
    projectSessionManager,
    () => mainWindow
  )

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
    if (!session || !projectSessionManager || !ptyHost || !runtimeController) {
      console.log(`[session-create] Aborted: session=${!!session} manager=${!!projectSessionManager} pty=${!!ptyHost} ctrl=${!!runtimeController}`)
      return null
    }

    const snapshot = projectSessionManager.snapshot()
    const project = snapshot.projects.find(p => p.id === session.projectId)
    if (!project) {
      console.log(`[session-create] No project found for session ${session.id}`)
      return session
    }

    const providerId = session.type === 'shell' ? 'local-shell' : 'opencode'
    const provider = getProvider(providerId)
    console.log(`[session-create] Starting ${providerId} session ${session.id} in ${project.path}`)

    void startSessionRuntime({
      session: {
        id: session.id,
        projectId: session.projectId,
        path: project.path,
        title: session.title,
        type: session.type,
        status: session.status,
        externalSessionId: session.externalSessionId
      },
      webhookPort: 43127,
      provider,
      ptyHost,
      manager: runtimeController
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

  ipcMain.handle(IPC_CHANNELS.sessionInput, async (_event, sessionId: string, data: string) => {
    ptyHost?.write(sessionId, data)
  })

  ipcMain.handle(IPC_CHANNELS.sessionResize, async (_event, sessionId: string, cols: number, rows: number) => {
    ptyHost?.resize(sessionId, cols, rows)
  })

  mainWindow = createMainWindow()

  for (const plan of projectSessionManager.buildBootstrapRecoveryPlan()) {
    const snapshot = projectSessionManager.snapshot()
    const session = snapshot.sessions.find(s => s.id === plan.sessionId)
    const project = session ? snapshot.projects.find(p => p.id === session.projectId) : undefined
    if (!session || !project) continue

    const provider = getProvider(session.type === 'shell' ? 'local-shell' : 'opencode')

    void startSessionRuntime({
      session: {
        id: session.id,
        projectId: session.projectId,
        path: project.path,
        title: session.title,
        type: session.type,
        status: session.status,
        externalSessionId: session.externalSessionId
      },
      webhookPort: 43127,
      provider,
      ptyHost,
      manager: runtimeController
    }).catch((err: unknown) => {
      console.error(`[bootstrap-recovery] Failed to recover session ${session.id}:`, err)
      void runtimeController?.markSessionExited(session.id, `恢复失败: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
