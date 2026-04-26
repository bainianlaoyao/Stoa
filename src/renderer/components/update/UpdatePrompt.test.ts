// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import UpdatePrompt from './UpdatePrompt.vue'
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

async function flushModal(): Promise<void> {
  await nextTick()
  await nextTick()
}

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        updatePrompt: {
          titleDownloaded: 'Ready to install',
          titleAvailable: 'Update available',
          defaultMessage: 'A new build is ready for this installation.',
          version: 'Version {version}',
          warning: 'Installing will close active sessions.',
          dismiss: 'Not now',
          install: 'Install now',
          download: 'Download now'
        }
      }
    }
  })
}

describe('UpdatePrompt', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders available update copy and emits dismiss/download actions', async () => {
    const wrapper = mount(UpdatePrompt, {
      attachTo: document.body,
      global: { plugins: [createTestI18n()] },
      props: {
        visible: true,
        state: createUpdateState({
          phase: 'available',
          availableVersion: '0.2.0',
          message: 'Update 0.2.0 is available.'
        })
      }
    })

    await flushModal()

    expect(document.querySelector('[data-testid="modal-root"]')?.textContent ?? '').toContain('Update 0.2.0 is available')
    expect(document.querySelector('[data-testid="modal-root"]')?.textContent ?? '').toContain('Download now')

    ;(document.querySelector('[data-update-action="download"]') as HTMLButtonElement | null)?.click()
    ;(document.querySelector('[data-update-action="dismiss"]') as HTMLButtonElement | null)?.click()
    await flushModal()

    expect(wrapper.emitted('download')).toEqual([[]])
    expect(wrapper.emitted('dismiss')).toEqual([[]])
  })

  it('renders install action and session warning when update is downloaded', async () => {
    const wrapper = mount(UpdatePrompt, {
      attachTo: document.body,
      global: { plugins: [createTestI18n()] },
      props: {
        visible: true,
        state: createUpdateState({
          phase: 'downloaded',
          downloadedVersion: '0.2.0',
          requiresSessionWarning: true,
          message: 'Update 0.2.0 is ready to install.'
        })
      }
    })

    await flushModal()

    expect(document.querySelector('[data-testid="modal-root"]')?.textContent ?? '').toContain('Ready to install')
    expect(document.querySelector('[data-testid="modal-root"]')?.textContent ?? '').toContain('Installing will close active sessions.')

    ;(document.querySelector('[data-update-action="install"]') as HTMLButtonElement | null)?.click()
    await flushModal()

    expect(wrapper.emitted('install')).toEqual([[]])
  })

  it('does not render when hidden', () => {
    const wrapper = mount(UpdatePrompt, {
      global: { plugins: [createTestI18n()] },
      props: {
        visible: false,
        state: createUpdateState({
          phase: 'available',
          availableVersion: '0.2.0'
        })
      }
    })

    expect(wrapper.find('[data-testid="update-prompt"]').exists()).toBe(false)
  })
})
