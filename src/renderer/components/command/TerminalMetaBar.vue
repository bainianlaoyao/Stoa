<script setup lang="ts">
import type { WorkspaceSummary } from '@shared/workspace'

defineProps<{
  workspace: WorkspaceSummary | null
}>()
</script>

<template>
  <div v-if="workspace" class="terminal-meta">
    <div class="terminal-meta__group terminal-meta__group--primary">
      <span>{{ workspace.workspaceId }}</span>
      <span>{{ workspace.cliSessionId ?? 'pending-session' }}</span>
    </div>
    <div class="terminal-meta__group terminal-meta__group--secondary">
      <span>{{ workspace.providerId }}</span>
      <span>{{ workspace.status }}</span>
    </div>
  </div>
</template>
