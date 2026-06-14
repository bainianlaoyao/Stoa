import { StoaClient } from '@renderer/lib/stoa-client'
import { StoaClientPreloadAdapter } from '@renderer/lib/stoa-client-preload-adapter'
import { initStoaClientForStores, setRendererApi } from '@renderer/stores/stoa-store-plugin'
import type { RendererApi } from '@shared/project-session'
import { readStoaWebTokenFromHash } from '@shared/stoa-web-launch-url'

export interface WebBootstrapResult {
  client: StoaClient
  adapter: RendererApi
}

function readRequiredToken(): string {
  const token = readStoaWebTokenFromHash(window.location.hash)

  if (!token) {
    throw new Error('Missing Stoa web token in URL fragment "token"')
  }

  return token
}

export function bootstrapWebRenderer(): WebBootstrapResult {
  const token = readRequiredToken()
  const client = initStoaClientForStores(window.location.origin, token)
  const adapter = new StoaClientPreloadAdapter(client)
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

  client.connectWs()
  setRendererApi(adapter)
  window.stoa = adapter

  return { client, adapter: adapter as RendererApi }
}
