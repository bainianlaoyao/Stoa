import type { ElectronRendererNativeApi, RendererApi } from './project-session'

declare global {
  interface Window {
    stoa: RendererApi
    stoaElectron?: ElectronRendererNativeApi
  }
}

export * from './project-session'
