<script setup lang="ts">
import type { SessionType } from '@shared/project-session'
import HermesInspectorPanel from './HermesInspectorPanel.vue'
import HermesSessionList from './HermesSessionList.vue'
import HermesTerminalDeck from './HermesTerminalDeck.vue'

const emit = defineEmits<{
  createWorkspaceSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()
</script>

<template>
  <section class="hermes-surface" data-surface="hermes" data-testid="surface.hermes" aria-label="Hermes surface">
    <div class="hermes-surface__layout">
      <HermesSessionList @create-workspace-session="emit('createWorkspaceSession', $event)" />
      <HermesTerminalDeck />
      <HermesInspectorPanel />
    </div>
  </section>
</template>

<style scoped>
.hermes-surface {
  height: 100%;
  min-height: 0;
  padding: 20px;
}

.hermes-surface__layout {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 320px;
  gap: 12px;
}
</style>
