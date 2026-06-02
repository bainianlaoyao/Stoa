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
      class="bg-surface-solid border border-line-strong border-b-[2px] border-b-muted/20 rounded-sm px-3 py-2 font-inherit text-text-strong outline-none w-full shadow-soft transition-all duration-200 ease-in-out hover:border-accent/50 focus:border-accent focus:border-b-accent focus:bg-surface-solid focus:ring-[3px] focus:ring-accent/15 placeholder:text-subtle"
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
