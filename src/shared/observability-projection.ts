import type { SessionStatus, SessionSummary } from './project-session'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from './provider-descriptors'
import type {
  ActiveSessionViewModel,
  AppObservabilitySnapshot,
  BlockingReason,
  ObservabilityConfidence,
  ObservabilityHealth,
  ObservabilityTone,
  ProjectObservabilitySnapshot,
  RecoveryPointerState,
  SessionPresencePhase,
  SessionPresenceSnapshot,
  SessionRowViewModel
} from './observability'

export function mapStatusToPresencePhase(status: SessionStatus): SessionPresencePhase {
  switch (status) {
    case 'bootstrapping':
    case 'starting':
      return 'preparing'
    case 'running':
      return 'working'
    case 'turn_complete':
    case 'awaiting_input':
      return 'ready'
    case 'needs_confirmation':
      return 'blocked'
    case 'degraded':
      return 'degraded'
    case 'error':
      return 'failed'
    case 'exited':
      return 'exited'
  }
}

export function mapPhaseToTone(phase: SessionPresencePhase): ObservabilityTone {
  switch (phase) {
    case 'ready':
      return 'accent'
    case 'working':
      return 'success'
    case 'blocked':
    case 'degraded':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'preparing':
    case 'exited':
      return 'neutral'
  }
}

export function providerLabel(providerId: string): string {
  return getProviderDescriptorByProviderId(providerId)?.displayName ?? providerId
}

export function phaseLabel(phase: SessionPresencePhase): string {
  switch (phase) {
    case 'preparing':
      return 'Preparing'
    case 'working':
      return 'Working'
    case 'ready':
      return 'Ready'
    case 'blocked':
      return 'Blocked'
    case 'degraded':
      return 'Degraded'
    case 'failed':
      return 'Failed'
    case 'exited':
      return 'Exited'
  }
}

export function buildSessionPresenceSnapshot(
  session: SessionSummary,
  options: {
    activeSessionId?: string | null
    nowIso: string
    modelLabel?: string | null
    lastAssistantSnippet?: string | null
    lastEvidenceType?: string | null
    lastEventAt?: string | null
    sourceSequence?: number
  }
): SessionPresenceSnapshot {
  const descriptor = getProviderDescriptorBySessionType(session.type)
  const phase = mapStatusToPresencePhase(session.status)
  const lastAssistantSnippet = options.lastAssistantSnippet ?? null
  const hasUnreadTurn = Boolean(lastAssistantSnippet && options.activeSessionId && options.activeSessionId !== session.id)
  const lastEventAt = options.lastEventAt ?? options.nowIso

  return {
    sessionId: session.id,
    projectId: session.projectId,
    providerId: descriptor.providerId,
    providerLabel: descriptor.displayName,
    modelLabel: options.modelLabel ?? null,
    phase,
    canonicalStatus: session.status,
    confidence: confidenceForSession(session),
    health: healthForPhase(phase),
    blockingReason: blockingReasonForStatus(session.status),
    lastAssistantSnippet,
    lastEventAt,
    lastEvidenceType: options.lastEvidenceType ?? null,
    hasUnreadTurn,
    recoveryPointerState: recoveryPointerStateForSession(session),
    sourceSequence: options.sourceSequence ?? 0,
    updatedAt: options.nowIso
  }
}

export function buildSessionRowViewModel(
  session: SessionSummary,
  snapshot: SessionPresenceSnapshot,
  nowIso: string
): SessionRowViewModel {
  const attentionReason = attentionReasonForSession(snapshot)

  return {
    sessionId: session.id,
    title: session.title,
    phase: snapshot.phase,
    primaryLabel: phaseLabel(snapshot.phase),
    secondaryLabel: [snapshot.providerLabel, snapshot.modelLabel].filter(Boolean).join(' / '),
    tone: mapPhaseToTone(snapshot.phase),
    hasUnreadTurn: snapshot.hasUnreadTurn,
    needsAttention: Boolean(attentionReason),
    attentionReason,
    updatedAgoLabel: updatedAgoLabel(snapshot.updatedAt, nowIso)
  }
}

export function buildActiveSessionViewModel(
  session: SessionSummary,
  snapshot: SessionPresenceSnapshot,
  nowIso: string
): ActiveSessionViewModel {
  return {
    sessionId: session.id,
    title: session.title,
    providerLabel: snapshot.providerLabel,
    modelLabel: snapshot.modelLabel,
    phaseLabel: phaseLabel(snapshot.phase),
    confidenceLabel: confidenceLabel(snapshot.confidence),
    tone: mapPhaseToTone(snapshot.phase),
    lastUpdatedLabel: updatedAgoLabel(snapshot.updatedAt, nowIso),
    snippet: snapshot.lastAssistantSnippet,
    explanation: session.summary
  }
}

