import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CreateProjectRequest,
  CreateSessionRequest,
  RendererApi,
  TerminalDataChunk,
  SessionStatusEvent
} from '@shared/project-session'

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
  }
}

contextBridge.exposeInMainWorld('stoa', api)
