<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useHermesStore } from '@renderer/stores/hermes'

const hermesStore = useHermesStore()
const { activeHermesSession, selectedProposal } = storeToRefs(hermesStore)
</script>

<template>
  <section class="hermes-action-panel" data-testid="hermes-action-panel" aria-label="Hermes action panel">
    <header class="hermes-action-panel__header">
      <p class="hermes-action-panel__eyebrow">Actions</p>
      <h3 class="hermes-action-panel__title">Next moves</h3>
    </header>
    <div class="hermes-action-panel__body">
      <button
        class="hermes-action-panel__action"
        data-testid="hermes.action.approve"
        type="button"
        :disabled="!selectedProposal"
        @click="selectedProposal && void hermesStore.approveProposal(selectedProposal.id)"
      >
        Approve
      </button>
      <button
        class="hermes-action-panel__action"
        data-testid="hermes.action.reject"
        type="button"
        :disabled="!selectedProposal"
        @click="selectedProposal && void hermesStore.rejectProposal(selectedProposal.id)"
      >
        Reject
      </button>
      <button
        class="hermes-action-panel__action hermes-action-panel__action--primary"
        data-testid="hermes.action.dispatch"
        type="button"
        :disabled="!selectedProposal"
        @click="selectedProposal && void hermesStore.approveAndDispatchProposal(selectedProposal.id)"
      >
        Approve and Execute
      </button>
      <button
        class="hermes-action-panel__action hermes-action-panel__action--danger"
        type="button"
        :disabled="!activeHermesSession"
        @click="activeHermesSession && void hermesStore.closeSession(activeHermesSession.id)"
      >
        Close session
      </button>
    </div>
  </section>
</template>

<style scoped>
.hermes-action-panel {
  display: grid;
  gap: 12px;
}

.hermes-action-panel__header {
  display: grid;
  gap: 4px;
}

.hermes-action-panel__eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hermes-action-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-title-sm);
  font-weight: 600;
}

.hermes-action-panel__body {
  display: grid;
  gap: 8px;
}

.hermes-action-panel__action {
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hermes-action-panel__action:hover:not(:disabled),
.hermes-action-panel__action:focus-visible:not(:disabled) {
  background: var(--color-black-faint);
  outline: none;
}

.hermes-action-panel__action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.hermes-action-panel__action--primary:not(:disabled) {
  border-color: var(--color-accent);
  background: var(--color-active-fill);
}

.hermes-action-panel__action--danger:not(:disabled) {
  color: var(--color-error);
}
</style>
