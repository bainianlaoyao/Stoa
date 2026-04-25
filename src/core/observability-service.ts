import {
  buildAppObservabilitySnapshot,
  buildProjectObservabilitySnapshot,
  buildSessionPresenceSnapshot
} from '../shared/observability-projection'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '../shared/observability'
import type { SessionSummary } from '../shared/project-session'
import type { ObservationStore } from './observation-store'

export interface ObservabilityServiceOptions {
  nowIso?: () => string
}

interface SessionEvidenceState {
  modelLabel: string | null
  lastAssistantSnippet: string | null
  lastEvidenceType: string | null
  lastEventAt: string | null
  evidenceSequence: number
}

export class ObservabilityService {
  private readonly nowIso: () => string
  private readonly sessions = new Map<string, SessionSummary>()
  private readonly evidence = new Map<string, SessionEvidenceState>()
  private readonly sessionSnapshots = new Map<string, SessionPresenceSnapshot>()
  private readonly projectSnapshots = new Map<string, ProjectObservabilitySnapshot>()
  private appSnapshot: AppObservabilitySnapshot
  private activeSessionId: string | null = null

  constructor(private readonly store: ObservationStore, options: ObservabilityServiceOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.appSnapshot = buildAppObservabilitySnapshot([], [], this.nowIso())
  }

  syncSessions(sessions: SessionSummary[], activeSessionId: string | null): void {
    this.activeSessionId = activeSessionId

    const retainedSessions = sessions.filter((session) => !session.archived)
    const retainedIds = new Set(retainedSessions.map((session) => session.id))
    const nextSessions = new Map<string, SessionSummary>()
    const nextEvidence = new Map<string, SessionEvidenceState>()

    for (const session of retainedSessions) {
      nextSessions.set(session.id, session)
      nextEvidence.set(
        session.id,
        this.evidence.get(session.id) ?? {
          modelLabel: null,
          lastAssistantSnippet: null,
          lastEvidenceType: null,
          lastEventAt: null,
          evidenceSequence: 0
        }
      )
    }

    this.sessions.clear()
    for (const [sessionId, session] of nextSessions) {
      this.sessions.set(sessionId, session)
    }

    this.evidence.clear()
    for (const [sessionId, evidence] of nextEvidence) {
      this.evidence.set(sessionId, evidence)
    }

    for (const sessionId of [...this.sessionSnapshots.keys()]) {
      if (!retainedIds.has(sessionId)) {
        this.sessionSnapshots.delete(sessionId)
      }
    }

    this.rebuildSnapshots(this.nowIso())
  }

  registerSession(session: SessionSummary, activeSessionId: string | null): void {
    this.syncSessions([...this.sessions.values(), session], activeSessionId)
  }

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId
    this.rebuildSnapshots(this.nowIso())
  }

  ingest(event: ObservationEvent): boolean {
    const appended = this.store.append(event)

    if (!appended || !event.sessionId) {
      return appended
    }

    if (!this.sessions.has(event.sessionId)) {
      return appended
    }

    const session = this.sessions.get(event.sessionId)
    const nextEvidence = updateEvidence(this.evidence.get(event.sessionId), event, session.lastStateSequence)

    this.evidence.set(event.sessionId, nextEvidence)
    this.rebuildSnapshots(this.nowIso())

    return appended
  }

  getSessionPresence(sessionId: string): SessionPresenceSnapshot | null {
    return this.sessionSnapshots.get(sessionId) ?? null
  }

  getProjectObservability(projectId: string): ProjectObservabilitySnapshot | null {
    return this.projectSnapshots.get(projectId) ?? null
  }

  getAppObservability(): AppObservabilitySnapshot {
    return this.appSnapshot
  }

  private rebuildSnapshots(nowIso: string): void {
    this.sessionSnapshots.clear()

    for (const session of this.sessions.values()) {
      const evidence = this.evidence.get(session.id)

      this.sessionSnapshots.set(
        session.id,
        buildSessionPresenceSnapshot(session, {
          activeSessionId: this.activeSessionId,
          nowIso,
          modelLabel: evidence?.modelLabel ?? null,
          lastAssistantSnippet: evidence?.lastAssistantSnippet ?? null,
          lastEvidenceType: evidence?.lastEvidenceType ?? null,
          lastEventAt: evidence?.lastEventAt ?? session.updatedAt,
          evidenceSequence: evidence?.evidenceSequence ?? 0,
          sourceSequence: Math.max(
            session.lastStateSequence,
            evidence?.evidenceSequence ?? 0
          )
        })
      )
    }

    this.rebuildProjectSnapshots(nowIso)
    this.appSnapshot = buildAppObservabilitySnapshot(
      [...this.projectSnapshots.values()],
      [...this.sessionSnapshots.values()],
      nowIso
    )
  }

  private rebuildProjectSnapshots(nowIso: string): void {
    this.projectSnapshots.clear()

    for (const projectId of new Set([...this.sessions.values()].map((session) => session.projectId))) {
      this.projectSnapshots.set(
        projectId,
        buildProjectObservabilitySnapshot(
          projectId,
          [...this.sessionSnapshots.values()].filter((snapshot) => snapshot.projectId === projectId),
          nowIso
        )
      )
    }
  }
}

function updateEvidence(
  current: SessionEvidenceState | undefined,
  event: ObservationEvent,
  sessionStateSequence: number
): SessionEvidenceState {
  const next: SessionEvidenceState = current ?? {
    modelLabel: null,
    lastAssistantSnippet: null,
    lastEvidenceType: null,
    lastEventAt: null,
    evidenceSequence: 0
  }
  const nextEvidenceSequence = Math.max(next.evidenceSequence, event.sequence)
  const isCurrentEvidence = event.sequence >= Math.max(next.evidenceSequence, sessionStateSequence)

  if (!isCurrentEvidence) {
    return {
      ...next,
      evidenceSequence: nextEvidenceSequence
    }
  }

  const model = event.payload.model
  const snippet = assistantSnippetForEvent(event)

  return {
    modelLabel: typeof model === 'string' ? model : next.modelLabel,
    lastAssistantSnippet: snippet ?? next.lastAssistantSnippet,
    lastEvidenceType: event.category === 'evidence' ? event.type : next.lastEvidenceType,
    lastEventAt: event.occurredAt,
    evidenceSequence: nextEvidenceSequence
  }
}

function assistantSnippetForEvent(event: ObservationEvent): string | null {
  if (event.category !== 'evidence' || !event.type.startsWith('evidence.assistant')) {
    return null
  }

  if (typeof event.payload.snippet === 'string') {
    return event.payload.snippet
  }

  if (typeof event.payload.summary === 'string') {
    return event.payload.summary
  }

  return null
}
