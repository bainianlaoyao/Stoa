<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import TerminalSessionDeck from './TerminalSessionDeck.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import { useSidebarStore } from '@renderer/stores/sidebar'
import { usePanelResize } from '@renderer/composables/useSidebarResize'
import { toSessionRowViewModel } from '@renderer/stores/observability-view-models'
import { toActiveSessionViewModel } from '@renderer/stores/observability-view-models'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

const props = withDefaults(defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
  activeProjectId: string | null
  activeSessionId: string | null
  visible?: boolean
}>(), {
  visible: true
})

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  deleteProject: [projectId: string]
  archiveSession: [sessionId: string]
  restoreSession: [sessionId: string]
  regenerateSessionTitle: [sessionId: string]
  restartSession: [sessionId: string]
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

const workspaceStore = useWorkspaceStore()
const { sessionPresenceMap } = storeToRefs(workspaceStore)

const sidebarStore = useSidebarStore()
const { sessionListWidth } = storeToRefs(sidebarStore)
const sessionListRef = ref<HTMLElement | null>(null)

const { onResizeStart } = usePanelResize({
  containerRef: sessionListRef,
  currentWidth: sessionListWidth,
  minWidth: 160,
  maxWidth: 480,
  direction: 'grow-right',
  onWidthChange: (w) => sidebarStore.setSessionListWidth(w),
  onWidthCommit: () => sidebarStore.commitSessionListWidth(),
})

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

const activeSessionViewModel = computed(() => {
  if (!props.activeSession) {
    return null
  }

  const presence = sessionPresenceMap.value[props.activeSession.id]
  if (!presence) {
    return null
  }

  return toActiveSessionViewModel(
    props.activeSession,
    presence,
    new Date().toISOString()
  )
})
</script>

<template>
  <section class="h-full min-h-0" data-surface="command" data-command-surface="true" data-testid="command-panel">
    <div class="h-full p-0 min-h-0 grid" data-testid="command-body">
      <div class="h-full grid grid-rows-1 gap-0 min-h-0 items-stretch" :style="{ gridTemplateColumns: sessionListWidth + 'px minmax(0,1fr)' }" data-testid="command-layout">
        <div ref="sessionListRef" class="relative min-h-0">
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
            @restore-session="emit('restoreSession', $event)"
            @regenerate-session-title="emit('regenerateSessionTitle', $event)"
            @restart-session="emit('restartSession', $event)"
          />

          <div
            class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 transition-colors"
            @mousedown="onResizeStart"
            data-testid="session-list-resize-handle"
          />
        </div>

        <TerminalSessionDeck
          :hierarchy="hierarchy"
          :active-project="activeProject"
          :active-session="activeSession"
          :active-session-view-model="activeSessionViewModel"
          :visible="visible"
          @open-workspace="emit('openWorkspace', $event)"
        />
      </div>
    </div>
  </section>
</template>
