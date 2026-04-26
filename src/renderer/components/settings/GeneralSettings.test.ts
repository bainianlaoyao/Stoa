// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import GeneralSettings from './GeneralSettings.vue'
import type { RendererApi } from '@shared/project-session'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({ activeProjectId: null, activeSessionId: null, terminalWebhookPort: 0, projects: [], sessions: [] }),
    createProject: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue(null),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue({
      blockedProjectCount: 0,
      failedProjectCount: 0,
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
      workspaceIde: { id: 'vscode', executablePath: '' },
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
    ...overrides
  }
}

function setupVibecodingMock(overrides: Partial<RendererApi> = {}): void {
  window.stoa = {
    ...createStoaMock(overrides)
  }
}

describe('GeneralSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupVibecodingMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders shell path input, font family select and font size select', () => {
    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    expect(wrapper.find('[data-settings-field="shellPath"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="workspaceIdeId"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="workspaceIdeExecutablePath"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="terminalFontFamily"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="terminalFontSize"]').exists()).toBe(true)
  })

  it('renders the general section header and card titles', () => {
    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    expect(wrapper.find('.settings-panel__title').text()).toBe('Shell and terminal defaults')
    expect(wrapper.text()).toContain('Shell executable')
    expect(wrapper.text()).toContain('Workspace quick access')
    expect(wrapper.text()).toContain('Terminal typography')
  })

  it('renders Browse button', () => {
    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const browseBtn = wrapper.find('[data-settings-field="shellPath"] .btn-ghost')
    expect(browseBtn.exists()).toBe(true)
    expect(browseBtn.text()).toBe('Browse')
  })

  it('shows "Detecting..." hint on mount', () => {
    setupVibecodingMock({ detectShell: vi.fn().mockReturnValue(new Promise(() => {})) })

    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const hint = wrapper.find('.settings-item__hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('Detecting...')
  })

  it('clicking Browse calls store.pickFile then store.updateSetting', async () => {
    const pickFileMock = vi.fn().mockResolvedValue('/usr/bin/zsh')
    const setSettingMock = vi.fn().mockResolvedValue(undefined)
    setupVibecodingMock({
      pickFile: pickFileMock,
      setSetting: setSettingMock
    })

    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    const browseBtn = wrapper.find('[data-settings-field="shellPath"] .btn-ghost')
    await browseBtn.trigger('click')
    await nextTick()
    await nextTick()

    expect(pickFileMock).toHaveBeenCalledWith({ title: 'Shell executable' })
    expect(setSettingMock).toHaveBeenCalledWith('shellPath', '/usr/bin/zsh')
  })

  it('renders VS Code as the only workspace IDE option', async () => {
    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    const field = wrapper.find('[data-settings-field="workspaceIdeId"]')
    const button = field.find('[data-testid="glass-listbox-button"]')
    await button.trigger('click')
    await nextTick()

    const options = field.findAll('li.glass-listbox__option')
    expect(options.map((option) => option.text())).toEqual(['VS Code'])
  })

  it('clicking workspace IDE Browse updates workspaceIde executablePath', async () => {
    const pickFileMock = vi.fn().mockResolvedValue('C:/Users/dev/AppData/Local/Programs/Microsoft VS Code/Code.exe')
    const setSettingMock = vi.fn().mockResolvedValue(undefined)
    setupVibecodingMock({
      pickFile: pickFileMock,
      setSetting: setSettingMock
    })

    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    const browseBtn = wrapper.find('[data-settings-field="workspaceIdeExecutablePath"] .btn-ghost')
    await browseBtn.trigger('click')
    await nextTick()
    await nextTick()

    expect(pickFileMock).toHaveBeenCalledWith({ title: 'VS Code executable' })
    expect(setSettingMock).toHaveBeenCalledWith('workspaceIde', {
      id: 'vscode',
      executablePath: 'C:/Users/dev/AppData/Local/Programs/Microsoft VS Code/Code.exe'
    })
  })

  it('changing font size select calls store.updateSetting with terminalFontSize', async () => {
    const setSettingMock = vi.fn().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })

    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    await nextTick()

    const field = wrapper.find('[data-settings-field="terminalFontSize"]')
    const button = field.find('[data-testid="glass-listbox-button"]')
    await button.trigger('click')
    await nextTick()

    const options = field.findAll('li.glass-listbox__option')
    const option18 = options.find((li) => li.text().includes('18px'))
    await option18!.trigger('click')
    await nextTick()

    expect(setSettingMock).toHaveBeenCalledWith('terminalFontSize', 18)
  })

  it('changing font family select calls store.updateSetting with terminalFontFamily', async () => {
    const setSettingMock = vi.fn().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })

    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    await nextTick()

    const field = wrapper.find('[data-settings-field="terminalFontFamily"]')
    const button = field.find('[data-testid="glass-listbox-button"]')
    await button.trigger('click')
    await nextTick()

    const options = field.findAll('li.glass-listbox__option')
    const cascadiaOption = options.find((li) => li.text().includes('Cascadia Mono'))
    await cascadiaOption!.trigger('click')
    await nextTick()

    expect(setSettingMock).toHaveBeenCalledWith('terminalFontFamily', 'Cascadia Mono')
  })
})
