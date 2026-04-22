<script setup lang="ts">
export type SettingsTab = 'general' | 'providers' | 'about'

defineProps<{
  activeTab: SettingsTab
}>()

const emit = defineEmits<{
  select: [tab: SettingsTab]
}>()

const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'providers', label: 'Providers', icon: '🔧' },
  { id: 'about', label: 'About', icon: 'ℹ' }
]
</script>

<template>
  <nav class="settings-tab-bar" role="tablist" aria-label="Settings navigation">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="settings-tab-bar__item"
      :class="{ 'settings-tab-bar__item--active': tab.id === activeTab }"
      :aria-selected="tab.id === activeTab"
      :aria-controls="`settings-panel-${tab.id}`"
      :data-settings-tab="tab.id"
      role="tab"
      type="button"
      @click="emit('select', tab.id)"
    >
      <span class="settings-tab-bar__icon">{{ tab.icon }}</span>
      <span class="settings-tab-bar__label">{{ tab.label }}</span>
    </button>
  </nav>
</template>
