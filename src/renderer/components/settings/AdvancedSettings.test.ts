// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import AdvancedSettings from './AdvancedSettings.vue'
import type { RendererApi } from '@shared/project-session'
import { createRendererApiMock } from '@shared/test-fixtures'
import { useSettingsStore } from '@renderer/stores/settings'
import enMessages from '@renderer/i18n/en'

const advancedMessages = enMessages.settings

function setupVibecodingMock(overrides: Partial<RendererApi> = {}): void {
  window.stoa = Object.assign(createRendererApiMock(), overrides)
}

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        settings: advancedMessages
      }
    }
  })
}

function mountAdvancedSettings() {
  return mount(AdvancedSettings, {
    global: { plugins: [createPinia(), createTestI18n()] },
    attachTo: document.body
  })
}

describe('AdvancedSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setupVibecodingMock()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('renders the stoa-ctl toggle row with the disabled state by default', () => {
    const wrapper = mountAdvancedSettings()

    const row = wrapper.find('[data-testid="settings-stoactl-toggle-row"]')
    expect(row.exists()).toBe(true)

    const toggle = wrapper.find('[data-testid="settings-stoactl-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe(advancedMessages.stoactlToggle.title)
  })

  it('renders the section header with the advanced tab label and summary', () => {
    const wrapper = mountAdvancedSettings()

    const section = wrapper.find('[data-surface="advanced-settings"]')
    expect(section.exists()).toBe(true)
    expect(section.text()).toContain(advancedMessages.tabs.advanced.label)
    expect(section.text()).toContain(advancedMessages.tabs.advanced.summary)
    expect(section.text()).toContain(advancedMessages.stoactlToggle.title)
    expect(section.text()).toContain(advancedMessages.stoactlToggle.description)
  })

  it('shows the enabled label and active state when settings.stoaCtlEnabled is true', async () => {
    const wrapper = mountAdvancedSettings()
    const store = useSettingsStore()
    store.stoaCtlEnabled = true
    await nextTick()

    const toggle = wrapper.find('[data-testid="settings-stoactl-toggle"]')
    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(toggle.classes()).toContain('settings-toggle__switch--active')
    expect(wrapper.text()).toContain(advancedMessages.stoactlToggle.enabledLabel)
  })

  it('toggles the setting off immediately when currently enabled (no confirm dialog)', async () => {
    const setSettingMock = vi.fn<(key: string, value: unknown) => Promise<void>>().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })
    const confirmSpy = window.confirm as unknown as ReturnType<typeof vi.fn>

    const wrapper = mountAdvancedSettings()
    const store = useSettingsStore()
    store.stoaCtlEnabled = true
    await nextTick()

    const toggle = wrapper.find('[data-testid="settings-stoactl-toggle"]')
    await toggle.trigger('click')
    await nextTick()

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(setSettingMock).toHaveBeenCalledWith('stoaCtlEnabled', false)
    expect(store.stoaCtlEnabled).toBe(false)
  })

  it('toggles the setting on after confirm when enabling', async () => {
    const setSettingMock = vi.fn<(key: string, value: unknown) => Promise<void>>().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })
    const confirmSpy = window.confirm as unknown as ReturnType<typeof vi.fn>
    confirmSpy.mockReturnValueOnce(true)

    const wrapper = mountAdvancedSettings()
    const store = useSettingsStore()
    expect(store.stoaCtlEnabled).toBe(false)

    const toggle = wrapper.find('[data-testid="settings-stoactl-toggle"]')
    await toggle.trigger('click')
    await nextTick()

    expect(confirmSpy).toHaveBeenCalledWith(advancedMessages.stoactlToggle.warningOnEnable)
    expect(setSettingMock).toHaveBeenCalledWith('stoaCtlEnabled', true)
    expect(store.stoaCtlEnabled).toBe(true)
  })

  it('does not change the setting when user cancels the confirm dialog on enable', async () => {
    const setSettingMock = vi.fn<(key: string, value: unknown) => Promise<void>>().mockResolvedValue(undefined)
    setupVibecodingMock({ setSetting: setSettingMock })
    const confirmSpy = window.confirm as unknown as ReturnType<typeof vi.fn>
    confirmSpy.mockReturnValueOnce(false)

    const wrapper = mountAdvancedSettings()
    const store = useSettingsStore()
    expect(store.stoaCtlEnabled).toBe(false)

    const toggle = wrapper.find('[data-testid="settings-stoactl-toggle"]')
    await toggle.trigger('click')
    await nextTick()

    expect(confirmSpy).toHaveBeenCalledWith(advancedMessages.stoactlToggle.warningOnEnable)
    expect(setSettingMock).not.toHaveBeenCalled()
    expect(store.stoaCtlEnabled).toBe(false)
  })
})
