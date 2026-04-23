import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CreateProjectRequest,
  CreateSessionRequest,
  RendererApi,
  SessionStatusEvent,
  TerminalDataChunk
} from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'

const api: RendererApi = {
  async getBootstrapState() {
    return ipcRenderer.invoke('project:bootstrap')
  },
  async createProject(request: CreateProjectRequest) {
    return ipcRenderer.invoke('project:create', request)
  },
  async createSession(request: CreateSessionRequest) {
    return ipcRenderer.invoke('session:create', request)
  },
  async setActiveProject(projectId) {
    return ipcRenderer.invoke('project:set-active', projectId)
  },
  async setActiveSession(sessionId) {
    return ipcRenderer.invoke('session:set-active', sessionId)
  },
  async getTerminalReplay(sessionId) {
    return ipcRenderer.invoke('session:terminal-replay', sessionId) as Promise<string>
  },
  async sendSessionInput(sessionId, data) {
    return ipcRenderer.invoke('session:input', sessionId, data)
  },
  async sendSessionResize(sessionId, cols, rows) {
    return ipcRenderer.invoke('session:resize', sessionId, cols, rows)
  },
  async archiveSession(sessionId) {
    return ipcRenderer.invoke('session:archive', sessionId)
  },
  async restoreSession(sessionId) {
    return ipcRenderer.invoke('session:restore', sessionId)
  },
  async listArchivedSessions() {
    return ipcRenderer.invoke('session:list-archived')
  },
  async getUpdateState() {
    return ipcRenderer.invoke('update:get-state') as Promise<UpdateState>
  },
  async checkForUpdates() {
    return ipcRenderer.invoke('update:check') as Promise<UpdateState>
  },
  async downloadUpdate() {
    return ipcRenderer.invoke('update:download') as Promise<UpdateState>
  },
  async quitAndInstallUpdate() {
    return ipcRenderer.invoke('update:quit-and-install')
  },
  async dismissUpdate() {
    return ipcRenderer.invoke('update:dismiss')
  },
  onTerminalData(callback: (chunk: TerminalDataChunk) => void) {
    const handler = (_event: Electron.IpcRendererEvent, chunk: TerminalDataChunk) => callback(chunk)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },
  onSessionEvent(callback: (event: SessionStatusEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, event: SessionStatusEvent) => callback(event)
    ipcRenderer.on('session:event', handler)
    return () => ipcRenderer.removeListener('session:event', handler)
  },
  onUpdateState(callback: (state: UpdateState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.removeListener('update:state', handler)
  },
  async getSettings() {
    return ipcRenderer.invoke('settings:get') as Promise<AppSettings>
  },
  async setSetting(key: string, value: unknown) {
    return ipcRenderer.invoke('settings:set', key, value)
  },
  async pickFolder(options?: { title?: string }) {
    return ipcRenderer.invoke('dialog:pick-folder', options) as Promise<string | null>
  },
  async pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) {
    return ipcRenderer.invoke('dialog:pick-file', options) as Promise<string | null>
  },
  async detectShell() {
    return ipcRenderer.invoke('settings:detect-shell') as Promise<string | null>
  },
  async detectProvider(providerId: string) {
    return ipcRenderer.invoke('settings:detect-provider', providerId) as Promise<string | null>
  },
  async minimizeWindow() {
    return ipcRenderer.invoke('window:minimize')
  },
  async maximizeWindow() {
    return ipcRenderer.invoke('window:maximize')
  },
  async closeWindow() {
    return ipcRenderer.invoke('window:close')
  },
  async isWindowMaximized() {
    return ipcRenderer.invoke('window:is-maximized') as Promise<boolean>
  },
  onWindowMaximizeChange(callback: (maximized: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximize-changed', handler)
    return () => ipcRenderer.removeListener('window:maximize-changed', handler)
  }
}

contextBridge.exposeInMainWorld('stoa', api)
