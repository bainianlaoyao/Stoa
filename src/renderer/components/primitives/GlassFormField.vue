<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string
  type?: 'text' | 'select'
  options?: Array<{ value: string; label: string }>
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <label class="form-field">
    <span class="form-field__label">{{ label }}</span>
    <input
      v-if="type !== 'select'"
      class="form-field__input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <select
      v-else
      class="form-field__select"
      :value="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
  </label>
</template>
