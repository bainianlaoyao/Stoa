<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import TerminalViewport from '@renderer/components/TerminalViewport.vue'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { ActiveSessionViewModel } from '@shared/observability'
import type {
  OpenWorkspaceRequest,
  ProjectSummary,
  SessionSummary,
  SessionType
} from '@shared/project-session'

interface ResolvedTerminalSession {
  project: ProjectSummary
  session: SessionSummary
}

const PERSISTENT_AI_SESSION_TYPES = new Set<SessionType>(['codex', 'opencode', 'claude-code'])

const props = withDefaults(defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
  activeSessionViewModel?: ActiveSessionViewModel | null
  visible?: boolean
}>(), {
  activeSessionViewModel: null,
  visible: true
})

const emit = defineEmits<{
  openWorkspace: [request: OpenWorkspaceRequest]
}>()

const activatedAiSessionIds = shallowRef<string[]>([])

function isPersistentAiSession(session: SessionSummary | null): session is SessionSummary {
  return session !== null && PERSISTENT_AI_SESSION_TYPES.has(session.type)
}

const sessionLookup = computed<Record<string, ResolvedTerminalSession>>(() => {
  const lookup: Record<string, ResolvedTerminalSession> = {}

  for (const project of props.hierarchy) {
    for (const session of project.sessions) {
      lookup[session.id] = {
        project,
        session
      }
    }
  }

  return lookup
})

watch(
  () => props.activeSession,
  (session) => {
    if (!isPersistentAiSession(session) || activatedAiSessionIds.value.includes(session.id)) {
      return
    }

    activatedAiSessionIds.value = [...activatedAiSessionIds.value, session.id]
  },
  { immediate: true }
)

watch(
  sessionLookup,
  (lookup) => {
    const nextIds = activatedAiSessionIds.value.filter((sessionId) => lookup[sessionId])
    if (nextIds.length === activatedAiSessionIds.value.length) {
      return
    }

    activatedAiSessionIds.value = nextIds
  },
  { immediate: true }
)

const persistentAiEntries = computed(() => {
  return activatedAiSessionIds.value
    .map((sessionId) => sessionLookup.value[sessionId] ?? null)
    .filter((entry): entry is ResolvedTerminalSession => entry !== null)
})

const activePersistentSessionId = computed(() => {
  return isPersistentAiSession(props.activeSession) ? props.activeSession.id : null
})

const activeEphemeralSession = computed(() => {
  return activePersistentSessionId.value ? null : props.activeSession
})

const activeEphemeralEntry = computed(() => {
  const session = activeEphemeralSession.value
  if (!session) {
    return null
  }

  return sessionLookup.value[session.id] ?? null
})
</script>

<template>
  <section class="h-full min-h-0 grid" data-testid="terminal-session-deck">
    <div
      v-for="entry in persistentAiEntries"
      :key="entry.session.id"
      v-show="props.visible && entry.session.id === activePersistentSessionId"
      class="h-full min-h-0"
      :data-session-id="entry.session.id"
      data-testid="terminal-session-deck-item"
    >
      <TerminalViewport
        :project="entry.project"
        :session="entry.session"
        :active-view-model="entry.session.id === activePersistentSessionId ? props.activeSessionViewModel : null"
        :visible="props.visible && entry.session.id === activePersistentSessionId"
        @open-workspace="emit('openWorkspace', $event)"
      />
    </div>

    <div
      v-if="activeEphemeralSession"
      :key="activeEphemeralSession.id"
      v-show="props.visible"
      class="h-full min-h-0"
      :data-session-id="activeEphemeralSession.id"
      data-testid="terminal-session-deck-ephemeral"
    >
      <TerminalViewport
        :project="activeEphemeralEntry?.project ?? props.activeProject"
        :session="activeEphemeralSession"
        :active-view-model="props.activeSessionViewModel"
        :visible="props.visible"
        @open-workspace="emit('openWorkspace', $event)"
      />
    </div>

    <div
      v-else-if="!activePersistentSessionId"
      v-show="props.visible"
      class="h-full min-h-0"
      data-testid="terminal-session-deck-empty"
    >
      <TerminalViewport
        :project="null"
        :session="null"
        :visible="props.visible"
        @open-workspace="emit('openWorkspace', $event)"
      />
    </div>
  </section>
</template>
