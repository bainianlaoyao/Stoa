import { describe, expect, test, vi } from 'vitest'
import { createWebbridgeClient } from './webbridge-client'
import type { WebbridgeStatus } from './types'

describe('webbridge-client', () => {
  test('reads health status from the webbridge binary', async () => {
    const execFile = vi.fn(async () => ({
      stdout: '{"running":true,"extension_connected":true,"version":"v1.9.7"}',
      stderr: ''
    }))

    const client = createWebbridgeClient({
      execFile,
      fetch: vi.fn() as unknown as typeof globalThis.fetch
    })

    await expect(client.readStatus()).resolves.toMatchObject({
      running: true,
      extension_connected: true,
      version: 'v1.9.7'
    })
  })

  test('sends webbridge commands to the local daemon', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          ok: true,
          data: { success: true, tabId: 1 }
        }
      }
    })) as unknown as typeof globalThis.fetch

    const client = createWebbridgeClient({
      execFile: vi.fn(),
      fetch
    })

    await expect(client.command('promo', 'navigate', {
      url: 'https://x.com/compose/post',
      newTab: true
    })).resolves.toMatchObject({
      success: true,
      tabId: 1
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
