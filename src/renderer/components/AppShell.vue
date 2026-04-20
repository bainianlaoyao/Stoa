<script setup lang="ts">
import { computed, ref } from 'vue'
import GlobalActivityBar from './GlobalActivityBar.vue'
import CommandSurface from './command/CommandSurface.vue'
import InboxQueueSurface from './inbox/InboxQueueSurface.vue'
import ContextTreeSurface from './tree/ContextTreeSurface.vue'
import type { WorkspaceSummary } from '@shared/workspace'
import type { WorkspaceHierarchyGroup } from '@renderer/stores/workspaces'
import type { AppSurface } from './GlobalActivityBar.vue'

const props = defineProps<{
  workspaces: WorkspaceSummary[]
  hierarchy: WorkspaceHierarchyGroup[]
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceSummary | null
  name: string
  path: string
  providerId: 'local-shell' | 'opencode'
  errorMessage: string
}>()

const emit = defineEmits<{
  select: [workspaceId: string]
  create: []
  'update:name': [value: string]
  'update:path': [value: string]
  'update:providerId': [value: 'local-shell' | 'opencode']
}>()

const activeSurface = ref<AppSurface>('command')

const pendingCount = computed(() => {
  return props.workspaces.filter((workspace) => ['awaiting_input', 'error', 'needs_confirmation'].includes(workspace.status)).length
})
</script>

<template>
  <main class="app-shell">
    <GlobalActivityBar :active-surface="activeSurface" :pending-count="pendingCount" @select="activeSurface = $event" />

    <section class="app-shell__viewport">
      <CommandSurface
        v-if="activeSurface === 'command'"
        :hierarchy="hierarchy"
        :active-workspace="activeWorkspace"
        :active-workspace-id="activeWorkspaceId"
        @select="emit('select', $event)"
        @create-project="emit('create')"
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
