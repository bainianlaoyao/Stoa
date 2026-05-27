<script setup lang="ts">
import { computed, ref } from 'vue'
import GlobalActivityBar from './GlobalActivityBar.vue'
import TitleBar from './TitleBar.vue'
import CommandSurface from './command/CommandSurface.vue'
import MetaSessionSurface from './meta-session/MetaSessionSurface.vue'
import ArchiveSurface from './archive/ArchiveSurface.vue'
import SettingsSurface from './settings/SettingsSurface.vue'
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

const archivedSessions = computed(() => {
  return props.hierarchy.flatMap((project) =>
    project.archivedSessions.map((session) => ({
      ...session,
      projectName: project.name,
      projectPath: project.path
    }))
  )
})
</script>

<template>
  <div class="flex flex-col h-full">
    <TitleBar />
    <main class="grid grid-cols-[56px_1fr] flex-1 min-h-0 p-0 gap-0">
      <GlobalActivityBar :active-surface="activeSurface" @select="activeSurface = $event" />

      <section class="min-w-0 min-h-0 m-3 ml-0 border border-line rounded-[length:var(--radius-lg)] bg-surface backdrop-blur-[40px] saturate-[1.2] shadow-premium overflow-hidden" data-testid="app-viewport" aria-label="Application viewport">
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
          @open-workspace="emit('openWorkspace', $event)"
        />
        <MetaSessionSurface
          v-if="activeSurface === 'meta-session'"
          aria-label="Meta session surface"
          @create-workspace-session="emit('createSession', $event)"
        />
        <ArchiveSurface
          v-if="activeSurface === 'archive'"
          :archived-sessions="archivedSessions"
          @restore-session="emit('restoreSession', $event)"
        />
        <SettingsSurface v-if="activeSurface === 'settings'" />
      </section>
    </main>
  </div>
</template>
