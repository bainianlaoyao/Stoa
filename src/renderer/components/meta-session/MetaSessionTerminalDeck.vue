<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import { useMetaSessionStore } from '@renderer/stores/meta-session'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const META_SESSION_PROJECT: ProjectSummary = {
  id: 'stoa-meta-session',
  name: 'Meta Session',
  path: '.',
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z'
}

const metaSessionStore = useMetaSessionStore()
const { sessions, activeMetaSessionId } = storeToRefs(metaSessionStore)

const deckSessions = computed<SessionSummary[]>(() => {
  return sessions.value.map((session) => ({
    id: session.id,
    projectId: META_SESSION_PROJECT.id,
    type: session.backendSessionType,
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
    externalSessionId: session.backendSessionId,
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
  <section class="meta-session-terminal-deck" data-testid="meta-session-terminal-deck" aria-label="Meta session terminal deck">
    <div
      v-for="session in deckSessions"
      :key="session.id"
      v-show="session.id === activeMetaSessionId"
      class="meta-session-terminal-deck__viewport"
    >
      <TerminalViewport
        :project="META_SESSION_PROJECT"
        :session="session"
        :visible="session.id === activeMetaSessionId"
      />
    </div>
    <div v-if="persistentSessionIds.length === 0" class="meta-session-terminal-deck__empty">
      <p>No meta session is running.</p>
    </div>
  </section>
</template>

<style scoped>
.meta-session-terminal-deck {
  min-height: 0;
  height: 100%;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
}

.meta-session-terminal-deck__viewport,
.meta-session-terminal-deck__empty {
  min-height: 0;
  height: 100%;
}

.meta-session-terminal-deck__empty {
  display: grid;
  place-items: center;
  color: var(--color-muted);
}
</style>
