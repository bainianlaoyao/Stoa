import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoaServerWebInfo, type StoaServerInfoSource } from './stoa-server-web-info'

const mockFetch = vi.fn()
const originalFetch = globalThis.fetch

function createSource(): StoaServerInfoSource {
  return {
    getPort: () => 3270,
    getAuthToken: () => 'test token'
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('getStoaServerWebInfo', () => {
  it('returns unavailable when no server source exists', async () => {
    await expect(getStoaServerWebInfo(null)).resolves.toEqual({
      available: false,
      port: 0,
      url: '',
      token: ''
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns a directly launchable fragment url when discovery says the web client is enabled', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: { webClient: true }
      })
    } as unknown as Response)

    await expect(getStoaServerWebInfo(createSource())).resolves.toEqual({
      available: true,
      port: 3270,
      url: 'http://127.0.0.1:3270/#token=test+token',
      token: 'test token'
    })
  })

  it('returns unavailable when discovery reports that the web client is disabled', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: { webClient: false }
      })
    } as unknown as Response)

    await expect(getStoaServerWebInfo(createSource())).resolves.toEqual({
      available: false,
      port: 0,
      url: '',
      token: ''
    })
  })

  it('returns unavailable when discovery fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(getStoaServerWebInfo(createSource())).resolves.toEqual({
      available: false,
      port: 0,
      url: '',
      token: ''
    })
  })
})
