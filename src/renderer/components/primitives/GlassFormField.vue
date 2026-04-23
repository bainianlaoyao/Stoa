<script setup lang="ts">
import GlassListbox from './GlassListbox.vue'

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
  <label class="grid gap-1.5" data-testid="form-field">
    <span class="text-[11px] font-semibold text-muted uppercase tracking-[0.08em]">{{ label }}</span>
    <input
      v-if="type !== 'select'"
      data-testid="form-input"
      class="bg-surface-solid border border-line rounded-lg px-2.5 py-2 font-inherit text-text-strong outline-none w-full focus:border-accent focus:ring-2 focus:ring-accent/12 placeholder:text-subtle"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <GlassListbox
      v-else
      :model-value="modelValue"
      :options="options ?? []"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </label>
</template>
