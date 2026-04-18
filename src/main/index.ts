import { BrowserWindow, app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { PtyHost } from '@core/pty-host'
import { SessionManager } from '@core/session-manager'
import { startWorkspaceRuntime } from '@core/workspace-runtime'
import { createLocalWebhookServer } from '@core/webhook-server'
import { getProvider } from '@extensions/providers'
import type { CanonicalWorkspaceEvent, CreateWorkspaceRequest, TerminalDataChunk } from '@shared/workspace'

let mainWindow: BrowserWindow | null = null
let sessionManager: SessionManager | null = null
let ptyHost: PtyHost | null = null
let webhookServer: ReturnType<typeof createLocalWebhookServer> | null = null

async function configureWorkspaceRuntimeMetadata(webhookPort: number): Promise<void> {
  if (!sessionManager) {
    return
  }

  const snapshot = sessionManager.snapshot()
  await Promise.all(snapshot.workspaces.map(async (workspace, index) => {
    await sessionManager?.configureWorkspaceRuntime(workspace.workspaceId, {
      workspaceSecret: `ws-secret-${randomUUID()}`,
      providerPort: webhookPort + index + 1
    })
  }))
}

async function configureSingleWorkspaceRuntimeMetadata(workspaceId: string, webhookPort: number, index: number): Promise<void> {
  if (!sessionManager) {
    return
  }

  await sessionManager.configureWorkspaceRuntime(workspaceId, {
    workspaceSecret: `ws-secret-${randomUUID()}`,
    providerPort: webhookPort + index + 1
  })
}

function broadcastTerminalData(chunk: TerminalDataChunk): void {
  mainWindow?.webContents.send(IPC_CHANNELS.terminalData, chunk)
}

function broadcastWorkspaceEvent(event: CanonicalWorkspaceEvent): void {
  mainWindow?.webContents.send(IPC_CHANNELS.workspaceEvent, event)
}

async function startWorkspaceRuntimes(webhookPort: number): Promise<void> {
  if (!sessionManager || !ptyHost) {
    return
  }

  const manager = sessionManager
  const host = ptyHost
  const snapshot = manager.snapshot()
  await Promise.all(snapshot.workspaces.map(async (workspace) => {
    const provider = getProvider(workspace.providerId)
    await startWorkspaceRuntime({
      workspace,
      webhookPort,
      provider,
      ptyHost: host,
      sessionManager: manager
    })
  }))
}

async function createAndStartWorkspace(request: CreateWorkspaceRequest, webhookPort: number): Promise<ReturnType<SessionManager['snapshot']>['workspaces'][number] | null> {
  if (!sessionManager || !ptyHost) {
    return null
  }

  const created = await sessionManager.addWorkspace(request)
  const snapshot = sessionManager.snapshot()
  const workspaceIndex = snapshot.workspaces.findIndex((workspace) => workspace.workspaceId === created.workspaceId)
  await configureSingleWorkspaceRuntimeMetadata(created.workspaceId, webhookPort, workspaceIndex < 0 ? snapshot.workspaces.length : workspaceIndex)

  const configured = sessionManager.snapshot().workspaces.find((workspace) => workspace.workspaceId === created.workspaceId)
  if (!configured) {
    return null
  }

  await startWorkspaceRuntime({
    workspace: configured,
    webhookPort,
    provider: getProvider(configured.providerId),
    ptyHost,
    sessionManager
  })

  return sessionManager.snapshot().workspaces.find((workspace) => workspace.workspaceId === created.workspaceId) ?? null
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.once('did-finish-load', () => {
    if (sessionManager) {
      const snapshot = sessionManager.snapshot()
      for (const workspace of snapshot.workspaces) {
        window.webContents.send(IPC_CHANNELS.workspaceEvent, {
          event_version: 1,
          event_id: `evt_main_ready_${workspace.workspaceId}`,
          event_type: 'workspace.status_changed',
          timestamp: new Date().toISOString(),
          workspace_id: workspace.workspaceId,
          provider_id: workspace.providerId,
          session_id: workspace.cliSessionId,
          source: 'system-recovery',
          payload: {
            status: workspace.status,
            summary: workspace.summary,
            is_provisional: workspace.isProvisional
          }
        })
      }
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
  ptyHost = new PtyHost()
  sessionManager = await SessionManager.create({
    projectPath: cwd(),
    webhookPort: null
  })

  webhookServer = createLocalWebhookServer({
    async onEvent(event) {
      await sessionManager?.handleWebhookEvent(event)
    },
    getWorkspaceSecret(workspaceId) {
      return sessionManager?.getWorkspaceSecret(workspaceId) ?? null
    }
  })
  const webhookPort = await webhookServer.start()
  sessionManager = await SessionManager.create({
    projectPath: cwd(),
    webhookPort
  })
  await configureWorkspaceRuntimeMetadata(webhookPort)

  sessionManager.subscribeWorkspace((event) => {
    broadcastWorkspaceEvent(event)
  })
  sessionManager.subscribeTerminal((chunk) => {
    broadcastTerminalData(chunk)
  })

  ipcMain.handle(IPC_CHANNELS.workspaceBootstrap, async () => {
    return sessionManager?.snapshot() ?? {
      activeWorkspaceId: null,
      terminalWebhookPort: webhookPort,
      workspaces: []
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspaceCreate, async (_event, payload: CreateWorkspaceRequest) => {
    return createAndStartWorkspace(payload, webhookPort)
  })

  ipcMain.on(IPC_CHANNELS.terminalInput, (_event, payload: { workspaceId: string; data: string }) => {
    ptyHost?.write(payload.workspaceId, payload.data)
  })

  ipcMain.on(
    IPC_CHANNELS.terminalResize,
    (_event, payload: { workspaceId: string; cols: number; rows: number }) => {
      ptyHost?.resize(payload.workspaceId, payload.cols, payload.rows)
    }
  )

  ipcMain.on(IPC_CHANNELS.workspaceSetActive, (_event, payload: { workspaceId: string }) => {
    void sessionManager?.setActiveWorkspace(payload.workspaceId)
  })

  mainWindow = createMainWindow()
  await startWorkspaceRuntimes(webhookPort)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ptyHost?.dispose()
  void webhookServer?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
