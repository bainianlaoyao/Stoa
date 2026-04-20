import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import type { CreateProjectRequest, CreateSessionRequest } from '@shared/project-session'

let mainWindow: BrowserWindow | null = null
let projectSessionManager: ProjectSessionManager | null = null

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
      nodeIntegration: false
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
    return projectSessionManager?.createSession(payload) ?? null
  })

  ipcMain.handle(IPC_CHANNELS.projectSetActive, async (_event, _projectId: string) => {
    return
  })

  ipcMain.handle(IPC_CHANNELS.sessionSetActive, async (_event, _sessionId: string) => {
    return
  })

  mainWindow = createMainWindow()

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
