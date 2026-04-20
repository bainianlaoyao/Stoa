import { contextBridge, ipcRenderer } from 'electron'
import type { CreateProjectRequest, CreateSessionRequest, RendererApi } from '@shared/project-session'

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
  }
}

contextBridge.exposeInMainWorld('vibecoding', api)
