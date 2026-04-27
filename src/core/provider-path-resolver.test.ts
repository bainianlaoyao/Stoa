import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { resolveProviderExecutablePath } from './provider-path-resolver'

describe('provider-path-resolver', () => {
  it('returns the configured executable path for a provider without running detection', async () => {
    const detectShell = vi.fn().mockResolvedValue('C:/Program Files/PowerShell/7/pwsh.exe')
    const detectProvider = vi.fn().mockResolvedValue('ignored')

    const result = await resolveProviderExecutablePath('codex', {
      ...DEFAULT_SETTINGS,
      providers: {
        codex: 'D:/tools/codex.exe'
      }
    }, {
      detectShell,
      detectProvider
    })

    expect(result).toEqual({
      shellPath: 'C:/Program Files/PowerShell/7/pwsh.exe',
      providerPath: 'D:/tools/codex.exe'
    })
    expect(detectShell).toHaveBeenCalledOnce()
    expect(detectProvider).not.toHaveBeenCalled()
  })

  it('falls back to provider detection when no configured executable path exists', async () => {
    const detectShell = vi.fn().mockResolvedValue('/bin/zsh')
    const detectProvider = vi.fn().mockResolvedValue('/usr/local/bin/claude')

    const result = await resolveProviderExecutablePath('claude-code', DEFAULT_SETTINGS, {
      detectShell,
      detectProvider
    })

    expect(result).toEqual({
      shellPath: '/bin/zsh',
      providerPath: '/usr/local/bin/claude'
    })
    expect(detectProvider).toHaveBeenCalledWith('claude', '/bin/zsh')
  })
})
