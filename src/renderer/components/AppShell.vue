<script setup lang="ts">
import { computed, ref } from 'vue'
import GlobalActivityBar from './GlobalActivityBar.vue'
import CommandSurface from './command/CommandSurface.vue'
import InboxQueueSurface from './inbox/InboxQueueSurface.vue'
import ContextTreeSurface from './tree/ContextTreeSurface.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
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
}>()

const activeSurface = ref<AppSurface>('command')

const pendingCount = computed(() => {
  return props.hierarchy.flatMap((project) => project.sessions).filter((session) => ['awaiting_input', 'error', 'needs_confirmation'].includes(session.status)).length
})
</script>

<template>
  <main class="app-shell">
    <GlobalActivityBar :active-surface="activeSurface" :pending-count="pendingCount" @select="activeSurface = $event" />

    <section class="app-shell__viewport">
      <CommandSurface
        v-if="activeSurface === 'command'"
        :hierarchy="hierarchy"
        :active-project="activeProject"
        :active-session="activeSession"
        :active-project-id="activeProjectId"
        :active-session-id="activeSessionId"
        @select-project="emit('selectProject', $event)"
        @select-session="emit('selectSession', $event)"
        @create-project="emit('createProject', $event)"
        @create-session="emit('createSession', $event)"
      />
      <InboxQueueSurface v-else-if="activeSurface === 'queue'" />
      <ContextTreeSurface v-else-if="activeSurface === 'tree'" />
      <section v-else class="placeholder-surface" data-surface="settings">
        <section class="placeholder-surface__lane placeholder-surface__lane--full">
          <p class="eyebrow">Settings</p>
          <h2>Settings placeholder</h2>
          <p>Settings is reserved in the global shell but not expanded in the current rewrite slice.</p>
        </section>
      </section>
    </section>
  </main>
</template>
