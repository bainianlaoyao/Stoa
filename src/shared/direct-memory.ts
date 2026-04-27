import type { SessionType } from './project-session'

export type DirectMemoryProviderType = Extract<SessionType, 'claude-code' | 'codex' | 'opencode'>
export type PublishedContextTarget = DirectMemoryProviderType | 'generic'
export type PublishedContextFormat = 'jsonl'

export interface EntireStoaCheckpointRef {
  checkpoint_id: string
  checkpoint_format_version: 'v1'
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
  session_ids: string[]
  latest_session_id: string | null
  agent: DirectMemoryProviderType | string
  model: string | null
  summary: string | null
  created_at: string | null
  updated_at: string | null
}

export interface EntireStoaCheckpointExport {
  checkpoint_id: string
  checkpoint_format_version: 'v1'
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
  root_metadata_ref: string
  sessions: EntireStoaSessionExport[]
  token_usage: unknown
  combined_attribution: unknown
}

export interface EntireStoaSessionExport {
  session_id: string
  agent: string
  model: string | null
  turn_id: string | null
  metadata_ref: string
  transcript_ref: string | null
  transcript_text: string | null
  prompt_ref: string | null
  prompt_text: string | null
  summary: string | null
  initial_attribution: unknown
}

export interface EvolverBridgeRefs {
  project_id: string
  stoa_session_id: string
  provider_session_id: string
  source_checkpoint_id: string
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
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

export interface EvolverStoaRunResult {
  ok: boolean
  run_id: string
  repo_root: string
  memory_dir: string
  evolution_dir: string
  gep_assets_dir: string
  session_scope: string
  selected_gene_id: string | null
  signals: string[]
  review_status: 'none' | 'pending' | 'approved' | 'rejected' | 'failed'
  exit_code: number
  artifact_refs: EvolverArtifactRefs
  bridge: EvolverBridgeRefs
  error: string | null
}

export interface EvolverStoaReviewState {
  ok: boolean
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'failed'
  run_id: string | null
  selected_gene_id: string | null
  signals: string[]
  mutation_id: string | null
  review_state_ref: string
  diff_ref: string | null
  validation_report_ref: string | null
  bridge: EvolverBridgeRefs | null
  error: string | null
}

export interface PublishedContextSourceRef {
  kind:
    | 'checkpoint_root'
    | 'checkpoint_session'
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
  target: PublishedContextTarget
  format: PublishedContextFormat
  run_id: string | null
  source_checkpoint_id: string | null
  source_refs: PublishedContextSourceRef[]
  content: string
  metadata: {
    generated_at: string
    token_budget: number | null
    selection_policy: string
  }
  bridge: EvolverBridgeRefs | null
  error: string | null
}

export interface MemoryEvolutionBridgeRef {
  projectId: string
  stoaSessionId: string
  providerSessionId: string
  providerType: DirectMemoryProviderType
  repoRoot: string
  entireCheckpointId: string
  entireCheckpointMetadataCommitSha: string
  entireSourceWorktreeCommitSha: string | null
  evolverRunId: string | null
  evolverWorktreePath: string | null
  evolverMemoryDir: string | null
  evolverEvolutionDir: string | null
  evolverGepAssetsDir: string | null
  evolverReviewStateRef: string | null
  lastPublishedContextTarget: PublishedContextTarget | null
  lastPublishedContextHash: string | null
  createdAt: string
  updatedAt: string
}
