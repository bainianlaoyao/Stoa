import { contextBridge, ipcRenderer } from 'electron'
import type {
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
  async sendSessionInput(sessionId, data) {
    return ipcRenderer.invoke('session:input', sessionId, data)
  },
  async sendSessionResize(sessionId, cols, rows) {
    return ipcRenderer.invoke('session:resize', sessionId, cols, rows)
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
  }
}

contextBridge.exposeInMainWorld('vibecoding', api)
