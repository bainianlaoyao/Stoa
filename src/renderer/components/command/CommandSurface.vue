<script setup lang="ts">
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import TerminalMetaBar from './TerminalMetaBar.vue'
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
}>()
</script>

<template>
  <section class="command-panel" data-surface="command" data-command-surface="true">
    <div class="command-body">
      <div class="command-layout">
        <WorkspaceHierarchyPanel
          :hierarchy="hierarchy"
          :active-project-id="activeProjectId"
          :active-session-id="activeSessionId"
          @select-project="emit('selectProject', $event)"
          @select-session="emit('selectSession', $event)"
          @create-project="emit('createProject', $event)"
          @create-session="emit('createSession', $event)"
        />

        <div class="terminal-screen">
          <TerminalMetaBar :project="activeProject" :session="activeSession" />
          <TerminalViewport :project="activeProject" :session="activeSession" />
        </div>
      </div>
    </div>
  </section>
</template>
