<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useHermesStore } from '@renderer/stores/hermes'
import HermesActionPanel from './HermesActionPanel.vue'

const hermesStore = useHermesStore()
const { activeHermesSession, activeSessionPendingProposals, inspectorTarget, selectedProposal } = storeToRefs(hermesStore)

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
  <aside class="hermes-inspector-panel" data-testid="hermes-inspector-panel" aria-label="Hermes inspector panel">
    <section class="hermes-inspector-panel__card">
      <header class="hermes-inspector-panel__header">
        <p class="hermes-inspector-panel__eyebrow">Global brief</p>
        <h3 class="hermes-inspector-panel__title">{{ activeHermesSession?.title ?? 'No active Hermes session' }}</h3>
      </header>
      <p class="hermes-inspector-panel__summary">{{ activeHermesSession?.lastSummary ?? 'Create or select a Hermes session to inspect global state.' }}</p>
    </section>

    <section class="hermes-inspector-panel__card">
      <header class="hermes-inspector-panel__header">
        <p class="hermes-inspector-panel__eyebrow">Inspector</p>
        <h3 class="hermes-inspector-panel__title">Target</h3>
      </header>
      <p class="hermes-inspector-panel__summary">{{ targetLabel }}</p>
      <code v-if="activeHermesSession?.resumeSessionId" class="hermes-inspector-panel__code">
        {{ activeHermesSession.resumeSessionId }}
      </code>
    </section>

    <section class="hermes-inspector-panel__card">
      <header class="hermes-inspector-panel__header">
        <p class="hermes-inspector-panel__eyebrow">Proposals</p>
        <h3 class="hermes-inspector-panel__title">Pending approval</h3>
      </header>
      <div v-if="activeSessionPendingProposals.length > 0" class="hermes-inspector-panel__proposal-list">
        <button
          v-for="proposal in activeSessionPendingProposals"
          :key="proposal.id"
          class="hermes-inspector-panel__proposal-item"
          :class="{ 'hermes-inspector-panel__proposal-item--active': selectedProposal?.id === proposal.id }"
          data-testid="hermes.proposal.item"
          type="button"
          @click="void hermesStore.setInspector({ kind: 'proposal', proposalId: proposal.id })"
        >
          <strong class="hermes-inspector-panel__proposal-title">{{ proposal.summary }}</strong>
          <span class="hermes-inspector-panel__proposal-status">{{ proposal.status }}</span>
          <p class="hermes-inspector-panel__proposal-reason">{{ proposal.reason }}</p>
        </button>
      </div>
      <p v-else class="hermes-inspector-panel__summary">No pending proposals in the active Hermes session.</p>
    </section>

    <section v-if="selectedProposal" class="hermes-inspector-panel__card">
      <header class="hermes-inspector-panel__header">
        <p class="hermes-inspector-panel__eyebrow">Proposal detail</p>
        <h3 class="hermes-inspector-panel__title">{{ selectedProposal.summary }}</h3>
      </header>
      <p class="hermes-inspector-panel__summary">{{ selectedProposal.reason }}</p>
      <p v-if="selectedProposal.promptText" class="hermes-inspector-panel__prompt">
        {{ selectedProposal.promptText }}
      </p>
      <div class="hermes-inspector-panel__meta">
        <code class="hermes-inspector-panel__code">{{ selectedProposal.id }}</code>
        <span class="hermes-inspector-panel__status">{{ selectedProposal.status }}</span>
      </div>
      <p v-if="selectedProposal.executionResult" class="hermes-inspector-panel__summary">
        {{ selectedProposal.executionResult }}
      </p>
    </section>

    <section class="hermes-inspector-panel__card">
      <header class="hermes-inspector-panel__header">
        <p class="hermes-inspector-panel__eyebrow">Risk</p>
        <h3 class="hermes-inspector-panel__title">Current risk</h3>
      </header>
      <p class="hermes-inspector-panel__summary">{{ activeHermesSession?.lastRisk ?? 'No active risk reported.' }}</p>
    </section>

    <HermesActionPanel />
  </aside>
</template>

<style scoped>
.hermes-inspector-panel {
  display: grid;
  gap: 12px;
  min-height: 0;
  align-content: start;
}

.hermes-inspector-panel__card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.hermes-inspector-panel__header {
  display: grid;
  gap: 4px;
}

.hermes-inspector-panel__eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hermes-inspector-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-title-sm);
  font-weight: 600;
}

.hermes-inspector-panel__summary {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.hermes-inspector-panel__code {
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
}

.hermes-inspector-panel__proposal-list {
  display: grid;
  gap: 8px;
}

.hermes-inspector-panel__proposal-item {
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

.hermes-inspector-panel__proposal-item:hover,
.hermes-inspector-panel__proposal-item:focus-visible {
  background: var(--color-surface);
  outline: none;
}

.hermes-inspector-panel__proposal-item--active {
  border-color: var(--color-accent);
  background: var(--color-active-fill);
}

.hermes-inspector-panel__proposal-title {
  color: var(--color-text-strong);
  font-size: var(--text-body-sm);
  font-weight: 600;
}

.hermes-inspector-panel__proposal-status,
.hermes-inspector-panel__status {
  color: var(--color-muted);
  font-size: var(--text-caption);
  text-transform: uppercase;
}

.hermes-inspector-panel__proposal-reason,
.hermes-inspector-panel__prompt {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.5;
}

.hermes-inspector-panel__prompt {
  white-space: pre-wrap;
}

.hermes-inspector-panel__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
