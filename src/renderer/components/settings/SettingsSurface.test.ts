// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsSurface from './SettingsSurface.vue'
import type { RendererApi } from '@shared/project-session'

function createStoaMock(): RendererApi {
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
    getSettings: vi.fn().mockResolvedValue({ shellPath: '', terminalFontSize: 14, providers: {} }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null)
  }
}

function setupVibecodingMock(): void {
  window.stoa = {
    ...createStoaMock()
  }
}

describe('SettingsSurface', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupVibecodingMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the settings surface section with correct data-surface and aria-label', () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const section = wrapper.find('[data-surface="settings"]')
    expect(section.exists()).toBe(true)
    expect(section.attributes('aria-label')).toBe('Settings surface')
  })

  it('renders the page hero and shell layout', () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    expect(wrapper.find('.settings-surface__hero').exists()).toBe(true)
    expect(wrapper.find('.settings-surface__title').text()).toBe('Settings')
    expect(wrapper.find('.settings-surface__shell').exists()).toBe(true)
  })

  it('renders the tab bar with 3 tabs', () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const tabs = wrapper.findAll('[data-settings-tab]')
    expect(tabs).toHaveLength(3)
  })

  it('defaults to showing GeneralSettings panel', () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const generalPanel = wrapper.find('[aria-label="General settings"]')
    expect(generalPanel.exists()).toBe(true)
  })

  it('clicking Providers tab shows ProvidersSettings panel', async () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const providersTab = wrapper.find('[data-settings-tab="providers"]')
    await providersTab.trigger('click')

    const providersPanel = wrapper.find('[aria-label="Provider settings"]')
    expect(providersPanel.exists()).toBe(true)
  })

  it('clicking About tab shows AboutSettings panel', async () => {
    const wrapper = mount(SettingsSurface, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const aboutTab = wrapper.find('[data-settings-tab="about"]')
    await aboutTab.trigger('click')

    const aboutPanel = wrapper.find('[aria-label="About"]')
    expect(aboutPanel.exists()).toBe(true)
  })
})
