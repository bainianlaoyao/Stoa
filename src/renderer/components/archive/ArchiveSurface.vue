<script setup lang="ts">
import type { SessionSummary } from '@shared/project-session'

defineProps<{
  archivedSessions: SessionSummary[]
}>()

const emit = defineEmits<{
  restoreSession: [sessionId: string]
}>()
</script>

<template>
  <section class="archive-surface" data-surface="archive" aria-label="Archive surface">
    <div class="archive-body">
      <h2 class="archive-title">已归档会话</h2>

      <p v-if="archivedSessions.length === 0" class="archive-empty">没有已归档的会话</p>

      <div v-else class="archive-list">
        <div
          v-for="session in archivedSessions"
          :key="session.id"
          class="archive-card"
          :data-archive-session="session.id"
        >
          <div class="archive-card__content">
            <strong class="archive-card__title">{{ session.title }}</strong>
            <span class="archive-card__type">{{ session.type }}</span>
            <span class="archive-card__status">{{ session.status }}</span>
          </div>
          <button
            class="archive-card__restore"
            type="button"
            :data-archive-restore="session.id"
            @click="emit('restoreSession', session.id)"
          >
            恢复
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.archive-surface {
  display: grid;
  height: 100%;
  min-height: 0;
}

.archive-body {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 20px 24px;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text);
  transition: all 0.2s ease;
}

.archive-title {
  margin: 0;
  color: var(--text-strong);
  font-size: 16px;
  font-weight: 600;
}

.archive-empty {
  margin: 0;
  color: var(--muted);
}

.archive-list {
  display: grid;
  gap: 12px;
}

.archive-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-solid);
  transition: all 0.2s ease;
}

.archive-card__content {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.archive-card__title {
  color: var(--text-strong);
  font-weight: 600;
}

.archive-card__type,
.archive-card__status {
  color: var(--muted);
  font-size: 12px;
}

.archive-card__restore {
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
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}
</style>
