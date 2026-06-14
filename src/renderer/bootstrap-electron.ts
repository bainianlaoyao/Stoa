import { StoaClient } from '@renderer/lib/stoa-client'
import { StoaClientPreloadAdapter } from '@renderer/lib/stoa-client-preload-adapter'
import { initStoaClientForStores, setRendererApi } from '@renderer/stores/stoa-store-plugin'
import type { ElectronRendererNativeApi, RendererApi } from '@shared/project-session'

export interface DesktopBootstrapResult {
  client: StoaClient
  adapter: RendererApi
}

function requireNativeBridge(): ElectronRendererNativeApi {
  const nativeBridge = window.stoaElectron
  if (!nativeBridge) {
    throw new Error('Renderer bootstrap failed: window.stoaElectron is missing.')
  }
  return nativeBridge
}

async function requireServerConnection(nativeBridge: ElectronRendererNativeApi): Promise<{ baseUrl: string; token: string }> {
  const info = await nativeBridge.getServerInfo()
  if (!info.available) {
    throw new Error('Renderer bootstrap failed: Stoa Server is unavailable.')
  }
  return {
    baseUrl: `http://127.0.0.1:${info.port}`,
    token: info.token
  }
}

export async function bootstrapDesktopRenderer(): Promise<DesktopBootstrapResult> {
  const nativeBridge = requireNativeBridge()
  const { baseUrl, token } = await requireServerConnection(nativeBridge)
  const client = initStoaClientForStores(baseUrl, token)
  const adapter = new StoaClientPreloadAdapter(client) as RendererApi & ElectronRendererNativeApi
  let bootstrapResolved = false

  const originalGetBootstrapState = adapter.getBootstrapState.bind(adapter)
  adapter.getBootstrapState = async () => {
    const state = await originalGetBootstrapState()
    if (!bootstrapResolved) {
      bootstrapResolved = true
      client.flushBuffer()
    }
    return state
  }

  Object.assign(adapter, nativeBridge)

  client.connectWs()
  setRendererApi(adapter)
  window.stoa = adapter

  return { client, adapter }
}
