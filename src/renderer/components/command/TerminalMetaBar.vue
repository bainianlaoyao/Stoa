<script setup lang="ts">
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()
</script>

<template>
  <div v-if="project && session" class="terminal-meta flex justify-between gap-2 text-muted font-mono text-[11px]">
    <div class="terminal-meta__group terminal-meta__group--primary inline-flex gap-2 items-center min-w-0">
      <span>{{ project.id }}</span>
      <span>{{ session.id }}</span>
    </div>
    <div class="terminal-meta__group terminal-meta__group--secondary inline-flex gap-2 items-center min-w-0 justify-end">
      <span>{{ session.type }}</span>
      <span>{{ session.status }}</span>
    </div>
  </div>
</template>
