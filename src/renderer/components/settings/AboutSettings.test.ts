// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import AboutSettings from './AboutSettings.vue'
import { useUpdateStore } from '@renderer/stores/update'
import type { RendererApi } from '@shared/project-session'
import { createRendererApiMock } from '@shared/test-fixtures'
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
  return Object.assign(
    createRendererApiMock({
      getUpdateState: vi.fn().mockResolvedValue(createUpdateState()),
      checkForUpdates: vi.fn().mockResolvedValue(
        createUpdateState({ phase: 'up-to-date', message: 'You are up to date.' })
      ),
      downloadUpdate: vi.fn().mockResolvedValue(
        createUpdateState({ phase: 'downloaded', downloadedVersion: '0.2.0' })
      )
    }),
    overrides
  )
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

  it('uses the shared renderer brand symbol for the about logo', () => {
    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })
    const logo = wrapper.get('.settings-about__logo')

    expect(logo.element.tagName).toBe('IMG')
    expect(logo.attributes('src')).toMatch(/^data:image\/svg\+xml/)
    expect(logo.attributes('aria-hidden')).toBe('true')
    expect(logo.text()).toBe('')
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
    expect(wrapper.text()).toContain('Latest version')
    expect(wrapper.text()).toContain('0.2.0')
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

  it('shows download button when update is available', async () => {
    const store = useUpdateStore()
    store.applyState(createUpdateState({
      phase: 'available',
      availableVersion: '0.2.0',
      message: 'Update 0.2.0 is available.'
    }))

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    const button = wrapper.get('[data-settings-action="download-update"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.text()).toBe('Download now')
  })

  it('clicking download calls downloadUpdate', async () => {
    const downloadUpdate = vi.fn().mockResolvedValue(
      createUpdateState({ phase: 'downloading' })
    )
    window.stoa = createStoaMock({ downloadUpdate })

    const store = useUpdateStore()
    store.applyState(createUpdateState({
      phase: 'available',
      availableVersion: '0.2.0'
    }))

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    await wrapper.get('[data-settings-action="download-update"]').trigger('click')
    expect(downloadUpdate).toHaveBeenCalledOnce()
  })

  it('disables button while downloading', () => {
    const store = useUpdateStore()
    store.applyState(createUpdateState({
      phase: 'downloading',
      availableVersion: '0.2.0',
      downloadProgressPercent: 42
    }))

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    const button = wrapper.get('[data-settings-action="download-update"]')
    expect(button.attributes('disabled')).toBe('')
    expect(button.text()).toBe('Downloading...')
  })

  it('shows install button when update is downloaded', async () => {
    const store = useUpdateStore()
    store.applyState(createUpdateState({
      phase: 'downloaded',
      downloadedVersion: '0.2.0',
      message: 'Update 0.2.0 is ready to install.'
    }))

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    const button = wrapper.get('[data-settings-action="install-update"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.text()).toBe('Install now')
  })

  it('clicking install calls quitAndInstallUpdate', async () => {
    const quitAndInstallUpdate = vi.fn().mockResolvedValue(undefined)
    window.stoa = createStoaMock({ quitAndInstallUpdate })

    const store = useUpdateStore()
    store.applyState(createUpdateState({
      phase: 'downloaded',
      downloadedVersion: '0.2.0'
    }))

    const wrapper = mount(AboutSettings, {
      global: { plugins: [pinia] }
    })

    await wrapper.get('[data-settings-action="install-update"]').trigger('click')
    expect(quitAndInstallUpdate).toHaveBeenCalledOnce()
  })
})
