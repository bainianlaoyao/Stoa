import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapWebRenderer } from './bootstrap-web'

const {
  mockConnectWs,
  mockFlushBuffer,
  mockGetBootstrapState,
  mockInitStoaClientForStores,
  mockSetRendererApi,
} = vi.hoisted(() => ({
  mockConnectWs: vi.fn(),
  mockFlushBuffer: vi.fn(),
  mockGetBootstrapState: vi.fn(),
  mockInitStoaClientForStores: vi.fn(),
  mockSetRendererApi: vi.fn(),
}))

mockInitStoaClientForStores.mockImplementation(() => ({
  connectWs: mockConnectWs,
  flushBuffer: mockFlushBuffer,
}))

vi.mock('@renderer/stores/stoa-store-plugin', () => ({
  initStoaClientForStores: mockInitStoaClientForStores,
  setRendererApi: mockSetRendererApi,
}))

vi.mock('@renderer/lib/stoa-client-preload-adapter', () => ({
  StoaClientPreloadAdapter: vi.fn().mockImplementation(() => ({
    getBootstrapState: mockGetBootstrapState,
  })),
}))

describe('bootstrapWebRenderer', () => {
  const originalLocation = window.location
  const originalStoa = window.stoa

  beforeEach(() => {
    mockConnectWs.mockReset()
    mockFlushBuffer.mockReset()
    mockGetBootstrapState.mockReset()
    mockInitStoaClientForStores.mockClear()
    mockSetRendererApi.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    window.stoa = originalStoa
  })

  it('initializes the client from location origin and token fragment, then binds window.stoa', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://localhost:3270/#token=test-token'),
    })

    const result = bootstrapWebRenderer()

    expect(mockInitStoaClientForStores).toHaveBeenCalledWith('http://localhost:3270', 'test-token')
    expect(mockConnectWs).toHaveBeenCalledOnce()
    expect(mockSetRendererApi).toHaveBeenCalledWith(result.adapter)
    expect(window.stoa).toBe(result.adapter)
  })

  it('flushes the websocket buffer after the first bootstrap snapshot resolves', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://localhost:3270/#token=test-token'),
    })
    mockGetBootstrapState.mockResolvedValue({ projects: [], sessions: [] })

    const { adapter } = bootstrapWebRenderer()

    await adapter.getBootstrapState()
    await adapter.getBootstrapState()

    expect(mockFlushBuffer).toHaveBeenCalledTimes(1)
  })

  it('throws when the token fragment is missing', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('http://localhost:3270/'),
    })

    expect(() => bootstrapWebRenderer()).toThrow('Missing Stoa web token')
  })
})
