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
  <label class="grid gap-1.5">
    <span class="text-[11px] font-semibold text-muted uppercase tracking-[0.08em]">{{ label }}</span>
    <input
      v-if="type !== 'select'"
      class="bg-surface-solid border border-line rounded-lg px-2.5 py-2 font-inherit text-text-strong outline-none w-full focus:border-accent focus:ring-2 focus:ring-accent/12 placeholder:text-subtle"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <select
      v-else
      class="bg-surface-solid border border-line rounded-lg px-2.5 py-2 font-inherit text-text-strong outline-none w-full appearance-none focus:border-accent focus:ring-2 focus:ring-accent/12"
      :value="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
  </label>
</template>
