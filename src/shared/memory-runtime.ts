export type MemoryRuntimeEvidenceProvider = 'claude-code' | 'codex'
export type MemoryRuntimeEvidenceChannel = 'hook' | 'notify'
export type MemoryRuntimeConsumer = MemoryRuntimeEvidenceProvider | 'opencode' | 'generic'
export type MemoryRuntimeDeliveryState = 'pending' | 'published' | 'failed'
export type SemanticSessionOutcome = 'success' | 'failure' | 'mixed' | 'unknown'
export type EvolverReviewStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'failed'
export type EvolverPublishedContextTarget = Extract<MemoryRuntimeConsumer, 'claude-code' | 'codex' | 'generic'>
export type EvolverPublishedContextFormat = 'jsonl'

export interface EvolverRunBridgeRefs {
  project_id: string | null
  stoa_session_id: string | null
  provider_session_id: string | null
}

export interface EvolverArtifactRefs {
  review_state_ref: string | null
  genes_ref: string | null
  genes_jsonl_ref: string | null
  capsules_ref: string | null
  capsules_jsonl_ref: string | null
  events_ref: string | null
  candidates_ref: string | null
  external_candidates_ref: string | null
  failed_capsules_ref: string | null
  memory_graph_ref: string | null
  stdout_ref: string | null
  stderr_ref: string | null
}

export interface EvolverRunResult {
  ok: boolean
  run_id: string
  repo_root: string
  memory_dir: string
  evolution_dir: string
  gep_assets_dir: string
  session_scope: string
  selected_gene_id: string | null
  signals: string[]
  review_status: EvolverReviewStatus
  exit_code: number
  artifact_refs: EvolverArtifactRefs
  bridge: EvolverRunBridgeRefs | null
  error: string | null
}

export interface EvolverReviewState {
  ok: boolean
  status: EvolverReviewStatus
  run_id: string | null
  selected_gene_id: string | null
  signals: string[]
  mutation_id: string | null
  review_state_ref: string | null
  diff_ref: string | null
  validation_report_ref: string | null
  bridge: EvolverRunBridgeRefs | null
  error: string | null
}

export interface EvolverReviewExport {
  ok: boolean
  review: EvolverReviewState
  gene: Record<string, unknown> | null
  mutation: Record<string, unknown> | null
  diff: string
  error: string | null
}

export interface PublishedContextSourceRef {
  kind:
    | 'gene'
    | 'capsule'
    | 'event_log'
    | 'failed_capsules'
    | 'memory_graph'
    | 'review_state'
    | 'stdout'
    | 'stderr'
  id: string
  ref: string
  score: number | null
  reason: string
}

export interface EvolverPublishedContext {
  ok: boolean
  target: EvolverPublishedContextTarget
  format: EvolverPublishedContextFormat
  run_id: string | null
  source_refs: PublishedContextSourceRef[]
  content: string
  metadata: {
    generated_at: string
    token_budget: number | null
    selection_policy: string
  }
  bridge: EvolverRunBridgeRefs | null
  error: string | null
}

export interface EvolverDistillationPrepareResult {
  ok: boolean
  reason: string | null
  prompt_path: string | null
  request_path: string | null
  input_capsule_count: number | null
  error: string | null
}

export interface EvolverDistillationCompleteResult {
  ok: boolean
  reason: string | null
  gene_id: string | null
  gene: Record<string, unknown> | null
  error: string | null
}

export interface SemanticSessionSummary {
  summary: string
  outcome: SemanticSessionOutcome
  lessons: string[]
}

export interface ReviewDecision {
  decision: 'approve' | 'reject'
  summary: string
  concerns: string[]
}

export interface DistillationResponse {
  responseText: string
}

export interface MemoryRuntimeEvidenceRawSource {
  provider: MemoryRuntimeEvidenceProvider
  channel: MemoryRuntimeEvidenceChannel
  rawEventName: string
}

export interface MemoryRuntimeEvidence {
  rawSource: MemoryRuntimeEvidenceRawSource
  hookEventName?: string
  providerSessionId?: string
  turnId?: string
  transcriptPath?: string
  lastAssistantMessage?: string
  promptText?: string
  inputMessages?: string[]
  toolName?: string
  toolUseId?: string
  cwd?: string
  model?: string
}

export interface MemoryRuntimeSessionProgress {
  projectId: string
  stoaSessionId: string
  lastProcessedEvidenceKey: string
  updatedAt: string
}

export interface MemoryRunRecord {
  projectId: string
  stoaSessionId: string
  providerSessionId: string | null
  runId: string
  worktreePath: string
  memoryDir: string
  evolutionDir: string
  gepAssetsDir: string
  reviewStateRef: string | null
  reviewStatus: EvolverReviewStatus
  lastError: string | null
  updatedAt: string
}

export interface PublishedMemoryRecord {
  projectId: string
  stoaSessionId: string
  consumer: MemoryRuntimeConsumer
  deliveryState: MemoryRuntimeDeliveryState
  runId: string | null
  publishedHash: string | null
  updatedAt: string
}
