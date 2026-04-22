import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BootstrapState, ProjectSummary, SessionStatus, SessionSummary } from '@shared/project-session'

export interface ProjectHierarchyNode extends ProjectSummary {
  active: boolean
  sessions: Array<SessionSummary & { active: boolean }>
}

export const useWorkspaceStore = defineStore('workspaces', () => {
  const projects = ref<ProjectSummary[]>([])
  const sessions = ref<SessionSummary[]>([])
  const activeProjectId = ref<string | null>(null)
  const activeSessionId = ref<string | null>(null)
  const terminalWebhookPort = ref<number | null>(null)
  const lastError = ref<string | null>(null)
  const archivedSessions = ref<SessionSummary[]>([])

  const activeProject = computed(() => {
    return projects.value.find((project) => project.id === activeProjectId.value) ?? null
  })

  const activeSession = computed(() => {
    return sessions.value.find((session) => session.id === activeSessionId.value) ?? null
  })

  const projectHierarchy = computed<ProjectHierarchyNode[]>(() => {
    return projects.value.map((project) => ({
      ...project,
      active: project.id === activeProjectId.value,
      sessions: sessions.value
        .filter((session) => session.projectId === project.id && !session.archived)
        .map((session) => ({
          ...session,
          active: session.id === activeSessionId.value
        }))
    }))
  })

  function hydrate(state: BootstrapState): void {
    projects.value = state.projects
    sessions.value = state.sessions
    activeProjectId.value = state.activeProjectId
    activeSessionId.value = state.activeSessionId
    terminalWebhookPort.value = state.terminalWebhookPort
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

  function setArchivedSessions(sessions: SessionSummary[]): void {
    archivedSessions.value = sessions
  }

  return {
    projects,
    sessions,
    activeProjectId,
    activeSessionId,
    terminalWebhookPort,
    lastError,
    activeProject,
    activeSession,
    projectHierarchy,
    hydrate,
    addProject,
    addSession,
    updateSession,
    setActiveProject,
    setActiveSession,
    clearError,
    archivedSessions,
    archiveSession,
    restoreSession,
    setArchivedSessions
  }
})
