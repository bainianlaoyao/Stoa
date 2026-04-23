// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GlassFormField from './GlassFormField.vue'

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

    it('does NOT render form select when type is not select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      expect(wrapper.find('[data-testid="form-select"]').exists()).toBe(false)
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

    it('renders form select when type=select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      expect(wrapper.find('[data-testid="form-select"]').exists()).toBe(true)
    })

    it('does NOT render form input when type=select', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      expect(wrapper.find('[data-testid="form-input"]').exists()).toBe(false)
    })

    it('renders option elements from options prop', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      const optionElements = wrapper.findAll('option')
      expect(optionElements).toHaveLength(2)
      expect((optionElements[0].element as HTMLOptionElement).value).toBe('a')
      expect(optionElements[0].text()).toBe('Option A')
      expect((optionElements[1].element as HTMLOptionElement).value).toBe('b')
      expect(optionElements[1].text()).toBe('Option B')
    })

    it('changing select emits update:modelValue with selected value', async () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'a', type: 'select', options }
      })
      const select = wrapper.find('[data-testid="form-select"]')
      await select.setValue('b')
      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['b'])
    })

    it('select value matches modelValue prop', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: 'b', type: 'select', options }
      })
      const select = wrapper.find('[data-testid="form-select"]')
      expect((select.element as HTMLSelectElement).value).toBe('b')
    })
  })

  describe('edge cases', () => {
    it('empty options array renders empty select without crash', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Pick', modelValue: '', type: 'select', options: [] }
      })
      expect(wrapper.find('[data-testid="form-select"]').exists()).toBe(true)
      expect(wrapper.findAll('option')).toHaveLength(0)
    })

    it('undefined type defaults to text (renders input, not select)', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      expect(wrapper.find('[data-testid="form-input"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="form-select"]').exists()).toBe(false)
    })

    it('renders correctly without placeholder prop', () => {
      const wrapper = mount(GlassFormField, {
        props: { label: 'Name', modelValue: '' }
      })
      const input = wrapper.find('[data-testid="form-input"]')
      expect((input.element as HTMLInputElement).placeholder).toBe('')
    })
  })
})
