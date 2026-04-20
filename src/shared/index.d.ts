import type { RendererApi } from './project-session'

declare global {
  interface Window {
    vibecoding: RendererApi
  }
}

export * from './project-session'
