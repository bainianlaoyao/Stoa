<script setup lang="ts">
import { computed } from 'vue'
import { listPanels } from '@extensions/panels'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const props = defineProps<{
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
  sessionCount: number
}>()

const panelSummaries = computed(() => {
  return listPanels().map((panel) => ({
    panelId: panel.panelId,
    title: panel.title,
    summary: panel.renderSummary({
      activeWorkspaceId: props.activeSession?.id ?? null,
      workspaceCount: props.sessionCount
    })
  }))
})
</script>

<template>
  <section class="panel-extensions">
    <header class="panel-extensions__header">
      <p class="workspace-list__eyebrow">Panels</p>
      <h2>White-box panels</h2>
    </header>

    <article v-for="panel in panelSummaries" :key="panel.panelId" class="panel-extension-card">
      <h3>{{ panel.title }}</h3>
      <p>{{ panel.summary }}</p>
    </article>
  </section>
</template>
