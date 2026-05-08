<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import { useHermesStore } from '@renderer/stores/hermes'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const HERMES_PROJECT: ProjectSummary = {
  id: 'stoa-hermes',
  name: 'Hermes',
  path: '.',
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z'
}

const hermesStore = useHermesStore()
const { sessions, activeHermesSessionId } = storeToRefs(hermesStore)

const deckSessions = computed<SessionSummary[]>(() => {
  return sessions.value.map((session) => ({
    id: session.id,
    projectId: HERMES_PROJECT.id,
    type: 'hermes-agent',
    runtimeState: session.status === 'failed'
      ? 'failed_to_start'
      : session.status === 'closed'
        ? 'exited'
        : session.status === 'created'
          ? 'created'
          : session.status === 'starting'
            ? 'starting'
            : 'alive',
    turnState: session.status === 'running' ? 'running' : 'idle',
    turnEpoch: 0,
    lastTurnOutcome: 'none',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: session.status === 'closed' ? 'clean' : null,
    lastStateSequence: 0,
    blockingReason: session.status === 'waiting_approval' ? 'permission' : null,
    failureReason: session.status === 'failed' ? 'failed_to_start' : null,
    title: session.title,
    summary: session.lastSummary,
    recoveryMode: 'resume-external',
    externalSessionId: session.resumeSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivatedAt: session.lastActivatedAt,
    archived: false
  }))
})

const persistentSessionIds = computed(() => {
  return deckSessions.value.map((session) => session.id)
})
</script>

<template>
  <section class="hermes-terminal-deck" data-testid="hermes-terminal-deck" aria-label="Hermes terminal deck">
    <div
      v-for="session in deckSessions"
      :key="session.id"
      v-show="session.id === activeHermesSessionId"
      class="hermes-terminal-deck__viewport"
    >
      <TerminalViewport
        :project="HERMES_PROJECT"
        :session="session"
        :visible="session.id === activeHermesSessionId"
      />
    </div>
    <div v-if="persistentSessionIds.length === 0" class="hermes-terminal-deck__empty">
      <p>No Hermes session is running.</p>
    </div>
  </section>
</template>

<style scoped>
.hermes-terminal-deck {
  min-height: 0;
  height: 100%;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.hermes-terminal-deck__viewport,
.hermes-terminal-deck__empty {
  min-height: 0;
  height: 100%;
}

.hermes-terminal-deck__empty {
  display: grid;
  place-items: center;
  color: var(--color-muted);
}
</style>
