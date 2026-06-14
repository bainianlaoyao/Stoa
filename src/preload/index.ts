import { contextBridge, ipcRenderer } from 'electron'
import { release } from 'os'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type { ElectronRendererNativeApi, OpenWorkspaceRequest } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'

interface PreloadKeyboardEvent {
  key: string
}

interface PreloadDocument {
  addEventListener(type: 'keydown', listener: (event: PreloadKeyboardEvent) => void, options?: boolean): void
}

declare const document: PreloadDocument

const windowsBuildNumber = process.platform === 'win32'
  ? (parseInt(release().split('.').pop() ?? '0', 10) || undefined)
  : undefined

const electronApi = {
  windowsBuildNumber,
  async getServerInfo() {
    return ipcRenderer.invoke(IPC_CHANNELS.serverGetInfo) as Promise<{ available: boolean; port: number; url: string; token: string }>
  },
  async openWorkspace(request: OpenWorkspaceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen, request)
  },
  async titleGenerationFetchModels(baseUrl: string, apiKey: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.titleGenerationFetchModels, baseUrl, apiKey) as Promise<string[]>
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
  async detectVscode() {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDetectVscode) as Promise<string | null>
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
  async fsOpenFile(filePath: string, line?: number, column?: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsOpenFile, filePath, line, column) as Promise<void>
  },
  async shellShowItemInFolder(filePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.shellShowItemInFolder, filePath) as Promise<void>
  }
} satisfies ElectronRendererNativeApi

contextBridge.exposeInMainWorld('stoaElectron', electronApi)

;(function installDebugKeySequence() {
  const DEBUG_CODE = '114514'
  let keySequence = ''

  document.addEventListener('keydown', (event: PreloadKeyboardEvent) => {
    const ch = event.key
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
