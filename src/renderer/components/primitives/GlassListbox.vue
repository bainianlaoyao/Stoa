<script setup lang="ts">
import { computed } from 'vue'
import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption
} from '@headlessui/vue'

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? ''
)
</script>

<template>
  <Listbox
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="relative">
      <ListboxButton
        class="glass-listbox__button"
        data-testid="glass-listbox-button"
      >
        <span class="truncate">{{ selectedLabel }}</span>
        <span class="glass-listbox__chevron">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </ListboxButton>

      <transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <ListboxOptions class="glass-listbox__options">
          <ListboxOption
            v-for="opt in options"
            :key="opt.value"
            v-slot="{ active, selected }"
            :value="opt.value"
            as="template"
          >
            <li
              class="glass-listbox__option"
              :class="{
                'glass-listbox__option--active': active,
                'glass-listbox__option--selected': selected
              }"
            >
              <span class="truncate">{{ opt.label }}</span>
              <svg
                v-if="selected"
                class="glass-listbox__check"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3.5 8.5l3 3 6-6" />
              </svg>
            </li>
          </ListboxOption>
        </ListboxOptions>
      </transition>
    </div>
  </Listbox>
</template>

<style scoped>
.glass-listbox__button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font: inherit;
  font-size: var(--text-body-sm);
  color: var(--color-text-strong);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  text-align: left;
}

.glass-listbox__button:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.glass-listbox__chevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--color-muted);
  transition: transform 0.15s;
}

.glass-listbox__button[aria-expanded="true"] .glass-listbox__chevron {
  transform: rotate(180deg);
}

.glass-listbox__options {
  position: absolute;
  z-index: 50;
  width: 100%;
  margin-top: 4px;
  padding: 4px;
  background: var(--color-surface-solid);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-glass);
  max-height: 240px;
  overflow-y: auto;
  list-style: none;
}

.glass-listbox__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: var(--text-body-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.glass-listbox__option--active {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-accent);
}

.glass-listbox__option--selected {
  font-weight: 600;
}

.glass-listbox__check {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--color-accent);
}
</style>
