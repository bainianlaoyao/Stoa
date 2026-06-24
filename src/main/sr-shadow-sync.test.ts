import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type BootstrapState } from '@shared/project-session'
import { fetchStoaServerBootstrapState, syncProjectSessionShadowFromStoaServer } from './sr-shadow-sync'

function createBootstrapState(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    activeProjectId: null,
    activeSessionId: null,
    terminalWebhookPort: null,
    projects: [],
    sessions: [],
    ...overrides
  }
}

describe('sr shadow sync', () => {
  it('reads the Server bootstrap state envelope', async () => {
    const state = createBootstrapState({
      projects: [{ id: 'project-1', name: 'Demo', path: 'D:/demo', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', defaultSessionType: 'shell' }]
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, data: state })
    })

    await expect(fetchStoaServerBootstrapState({
      port: 3270,
      authToken: 'sr-token',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).resolves.toEqual(state)

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3270/api/v1/bootstrap', {
      headers: {
        Authorization: 'Bearer sr-token'
      }
    })
  })

  it('replaces the Electron shadow manager with Server state and settings', async () => {
    const state = createBootstrapState({
      activeProjectId: 'project-1',
      projects: [{ id: 'project-1', name: 'Demo', path: 'D:/demo', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', defaultSessionType: 'claude-code' }]
    })
    const settings = {
      ...DEFAULT_SETTINGS,
      shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true, data: state })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true, data: settings })
      })
    const manager = {
      replaceShadowState: vi.fn().mockResolvedValue(undefined)
    }

    await expect(syncProjectSessionShadowFromStoaServer({
      port: 3270,
      authToken: 'sr-token',
      manager,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).resolves.toBe(true)

    expect(manager.replaceShadowState).toHaveBeenCalledWith(state, expect.objectContaining({
      shellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    }))
  })

  it('does not replace shadow state when Server bootstrap cannot be read', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn()
    })
    const manager = {
      replaceShadowState: vi.fn()
    }

    await expect(syncProjectSessionShadowFromStoaServer({
      port: 3270,
      authToken: 'sr-token',
      manager,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).resolves.toBe(false)

    expect(manager.replaceShadowState).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
