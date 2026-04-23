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
    getSettings: vi.fn().mockResolvedValue({ shellPath: '', terminalFontSize: 14, terminalFontFamily: 'JetBrains Mono', providers: {} }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
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
    expect(wrapper.text()).toContain('Terminal typography')
  })

  it('renders Browse button', () => {
    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const browseBtn = wrapper.find('.settings-item__browse')
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

    const browseBtn = wrapper.find('.settings-item__browse')
    await browseBtn.trigger('click')
    await nextTick()
    await nextTick()

    expect(pickFileMock).toHaveBeenCalledWith({ title: 'Select shell executable' })
    expect(setSettingMock).toHaveBeenCalledWith('shellPath', '/usr/bin/zsh')
  })

  it('changing font size select calls store.updateSetting with terminalFontSize', async () => {
    const setSettingMock = vi.fn().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })

    const wrapper = mount(GeneralSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    await nextTick()

    const select = wrapper.find('[data-settings-field="terminalFontSize"] select')
    await select.setValue('18')
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

    const select = wrapper.find('[data-settings-field="terminalFontFamily"] select')
    await select.setValue('Cascadia Mono')
    await nextTick()

    expect(setSettingMock).toHaveBeenCalledWith('terminalFontFamily', 'Cascadia Mono')
  })
})
