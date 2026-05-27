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
import { useSettingsStore } from '@renderer/stores/settings'
import enMessages from '@renderer/i18n/en'

const providersSettingsPath = resolve(dirname(fileURLToPath(import.meta.url)), 'ProvidersSettings.vue')
const providerMessages = enMessages.providers
let pinia: ReturnType<typeof createPinia>

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
    onTitleGenerationNotification: vi.fn().mockReturnValue(() => {}),
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
      terminal: {},
      providers: {},
      titleGeneration: {
        enabled: false,
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini'
      },
      workspaceIde: { id: 'vscode', executablePath: '' },
      evolverInferenceProvider: 'claude-code',
      evolverExecutionMode: 'workspace-shell',
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    titleGenerationFetchModels: vi.fn().mockResolvedValue([]),
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
          ...providerMessages
        }
      }
    }
  })
}

function mountProvidersSettings() {
  return mount(ProvidersSettings, {
    global: { plugins: [pinia, createTestI18n()] },
    attachTo: document.body
  })
}

describe('ProvidersSettings', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
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

    expect(wrapper.find('.settings-panel__title').text()).toBe(providerMessages.title)
    expect(wrapper.find('.settings-card__badge').exists()).toBe(true)
  })

  it('renders the evolver inference provider selector with host-owned copy', () => {
    const wrapper = mountProvidersSettings()
    const card = wrapper.find(`[aria-label="${providerMessages.evolverInference.ariaLabel}"]`)

    expect(card.exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="evolver-inference-provider"]').exists()).toBe(true)
    expect(card.text()).toContain(providerMessages.evolverInference.title)
    expect(card.text()).toContain(providerMessages.evolverInference.description)
    expect(card.text()).toContain(providerMessages.evolverInference.badge)
    expect(card.text()).toContain(providerMessages.evolverInference.hint)
  })

  it('renders a hydrated claude-code inference provider selection from persisted settings', async () => {
    const wrapper = mountProvidersSettings()
    const trigger = wrapper.find('[data-settings-field="evolver-inference-provider"] [data-testid="glass-listbox-button"]')

    expect(trigger.text()).toContain('Claude Code')
  })

  it('renders the session title generation card with user-supplied API fields', () => {
    const wrapper = mountProvidersSettings()
    const card = wrapper.find(`[aria-label="${providerMessages.titleGeneration.ariaLabel}"]`)

    expect(card.exists()).toBe(true)
    expect(card.text()).toContain(providerMessages.titleGeneration.title)
    expect(card.text()).toContain(providerMessages.titleGeneration.description)
    expect(card.text()).toContain(providerMessages.titleGeneration.badge)
    expect(card.text()).toContain(providerMessages.titleGeneration.hint)
    expect(wrapper.find('[data-settings-field="title-generation-enabled"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="title-generation-model"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="title-generation-base-url"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="title-generation-api-key"]').exists()).toBe(true)
  })

  it('updates title generation API fields through the shared settings store', async () => {
    const wrapper = mountProvidersSettings()
    const store = useSettingsStore()
    const updateSetting = vi.spyOn(store, 'updateSetting').mockResolvedValue(undefined)

    const inputs = wrapper.findAll('[data-testid="form-input"]')
    const baseUrlInput = inputs[0]
    const apiKeyInput = inputs[1]

    expect(baseUrlInput).toBeDefined()
    expect(apiKeyInput).toBeDefined()

    await baseUrlInput!.setValue('https://example.test/v1')
    await apiKeyInput!.setValue('sk-user-title')

    expect(updateSetting).toHaveBeenNthCalledWith(1, 'titleGeneration', {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5.4-mini'
    })
    expect(updateSetting).toHaveBeenNthCalledWith(2, 'titleGeneration', {
      enabled: false,
      apiKey: 'sk-user-title',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini'
    })
  })

  it('renders Browse button for each provider', () => {
    const wrapper = mountProvidersSettings()
    const browseButtons = wrapper.findAll('[data-settings-field^="provider-"] .btn-ghost')
    expect(browseButtons.length).toBeGreaterThanOrEqual(1)
    expect(browseButtons[0].text()).toBe(providerMessages.browse)
  })

  it('shows "Detecting..." hint on mount', () => {
    setupVibecodingMock({ detectProvider: vi.fn().mockReturnValue(new Promise(() => {})) })

    const wrapper = mountProvidersSettings()
    const hint = wrapper.find('[aria-label="OpenCode provider"] .settings-item__hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe(providerMessages.detecting)
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

  it('keeps the claude permissions toggle on shared control surface tokens and baseline timing', () => {
    const source = readFileSync(providersSettingsPath, 'utf8')

    expect(source).toContain('border-radius: var(--radius-sm);')
    expect(source).toContain('background: var(--color-surface-solid);')
    expect(source).toContain('border: 1px solid var(--color-line);')
    expect(source).toContain('box-shadow: var(--shadow-soft);')
    expect(source).not.toContain('background: var(--shadow-success-ring);')
    expect(source).not.toContain('160ms')
    expect(source).not.toContain('border-radius: 16px;')
  })

})
