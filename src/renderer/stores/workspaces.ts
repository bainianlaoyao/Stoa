import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  BootstrapState,
  ProjectSummary,
  SessionGraphEvent,
  SessionSummary,
  SessionTreeMeta
} from '@shared/project-session'
import { buildSessionPresenceSnapshot } from '@shared/observability-projection'
import type {
  AppObservabilitySnapshot,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'

interface SessionTreeProjection {
  treeDepth: number
  treeRootSessionId: string
  treeChildCount: number
  treeDescendantCount: number
}

type ProjectHierarchySessionNode = SessionSummary & {
  active: boolean
  treeDepth?: number
  treeRootSessionId?: string
  treeChildCount?: number
  treeDescendantCount?: number
}

export interface ProjectHierarchyNode extends ProjectSummary {
  active: boolean
  sessions: ProjectHierarchySessionNode[]
  archivedSessions: ProjectHierarchySessionNode[]
}

interface SequencedSnapshot {
  sourceSequence: number
  updatedAt: string
}

interface SessionRecord extends SessionSummary, SessionTreeProjection {}

function isStaleSnapshot(current: SequencedSnapshot, next: SequencedSnapshot): boolean {
  if (current.sourceSequence > next.sourceSequence) {
    return true
  }

  return current.sourceSequence === next.sourceSequence && current.updatedAt >= next.updatedAt
}

function fallbackTreeProjection(session: SessionSummary, hint?: SessionTreeMeta): SessionTreeProjection {
  return {
    treeDepth: hint?.depth ?? 0,
    treeRootSessionId: hint?.rootSessionId ?? session.id,
    treeChildCount: hint?.childCount ?? 0,
    treeDescendantCount: hint?.descendantCount ?? 0
  }
}

function projectSessionsIntoTree(
  sessionList: SessionSummary[],
  treeHints: ReadonlyMap<string, SessionTreeMeta>
): SessionRecord[] {
  if (sessionList.length === 0) {
    return []
  }

  const sessionById = new Map(sessionList.map((session) => [session.id, session]))
  const indexById = new Map(sessionList.map((session, index) => [session.id, index]))
  const childrenByParentId = new Map<string, SessionSummary[]>()

  for (const session of sessionList) {
    if (!session.parentSessionId || !sessionById.has(session.parentSessionId)) {
      continue
    }

    const siblings = childrenByParentId.get(session.parentSessionId) ?? []
    siblings.push(session)
    childrenByParentId.set(session.parentSessionId, siblings)
  }

  const derivedMetaById = new Map<string, SessionTreeProjection>()
  const orderedSessionIds: string[] = []
  const orderedSessionIdSet = new Set<string>()

  function orderedChildrenFor(parentId: string): SessionSummary[] {
    return [...(childrenByParentId.get(parentId) ?? [])].sort((left, right) => {
      return (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0)
    })
  }

  function visit(session: SessionSummary, rootSessionId: string, depth: number, lineage: Set<string>): SessionTreeProjection {
    const existing = derivedMetaById.get(session.id)
    if (existing) {
      return existing
    }

    if (!orderedSessionIdSet.has(session.id)) {
      orderedSessionIds.push(session.id)
      orderedSessionIdSet.add(session.id)
    }

    if (lineage.has(session.id)) {
      const fallback = fallbackTreeProjection(session, treeHints.get(session.id))
      derivedMetaById.set(session.id, fallback)
      return fallback
    }

    lineage.add(session.id)

    const childSessions = orderedChildrenFor(session.id).filter((child) => !lineage.has(child.id))
    let descendantCount = 0

    for (const child of childSessions) {
      const childMeta = visit(child, rootSessionId, depth + 1, lineage)
      descendantCount += 1 + childMeta.treeDescendantCount
    }

    lineage.delete(session.id)

    const meta: SessionTreeProjection = {
      treeDepth: depth,
      treeRootSessionId: rootSessionId,
      treeChildCount: childSessions.length,
      treeDescendantCount: descendantCount
    }
    derivedMetaById.set(session.id, meta)
    return meta
  }

  const rootSessions = sessionList
    .filter((session) => !session.parentSessionId || !sessionById.has(session.parentSessionId))
    .sort((left, right) => (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0))

  for (const rootSession of rootSessions) {
    const hint = treeHints.get(rootSession.id)
    visit(rootSession, hint?.rootSessionId ?? rootSession.id, hint?.depth ?? 0, new Set<string>())
  }

  for (const session of sessionList.sort((left, right) => (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0))) {
    if (derivedMetaById.has(session.id)) {
      continue
    }

    const hint = treeHints.get(session.id)
    visit(session, hint?.rootSessionId ?? session.id, hint?.depth ?? 0, new Set<string>())
  }

  return orderedSessionIds
    .map((sessionId) => sessionById.get(sessionId))
    .filter((session): session is SessionSummary => Boolean(session))
    .map((session) => {
      const hint = treeHints.get(session.id)
      const derived = derivedMetaById.get(session.id) ?? fallbackTreeProjection(session, hint)
      return {
        ...session,
        treeDepth: hint?.depth ?? derived.treeDepth,
        treeRootSessionId: hint?.rootSessionId ?? derived.treeRootSessionId,
        treeChildCount: derived.treeChildCount,
        treeDescendantCount: derived.treeDescendantCount
      }
    })
}

export const useWorkspaceStore = defineStore('workspaces', () => {
  const projects = ref<ProjectSummary[]>([])
  const sessions = ref<SessionRecord[]>([])
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
  const sessionTreeHints = new Map<string, SessionTreeMeta>()

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
      const projectSessions: ProjectHierarchySessionNode[] = sessions.value
        .filter((session) => session.projectId === project.id && !session.archived)
        .map((session) => ({
          ...session,
          active: session.id === activeSessionId.value
        }))

      const archivedProjectSessions: ProjectHierarchySessionNode[] = sessions.value
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
    sessionTreeHints.clear()
    sessions.value = projectSessionsIntoTree(state.sessions, sessionTreeHints)
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

  function removeProject(projectId: string): void {
    projects.value = projects.value.filter(p => p.id !== projectId)
    sessions.value = sessions.value.filter(s => s.projectId !== projectId)
    if (activeProjectId.value === projectId) {
      activeProjectId.value = projects.value[0]?.id ?? null
      if (activeProjectId.value) {
        activeSessionId.value = sessions.value.find(s => s.projectId === activeProjectId.value)?.id ?? null
      } else {
        activeSessionId.value = null
      }
    }
  }

  function addProject(project: ProjectSummary): void {
    projects.value.push(project)
  }

  function reprojectSessions(nextSessions: SessionSummary[]): void {
    sessions.value = projectSessionsIntoTree(nextSessions, sessionTreeHints)
  }

  function upsertSession(session: SessionSummary, treeMeta?: SessionTreeMeta): void {
    if (treeMeta) {
      sessionTreeHints.set(session.id, treeMeta)
    }

    const existingIndex = sessions.value.findIndex((candidate) => candidate.id === session.id)
    const nextSessions: SessionSummary[] = sessions.value.map((candidate) => ({
      ...candidate
    }))

    if (existingIndex === -1) {
      nextSessions.push(session)
    } else {
      nextSessions.splice(existingIndex, 1, { ...nextSessions[existingIndex], ...session })
    }

    reprojectSessions(nextSessions)
    syncSessionPresenceFromSummary(sessions.value.find((candidate) => candidate.id === session.id) ?? session)
  }

  function addSession(session: SessionSummary): void {
    upsertSession(session)
  }

  function updateSession(sessionId: string, patch: Partial<SessionSummary>): void {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return
    upsertSession({ ...session, ...patch })
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
    upsertSession({ ...session, archived: true })
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
    }
  }

  function restoreSession(sessionId: string): void {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return
    upsertSession({ ...session, archived: false })
  }

  function applySessionGraphEvent(event: SessionGraphEvent): void {
    const { kind, origin, node } = event
    const incoming = node.session

    switch (kind) {
      case 'created': {
        upsertSession(incoming, node.tree)
        if (origin === 'renderer') {
          setActiveSession(incoming.id)
        }
        break
      }
      case 'updated': {
        upsertSession(incoming, node.tree)
        break
      }
      case 'archived': {
        upsertSession({ ...incoming, archived: true }, node.tree)
        if (activeSessionId.value === incoming.id) {
          activeSessionId.value = null
        }
        break
      }
      case 'restored': {
        upsertSession({ ...incoming, archived: false }, node.tree)
        break
      }
      case 'destroyed': {
        sessionTreeHints.delete(incoming.id)
        reprojectSessions(sessions.value.filter(s => s.id !== incoming.id))
        if (activeSessionId.value === incoming.id) {
          activeSessionId.value = null
        }
        break
      }
    }
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
    removeProject,
    unsubscribeObservability,
    applySessionGraphEvent
  }
})
