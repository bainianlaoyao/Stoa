<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { toSessionRowViewModel } from '@renderer/stores/observability-view-models'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

const props = defineProps<{
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
  deleteProject: [projectId: string]
  archiveSession: [sessionId: string]
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

const workspaceStore = useWorkspaceStore()
const { sessionPresenceMap } = storeToRefs(workspaceStore)

const sessionRowViewModels = computed(() => {
  const nowIso = new Date().toISOString()
  const viewModels: Record<string, ReturnType<typeof toSessionRowViewModel>> = {}

  for (const project of props.hierarchy) {
    for (const session of project.sessions) {
      const presence = sessionPresenceMap.value[session.id]
      if (!presence) {
        continue
      }

      viewModels[session.id] = toSessionRowViewModel(session, presence, nowIso)
    }
  }

  return viewModels
})
</script>

<template>
  <section class="h-full min-h-0" data-surface="command" data-command-surface="true" data-testid="command-panel">
    <div class="h-full p-2.5 min-h-0 grid" data-testid="command-body">
      <div class="h-full grid grid-cols-[240px_minmax(0,1fr)] gap-2.5 min-h-0 items-stretch" data-testid="command-layout">
        <WorkspaceHierarchyPanel
          :hierarchy="hierarchy"
          :active-project-id="activeProjectId"
          :active-session-id="activeSessionId"
          :session-row-view-models="sessionRowViewModels"
          @select-project="emit('selectProject', $event)"
          @select-session="emit('selectSession', $event)"
          @create-project="emit('createProject', $event)"
          @create-session="emit('createSession', $event)"
          @delete-project="emit('deleteProject', $event)"
          @archive-session="emit('archiveSession', $event)"
        />

        <TerminalViewport
          :project="activeProject"
          :session="activeSession"
          @open-workspace="emit('openWorkspace', $event)"
        />
      </div>
    </div>
  </section>
</template>
