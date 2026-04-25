import type { SessionAgentState, SessionRuntimeState } from './project-session'

export type ObservationScope = 'session' | 'project' | 'app'
export type ObservationCategory = 'lifecycle' | 'presence' | 'evidence' | 'activity' | 'system'
export type ObservationSeverity = 'info' | 'attention' | 'warning' | 'error'
export type ObservationRetention = 'critical' | 'operational' | 'ephemeral'
export type ObservationSource = 'hook-sidecar' | 'provider-adapter' | 'system-recovery' | 'runtime-controller'

export interface ObservationEvent {
  eventId: string
  eventVersion: 1
  sequence: number
  occurredAt: string
  ingestedAt: string
  scope: ObservationScope
  projectId: string | null
  sessionId: string | null
  providerId: string | null
  category: ObservationCategory
  type: string
  severity: ObservationSeverity
  retention: ObservationRetention
  source: ObservationSource
  correlationId: string | null
  dedupeKey: string | null
  payload: Record<string, unknown>
}

export type SessionPresencePhase = 'preparing' | 'ready' | 'running' | 'complete' | 'blocked' | 'failed' | 'exited'
export type ObservabilityConfidence = 'authoritative' | 'provisional' | 'stale'
export type ObservabilityHealth = 'healthy' | 'degraded' | 'lost'
export type BlockingReason = 'permission' | 'elicitation' | 'resume-confirmation' | 'provider-error'
export type RecoveryPointerState = 'trusted' | 'suspect' | 'missing'
export type ObservabilityTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface SessionRuntimeSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  runtimeAttached: boolean
  externalSessionId: string | null
  recoveryPointerState: RecoveryPointerState
  lastEventAt: string
  updatedAt: string
}

export interface SessionPresenceSnapshot {
  [extra: string]: unknown
  sessionId: string
  projectId: string
  providerId: string
  providerLabel: string
  modelLabel: string | null
  phase: SessionPresencePhase
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  confidence: ObservabilityConfidence
  health: ObservabilityHealth
  blockingReason: BlockingReason | null
  lastAssistantSnippet: string | null
  lastEventAt: string
  lastEvidenceType: string | null
  hasUnreadTurn: boolean
  recoveryPointerState: RecoveryPointerState
  evidenceSequence: number
  sourceSequence: number
  updatedAt: string
}

export interface ProjectObservabilitySnapshot {
  projectId: string
  overallHealth: ObservabilityHealth
  activeSessionCount: number
  blockedSessionCount: number
  degradedSessionCount: number
  failedSessionCount: number
  unreadTurnCount: number
  latestAttentionSessionId: string | null
  latestAttentionReason: string | null
  lastEventAt: string | null
  sourceSequence: number
  updatedAt: string
}

export interface AppObservabilitySnapshot {
  blockedProjectCount: number
  failedProjectCount: number
  degradedProjectCount: number
  totalUnreadTurns: number
  projectsNeedingAttention: string[]
  providerHealthSummary: Record<string, ObservabilityHealth>
  lastGlobalEventAt: string | null
  sourceSequence: number
  updatedAt: string
}

export interface SessionRowViewModel {
  sessionId: string
  title: string
  phase: SessionPresencePhase
  primaryLabel: string
  secondaryLabel: string
  tone: ObservabilityTone
  hasUnreadTurn: boolean
  needsAttention: boolean
  attentionReason: string | null
  updatedAgoLabel: string
}

export interface ActiveSessionViewModel {
  sessionId: string
  title: string
  providerLabel: string
  modelLabel: string | null
  phaseLabel: string
  confidenceLabel: string
  tone: ObservabilityTone
  lastUpdatedLabel: string
  snippet: string | null
  explanation: string | null
}
