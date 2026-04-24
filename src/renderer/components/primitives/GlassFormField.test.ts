// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GlassFormField from './GlassFormField.vue'

const glassListboxPath = resolve(dirname(fileURLToPath(import.meta.url)), 'GlassListbox.vue')
const glassPathFieldPath = resolve(dirname(fileURLToPath(import.meta.url)), 'GlassPathField.vue')

describe('GlassFormField', () => {
  describe('text input (default)', () => {
    it('renders form-field label', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      expect(wrapper.find('[data-testid="form-field"]').exists()).toBe(true)
      expect(wrapper.find('label[data-testid="form-field"]').exists()).toBe(true)
    })

    it('renders form input when type is not select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      expect(wrapper.find('[data-testid="form-input"]').exists()).toBe(true)
    })

    it('does NOT render listbox button when type is not select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      expect(wrapper.find('[data-testid="glass-listbox-button"]').exists()).toBe(false)
    })

    it('input value matches modelValue prop', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: 'hello' }
      })
      const input = wrapper.find('[data-testid="form-input"]')
      expect((input.element as HTMLInputElement).value).toBe('hello')
    })

    it('input placeholder matches placeholder prop', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '', placeholder: 'Enter name' }
      })
      const input = wrapper.find('[data-testid="form-input"]')
      expect((input.element as HTMLInputElement).placeholder).toBe('Enter name')
    })

    it('typing in input emits update:modelValue with new value', async () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      const input = wrapper.find('[data-testid="form-input"]')
      await input.setValue('typed text')
      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['typed text'])
    })
  })

  describe('select input (type="select")', () => {
    const options = [
      { value: 'a', label: 'Option A' },
      { value: 'b', label: 'Option B' }
    ]

    it('renders listbox button when type=select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      expect(wrapper.find('[data-testid="glass-listbox-button"]').exists()).toBe(true)
    })

    it('does NOT render form input when type=select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      expect(wrapper.find('[data-testid="form-input"]').exists()).toBe(false)
    })

    it('shows selected option label in button', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      const button = wrapper.find('[data-testid="glass-listbox-button"]')
      expect(button.text()).toContain('Option A')
    })

    it('clicking listbox button opens options panel', async () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      const button = wrapper.find('[data-testid="glass-listbox-button"]')
      await button.trigger('click')

      const listItems = wrapper.findAll('li.glass-listbox__option')
      expect(listItems).toHaveLength(2)
      expect(listItems[0].text()).toBe('Option A')
      expect(listItems[1].text()).toBe('Option B')
    })

    it('clicking an option emits update:modelValue', async () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      // Open the listbox
      const button = wrapper.find('[data-testid="glass-listbox-button"]')
      await button.trigger('click')

      // Click the second option
      const listItems = wrapper.findAll('li.glass-listbox__option')
      await listItems[1].trigger('click')

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['b'])
    })
  })

  describe('edge cases', () => {
    it('empty options array renders without crash', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: '', type: 'select', options: [] }
      })
      expect(wrapper.find('[data-testid="glass-listbox-button"]').exists()).toBe(true)
    })

    it('undefined type defaults to text (renders input, not listbox)', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      expect(wrapper.find('[data-testid="form-input"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="glass-listbox-button"]').exists()).toBe(false)
    })

    it('renders correctly without placeholder prop', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      const input = wrapper.find('[data-testid="form-input"]')
      expect((input.element as HTMLInputElement).placeholder).toBe('')
    })
  })

  describe('style contracts', () => {
    it('keeps GlassListbox transitions on the shared 0.2s baseline', () => {
      const source = readFileSync(glassListboxPath, 'utf8')

      expect(source).not.toContain('duration-100')
      expect(source).not.toContain('duration-75')
      expect(source).not.toContain('0.15s')
      expect(source).not.toContain('0.1s')
    })

    it('keeps GlassPathField transitions on the shared 0.2s baseline', () => {
      const source = readFileSync(glassPathFieldPath, 'utf8')

      expect(source).not.toContain('0.15s')
    })
  })
})
