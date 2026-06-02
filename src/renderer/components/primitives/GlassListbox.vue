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
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-1.5"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-[var(--duration-rest)] ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
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
  background: var(--control-fill);
  border: 1px solid var(--color-line-strong);
  border-bottom: 2px solid color-mix(in srgb, var(--color-text) 15%, transparent);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font: inherit;
  font-size: var(--text-body-sm);
  color: var(--color-text-strong);
  cursor: pointer;
  transition: border-color 0.2s ease, 
              background-color 0.2s ease,
              box-shadow 0.2s ease;
  text-align: left;
  box-shadow: var(--shadow-soft);
}

.glass-listbox__button:hover {
  background: var(--control-fill-hover);
  border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
}

.glass-listbox__button:focus {
  outline: none;
  border-color: var(--color-accent);
  border-bottom-color: var(--color-accent);
  box-shadow: var(--shadow-focus-ring);
}

.glass-listbox__chevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--color-subtle);
  transition: transform 0.2s ease, color 0.2s ease;
}

.glass-listbox__button:hover .glass-listbox__chevron {
  color: var(--color-muted);
}

.glass-listbox__button[aria-expanded="true"] .glass-listbox__chevron {
  transform: rotate(180deg);
  color: var(--color-accent);
}

.glass-listbox__options {
  position: absolute;
  z-index: 50;
  width: 100%;
  margin-top: 4px;
  padding: 4px;
  background: var(--acrylic);
  backdrop-filter: blur(30px) saturate(1.25);
  -webkit-backdrop-filter: blur(30px) saturate(1.25);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-flyout);
  max-height: 240px;
  overflow-y: auto;
  list-style: none;
}

.glass-listbox__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-body-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.glass-listbox__option--active {
  background: var(--color-active-fill);
  color: var(--color-accent);
}

.glass-listbox__option--selected {
  font-weight: 600;
  color: var(--color-text-strong);
}

.glass-listbox__check {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--color-accent);
}
</style>
