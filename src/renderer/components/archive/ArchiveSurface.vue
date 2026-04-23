<script setup lang="ts">
import type { SessionSummary } from '@shared/project-session'

interface ArchivedSessionEntry extends SessionSummary {
  projectName: string
  projectPath: string
}

defineProps<{
  archivedSessions: ArchivedSessionEntry[]
}>()

const emit = defineEmits<{
  restoreSession: [sessionId: string]
}>()
</script>

<template>
  <section class="archive-surface" data-surface="archive" aria-label="Archive surface">
    <div class="archive-body">
      <header class="archive-header">
        <p class="archive-eyebrow">Session Archive</p>
        <h2 class="archive-title">已归档会话</h2>
        <p class="archive-subtitle">集中恢复历史会话，命令面板只保留归档动作。</p>
      </header>

      <p v-if="archivedSessions.length === 0" class="archive-empty">当前没有已归档的会话。</p>

      <div v-else class="archive-list">
        <article
          v-for="session in archivedSessions"
          :key="session.id"
          class="archive-card"
          :data-archive-session="session.id"
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

            <p class="archive-card__summary">{{ session.summary || session.status }}</p>
          </div>

          <button
            class="archive-card__restore"
            type="button"
            :data-archive-restore="session.id"
            @click="emit('restoreSession', session.id)"
          >
            恢复
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
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive-title {
  margin: 0;
  color: var(--text-strong);
  font-size: 18px;
  font-weight: 600;
}

.archive-subtitle,
.archive-empty,
.archive-card__summary {
  margin: 0;
  color: var(--muted);
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
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  box-shadow: var(--shadow-card);
  transition: all 0.2s ease;
}

.archive-card:hover {
  border-color: var(--line-strong);
  background: var(--surface-solid);
}

.archive-card__content,
.archive-card__head,
.archive-card__meta {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.archive-card__title {
  color: var(--text-strong);
  font-weight: 600;
}

.archive-card__badge {
  justify-self: start;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-solid);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
  text-transform: uppercase;
}

.archive-card__project {
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}

.archive-card__path {
  color: var(--subtle);
  font: 11px var(--font-mono);
}

.archive-card__restore {
  align-self: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-solid);
  color: var(--text-strong);
  padding: 8px 12px;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.archive-card__restore:hover,
.archive-card__restore:focus-visible {
  background: var(--surface);
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}
</style>
