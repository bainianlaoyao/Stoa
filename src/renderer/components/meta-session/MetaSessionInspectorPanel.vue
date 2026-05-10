<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useMetaSessionStore } from '@renderer/stores/meta-session'
import MetaSessionActionPanel from './MetaSessionActionPanel.vue'

const metaSessionStore = useMetaSessionStore()
const { activeMetaSession, activeSessionPendingProposals, inspectorTarget, selectedProposal } = storeToRefs(metaSessionStore)

const targetLabel = computed(() => {
  if (!inspectorTarget.value) {
    return 'none'
  }

  if (inspectorTarget.value.kind === 'app') {
    return 'app'
  }

  if (inspectorTarget.value.kind === 'work-session') {
    return inspectorTarget.value.sessionId
  }

  return inspectorTarget.value.proposalId
})
</script>

<template>
  <aside class="meta-session-inspector-panel" data-testid="meta-session-inspector-panel" aria-label="Meta session inspector panel">
    <section class="meta-session-inspector-panel__card">
      <header class="meta-session-inspector-panel__header">
        <p class="meta-session-inspector-panel__eyebrow">Global brief</p>
        <h3 class="meta-session-inspector-panel__title">{{ activeMetaSession?.title ?? 'No active meta session' }}</h3>
      </header>
      <p class="meta-session-inspector-panel__summary">{{ activeMetaSession?.lastSummary ?? 'Create or select a meta session to inspect global state.' }}</p>
    </section>

    <section class="meta-session-inspector-panel__card">
      <header class="meta-session-inspector-panel__header">
        <p class="meta-session-inspector-panel__eyebrow">Inspector</p>
        <h3 class="meta-session-inspector-panel__title">Target</h3>
      </header>
      <p class="meta-session-inspector-panel__summary">{{ targetLabel }}</p>
      <code v-if="activeMetaSession?.backendSessionId" class="meta-session-inspector-panel__code">
        {{ activeMetaSession.backendSessionId }}
      </code>
    </section>

    <section class="meta-session-inspector-panel__card">
      <header class="meta-session-inspector-panel__header">
        <p class="meta-session-inspector-panel__eyebrow">Proposals</p>
        <h3 class="meta-session-inspector-panel__title">Pending approval</h3>
      </header>
      <div v-if="activeSessionPendingProposals.length > 0" class="meta-session-inspector-panel__proposal-list">
        <button
          v-for="proposal in activeSessionPendingProposals"
          :key="proposal.id"
          class="meta-session-inspector-panel__proposal-item"
          :class="{ 'meta-session-inspector-panel__proposal-item--active': selectedProposal?.id === proposal.id }"
          data-testid="meta-session.proposal.item"
          type="button"
          @click="void metaSessionStore.setInspector({ kind: 'proposal', proposalId: proposal.id })"
        >
          <strong class="meta-session-inspector-panel__proposal-title">{{ proposal.summary }}</strong>
          <span class="meta-session-inspector-panel__proposal-status">{{ proposal.status }}</span>
          <p class="meta-session-inspector-panel__proposal-reason">{{ proposal.reason }}</p>
        </button>
      </div>
      <p v-else class="meta-session-inspector-panel__summary">No pending proposals in the active meta session.</p>
    </section>

    <section v-if="selectedProposal" class="meta-session-inspector-panel__card">
      <header class="meta-session-inspector-panel__header">
        <p class="meta-session-inspector-panel__eyebrow">Proposal detail</p>
        <h3 class="meta-session-inspector-panel__title">{{ selectedProposal.summary }}</h3>
      </header>
      <p class="meta-session-inspector-panel__summary">{{ selectedProposal.reason }}</p>
      <p v-if="selectedProposal.promptText" class="meta-session-inspector-panel__prompt">
        {{ selectedProposal.promptText }}
      </p>
      <div class="meta-session-inspector-panel__meta">
        <code class="meta-session-inspector-panel__code">{{ selectedProposal.id }}</code>
        <span class="meta-session-inspector-panel__status">{{ selectedProposal.status }}</span>
      </div>
      <p v-if="selectedProposal.executionResult" class="meta-session-inspector-panel__summary">
        {{ selectedProposal.executionResult }}
      </p>
    </section>

    <section class="meta-session-inspector-panel__card">
      <header class="meta-session-inspector-panel__header">
        <p class="meta-session-inspector-panel__eyebrow">Risk</p>
        <h3 class="meta-session-inspector-panel__title">Current risk</h3>
      </header>
      <p class="meta-session-inspector-panel__summary">{{ activeMetaSession?.lastRisk ?? 'No active risk reported.' }}</p>
    </section>

    <MetaSessionActionPanel />
  </aside>
</template>

<style scoped>
.meta-session-inspector-panel {
  display: grid;
  gap: 12px;
  min-height: 0;
  align-content: start;
}

.meta-session-inspector-panel__card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.meta-session-inspector-panel__header {
  display: grid;
  gap: 4px;
}

.meta-session-inspector-panel__eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.meta-session-inspector-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-title-sm);
  font-weight: 600;
}

.meta-session-inspector-panel__summary {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.meta-session-inspector-panel__code {
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
}

.meta-session-inspector-panel__proposal-list {
  display: grid;
  gap: 8px;
}

.meta-session-inspector-panel__proposal-item {
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

.meta-session-inspector-panel__proposal-item:hover,
.meta-session-inspector-panel__proposal-item:focus-visible {
  background: var(--color-surface);
  outline: none;
}

.meta-session-inspector-panel__proposal-item--active {
  border-color: var(--color-accent);
  background: var(--color-active-fill);
}

.meta-session-inspector-panel__proposal-title {
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.meta-session-inspector-panel__proposal-status,
.meta-session-inspector-panel__status {
  color: var(--color-muted);
  font-size: var(--text-caption);
  text-transform: uppercase;
}

.meta-session-inspector-panel__proposal-reason,
.meta-session-inspector-panel__prompt {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.meta-session-inspector-panel__prompt {
  white-space: pre-wrap;
}

.meta-session-inspector-panel__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
