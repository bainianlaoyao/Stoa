// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import AboutSettings from './AboutSettings.vue'
import { useUpdateStore } from '@renderer/stores/update'
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

describe('AboutSettings', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    window.stoa = createStoaMock()
  })

  it('renders app name "Stoa"', () => {
    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })
    expect(wrapper.find('.settings-about__name').text()).toBe('Stoa')
  })

  it('renders version "v0.1.0"', () => {
    const store = useUpdateStore()
    store.applyState(createUpdateState({ currentVersion: '0.1.0' }))
    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })
    expect(wrapper.find('.settings-about__version').text()).toBe('v0.1.0')
  })

  it('renders tech stack text', () => {
    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })
    expect(wrapper.find('.settings-about__stack').text()).toBe('Electron · Vue 3 · node-pty')
  })

  it('renders the about hero summary', () => {
    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })
    expect(wrapper.find('.settings-about__summary').text()).toContain('Multi-session workspace console')
  })

  it('renders 3 links with target="_blank"', () => {
    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })
    const links = wrapper.findAll('.settings-about__link')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank')
    }
  })

  it('shows the current update status from the store', () => {
    const store = useUpdateStore()
    store.applyState(createUpdateState({
      phase: 'available',
      currentVersion: '0.1.0',
      availableVersion: '0.2.0',
      message: 'Update 0.2.0 is available.'
    }))

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    expect(wrapper.text()).toContain('Update available')
    expect(wrapper.text()).toContain('Update 0.2.0 is available.')
    expect(wrapper.text()).toContain('Latest version: 0.2.0')
  })

  it('clicking check for updates calls the update store bridge action', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(createUpdateState({ phase: 'checking' }))
    window.stoa = createStoaMock({ checkForUpdates })

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    await wrapper.get('[data-settings-action="check-updates"]').trigger('click')

    expect(checkForUpdates).toHaveBeenCalledOnce()
  })
})
