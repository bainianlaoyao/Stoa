// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings'
import type { RendererApi } from '@shared/project-session'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    windowsBuildNumber: undefined,
    getBootstrapState: vi.fn().mockResolvedValue({ activeProjectId: null, activeSessionId: null, terminalWebhookPort: 0, projects: [], sessions: [] }),
    createProject: vi.fn().mockResolvedValue(null),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(null),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    regenerateSessionTitle: vi.fn().mockResolvedValue(null),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),

    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn(),
    sendSessionBinaryInput: vi.fn(),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onMemoryNotification: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue(null),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
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
      evolverInferenceProvider: 'claude-code',
      evolverExecutionMode: 'workspace-shell',
      workspaceIde: { id: 'vscode', executablePath: '' },
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
    detectVscode: vi.fn().mockResolvedValue(null),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
    getUpdateState: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    checkForUpdates: vi.fn().mockResolvedValue({
      phase: 'up-to-date',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: 'You are up to date.',
      requiresSessionWarning: false
    }),
    downloadUpdate: vi.fn().mockResolvedValue({
      phase: 'downloaded',
      currentVersion: '0.1.0',
      availableVersion: '0.2.0',
      downloadedVersion: '0.2.0',
      downloadProgressPercent: 100,
      lastCheckedAt: null,
      message: 'Update 0.2.0 is ready to install.',
      requiresSessionWarning: false
    }),
    quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    dismissUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockReturnValue(() => {}),
    uninstallSidecars: vi.fn().mockResolvedValue(undefined),
    listSessionEvidence: vi.fn().mockResolvedValue([]),
    contextExportFullText: vi.fn().mockResolvedValue({ text: '', truncated: false, totalTurns: 0 }),
    contextExportSlimText: vi.fn().mockResolvedValue({ text: '', truncated: false, totalTurns: 0 }),
    ...overrides,
    restartSession: overrides.restartSession ?? vi.fn().mockResolvedValue(undefined)
  }
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
