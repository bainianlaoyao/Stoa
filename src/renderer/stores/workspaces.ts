import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BootstrapState, ProjectSummary, SessionStatus, SessionSummary } from '@shared/project-session'
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

      const [sessionId, snapshot] = entry
      if (!(sessionId in sessionPresenceById.value)) {
        sessionPresenceById.value = {
          ...sessionPresenceById.value,
          [sessionId]: snapshot
        }
      }
    }

    for (const entry of nextProjectObservabilityEntries) {
      if (!entry) {
        continue
      }

      const [projectId, snapshot] = entry
      if (!(projectId in projectObservabilityById.value)) {
        projectObservabilityById.value = {
          ...projectObservabilityById.value,
          [projectId]: snapshot
        }
      }
    }

    const initialAppObservability = (await stoa.getAppObservability?.()) ?? null
    if (appObservability.value === null) {
      appObservability.value = initialAppObservability
    }
  }

  function subscribeToObservability(stoa: typeof window.stoa): void {
    unsubscribeObservability()

    unsubscribeSessionPresenceChanged.value = stoa.onSessionPresenceChanged?.((snapshot) => {
      sessionPresenceById.value = {
        ...sessionPresenceById.value,
        [snapshot.sessionId]: snapshot
      }
    }) ?? null

    unsubscribeProjectObservabilityChanged.value = stoa.onProjectObservabilityChanged?.((snapshot) => {
      projectObservabilityById.value = {
        ...projectObservabilityById.value,
        [snapshot.projectId]: snapshot
      }
    }) ?? null

    unsubscribeAppObservabilityChanged.value = stoa.onAppObservabilityChanged?.((snapshot) => {
      appObservability.value = snapshot
    }) ?? null
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
  }

  function updateSession(sessionId: string, patch: { status?: SessionStatus; summary?: string; externalSessionId?: string | null }): void {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return
    if (patch.status !== undefined) session.status = patch.status
    if (patch.summary !== undefined) session.summary = patch.summary
    if (patch.externalSessionId !== undefined) session.externalSessionId = patch.externalSessionId
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
