// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import ProvidersSettings from './ProvidersSettings.vue'
import type { RendererApi } from '@shared/project-session'

const providersSettingsPath = resolve(dirname(fileURLToPath(import.meta.url)), 'ProvidersSettings.vue')

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
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      providers: {},
      claudeDangerouslySkipPermissions: false
    }),
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

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        providers: {
          eyebrow: 'Providers',
          title: 'Provider runtime paths',
          description: 'Keep executable discovery predictable so provider-backed sessions can start without extra repair work.',
          cardDescription: 'Set an explicit executable path or let Stoa use the local detected runtime.',
          executablePath: 'Executable path',
          placeholderMissing: 'not found',
          autoDetected: 'Auto-detected',
          browse: 'Browse',
          detecting: 'Detecting...',
          customPath: 'Custom path',
          notFound: 'Not found — click Browse to locate',
          selectExecutable: 'Select {provider} executable'
        }
      }
    }
  })
}

function mountProvidersSettings() {
  return mount(ProvidersSettings, {
    global: { plugins: [createPinia(), createTestI18n()] },
    attachTo: document.body
  })
}

describe('ProvidersSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupVibecodingMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders provider entries for OpenCode Codex and Claude Code', () => {
    const wrapper = mountProvidersSettings()
    expect(wrapper.find('[data-settings-field="provider-opencode"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="provider-codex"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="provider-claude-code"]').exists()).toBe(true)
  })

  it('renders provider section heading and status badge', () => {
    const wrapper = mountProvidersSettings()

    expect(wrapper.find('.settings-panel__title').text()).toBe('Provider runtime paths')
    expect(wrapper.find('.settings-card__badge').exists()).toBe(true)
  })

  it('renders Browse button for each provider', () => {
    const wrapper = mountProvidersSettings()
    const browseButtons = wrapper.findAll('[data-settings-field^="provider-"] .btn-ghost')
    expect(browseButtons.length).toBeGreaterThanOrEqual(1)
    expect(browseButtons[0].text()).toBe('Browse')
  })

  it('shows "Detecting..." hint on mount', () => {
    setupVibecodingMock({ detectProvider: vi.fn().mockReturnValue(new Promise(() => {})) })

    const wrapper = mountProvidersSettings()
    const hint = wrapper.find('.settings-item__hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('Detecting...')
  })

  it('clicking Browse calls store.pickFile', async () => {
    const pickFileMock = vi.fn().mockResolvedValue('/usr/local/bin/opencode')
    setupVibecodingMock({ pickFile: pickFileMock })

    const wrapper = mountProvidersSettings()

    await nextTick()

    const browseBtn = wrapper.find('[data-settings-field="provider-opencode"] .btn-ghost')
    await browseBtn.trigger('click')
    await nextTick()

    expect(pickFileMock).toHaveBeenCalled()
  })

  it('toggles claude dangerously-skip-permissions setting', async () => {
    const setSettingMock = vi.fn().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })

    const wrapper = mountProvidersSettings()

    await nextTick()

    const toggle = wrapper.find('[data-settings-field="provider-claude-code-dangerously-skip-permissions"] button[role="switch"]')
    expect(toggle.exists()).toBe(true)

    await toggle.trigger('click')

    expect(setSettingMock).toHaveBeenCalledWith('claudeDangerouslySkipPermissions', true)
  })

  it('does not misuse shadow tokens as badge fills or keep non-baseline switch timings', () => {
    const source = readFileSync(providersSettingsPath, 'utf8')

    expect(source).not.toContain('background: var(--shadow-success-ring);')
    expect(source).not.toContain('160ms')
  })
})
