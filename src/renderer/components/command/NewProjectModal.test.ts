// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import NewProjectModal from './NewProjectModal.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

describe('NewProjectModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('render', () => {
    it('renders when show=true', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.modal-overlay')).toBeTruthy()
    })

    it('does NOT render when show=false', () => {
      mount(NewProjectModal, {
        props: { show: false },
        attachTo: document.body
      })
      expect(document.body.querySelector('.modal-overlay')).toBeFalsy()
    })

    it('renders two .form-field__input elements (name + path)', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      expect(inputs.length).toBe(2)
    })

    it('renders 创建 button (.button-primary)', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const btn = document.body.querySelector('.button-primary')
      expect(btn).toBeTruthy()
      expect(btn!.textContent).toContain('创建')
    })

    it('renders 取消 button (.button-ghost)', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const btn = document.body.querySelector('.button-ghost')
      expect(btn).toBeTruthy()
      expect(btn!.textContent).toContain('取消')
    })
  })

  describe('validation', () => {
    it('submit with empty name + path → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with name only → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with path only → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const pathInput = inputs[1] as HTMLInputElement
      pathInput.value = '/some/path'
      pathInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with whitespace-only name → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      const pathInput = inputs[1] as HTMLInputElement
      nameInput.value = '   '
      nameInput.dispatchEvent(new Event('input'))
      pathInput.value = '/some/path'
      pathInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })
  })

  describe('happy path', () => {
    it('fill name + path → click 创建 → emits create with { name, path }', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      const pathInput = inputs[1] as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      pathInput.value = '/path/to/project'
      pathInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeTruthy()
      expect(wrapper.emitted('create')![0]).toEqual([{ name: 'my-project', path: '/path/to/project' }])
    })

    it('emitted name and path are trimmed (no leading/trailing spaces)', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      const pathInput = inputs[1] as HTMLInputElement
      nameInput.value = '  my-project  '
      nameInput.dispatchEvent(new Event('input'))
      pathInput.value = '  /path/to/project  '
      pathInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')![0]).toEqual([{ name: 'my-project', path: '/path/to/project' }])
    })

    it('after submit → does NOT emit update:show (modal stays open for async result)', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      const pathInput = inputs[1] as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      pathInput.value = '/path/to/project'
      pathInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(wrapper.emitted('update:show')).toBeFalsy()
    })
  })

  describe('cancel', () => {
    it('clicking 取消 → emits update:show with false', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.button-ghost') as HTMLElement).click()
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('clicking 取消 → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
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
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const errorEl = document.body.querySelector('.modal-panel__error')
      expect(errorEl).toBeTruthy()
      expect(errorEl!.textContent).toContain('Creation failed')
    })

    it('does NOT show .modal-panel__error when store.lastError is null', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.modal-panel__error')).toBeFalsy()
    })

    it('submit clears previous error via store.clearError', () => {
      const store = useWorkspaceStore()
      store.lastError = 'prev error'
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      const pathInput = inputs[1] as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      pathInput.value = '/path/to/project'
      pathInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.button-primary') as HTMLElement).click()
      expect(store.lastError).toBeNull()
    })

    it('closing modal clears error and resets drafts', async () => {
      const store = useWorkspaceStore()
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('.form-field__input')
      const nameInput = inputs[0] as HTMLInputElement
      const pathInput = inputs[1] as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      pathInput.value = '/path/to/project'
      pathInput.dispatchEvent(new Event('input'))
      store.lastError = 'some error'

      await wrapper.setProps({ show: false })
      expect(store.lastError).toBeNull()

      await wrapper.setProps({ show: true })
      await nextTick()
      const freshInputs = document.body.querySelectorAll('.form-field__input')
      expect((freshInputs[0] as HTMLInputElement).value).toBe('')
      expect((freshInputs[1] as HTMLInputElement).value).toBe('')
    })

    it('auto-closes when lastError transitions from error to null', async () => {
      const store = useWorkspaceStore()
      store.lastError = 'creation failed'
      const wrapper = mount(NewProjectModal, {
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
