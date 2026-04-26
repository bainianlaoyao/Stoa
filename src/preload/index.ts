import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type {
  AppSettings,
  CreateProjectRequest,
  CreateSessionRequest,
  ObservationEventListOptions,
  RendererApi,
  TerminalDataChunk
} from '@shared/project-session'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'
import type { UpdateState } from '@shared/update-state'

interface PreloadKeyboardEvent {
  key: string
}

interface PreloadDocument {
  addEventListener(type: 'keydown', listener: (event: PreloadKeyboardEvent) => void, options?: boolean): void
}

declare const document: PreloadDocument

const api: RendererApi = {
  async getBootstrapState() {
    return ipcRenderer.invoke(IPC_CHANNELS.projectBootstrap)
  },
  async createProject(request: CreateProjectRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.projectCreate, request)
  },
  async createSession(request: CreateSessionRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionCreate, request)
  },
  async setActiveProject(projectId) {
    return ipcRenderer.invoke(IPC_CHANNELS.projectSetActive, projectId)
  },
  async setActiveSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionSetActive, sessionId)
  },
  async getTerminalReplay(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionTerminalReplay, sessionId) as Promise<string>
  },
  async sendSessionInput(sessionId, data) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionInput, sessionId, data)
  },
  async sendSessionResize(sessionId, cols, rows) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionResize, sessionId, cols, rows)
  },
  async archiveSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionArchive, sessionId)
  },
  async restoreSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRestore, sessionId)
  },
  async listArchivedSessions() {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionListArchived)
  },
  async getUpdateState() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateGetState) as Promise<UpdateState>
  },
  async checkForUpdates() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateCheck) as Promise<UpdateState>
  },
  async downloadUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDownload) as Promise<UpdateState>
  },
  async quitAndInstallUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateQuitAndInstall)
  },
  async dismissUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDismiss)
  },
  onTerminalData(callback: (chunk: TerminalDataChunk) => void) {
    const handler = (_event: Electron.IpcRendererEvent, chunk: TerminalDataChunk) => callback(chunk)
    ipcRenderer.on(IPC_CHANNELS.terminalData, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalData, handler)
  },
  async getSessionPresence(sessionId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityGetSessionPresence, sessionId) as Promise<SessionPresenceSnapshot | null>
  },
  async getProjectObservability(projectId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityGetProject, projectId) as Promise<ProjectObservabilitySnapshot | null>
  },
  async getAppObservability() {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityGetApp) as Promise<AppObservabilitySnapshot | null>
  },
  async listSessionObservationEvents(sessionId: string, options: ObservationEventListOptions) {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityListSessionEvents, sessionId, options) as Promise<{
      events: ObservationEvent[]
      nextCursor: string | null
    }>
  },
  onSessionPresenceChanged(callback: (snapshot: SessionPresenceSnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SessionPresenceSnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.observabilitySessionPresenceChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.observabilitySessionPresenceChanged, handler)
  },
  onProjectObservabilityChanged(callback: (snapshot: ProjectObservabilitySnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ProjectObservabilitySnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.observabilityProjectChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.observabilityProjectChanged, handler)
  },
  onAppObservabilityChanged(callback: (snapshot: AppObservabilitySnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppObservabilitySnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.observabilityAppChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.observabilityAppChanged, handler)
  },
  onUpdateState(callback: (state: UpdateState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.updateState, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateState, handler)
  },
  async getSettings() {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<AppSettings>
  },
  async setSetting(key: string, value: unknown) {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsSet, key, value)
  },
  async pickFolder(options?: { title?: string }) {
    return ipcRenderer.invoke(IPC_CHANNELS.dialogPickFolder, options) as Promise<string | null>
  },
  async pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) {
    return ipcRenderer.invoke(IPC_CHANNELS.dialogPickFile, options) as Promise<string | null>
  },
  async detectShell() {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDetectShell) as Promise<string | null>
  },
  async detectProvider(providerId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDetectProvider, providerId) as Promise<string | null>
  },
  async minimizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowMinimize)
  },
  async maximizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowMaximize)
  },
  async closeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowClose)
  },
  async isWindowMaximized() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized) as Promise<boolean>
  },
  onWindowMaximizeChange(callback: (maximized: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on(IPC_CHANNELS.windowMaximizeChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizeChanged, handler)
  }
}

contextBridge.exposeInMainWorld('stoa', api)

;(function installDebugKeySequence() {
  const DEBUG_CODE = '114514'
  let keySequence = ''

  document.addEventListener('keydown', (e: PreloadKeyboardEvent) => {
    const ch = e.key
    if (ch.length !== 1 || ch < '0' || ch > '9') {
      keySequence = ''
      return
    }

    keySequence = (keySequence + ch).slice(-DEBUG_CODE.length)
    if (keySequence !== DEBUG_CODE) return

    keySequence = ''
    ipcRenderer.send(IPC_CHANNELS.debugToggleDevTools)
  }, true)
})()
