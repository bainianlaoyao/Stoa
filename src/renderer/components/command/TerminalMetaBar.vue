<script setup lang="ts">
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
}>()
</script>

<template>
  <div v-if="project && session" class="terminal-meta">
    <div class="terminal-meta__group terminal-meta__group--primary">
      <span>{{ project.id }}</span>
      <span>{{ session.id }}</span>
    </div>
    <div class="terminal-meta__group terminal-meta__group--secondary">
      <span>{{ session.type }}</span>
      <span>{{ session.status }}</span>
    </div>
  </div>
</template>