export function buildProjectObservabilitySnapshot(
  projectId: string,
  sessions: SessionPresenceSnapshot[],
  nowIso: string
): ProjectObservabilitySnapshot {
  const attentionSession = latestAttentionSession(sessions)

  return {
    projectId,
    overallHealth: aggregateHealth(sessions.map((session) => session.health)),
    activeSessionCount: sessions.length,
    blockedSessionCount: sessions.filter((session) => session.phase === 'blocked').length,
    degradedSessionCount: sessions.filter((session) => session.phase === 'degraded').length,
    failedSessionCount: sessions.filter((session) => session.phase === 'failed').length,
    unreadTurnCount: sessions.filter((session) => session.hasUnreadTurn).length,
    latestAttentionSessionId: attentionSession?.sessionId ?? null,
    latestAttentionReason: attentionSession ? attentionReasonForSession(attentionSession) : null,
    lastEventAt: latestTimestamp(sessions.map((session) => session.lastEventAt)),
    sourceSequence: maxSourceSequence(sessions),
    updatedAt: nowIso
  }
}

export function buildAppObservabilitySnapshot(
  projects: ProjectObservabilitySnapshot[],
  sessionSnapshots: SessionPresenceSnapshot[],
  nowIso: string
): AppObservabilitySnapshot {
  return {
    blockedProjectCount: projects.filter((project) => project.blockedSessionCount > 0).length,
    failedProjectCount: projects.filter((project) => project.failedSessionCount > 0).length,
    degradedProjectCount: projects.filter((project) => project.degradedSessionCount > 0).length,
    totalUnreadTurns: projects.reduce((total, project) => total + project.unreadTurnCount, 0),
    projectsNeedingAttention: projects
      .filter((project) => project.latestAttentionSessionId !== null)
      .map((project) => project.projectId),
    providerHealthSummary: buildProviderHealthSummary(sessionSnapshots),
    lastGlobalEventAt: latestTimestamp(projects.map((project) => project.lastEventAt).filter((value) => value !== null)),
    sourceSequence: Math.max(maxSourceSequence(projects), maxSourceSequence(sessionSnapshots)),
    updatedAt: nowIso
  }
}

function maxSourceSequence(values: Array<{ sourceSequence: number }>): number {
  return values.reduce((max, value) => Math.max(max, value.sourceSequence), 0)
}

function healthForPhase(phase: SessionPresencePhase): ObservabilityHealth {
  if (phase === 'failed') {
    return 'lost'
  }

  if (phase === 'blocked' || phase === 'degraded') {
    return 'degraded'
  }

  return 'healthy'
}

function confidenceForSession(session: SessionSummary): ObservabilityConfidence {
  return session.externalSessionId ? 'authoritative' : 'stale'
}

function recoveryPointerStateForSession(session: SessionSummary): RecoveryPointerState {
  return session.externalSessionId ? 'trusted' : 'missing'
}

function blockingReasonForStatus(status: SessionStatus): BlockingReason | null {
  if (status === 'needs_confirmation') {
    return 'resume-confirmation'
  }

  if (status === 'error') {
    return 'provider-error'
  }

  return null
}

function aggregateHealth(healthValues: ObservabilityHealth[]): ObservabilityHealth {
  if (healthValues.includes('lost')) {
    return 'lost'
  }

  if (healthValues.includes('degraded')) {
    return 'degraded'
  }

  return 'healthy'
}

function buildProviderHealthSummary(sessions: SessionPresenceSnapshot[]): Record<string, ObservabilityHealth> {
  const summary: Record<string, ObservabilityHealth> = {}

  for (const session of sessions) {
    summary[session.providerId] = aggregateHealth([summary[session.providerId], session.health].filter(Boolean))
  }

  return summary
}

function latestAttentionSession(sessions: SessionPresenceSnapshot[]): SessionPresenceSnapshot | null {
  const attentionSessions = sessions.filter((session) => attentionReasonForSession(session))

  return [...attentionSessions].sort((left, right) => {
    const timeComparison = right.lastEventAt.localeCompare(left.lastEventAt)

    if (timeComparison !== 0) {
      return timeComparison
    }

    return attentionPriority(right) - attentionPriority(left)
  })[0] ?? null
}

function attentionReasonForSession(session: SessionPresenceSnapshot): string | null {
  if (session.blockingReason) {
    return session.blockingReason
  }

  if (session.phase === 'failed') {
    return 'provider-error'
  }

  if (session.phase === 'degraded') {
    return 'degraded'
  }

  if (session.hasUnreadTurn) {
    return 'unread-turn'
  }

  return null
}

function attentionPriority(session: SessionPresenceSnapshot): number {
  switch (attentionReasonForSession(session)) {
    case 'provider-error':
      return 4
    case 'resume-confirmation':
    case 'permission':
    case 'elicitation':
      return 3
    case 'degraded':
      return 2
    case 'unread-turn':
      return 1
    default:
      return 0
  }
}

function latestTimestamp(values: string[]): string | null {
  return [...values].sort((left, right) => right.localeCompare(left))[0] ?? null
}

function updatedAgoLabel(updatedAt: string, nowIso: string): string {
  const elapsedMs = Date.parse(nowIso) - Date.parse(updatedAt)

  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) {
    return 'Just now'
  }

  const elapsedMinutes = Math.floor(elapsedMs / 60_000)

  return `${elapsedMinutes}m ago`
}

function confidenceLabel(confidence: ObservabilityConfidence): string {
  switch (confidence) {
    case 'authoritative':
      return 'Authoritative'
    case 'provisional':
      return 'Provisional'
    case 'stale':
      return 'Stale'
  }
}
