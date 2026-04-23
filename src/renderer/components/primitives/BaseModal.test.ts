// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseModal from './BaseModal.vue'

describe('BaseModal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('render', () => {
    it('renders modal overlay when show=true', () => {
      mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      expect(document.body.querySelector('[data-testid="modal-overlay"]')).toBeTruthy()
    })

    it('does NOT render modal overlay when show=false', () => {
      mount(BaseModal, {
        props: { show: false, title: 'Test' },
        attachTo: document.body
      })
      expect(document.body.querySelector('[data-testid="modal-overlay"]')).toBeFalsy()
    })

    it('renders modal panel with role="dialog"', () => {
      mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      const panel = document.body.querySelector('[data-testid="modal-panel"]')
      expect(panel).toBeTruthy()
      expect(panel!.getAttribute('role')).toBe('dialog')
    })

    it('renders aria-modal="true" on modal panel', () => {
      mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      const panel = document.body.querySelector('[data-testid="modal-panel"]')
      expect(panel!.getAttribute('aria-modal')).toBe('true')
    })

    it('renders title text in modal title', () => {
      mount(BaseModal, {
        props: { show: true, title: 'My Modal Title' },
        attachTo: document.body
      })
      const title = document.body.querySelector('[data-testid="modal-title"]')
      expect(title!.textContent).toBe('My Modal Title')
    })

    it('renders close button', () => {
      mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      expect(document.body.querySelector('[data-testid="modal-close"]')).toBeTruthy()
    })

    it('renders slot content in modal body', () => {
      mount(BaseModal, {
        props: { show: true, title: 'Test' },
        slots: { default: '<p class="slot-content">Hello</p>' },
        attachTo: document.body
      })
      const body = document.body.querySelector('[data-testid="modal-body"]')
      expect(body!.querySelector('.slot-content')).toBeTruthy()
      expect(body!.textContent).toContain('Hello')
    })
  })

  describe('aria', () => {
    it('aria-labelledby on panel matches title element id', () => {
      mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      const panel = document.body.querySelector('[data-testid="modal-panel"]')!
      const titleEl = document.body.querySelector('[data-testid="modal-title"]')!
      const labelledBy = panel.getAttribute('aria-labelledby')
      expect(labelledBy).toBe(titleEl.getAttribute('id'))
    })
  })

  describe('close behavior', () => {
    it('clicking close button emits update:show with false', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      const closeBtn = document.body.querySelector('[data-testid="modal-close"]') as HTMLElement
      closeBtn.click()
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('clicking overlay background (self) emits update:show with false', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      const overlay = document.body.querySelector('[data-testid="modal-overlay"]') as HTMLElement
      overlay.click()
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('clicking panel content does NOT emit update:show', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: true, title: 'Test' },
        attachTo: document.body
      })
      const panel = document.body.querySelector('[data-testid="modal-panel"]') as HTMLElement
      panel.click()
      expect(wrapper.emitted('update:show')).toBeFalsy()
    })
  })

  describe('escape key', () => {
    it('pressing Escape when show=true emits update:show with false', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: false, title: 'Test' },
        attachTo: document.body
      })
      // watch is not immediate, so transition to true to attach listener
      await wrapper.setProps({ show: true })

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(wrapper.emitted('update:show')).toBeTruthy()
      expect(wrapper.emitted('update:show')![0]).toEqual([false])
    })

    it('pressing other keys (Enter) does NOT emit update:show', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: false, title: 'Test' },
        attachTo: document.body
      })
      await wrapper.setProps({ show: true })

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      expect(wrapper.emitted('update:show')).toBeFalsy()
    })
  })

  describe('lifecycle', () => {
    it('pressing Escape when show=false does nothing (listener not attached)', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: false, title: 'Test' },
        attachTo: document.body
      })
      // watch is not immediate, and show=false means listener never attached
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(wrapper.emitted('update:show')).toBeFalsy()
    })

    it('cleanup: listener removed when show transitions from true to false', async () => {
      const wrapper = mount(BaseModal, {
        props: { show: false, title: 'Test' },
        attachTo: document.body
      })
      await wrapper.setProps({ show: true })
      await wrapper.setProps({ show: false })

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(wrapper.emitted('update:show')).toBeFalsy()
    })
  })
})
