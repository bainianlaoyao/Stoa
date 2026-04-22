// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import ProvidersSettings from './ProvidersSettings.vue'
import type { RendererApi } from '@shared/project-session'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({ activeProjectId: null, activeSessionId: null, terminalWebhookPort: 0, projects: [], sessions: [] }),
    createProject: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue(null),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({ shellPath: '', terminalFontSize: 14, providers: {} }),
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

describe('ProvidersSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupVibecodingMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders OpenCode provider entry with correct data-settings-field attribute', () => {
    const wrapper = mount(ProvidersSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const providerInput = wrapper.find('[data-settings-field="provider-opencode"]')
    expect(providerInput.exists()).toBe(true)
  })

  it('renders provider section heading and status badge', () => {
    const wrapper = mount(ProvidersSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    expect(wrapper.find('.settings-panel__title').text()).toBe('Provider runtime paths')
    expect(wrapper.find('.settings-card__badge').exists()).toBe(true)
  })

  it('renders Browse button for each provider', () => {
    const wrapper = mount(ProvidersSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const browseButtons = wrapper.findAll('.settings-item__browse')
    expect(browseButtons.length).toBeGreaterThanOrEqual(1)
    expect(browseButtons[0].text()).toBe('Browse')
  })

  it('shows "Detecting..." hint on mount', () => {
    setupVibecodingMock({ detectProvider: vi.fn().mockReturnValue(new Promise(() => {})) })

    const wrapper = mount(ProvidersSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })
    const hint = wrapper.find('.settings-item__hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('Detecting...')
  })

  it('clicking Browse calls store.pickFile', async () => {
    const pickFileMock = vi.fn().mockResolvedValue('/usr/local/bin/opencode')
    setupVibecodingMock({ pickFile: pickFileMock })

    const wrapper = mount(ProvidersSettings, {
      global: { plugins: [createPinia()] },
      attachTo: document.body
    })

    await nextTick()

    const browseBtn = wrapper.find('.settings-item__browse')
    await browseBtn.trigger('click')
    await nextTick()

    expect(pickFileMock).toHaveBeenCalled()
  })
})
