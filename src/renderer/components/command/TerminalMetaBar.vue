<script setup lang="ts">
import { computed } from 'vue'
import type { ActiveSessionViewModel } from '@shared/observability'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const props = defineProps<{
  project: ProjectSummary | null
  session: SessionSummary | null
  activeViewModel?: ActiveSessionViewModel | null
}>()

const hasFallbackMeta = computed(() => Boolean(props.project && props.session))
</script>

<template>
  <div v-if="activeViewModel || hasFallbackMeta" class="terminal-meta" data-testid="terminal-status-bar">
    <template v-if="activeViewModel">
      <div class="terminal-meta__headline">
        <span class="terminal-meta__eyebrow">{{ project?.name ?? 'Active session' }}</span>
        <strong class="terminal-meta__title">{{ activeViewModel.title }}</strong>
      </div>

      <div class="terminal-meta__details">
        <span class="terminal-meta__chip" :data-tone="activeViewModel.tone">{{ activeViewModel.phaseLabel }}</span>
        <span class="terminal-meta__chip">{{ activeViewModel.confidenceLabel }}</span>
        <span class="terminal-meta__value">{{ activeViewModel.providerLabel }}</span>
        <span v-if="activeViewModel.modelLabel" class="terminal-meta__value">{{ activeViewModel.modelLabel }}</span>
        <span class="terminal-meta__timestamp">{{ activeViewModel.lastUpdatedLabel }}</span>
      </div>

      <p v-if="activeViewModel.snippet" class="terminal-meta__summary">{{ activeViewModel.snippet }}</p>
      <p v-if="activeViewModel.explanation" class="terminal-meta__explanation">{{ activeViewModel.explanation }}</p>
    </template>

    <template v-else-if="project && session">
      <div class="terminal-meta__group terminal-meta__group--primary">
        <span>{{ project.id }}</span>
        <span>{{ session.id }}</span>
      </div>
      <div class="terminal-meta__group terminal-meta__group--secondary">
        <span>{{ session.type }}</span>
        <span>{{ session.status }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.terminal-meta {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text);
}

.terminal-meta__headline,
.terminal-meta__group {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.terminal-meta__eyebrow {
  margin: 0;
  color: var(--color-subtle);
  font-family: var(--font-ui);
  font-size: var(--text-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.terminal-meta__title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-body-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-meta__details,
.terminal-meta__group--secondary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
}

.terminal-meta__group--primary,
.terminal-meta__group--secondary {
  justify-content: space-between;
}

.terminal-meta__chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-strong);
}

.terminal-meta__chip[data-tone='accent'] {
  color: var(--color-accent);
}

.terminal-meta__chip[data-tone='success'] {
  color: var(--color-success);
}

.terminal-meta__chip[data-tone='warning'] {
  color: var(--color-warning);
}

.terminal-meta__chip[data-tone='danger'] {
  color: var(--color-error);
}

.terminal-meta__value,
.terminal-meta__timestamp {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-meta__timestamp {
  color: var(--color-subtle);
}

.terminal-meta__summary,
.terminal-meta__explanation {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-meta__summary {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--text-body-sm);
}

.terminal-meta__explanation {
  color: var(--color-muted);
  font-family: var(--font-ui);
  font-size: var(--text-caption);
}
</style>
