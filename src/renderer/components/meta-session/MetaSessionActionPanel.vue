<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useMetaSessionStore } from '@renderer/stores/meta-session'

const metaSessionStore = useMetaSessionStore()
const { activeMetaSession, selectedProposal } = storeToRefs(metaSessionStore)
</script>

<template>
  <section class="meta-session-action-panel" data-testid="meta-session-action-panel" aria-label="Meta session action panel">
    <header class="meta-session-action-panel__header">
      <p class="meta-session-action-panel__eyebrow">Actions</p>
      <h3 class="meta-session-action-panel__title">Next moves</h3>
    </header>
    <div class="meta-session-action-panel__body">
      <button
        class="meta-session-action-panel__action"
        data-testid="meta-session.action.approve"
        type="button"
        :disabled="!selectedProposal"
        @click="selectedProposal && void metaSessionStore.approveProposal(selectedProposal.id)"
      >
        Approve
      </button>
      <button
        class="meta-session-action-panel__action"
        data-testid="meta-session.action.reject"
        type="button"
        :disabled="!selectedProposal"
        @click="selectedProposal && void metaSessionStore.rejectProposal(selectedProposal.id)"
      >
        Reject
      </button>
      <button
        class="meta-session-action-panel__action meta-session-action-panel__action--primary"
        data-testid="meta-session.action.dispatch"
        type="button"
        :disabled="!selectedProposal"
        @click="selectedProposal && void metaSessionStore.approveAndDispatchProposal(selectedProposal.id)"
      >
        Approve and Execute
      </button>
      <button
        class="meta-session-action-panel__action meta-session-action-panel__action--danger"
        type="button"
        :disabled="!activeMetaSession"
        @click="activeMetaSession && void metaSessionStore.archiveSession(activeMetaSession.id)"
      >
        Archive session
      </button>
    </div>
  </section>
</template>

<style scoped>
.meta-session-action-panel {
  display: grid;
  gap: 12px;
}

.meta-session-action-panel__header {
  display: grid;
  gap: 4px;
}

.meta-session-action-panel__eyebrow {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.meta-session-action-panel__title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-title-sm);
  font-weight: 600;
}

.meta-session-action-panel__body {
  display: grid;
  gap: 8px;
}

.meta-session-action-panel__action {
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-solid);
  color: var(--color-text-strong);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.meta-session-action-panel__action:hover:not(:disabled),
.meta-session-action-panel__action:focus-visible:not(:disabled) {
  background: var(--color-black-faint);
  outline: none;
}

.meta-session-action-panel__action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.meta-session-action-panel__action--primary:not(:disabled) {
  border-color: var(--color-accent);
  background: var(--color-active-fill);
}

.meta-session-action-panel__action--danger:not(:disabled) {
  color: var(--color-error);
}
</style>
