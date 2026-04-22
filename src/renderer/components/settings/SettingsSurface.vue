<script setup lang="ts">
import { ref, type Component } from 'vue'
import SettingsTabBar from './SettingsTabBar.vue'
import type { SettingsTab } from './SettingsTabBar.vue'
import GeneralSettings from './GeneralSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AboutSettings from './AboutSettings.vue'

const activeTab = ref<SettingsTab>('general')

const tabComponents: Record<SettingsTab, Component> = {
  general: GeneralSettings,
  providers: ProvidersSettings,
  about: AboutSettings
}
</script>

<template>
  <section class="settings-surface" data-surface="settings" aria-label="Settings surface">
    <SettingsTabBar :active-tab="activeTab" @select="activeTab = $event" />
    <component :is="tabComponents[activeTab]" />
  </section>
</template>
