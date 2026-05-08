export type HermesCapabilityLevel = 0 | 1 | 2 | 3

export type HermesSessionStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'idle'
  | 'failed'
  | 'closed'

export interface HermesSessionSummary {
  id: string
  title: string
  status: HermesSessionStatus
  capabilityLevel: HermesCapabilityLevel
  pendingProposalCount: number
  activeTargetCount: number
  lastSummary: string
  lastRisk: string | null
  resumeSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
}

export interface PersistedHermesSession {
  session_id: string
  title: string
  status: HermesSessionStatus
  capability_level: HermesCapabilityLevel
  pending_proposal_count: number
  active_target_count: number
  last_summary: string
  last_risk: string | null
  resume_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
}

export type HermesProposalKind = 'prompt'

export type HermesProposalStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'stale'

export interface HermesProposalSnapshotSession {
  sessionId: string
  lastStateSequence: number
  turnEpoch: number
  updatedAt: string
}

export interface HermesProposalSnapshot {
  sessions: HermesProposalSnapshotSession[]
}

export interface PersistedHermesProposalSnapshotSession {
  session_id: string
  last_state_sequence: number
  turn_epoch: number
  updated_at: string
}

export interface PersistedHermesProposalSnapshot {
  sessions: PersistedHermesProposalSnapshotSession[]
}

export interface HermesProposal {
  id: string
  hermesSessionId: string
  kind: HermesProposalKind
  targetSessionIds: string[]
  riskLevel: HermesCapabilityLevel
  status: HermesProposalStatus
  summary: string
  reason: string
  promptText: string | null
  presetName: string | null
  snapshot: HermesProposalSnapshot
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  rejectedAt: string | null
  executedAt: string | null
  executionResult: string | null
}

export interface PersistedHermesProposal {
  proposal_id: string
  hermes_session_id: string
  kind: HermesProposalKind
  target_session_ids: string[]
  risk_level: HermesCapabilityLevel
  status: HermesProposalStatus
  summary: string
  reason: string
  prompt_text: string | null
  preset_name: string | null
  snapshot: PersistedHermesProposalSnapshot
  created_at: string
  updated_at: string
  approved_at: string | null
  rejected_at: string | null
  executed_at: string | null
  execution_result: string | null
}

export type HermesActionLogAction =
  | 'proposal.created'
  | 'proposal.approved'
  | 'proposal.rejected'
  | 'proposal.executing'
  | 'proposal.completed'
  | 'proposal.failed'
  | 'proposal.stale'

export interface HermesActionLog {
  id: string
  hermesSessionId: string
  proposalId: string | null
  action: HermesActionLogAction
  detail: string
  createdAt: string
}

export interface PersistedHermesActionLog {
  action_id: string
  hermes_session_id: string
  proposal_id: string | null
  action: HermesActionLogAction
  detail: string
  created_at: string
}

export interface PersistedHermesStateV1 {
  version: 1
  active_hermes_session_id: string | null
  sessions: PersistedHermesSession[]
  proposals: PersistedHermesProposal[]
  action_logs: PersistedHermesActionLog[]
  inspector_target: PersistedHermesInspectorTarget | null
}

export interface HermesAppInspectorTarget {
  kind: 'app'
}

export interface HermesWorkSessionInspectorTarget {
  kind: 'work-session'
  sessionId: string
}

export interface HermesProposalInspectorTarget {
  kind: 'proposal'
  proposalId: string
}

export type HermesInspectorTarget =
  | HermesAppInspectorTarget
  | HermesWorkSessionInspectorTarget
  | HermesProposalInspectorTarget

export type PersistedHermesInspectorTarget = HermesInspectorTarget

export interface HermesBootstrapState {
  activeHermesSessionId: string | null
  sessions: HermesSessionSummary[]
  inspectorTarget: HermesInspectorTarget | null
}

export interface CreateHermesSessionRequest {
  title: string
  capabilityLevel: HermesCapabilityLevel
}

export interface HermesSnapshot extends HermesBootstrapState {}

export interface HermesSessionEvent {
  session: HermesSessionSummary
}

export interface HermesBootstrapRecoveryEntry {
  sessionId: string
  resumeSessionId: string
}
