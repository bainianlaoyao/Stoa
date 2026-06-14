import { beforeEach, describe, expect, it } from 'vitest'
import type { PiniaPluginContext } from 'pinia'
import { getStoaClient, initStoaClientForStores, resetStoaClientForStores, stoaClientPlugin } from './stoa-store-plugin'

const pluginContext = {} as PiniaPluginContext

describe('stoaClientPlugin', () => {
  beforeEach(() => {
    resetStoaClientForStores()
  })

  it('does not inject a null $stoaClient when no client has been initialized', () => {
    const injected = stoaClientPlugin()(pluginContext)

    expect(injected).toEqual({})
  })

  it('injects the initialized client when available', () => {
    initStoaClientForStores('http://localhost:3270', 'test-token')

    const injected = stoaClientPlugin()(pluginContext)

    expect(injected).toEqual({
      $stoaClient: getStoaClient()
    })
  })
})
