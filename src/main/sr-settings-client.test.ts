import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { fetchStoaServerSettings } from './sr-settings-client'

describe('fetchStoaServerSettings', () => {
  it('reads provider paths from the Stoa Server settings envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          ...DEFAULT_SETTINGS,
          providers: {
            codex: 'D:\\fake\\codex.cmd'
          },
          claudeDangerouslySkipPermissions: true
        }
      })
    })

    const settings = await fetchStoaServerSettings({
      port: 3270,
      authToken: 'sr-token',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3270/api/v1/settings', {
      headers: {
        Authorization: 'Bearer sr-token'
      }
    })
    expect(settings?.providers.codex).toBe('D:\\fake\\codex.cmd')
    expect(settings?.claudeDangerouslySkipPermissions).toBe(true)
  })

  it('falls back to null when the SR settings request fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn()
    })

    await expect(fetchStoaServerSettings({
      port: 3270,
      authToken: 'sr-token',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).resolves.toBeNull()
  })
})
