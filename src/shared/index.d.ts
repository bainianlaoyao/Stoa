import type { RendererApi } from './project-session'

declare global {
  interface Window {
    stoa: RendererApi
  }
}

export * from './project-session'
