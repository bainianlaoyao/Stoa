<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string
  placeholder?: string
  mono?: boolean
  readonly?: boolean
  browseLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  browse: []
}>()
</script>

<template>
  <div class="glass-path-field" data-testid="path-field">
    <label class="glass-path-field__label">
      <span class="text-[11px] font-semibold text-muted uppercase tracking-[0.08em]">{{ label }}</span>
      <div class="flex gap-2">
        <input
          class="glass-path-field__input"
          :class="{ 'font-mono': mono }"
          :value="modelValue"
          :placeholder="placeholder"
          :readonly="readonly"
          v-bind="readonly ? { onClick: () => emit('browse') } : {}"
          @change="!readonly && emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="browseLabel"
          class="btn-ghost min-h-[38px]"
          type="button"
          @click="emit('browse')"
        >{{ browseLabel }}</button>
      </div>
    </label>
  </div>
</template>

<style scoped>
.glass-path-field__label {
  display: grid;
  gap: 6px;
}

.glass-path-field__input {
  background: linear-gradient(to bottom, #ffffff 0%, #fafbfc 100%);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font: inherit;
  font-size: var(--text-body-sm);
  color: var(--color-text-strong);
  outline: none;
  width: 100%;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.015);
}

.glass-path-field__input:hover {
  border-color: rgba(0, 85, 255, 0.35);
}

.glass-path-field__input:focus {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-focus-ring);
  background: #ffffff;
}

.glass-path-field__input::placeholder {
  color: var(--color-subtle);
}

.glass-path-field__input[readonly] {
  cursor: pointer;
}
</style>
