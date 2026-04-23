// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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

describe('UpdatePrompt', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders available update copy and emits dismiss/download actions', async () => {
    const wrapper = mount(UpdatePrompt, {
      attachTo: document.body,
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
