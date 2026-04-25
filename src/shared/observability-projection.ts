import type { SessionSummary } from './project-session'
import { getProviderDescriptorByProviderId, getProviderDescriptorBySessionType } from './provider-descriptors'
import { derivePresencePhase } from './session-state-reducer'
import type {
  ActiveSessionViewModel,
  AppObservabilitySnapshot,
  ObservabilityConfidence,
  ObservabilityHealth,
  ObservabilityTone,
  ProjectObservabilitySnapshot,
  RecoveryPointerState,
  SessionPresencePhase,
  SessionPresenceSnapshot,
  SessionRowViewModel
} from './observability'

export function mapPhaseToTone(phase: SessionPresencePhase): ObservabilityTone {
  switch (phase) {
    case 'ready':
      return 'neutral'
    case 'running':
      return 'success'
    case 'complete':
      return 'warning'
    case 'blocked':
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
    case 'running':
      return 'Running'
    case 'ready':
      return 'Ready'
    case 'complete':
      return 'Complete'
    case 'blocked':
      return 'Blocked'
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
    evidenceSequence?: number
    sourceSequence?: number
  }
): SessionPresenceSnapshot {
  const descriptor = getProviderDescriptorBySessionType(session.type)
  const phase = derivePresencePhase({
    runtimeState: session.runtimeState,
    agentState: session.agentState,
    hasUnseenCompletion: session.hasUnseenCompletion,
    runtimeExitCode: session.runtimeExitCode,
    runtimeExitReason: session.runtimeExitReason,
    provider: session.type
  })
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
    runtimeState: session.runtimeState,
    agentState: session.agentState,
    hasUnseenCompletion: session.hasUnseenCompletion,
    runtimeExitCode: session.runtimeExitCode,
    runtimeExitReason: session.runtimeExitReason,
    confidence: confidenceForSession(session),
    health: healthForPhase(phase),
    blockingReason: session.blockingReason,
    lastAssistantSnippet,
    lastEventAt,
    lastEvidenceType: options.lastEvidenceType ?? null,
    hasUnreadTurn,
    recoveryPointerState: recoveryPointerStateForSession(session),
    evidenceSequence: options.evidenceSequence ?? 0,
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
    primaryLabel: rowPrimaryLabel(snapshot),
    secondaryLabel: [snapshot.providerLabel, snapshot.modelLabel].filter(Boolean).join(' / '),
    tone: mapPhaseToTone(snapshot.phase),
    hasUnreadTurn: snapshot.hasUnreadTurn,
    needsAttention: Boolean(attentionReason),
    attentionReason,
    updatedAgoLabel: updatedAgoLabel(snapshot.updatedAt, nowIso)
  }
}

function rowPrimaryLabel(snapshot: SessionPresenceSnapshot): string {
  if (snapshot.phase === 'running') {
    return 'Running'
  }

  return phaseLabel(snapshot.phase)
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
    overallHealth: aggregateSessionHealth(sessions),
    activeSessionCount: sessions.length,
    blockedSessionCount: sessions.filter((session) => session.phase === 'blocked').length,
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

  return 'healthy'
}

function confidenceForSession(session: SessionSummary): ObservabilityConfidence {
  return session.externalSessionId ? 'authoritative' : 'stale'
}

function recoveryPointerStateForSession(session: SessionSummary): RecoveryPointerState {
  return session.externalSessionId ? 'trusted' : 'missing'
}

function aggregateHealth(healthValues: ObservabilityHealth[]): ObservabilityHealth {
  if (healthValues.includes('lost')) {
    return 'lost'
  }

  return 'healthy'
}

function buildProviderHealthSummary(sessions: SessionPresenceSnapshot[]): Record<string, ObservabilityHealth> {
  const summary: Record<string, ObservabilityHealth> = {}

  for (const session of sessions) {
    summary[session.providerId] = aggregateHealth([summary[session.providerId], healthForPhase(session.phase)].filter(Boolean))
  }

  return summary
}

function aggregateSessionHealth(sessions: SessionPresenceSnapshot[]): ObservabilityHealth {
  return aggregateHealth(sessions.map((session) => healthForPhase(session.phase)))
}

function latestAttentionSession(sessions: SessionPresenceSnapshot[]): SessionPresenceSnapshot | null {
  const attentionSessions = sessions.filter((session) => attentionReasonForSession(session))

  return [...attentionSessions].sort((left, right) => {
    const priorityComparison = attentionPriority(right) - attentionPriority(left)

    if (priorityComparison !== 0) {
      return priorityComparison
    }

    return right.lastEventAt.localeCompare(left.lastEventAt)
  })[0] ?? null
}

function attentionReasonForSession(session: SessionPresenceSnapshot): string | null {
  if (session.blockingReason) {
    return session.blockingReason
  }

  if (session.phase === 'failed') {
    return 'provider-error'
  }

  if (session.phase === 'complete') {
    return 'turn-complete'
  }

  if (session.phase === 'blocked') {
    return 'blocked'
  }

  if (session.hasUnreadTurn) {
    return 'unread-turn'
  }

  return null
}

function attentionPriority(session: SessionPresenceSnapshot): number {
  switch (session.phase) {
    case 'failed':
      return 5
    case 'complete':
    case 'blocked':
      return 4
    case 'running':
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
