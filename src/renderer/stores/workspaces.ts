import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BootstrapState, ProjectSummary, SessionSummary } from '@shared/project-session'
import { buildSessionPresenceSnapshot } from '@shared/observability-projection'
import type {
  AppObservabilitySnapshot,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'

export interface ProjectHierarchyNode extends ProjectSummary {
  active: boolean
  sessions: Array<SessionSummary & { active: boolean }>
  archivedSessions: Array<SessionSummary & { active: boolean }>
}

interface SequencedSnapshot {
  sourceSequence: number
  updatedAt: string
}

function isStaleSnapshot(current: SequencedSnapshot, next: SequencedSnapshot): boolean {
  if (current.sourceSequence > next.sourceSequence) {
    return true
  }

  return current.sourceSequence === next.sourceSequence && current.updatedAt >= next.updatedAt
}

export const useWorkspaceStore = defineStore('workspaces', () => {
  const projects = ref<ProjectSummary[]>([])
  const sessions = ref<SessionSummary[]>([])
  const activeProjectId = ref<string | null>(null)
  const activeSessionId = ref<string | null>(null)
  const terminalWebhookPort = ref<number | null>(null)
  const lastError = ref<string | null>(null)
  const sessionPresenceById = ref<Record<string, SessionPresenceSnapshot>>({})
  const projectObservabilityById = ref<Record<string, ProjectObservabilitySnapshot>>({})
  const appObservability = ref<AppObservabilitySnapshot | null>(null)
  const unsubscribeSessionPresenceChanged = ref<(() => void) | null>(null)
  const unsubscribeProjectObservabilityChanged = ref<(() => void) | null>(null)
  const unsubscribeAppObservabilityChanged = ref<(() => void) | null>(null)
  const backendSessionPresenceIds = new Set<string>()

  const activeProject = computed(() => {
    return projects.value.find((project) => project.id === activeProjectId.value) ?? null
  })

  const activeSession = computed(() => {
    return sessions.value.find((session) => session.id === activeSessionId.value) ?? null
  })

  const activeSessionPresence = computed(() => {
    if (!activeSessionId.value) {
      return null
    }

    return sessionPresenceById.value[activeSessionId.value] ?? null
  })

  const sessionPresenceMap = computed(() => sessionPresenceById.value)
  const projectObservabilityMap = computed(() => projectObservabilityById.value)

  const projectHierarchy = computed<ProjectHierarchyNode[]>(() => {
    return projects.value.map((project) => {
      const projectSessions = sessions.value
        .filter((session) => session.projectId === project.id && !session.archived)
        .map((session) => ({
          ...session,
          active: session.id === activeSessionId.value
        }))

      const archivedProjectSessions = sessions.value
        .filter((session) => session.projectId === project.id && session.archived)
        .map((session) => ({
          ...session,
          active: session.id === activeSessionId.value
        }))

      return {
        ...project,
        active: project.id === activeProjectId.value,
        sessions: projectSessions,
        archivedSessions: archivedProjectSessions
      }
    })
  })

  function hydrate(state: BootstrapState): void {
    projects.value = state.projects
    sessions.value = state.sessions
    activeProjectId.value = state.activeProjectId
    activeSessionId.value = state.activeSessionId
    terminalWebhookPort.value = state.terminalWebhookPort

    for (const session of state.sessions) {
      syncSessionPresenceFromSummary(session)
    }
  }

  async function hydrateObservability(): Promise<void> {
    const stoa = window.stoa

    if (!stoa) {
      return
    }

    subscribeToObservability(stoa)

    const nextSessionPresenceEntries = await Promise.all(
      sessions.value.map(async (session) => {
        const snapshot = await stoa.getSessionPresence?.(session.id)
        return snapshot ? [session.id, snapshot] as const : null
      })
    )

    const nextProjectObservabilityEntries = await Promise.all(
      projects.value.map(async (project) => {
        const snapshot = await stoa.getProjectObservability?.(project.id)
        return snapshot ? [project.id, snapshot] as const : null
      })
    )

    for (const entry of nextSessionPresenceEntries) {
      if (!entry) {
        continue
      }

      applySessionPresenceSnapshot(entry[1])
    }

    for (const entry of nextProjectObservabilityEntries) {
      if (!entry) {
        continue
      }

      applyProjectObservabilitySnapshot(entry[1])
    }

    const initialAppObservability = (await stoa.getAppObservability?.()) ?? null
    if (initialAppObservability) {
      applyAppObservabilitySnapshot(initialAppObservability)
    }

    await backfillMissedObservability(stoa)
  }

  function subscribeToObservability(stoa: typeof window.stoa): void {
    unsubscribeObservability()

    unsubscribeSessionPresenceChanged.value = stoa.onSessionPresenceChanged?.((snapshot) => {
      applySessionPresenceSnapshot(snapshot)
    }) ?? null

    unsubscribeProjectObservabilityChanged.value = stoa.onProjectObservabilityChanged?.((snapshot) => {
      applyProjectObservabilitySnapshot(snapshot)
    }) ?? null

    unsubscribeAppObservabilityChanged.value = stoa.onAppObservabilityChanged?.((snapshot) => {
      applyAppObservabilitySnapshot(snapshot)
    }) ?? null
  }

  function applySessionPresenceSnapshot(snapshot: SessionPresenceSnapshot): void {
    const current = sessionPresenceById.value[snapshot.sessionId]
    if (current && backendSessionPresenceIds.has(snapshot.sessionId) && isStaleSnapshot(current, snapshot)) {
      return
    }

    backendSessionPresenceIds.add(snapshot.sessionId)
    sessionPresenceById.value = {
      ...sessionPresenceById.value,
      [snapshot.sessionId]: snapshot
    }
  }

  function applyProjectObservabilitySnapshot(snapshot: ProjectObservabilitySnapshot): void {
    const current = projectObservabilityById.value[snapshot.projectId]
    if (current && isStaleSnapshot(current, snapshot)) {
      return
    }

    projectObservabilityById.value = {
      ...projectObservabilityById.value,
      [snapshot.projectId]: snapshot
    }
  }

  function applyAppObservabilitySnapshot(snapshot: AppObservabilitySnapshot): void {
    if (appObservability.value && isStaleSnapshot(appObservability.value, snapshot)) {
      return
    }

    appObservability.value = snapshot
  }

  async function backfillMissedObservability(stoa: typeof window.stoa): Promise<void> {
    for (const session of sessions.value) {
      const cursor = String(sessionPresenceById.value[session.id]?.evidenceSequence ?? 0)
      const listed = await stoa.listSessionObservationEvents?.(session.id, { cursor, limit: 50 })
      if (!listed?.events.length) {
        continue
      }

      const sessionSnapshot = await stoa.getSessionPresence?.(session.id)
      if (sessionSnapshot) {
        applySessionPresenceSnapshot(sessionSnapshot)
      }

      const projectSnapshot = await stoa.getProjectObservability?.(session.projectId)
      if (projectSnapshot) {
        applyProjectObservabilitySnapshot(projectSnapshot)
      }

      const nextAppSnapshot = await stoa.getAppObservability?.()
      if (nextAppSnapshot) {
        applyAppObservabilitySnapshot(nextAppSnapshot)
      }
    }
  }

  function unsubscribeObservability(): void {
    unsubscribeSessionPresenceChanged.value?.()
    unsubscribeProjectObservabilityChanged.value?.()
    unsubscribeAppObservabilityChanged.value?.()
    unsubscribeSessionPresenceChanged.value = null
    unsubscribeProjectObservabilityChanged.value = null
    unsubscribeAppObservabilityChanged.value = null
  }

  function setActiveProject(projectId: string): void {
    activeProjectId.value = projectId
    if (!sessions.value.some((session) => session.id === activeSessionId.value && session.projectId === projectId)) {
      activeSessionId.value = sessions.value.find((session) => session.projectId === projectId)?.id ?? null
    }
  }

  function setActiveSession(sessionId: string): void {
    const session = sessions.value.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return
    }

    activeSessionId.value = session.id
    activeProjectId.value = session.projectId
  }

  function addProject(project: ProjectSummary): void {
    projects.value.push(project)
  }

  function addSession(session: SessionSummary): void {
    sessions.value.push(session)
    syncSessionPresenceFromSummary(session)
  }

  function updateSession(sessionId: string, patch: Partial<SessionSummary>): void {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return
    Object.assign(session, patch)
    syncSessionPresenceFromSummary(session)
  }

  function syncSessionPresenceFromSummary(session: SessionSummary): void {
    if (backendSessionPresenceIds.has(session.id)) {
      return
    }

    const current = sessionPresenceById.value[session.id]
    const next = buildSessionPresenceSnapshot(session, {
      activeSessionId: activeSessionId.value,
      nowIso: new Date().toISOString(),
      modelLabel: current?.modelLabel ?? null,
      lastAssistantSnippet: current?.lastAssistantSnippet ?? null,
      lastEvidenceType: current?.lastEvidenceType ?? null,
      lastEventAt: current?.lastEventAt ?? null,
      evidenceSequence: current?.evidenceSequence ?? 0,
      sourceSequence: session.lastStateSequence
    })

    if (current && isStaleSnapshot(current, next)) {
      return
    }

    sessionPresenceById.value = {
      ...sessionPresenceById.value,
      [session.id]: next
    }
  }

  function clearError(): void {
    lastError.value = null
  }

  function archiveSession(sessionId: string): void {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return
    session.archived = true
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
    }
  }

  function restoreSession(sessionId: string): void {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return
    session.archived = false
  }

  return {
    projects,
    sessions,
    activeProjectId,
    activeSessionId,
    terminalWebhookPort,
    lastError,
    sessionPresenceById,
    projectObservabilityById,
    appObservability,
    activeProject,
    activeSession,
    activeSessionPresence,
    sessionPresenceMap,
    projectObservabilityMap,
    projectHierarchy,
    hydrate,
    hydrateObservability,
    applySessionPresenceSnapshot,
    addProject,
    addSession,
    updateSession,
    setActiveProject,
    setActiveSession,
    clearError,
    archiveSession,
    restoreSession,
    unsubscribeObservability
  }
})
