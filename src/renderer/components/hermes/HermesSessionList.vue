<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useHermesStore } from '@renderer/stores/hermes'

const hermesStore = useHermesStore()
const { sessions, activeHermesSessionId } = storeToRefs(hermesStore)

const orderedSessions = computed(() => {
  return [...sessions.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

async function handleCreate(): Promise<void> {
  const nextIndex = sessions.value.length + 1
  await hermesStore.createSession({
    title: `hermes-${nextIndex}`,
    capabilityLevel: 3
  })
}
</script>

<template>
  <aside class="hermes-session-list" data-testid="hermes-session-list" aria-label="Hermes sessions">
    <header class="hermes-session-list__header">
      <div class="hermes-session-list__copy">
        <p class="hermes-session-list__eyebrow">Hermes sessions</p>
        <h2 class="hermes-session-list__title">Global threads</h2>
      </div>
      <button
        class="hermes-session-list__create"
        data-testid="hermes.session.create"
        type="button"
        @click="void handleCreate()"
      >
        New
      </button>
    </header>

    <div class="hermes-session-list__items">
      <button
        v-for="session in orderedSessions"
        :key="session.id"
        class="hermes-session-list__item"
        :class="{ 'hermes-session-list__item--active': session.id === activeHermesSessionId }"
        data-testid="hermes.session.item"
        :data-session-id="session.id"
        type="button"
        @click="void hermesStore.setActiveSession(session.id)"
      >
        <div class="hermes-session-list__item-head">
          <strong class="hermes-session-list__item-title">{{ session.title }}</strong>
          <span class="hermes-session-list__item-status">{{ session.status }}</span>
        </div>
        <p class="hermes-session-list__item-summary">{{ session.lastSummary }}</p>
        <div class="hermes-session-list__item-meta">
          <code>{{ session.resumeSessionId ?? 'fresh' }}</code>
          <span>{{ session.pendingProposalCount }} proposals</span>
        </div>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.hermes-session-list {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  padding: 16px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.hermes-session-list__header {
  display: grid;
  gap: 12px;
}

.hermes-session-list__copy {
  display: grid;
  gap: 4px;
}

.hermes-session-list__eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hermes-session-list__title {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-title);
  font-weight: 600;
}

.hermes-session-list__create {
  justify-self: start;
  padding: 7px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  cursor: pointer;
  transition: all 0.2s ease;
}

.hermes-session-list__create:hover,
.hermes-session-list__create:focus-visible {
  background: var(--color-black-faint);
  outline: none;
}

.hermes-session-list__items {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.hermes-session-list__item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-solid);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hermes-session-list__item:hover,
.hermes-session-list__item:focus-visible {
  background: var(--color-surface);
  outline: none;
}

.hermes-session-list__item--active {
  border-color: var(--color-accent);
  background: var(--color-active-fill);
}

.hermes-session-list__item-head,
.hermes-session-list__item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hermes-session-list__item-title {
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.hermes-session-list__item-status {
  color: var(--color-muted);
  font-size: var(--text-caption);
  text-transform: uppercase;
}

.hermes-session-list__item-summary {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-body-sm);
  line-height: 1.5;
}

.hermes-session-list__item-meta {
  color: var(--color-subtle);
  font-size: var(--text-caption);
}

.hermes-session-list__item-meta code {
  font-family: var(--font-mono);
}
</style>
