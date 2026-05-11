export type MetaSessionCapabilityLevel = 0 | 1 | 2 | 3
export type MetaSessionBackendSessionType = 'claude-code' | 'codex' | 'opencode'

export type MetaSessionStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'idle'
  | 'failed'
  | 'closed'

export interface MetaSessionSummary {
  id: string
  title: string
  status: MetaSessionStatus
  backendSessionType: MetaSessionBackendSessionType
  capabilityLevel: MetaSessionCapabilityLevel
  pendingProposalCount: number
  activeTargetCount: number
  lastSummary: string
  lastRisk: string | null
  backendSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
  archived: boolean
}

export interface PersistedMetaSession {
  session_id: string
  title: string
  status: MetaSessionStatus
  backend_session_type: MetaSessionBackendSessionType
  capability_level: MetaSessionCapabilityLevel
  pending_proposal_count: number
  active_target_count: number
  last_summary: string
  last_risk: string | null
  backend_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  archived: boolean
}

export type MetaSessionProposalKind = 'prompt'

export type MetaSessionProposalStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'stale'

export interface MetaSessionProposalSnapshotSession {
  sessionId: string
  lastStateSequence: number
  turnEpoch: number
  updatedAt: string
}

export interface MetaSessionProposalSnapshot {
  sessions: MetaSessionProposalSnapshotSession[]
}

export interface PersistedMetaSessionProposalSnapshotSession {
  session_id: string
  last_state_sequence: number
  turn_epoch: number
  updated_at: string
}

export interface PersistedMetaSessionProposalSnapshot {
  sessions: PersistedMetaSessionProposalSnapshotSession[]
}

export interface MetaSessionProposal {
  id: string
  metaSessionId: string
  kind: MetaSessionProposalKind
  targetSessionIds: string[]
  riskLevel: MetaSessionCapabilityLevel
  status: MetaSessionProposalStatus
  summary: string
  reason: string
  promptText: string | null
  presetName: string | null
  snapshot: MetaSessionProposalSnapshot
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  rejectedAt: string | null
  executedAt: string | null
  executionResult: string | null
}

export interface PersistedMetaSessionProposal {
  proposal_id: string
  meta_session_id: string
  kind: MetaSessionProposalKind
  target_session_ids: string[]
  risk_level: MetaSessionCapabilityLevel
  status: MetaSessionProposalStatus
  summary: string
  reason: string
  prompt_text: string | null
  preset_name: string | null
  snapshot: PersistedMetaSessionProposalSnapshot
  created_at: string
  updated_at: string
  approved_at: string | null
  rejected_at: string | null
  executed_at: string | null
  execution_result: string | null
}

export type MetaSessionActionLogAction =
  | 'proposal.created'
  | 'proposal.approved'
  | 'proposal.rejected'
  | 'proposal.executing'
  | 'proposal.completed'
  | 'proposal.failed'
  | 'proposal.stale'

export interface MetaSessionActionLog {
  id: string
  metaSessionId: string
  proposalId: string | null
  action: MetaSessionActionLogAction
  detail: string
  createdAt: string
}

export interface PersistedMetaSessionActionLog {
  action_id: string
  meta_session_id: string
  proposal_id: string | null
  action: MetaSessionActionLogAction
  detail: string
  created_at: string
}

export interface PersistedMetaSessionStateV1 {
  version: 1
  active_meta_session_id: string | null
  sessions: PersistedMetaSession[]
  proposals: PersistedMetaSessionProposal[]
  action_logs: PersistedMetaSessionActionLog[]
  inspector_target: PersistedMetaSessionInspectorTarget | null
}

export interface MetaSessionAppInspectorTarget {
  kind: 'app'
}

export interface MetaSessionWorkSessionInspectorTarget {
  kind: 'work-session'
  sessionId: string
}

export interface MetaSessionProposalInspectorTarget {
  kind: 'proposal'
  proposalId: string
}

export type MetaSessionInspectorTarget =
  | MetaSessionAppInspectorTarget
  | MetaSessionWorkSessionInspectorTarget
  | MetaSessionProposalInspectorTarget

export type PersistedMetaSessionInspectorTarget = MetaSessionInspectorTarget

export interface MetaSessionBootstrapState {
  activeMetaSessionId: string | null
  sessions: MetaSessionSummary[]
  inspectorTarget: MetaSessionInspectorTarget | null
}

export interface CreateMetaSessionRequest {
  title: string
  backendSessionType: MetaSessionBackendSessionType
  capabilityLevel: MetaSessionCapabilityLevel
}

export interface MetaSessionSnapshot extends MetaSessionBootstrapState {}

export interface MetaSessionEvent {
  session: MetaSessionSummary
}

export interface MetaSessionBootstrapRecoveryEntry {
  sessionId: string
  backendSessionId: string
}
