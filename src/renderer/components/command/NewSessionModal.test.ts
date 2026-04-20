// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import NewSessionModal from './NewSessionModal.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

describe('NewSessionModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('render', () => {
    it('renders when show=true', () => {
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.modal-overlay')).toBeTruthy()
    })

    it('does NOT render when show=false', () => {
      mount(NewSessionModal, {
        props: { show: false },
        attachTo: document.body
      })
      expect(document.body.querySelector('.modal-overlay')).toBeFalsy()
    })

    it('renders .form-field__input for title', () => {
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.form-field__input')).toBeTruthy()
    })

    it('renders .form-field__select for session type', () => {
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.form-field__select')).toBeTruthy()
    })

    it('select has shell and opencode options', () => {
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const select = document.body.querySelector('.form-field__select') as HTMLSelectElement
      const options = Array.from(select.options).map(o => o.value)
      expect(options).toContain('shell')
      expect(options).toContain('opencode')
    })

    it('renders 创建 and 取消 buttons', () => {
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const primary = document.body.querySelector('.button-primary')
      const ghost = document.body.querySelector('.button-ghost')
      expect(primary).toBeTruthy()
      expect(primary!.textContent).toContain('创建')
      expect(ghost).toBeTruthy()
      expect(ghost!.textContent).toContain('取消')
    })
  })

  describe('validation', () => {
    it('submit with empty title → does NOT emit create', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with whitespace-only title → does NOT emit create', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const input = document.body.querySelector('.form-field__input') as HTMLInputElement
      input.value = '   '
      input.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })
  })

  describe('happy path', () => {
    it('fill title → submit → emits create with { title, type: shell }', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const input = document.body.querySelector('.form-field__input') as HTMLInputElement
      input.value = 'my-session'
      input.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeTruthy()
      expect(wrapper.emitted('create')![0]).toEqual([{ title: 'my-session', type: 'shell' }])
    })

    it('emitted title is trimmed', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const input = document.body.querySelector('.form-field__input') as HTMLInputElement
      input.value = '  my-session  '
      input.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')![0]).toEqual([{ title: 'my-session', type: 'shell' }])
    })

    it('after submit → does NOT emit update:show (modal stays open for async result)', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const input = document.body.querySelector('.form-field__input') as HTMLInputElement
      input.value = 'my-session'
      input.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('update:show')).toBeFalsy()
    })
  })

  describe('cancel', () => {
    it('clicking 取消 → emits update:show with false', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.button-ghost') as HTMLElement).click()
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('clicking 取消 → does NOT emit create', () => {
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.button-ghost') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })
  })

  describe('error handling', () => {
    it('shows .modal-panel__error when store.lastError is set', () => {
      const store = useWorkspaceStore()
      store.lastError = 'Creation failed'
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const errorEl = document.body.querySelector('.modal-panel__error')
      expect(errorEl).toBeTruthy()
      expect(errorEl!.textContent).toContain('Creation failed')
    })

    it('does NOT show .modal-panel__error when store.lastError is null', () => {
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.modal-panel__error')).toBeFalsy()
    })

    it('submit clears previous error via store.clearError', () => {
      const store = useWorkspaceStore()
      store.lastError = 'prev error'
      mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const input = document.body.querySelector('.form-field__input') as HTMLInputElement
      input.value = 'my-session'
      input.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(store.lastError).toBeNull()
    })

    it('closing modal clears error and resets drafts', async () => {
      const store = useWorkspaceStore()
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      const input = document.body.querySelector('.form-field__input') as HTMLInputElement
      input.value = 'my-session'
      input.dispatchEvent(new Event('input'))
      store.lastError = 'some error'

      await wrapper.setProps({ show: false })
      expect(store.lastError).toBeNull()

      await wrapper.setProps({ show: true })
      await nextTick()
      const freshInput = document.body.querySelector('.form-field__input') as HTMLInputElement
      expect(freshInput.value).toBe('')
    })

    it('auto-closes when lastError transitions from error to null', async () => {
      const store = useWorkspaceStore()
      store.lastError = 'creation failed'
      const wrapper = mount(NewSessionModal, {
        props: { show: true },
        attachTo: document.body
      })
      await nextTick()

      store.lastError = null
      await nextTick()

      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })
  })
})
