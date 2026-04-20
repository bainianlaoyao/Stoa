<script setup lang="ts">
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import TerminalMetaBar from './TerminalMetaBar.vue'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import type { WorkspaceSummary } from '@shared/workspace'
import type { WorkspaceHierarchyGroup } from '@renderer/stores/workspaces'

defineProps<{
  hierarchy: WorkspaceHierarchyGroup[]
  activeWorkspace: WorkspaceSummary | null
  activeWorkspaceId: string | null
}>()

const emit = defineEmits<{
  select: [workspaceId: string]
  createProject: []
}>()
</script>

<template>
  <section class="command-panel" data-surface="command" data-command-surface="true">
    <div class="command-body">
      <div class="command-layout">
        <WorkspaceHierarchyPanel :hierarchy="hierarchy" @select="emit('select', $event)" @create-project="emit('createProject')" />

        <div class="terminal-screen">
          <TerminalMetaBar :workspace="activeWorkspace" />
          <TerminalViewport :workspace="activeWorkspace" />
        </div>
      </div>
    </div>
  </section>
</template>
