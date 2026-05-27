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
    <span class="text-[length:var(--text-caption)] font-semibold text-muted uppercase tracking-[0.08em]">{{ label }}</span>
    <input
      v-if="type !== 'select'"
      data-testid="form-input"
      class="bg-gradient-to-b from-white to-[#fafbfc] border border-line-strong rounded-[length:var(--radius-sm)] px-3 py-2 font-inherit text-text-strong outline-none w-full shadow-[inset_0_1px_1px_rgba(0,0,0,0.015)] transition-all duration-200 ease-[cubic-bezier(0.25,0.8,0.25,1)] hover:border-accent/35 focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-accent/18 placeholder:text-subtle"
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
