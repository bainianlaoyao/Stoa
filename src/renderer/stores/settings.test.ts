// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings'
import type { RendererApi } from '@shared/project-session'
import { createRendererApiMock } from '@shared/test-fixtures'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return Object.assign(createRendererApiMock(), overrides)
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hydrates evolver settings from the runtime contract', async () => {
    window.stoa = createStoaMock()
    const store = useSettingsStore()

    await store.loadSettings()

    expect(store.evolverInferenceProvider).toBe('claude-code')
    expect(store.evolverExecutionMode).toBe('workspace-shell')
  })

  it('normalizes unsupported evolver inference provider to default', async () => {
    window.stoa = createStoaMock({
      getSettings: vi.fn().mockResolvedValue({
        shellPath: '',
        terminal: {},
        providers: {},
        titleGeneration: {
          enabled: false,
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4-mini'
        },
        evolverInferenceProvider: 'codex',
        evolverExecutionMode: 'workspace-shell',
        workspaceIde: { id: 'vscode', executablePath: '' },
        claudeDangerouslySkipPermissions: false,
        locale: 'en'
      })
    })
    const store = useSettingsStore()

    await store.loadSettings()

    expect(store.evolverInferenceProvider).toBe('claude-code')
  })

  it('persists evolver inference provider updates through setSetting', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    window.stoa = createStoaMock({ setSetting })
    const store = useSettingsStore()

    await store.updateSetting('evolverInferenceProvider', 'claude-code')

    expect(setSetting).toHaveBeenCalledWith('evolverInferenceProvider', 'claude-code')
    expect(store.evolverInferenceProvider).toBe('claude-code')
  })

  it('persists evolver execution mode updates through setSetting', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    window.stoa = createStoaMock({ setSetting })
    const store = useSettingsStore()

    await store.updateSetting('evolverExecutionMode', 'workspace-shell')

    expect(setSetting).toHaveBeenCalledWith('evolverExecutionMode', 'workspace-shell')
    expect(store.evolverExecutionMode).toBe('workspace-shell')
  })

  it('hydrates title generation settings from the runtime contract', async () => {
    window.stoa = createStoaMock({
      getSettings: vi.fn().mockResolvedValue({
        shellPath: '',
        terminal: {},
        providers: {},
        titleGeneration: {
          enabled: true,
          apiKey: 'sk-title-user',
          baseUrl: 'https://example.test/v1',
          model: 'gpt-5-mini'
        },
        evolverInferenceProvider: 'claude-code',
        evolverExecutionMode: 'workspace-shell',
        workspaceIde: { id: 'vscode', executablePath: '' },
        claudeDangerouslySkipPermissions: false,
        locale: 'en'
      })
    })
    const store = useSettingsStore()

    await store.loadSettings()

    expect(store.titleGeneration).toEqual({
      enabled: true,
      apiKey: 'sk-title-user',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5-mini'
    })
  })

  it('persists title generation updates through setSetting', async () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    window.stoa = createStoaMock({ setSetting })
    const store = useSettingsStore()

    await store.updateSetting('titleGeneration', {
      enabled: true,
      apiKey: 'sk-title-user',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5-mini'
    })

    expect(setSetting).toHaveBeenCalledWith('titleGeneration', {
      enabled: true,
      apiKey: 'sk-title-user',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5-mini'
    })
    expect(store.titleGeneration).toEqual({
      enabled: true,
      apiKey: 'sk-title-user',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5-mini'
    })
  })
})
