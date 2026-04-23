// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import NewProjectModal from './NewProjectModal.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'

function mockPickFolder(path: string | null) {
  window.stoa = {
    ...window.stoa,
    pickFolder: vi.fn().mockResolvedValue(path)
  } as any
}

describe('NewProjectModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    window.stoa = {
      getBootstrapState: vi.fn(),
      createProject: vi.fn(),
      createSession: vi.fn(),
      setActiveProject: vi.fn(),
      setActiveSession: vi.fn(),
      sendSessionInput: vi.fn(),
      sendSessionResize: vi.fn(),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onSessionEvent: vi.fn().mockReturnValue(() => {}),
      getSettings: vi.fn().mockResolvedValue({ shellPath: '', terminalFontSize: 14, providers: {} }),
      setSetting: vi.fn(),
      pickFolder: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue(null),
      detectShell: vi.fn().mockResolvedValue(null),
      detectProvider: vi.fn().mockResolvedValue(null)
    } as any
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
      expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
    })

    it('does NOT render when show=false', () => {
      mount(NewProjectModal, {
        props: { show: false },
        attachTo: document.body
      })
      expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
    })

    it('renders two input elements (name + path)', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const inputs = document.body.querySelectorAll('input[type="text"], input:not([type])')
      expect(inputs.length).toBe(2)
    })

    it('renders 创建 button (.btn-primary)', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const btn = document.body.querySelector('.btn-primary')
      expect(btn).toBeTruthy()
      expect(btn!.textContent).toContain('创建')
    })

    it('renders 取消 button in footer', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const btn = document.body.querySelector('.flex.justify-end .btn-ghost')
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
      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with name only → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const nameInput = document.body.querySelector('label:first-of-type input') as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with path only (name cleared after Browse) → does NOT emit create', async () => {
      mockPickFolder('/some/path')
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = ''
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })

    it('submit with whitespace-only name (after Browse) → does NOT emit create', async () => {
      mockPickFolder('/some/path')
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = '   '
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })
  })

  describe('happy path', () => {
    it('fill name + path → click 创建 → emits create with { name, path }', async () => {
      mockPickFolder('/path/to/project')
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeTruthy()
      expect(wrapper.emitted('create')![0]).toEqual([{ name: 'my-project', path: '/path/to/project' }])
    })

    it('emitted name is trimmed (no leading/trailing spaces)', async () => {
      mockPickFolder('/path/to/project')
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = '  my-project  '
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('create')![0]).toEqual([{ name: 'my-project', path: '/path/to/project' }])
    })

    it('after submit → emits update:show with false (modal closes)', async () => {
      mockPickFolder('/path/to/project')
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })
  })

  describe('cancel', () => {
    it('clicking 取消 → emits update:show with false', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.flex.justify-end .btn-ghost') as HTMLElement).click()
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('clicking 取消 → does NOT emit create', () => {
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      ;(document.body.querySelector('.flex.justify-end .btn-ghost') as HTMLElement).click()
      expect(wrapper.emitted('create')).toBeFalsy()
    })
  })

  describe('error handling', () => {
    it('shows error element when store.lastError is set', () => {
      const store = useWorkspaceStore()
      store.lastError = 'Creation failed'
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const errorEl = document.body.querySelector('.text-error')
      expect(errorEl).toBeTruthy()
      expect(errorEl!.textContent).toContain('Creation failed')
    })

    it('does NOT show error element when store.lastError is null', () => {
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      expect(document.body.querySelector('.text-error')).toBeFalsy()
    })

    it('submit clears previous error via store.clearError', async () => {
      const store = useWorkspaceStore()
      store.lastError = 'prev error'
      mockPickFolder('/path/to/project')
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      ;(document.body.querySelector('.btn-primary') as HTMLElement).click()
      expect(store.lastError).toBeNull()
    })

    it('closing modal resets drafts', async () => {
      mockPickFolder('/path/to/project')
      const wrapper = mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      const nameInput = document.body.querySelector('label input') as HTMLInputElement
      nameInput.value = 'my-project'
      nameInput.dispatchEvent(new Event('input'))
      await nextTick()

      const browseBtn = document.body.querySelector('.btn-ghost') as HTMLElement
      browseBtn.click()
      await nextTick()

      await wrapper.setProps({ show: false })
      await wrapper.setProps({ show: true })
      await nextTick()
      const freshInputs = document.body.querySelectorAll('label input')
      expect((freshInputs[0] as HTMLInputElement).value).toBe('')
      expect((freshInputs[1] as HTMLInputElement).value).toBe('')
    })

    it('error persists until explicitly cleared', async () => {
      const store = useWorkspaceStore()
      store.lastError = 'creation failed'
      mount(NewProjectModal, {
        props: { show: true },
        attachTo: document.body
      })
      await nextTick()

      expect(store.lastError).toBe('creation failed')
    })
  })
})
