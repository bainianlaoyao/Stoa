import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type { CreateWorkspaceRequest, RendererApi, TerminalDataChunk, WorkspaceEvent } from '@shared/workspace'

const api: RendererApi = {
  async getBootstrapState() {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceBootstrap)
  },
  async createWorkspace(request: CreateWorkspaceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceCreate, request)
  },
  onWorkspaceEvent(listener) {
    const subscription = (_event: Electron.IpcRendererEvent, payload: WorkspaceEvent) => {
      listener(payload)
    }

    ipcRenderer.on(IPC_CHANNELS.workspaceEvent, subscription)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.workspaceEvent, subscription)
    }
  },
  onTerminalData(listener) {
    const subscription = (_event: Electron.IpcRendererEvent, payload: TerminalDataChunk) => {
      listener(payload)
    }

    ipcRenderer.on(IPC_CHANNELS.terminalData, subscription)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.terminalData, subscription)
    }
  },
  async writeTerminalInput(workspaceId, data) {
    ipcRenderer.send(IPC_CHANNELS.terminalInput, { workspaceId, data })
  },
  async resizeTerminal(workspaceId, cols, rows) {
    ipcRenderer.send(IPC_CHANNELS.terminalResize, { workspaceId, cols, rows })
  },
  async setActiveWorkspace(workspaceId) {
    ipcRenderer.send(IPC_CHANNELS.workspaceSetActive, { workspaceId })
  }
}

contextBridge.exposeInMainWorld('vibecoding', api)
