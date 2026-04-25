<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SessionSummary } from '@shared/project-session'

interface ArchivedSessionEntry extends SessionSummary {
  projectName: string
  projectPath: string
}

const { t } = useI18n()

defineProps<{
  archivedSessions: ArchivedSessionEntry[]
}>()

const emit = defineEmits<{
  restoreSession: [sessionId: string]
}>()
</script>

<template>
  <section class="archive-surface" data-surface="archive" data-testid="surface.archive" aria-label="Archive surface">
    <div class="archive-body">
      <header class="archive-header">
        <p class="archive-eyebrow">{{ t('archive.eyebrow') }}</p>
        <h2 class="archive-title">{{ t('archive.title') }}</h2>
        <p class="archive-subtitle">{{ t('archive.subtitle') }}</p>
      </header>

      <p v-if="archivedSessions.length === 0" class="archive-empty">{{ t('archive.empty') }}</p>

      <div v-else class="archive-list">
        <article
          v-for="session in archivedSessions"
          :key="session.id"
          class="archive-card"
          :data-archive-session="session.id"
          data-testid="archive.session.row"
        >
          <div class="archive-card__content">
            <div class="archive-card__head">
              <strong class="archive-card__title">{{ session.title }}</strong>
              <span class="archive-card__badge">{{ session.type }}</span>
            </div>

            <div class="archive-card__meta">
              <span class="archive-card__project">{{ session.projectName }}</span>
              <code class="archive-card__path">{{ session.projectPath }}</code>
            </div>

            <p class="archive-card__summary">{{ session.summary || `${session.runtimeState} / ${session.agentState}` }}</p>
          </div>

          <button
            class="archive-card__restore"
            type="button"
            :data-archive-restore="session.id"
            data-testid="archive.session.restore"
            @click="emit('restoreSession', session.id)"
          >
            {{ t('archive.restore') }}
          </button>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.archive-surface {
  height: 100%;
  min-height: 0;
}

.archive-body {
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 20px;
}

.archive-header {
  display: grid;
  gap: 6px;
}

.archive-eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive-title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: 18px;
  font-weight: 600;
}

.archive-subtitle,
.archive-empty,
.archive-card__summary {
  margin: 0;
  color: var(--color-muted);
}

.archive-list {
  display: grid;
  gap: 12px;
}

.archive-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px 18px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  box-shadow: var(--shadow-card);
  transition: all 0.2s ease;
}

.archive-card:hover {
  border-color: var(--color-line-strong);
  background: var(--color-surface-solid);
}

.archive-card__content,
.archive-card__head,
.archive-card__meta {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.archive-card__title {
  color: var(--color-text-strong);
  font-weight: 600;
}

.archive-card__badge {
  justify-self: start;
  padding: 2px 8px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: var(--color-surface-solid);
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.4;
  text-transform: uppercase;
}

.archive-card__project {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
}

.archive-card__path {
  color: var(--color-subtle);
  font: 11px var(--font-mono);
}

.archive-card__restore {
  align-self: center;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  padding: 8px 12px;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.archive-card__restore:hover,
.archive-card__restore:focus-visible {
  background: var(--color-surface);
  border-color: var(--color-accent);
  color: var(--color-accent);
  outline: none;
}
</style>
