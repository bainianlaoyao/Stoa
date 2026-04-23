<script setup lang="ts">
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
  activeProjectId: string | null
  activeSessionId: string | null
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  archiveSession: [sessionId: string]
}>()
</script>

<template>
  <section class="h-full min-h-0" data-surface="command" data-command-surface="true" data-testid="command-panel">
    <div class="h-full p-2.5 min-h-0 grid" data-testid="command-body">
      <div class="h-full grid grid-cols-[240px_minmax(0,1fr)] gap-2.5 min-h-0 items-stretch" data-testid="command-layout">
        <WorkspaceHierarchyPanel
          :hierarchy="hierarchy"
          :active-project-id="activeProjectId"
          :active-session-id="activeSessionId"
          @select-project="emit('selectProject', $event)"
          @select-session="emit('selectSession', $event)"
          @create-project="emit('createProject', $event)"
          @create-session="emit('createSession', $event)"
          @archive-session="emit('archiveSession', $event)"
        />

        <TerminalViewport :project="activeProject" :session="activeSession" />
      </div>
    </div>
  </section>
</template>
