import type { PiniaPluginContext } from 'pinia'
import type { RendererApi } from '@shared/project-session'
import { StoaClient } from '@renderer/lib/stoa-client'

// Augment Pinia store properties
declare module 'pinia' {
  export interface PiniaCustomProperties {
    $stoaClient?: StoaClient
  }
}

let clientInstance: StoaClient | null = null
let rendererApiInstance: RendererApi | null = null

export function initStoaClientForStores(baseUrl: string, token: string): StoaClient {
  clientInstance = new StoaClient(baseUrl, token)
  return clientInstance
}

export function getStoaClient(): StoaClient | null {
  return clientInstance
}

export function flushStoaClientBuffer(): void {
  clientInstance?.flushBuffer()
}

export function getRendererApi(): RendererApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return rendererApiInstance ?? (window as Window & { stoa?: RendererApi }).stoa ?? null
}

export function setRendererApi(rendererApi: RendererApi | null): void {
  rendererApiInstance = rendererApi
}

export function resetStoaClientForStores(): void {
  clientInstance = null
  rendererApiInstance = null
}

export function requireRendererApi(): RendererApi {
  const rendererApi = getRendererApi()
  if (!rendererApi) {
    throw new Error('Renderer bridge unavailable: window.stoa is missing and StoaClient is not initialized.')
  }
  return rendererApi
}

export function isStoaClientMode(): boolean {
  return clientInstance !== null
}

export function stoaClientPlugin() {
  return (_context: PiniaPluginContext) => {
    if (!clientInstance) {
      return {}
    }

    return {
      $stoaClient: clientInstance
    }
  }
}
