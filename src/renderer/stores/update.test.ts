import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUpdateStore } from './update'
import type { RendererApi } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'

function createUpdateState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    phase: 'idle',
    currentVersion: '0.1.0',
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: null,
    requiresSessionWarning: false,
    ...overrides
  }
}

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: 0,
      projects: [],
      sessions: []
    }),
    createProject: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue(null),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue({
      blockedProjectCount: 0,
      failedProjectCount: 0,
      degradedProjectCount: 0,
      totalUnreadTurns: 0,
      projectsNeedingAttention: [],
      providerHealthSummary: {},
      lastGlobalEventAt: null,
      updatedAt: '0'
    }),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      providers: {},
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
    getUpdateState: vi.fn().mockResolvedValue(createUpdateState()),
    checkForUpdates: vi.fn().mockResolvedValue(createUpdateState({ phase: 'up-to-date', message: 'You are up to date.' })),
    downloadUpdate: vi.fn().mockResolvedValue(createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' })),
    quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    dismissUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

describe('useUpdateStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createStoaMock()
  })

  it('applies pushed state and exposes prompt visibility for available updates', () => {
    const store = useUpdateStore()

    store.applyState(createUpdateState({ phase: 'available', availableVersion: '0.2.0', message: 'Update 0.2.0 is available.' }))

    expect(store.state.phase).toBe('available')
    expect(store.state.availableVersion).toBe('0.2.0')
    expect(store.shouldShowPrompt).toBe(true)
  })

  it('dismisses the current prompt until the update identity changes', () => {
    const store = useUpdateStore()

    store.applyState(createUpdateState({ phase: 'available', availableVersion: '0.2.0' }))
    store.dismissPrompt()

    expect(store.shouldShowPrompt).toBe(false)

    store.applyState(createUpdateState({ phase: 'available', availableVersion: '0.2.0' }))
    expect(store.shouldShowPrompt).toBe(false)

    store.applyState(createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' }))
    expect(store.shouldShowPrompt).toBe(true)
  })

  it('refreshes state from the update bridge', async () => {
    const updateState = createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' })
    window.stoa = createStoaMock({
      getUpdateState: vi.fn().mockResolvedValue(updateState)
    })
    const store = useUpdateStore()

    await store.refresh()

    expect(window.stoa.getUpdateState).toHaveBeenCalledOnce()
    expect(store.state.downloadedVersion).toBe('0.2.0')
  })

  it('checks for updates and stores the returned state', async () => {
    const checkedState = createUpdateState({ phase: 'available', availableVersion: '0.2.0' })
    window.stoa = createStoaMock({
      checkForUpdates: vi.fn().mockResolvedValue(checkedState)
    })
    const store = useUpdateStore()

    await store.checkForUpdates()

    expect(window.stoa.checkForUpdates).toHaveBeenCalledOnce()
    expect(store.state.phase).toBe('available')
    expect(store.shouldShowPrompt).toBe(true)
  })

  it('dismisses through the update bridge and hides the prompt locally', async () => {
    const store = useUpdateStore()
    store.applyState(createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' }))

    await store.dismissUpdate()

    expect(window.stoa.dismissUpdate).toHaveBeenCalledOnce()
    expect(store.shouldShowPrompt).toBe(false)
  })
})
