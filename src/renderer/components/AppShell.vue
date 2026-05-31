<script setup lang="ts">
import { ref, watch } from 'vue'
import GlobalActivityBar from './GlobalActivityBar.vue'
import TitleBar from './TitleBar.vue'
import CommandSurface from './command/CommandSurface.vue'
import SettingsSurface from './settings/SettingsSurface.vue'
import RightSidebar from './right-sidebar/RightSidebar.vue'
import { useSidebarStore } from '@renderer/stores/sidebar'
import type { OpenWorkspaceRequest, ProjectSummary, SessionSummary } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { AppSurface } from './GlobalActivityBar.vue'

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  deleteProject: [projectId: string]
  archiveSession: [sessionId: string]
  regenerateSessionTitle: [sessionId: string]
  restartSession: [sessionId: string]
  restoreSession: [sessionId: string]
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

const activeSurface = ref<AppSurface>('command')

// Auto-hide sidebar when navigating to a full-page surface (settings, archive, meta-session)
// and restore it when returning to the command surface.
const sidebarStore = useSidebarStore()
let sidebarWasOpenBeforeAutoHide = false

watch(activeSurface, (surface, prevSurface) => {
  if (surface !== 'command' && sidebarStore.open) {
    sidebarWasOpenBeforeAutoHide = true
    sidebarStore.setOpen(false)
  } else if (surface === 'command' && prevSurface !== 'command' && sidebarWasOpenBeforeAutoHide) {
    sidebarStore.setOpen(true)
    sidebarWasOpenBeforeAutoHide = false
  }
})
</script>

<template>
  <div class="flex flex-col h-full">
    <TitleBar />
    <main class="grid grid-cols-[56px_1fr_auto] flex-1 min-h-0 p-0 gap-0">
      <GlobalActivityBar :active-surface="activeSurface" @select="activeSurface = $event" />

      <section class="min-w-0 min-h-0 m-3 ml-0 border border-black/[0.04] rounded-2xl bg-surface backdrop-blur-[40px] saturate-[1.2] shadow-premium overflow-hidden" data-testid="app-viewport" aria-label="Application viewport">
        <CommandSurface
          v-show="activeSurface === 'command'"
          aria-label="Command surface"
          :hierarchy="hierarchy"
          :active-project="activeProject"
          :active-session="activeSession"
          :active-project-id="activeProjectId"
          :active-session-id="activeSessionId"
          :visible="activeSurface === 'command'"
          @select-project="emit('selectProject', $event)"
          @select-session="emit('selectSession', $event)"
          @create-project="emit('createProject', $event)"
          @create-session="emit('createSession', $event)"
          @delete-project="emit('deleteProject', $event)"
          @archive-session="emit('archiveSession', $event)"
          @regenerate-session-title="emit('regenerateSessionTitle', $event)"
          @restart-session="emit('restartSession', $event)"
          @restore-session="emit('restoreSession', $event)"
          @open-workspace="emit('openWorkspace', $event)"
        />
        <SettingsSurface v-if="activeSurface === 'settings'" />
      </section>

      <RightSidebar />
    </main>
  </div>
</template>
