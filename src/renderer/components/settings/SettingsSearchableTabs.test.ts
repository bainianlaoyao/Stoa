// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { RendererApi } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'
import { createRendererApiMock } from '@shared/test-fixtures'
import GeneralSettings from './GeneralSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AboutSettings from './AboutSettings.vue'
import { useUpdateStore } from '@renderer/stores/update'

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
  return Object.assign(
    createRendererApiMock({
      getUpdateState: vi.fn().mockResolvedValue(createUpdateState())
    }),
    overrides
  )
}

describe('search-aware settings tabs', () => {
  let pinia: Pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    window.stoa = createStoaMock()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('filters General settings cards to the matching section', () => {
    const wrapper = mount(GeneralSettings, {
      props: {
        searchQuery: 'theme'
      },
      global: { plugins: [pinia] },
      attachTo: document.body
    })

    expect(wrapper.find('[data-settings-field="themeMode"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="shellPath"]').exists()).toBe(false)
    expect(wrapper.find('[data-settings-field="locale"]').exists()).toBe(false)
  })

  it('keeps the relevant Providers card visible for focused queries', () => {
    const wrapper = mount(ProvidersSettings, {
      props: {
        searchQuery: 'permissions'
      },
      global: { plugins: [pinia] },
      attachTo: document.body
    })

    expect(wrapper.find('[data-settings-field="provider-claude-code-dangerously-skip-permissions"]').exists()).toBe(true)
    expect(wrapper.find('[data-settings-field="title-generation-base-url"]').exists()).toBe(false)
    expect(wrapper.find('[data-settings-field="evolver-inference-provider"]').exists()).toBe(false)
  })

  it('filters About settings to the matching card while preserving update behavior elsewhere', () => {
    const updateStore = useUpdateStore()
    updateStore.applyState(createUpdateState({
      phase: 'available',
      availableVersion: '0.2.0',
      message: 'Update 0.2.0 is available.'
    }))

    const wrapper = mount(AboutSettings, {
      props: {
        searchQuery: 'github'
      },
      global: { plugins: [pinia] },
      attachTo: document.body
    })

    expect(wrapper.find('.settings-about__links').exists()).toBe(true)
    expect(wrapper.find('[data-settings-action="download-update"]').exists()).toBe(false)
    expect(wrapper.find('.settings-about__summary').exists()).toBe(false)
  })
})
