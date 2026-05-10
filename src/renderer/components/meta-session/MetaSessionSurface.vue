<script setup lang="ts">
import type { SessionType } from '@shared/project-session'
import MetaSessionInspectorPanel from './MetaSessionInspectorPanel.vue'
import MetaSessionSessionList from './MetaSessionSessionList.vue'
import MetaSessionTerminalDeck from './MetaSessionTerminalDeck.vue'

const emit = defineEmits<{
  createWorkspaceSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()
</script>

<template>
  <section class="meta-session-surface" data-surface="meta-session" data-testid="surface.meta-session" aria-label="Meta session surface">
    <div class="meta-session-surface__layout">
      <MetaSessionSessionList @create-workspace-session="emit('createWorkspaceSession', $event)" />
      <MetaSessionTerminalDeck />
      <MetaSessionInspectorPanel />
    </div>
  </section>
</template>

<style scoped>
.meta-session-surface {
  height: 100%;
  min-height: 0;
  padding: 20px;
}

.meta-session-surface__layout {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 320px;
  gap: 12px;
}
</style>
