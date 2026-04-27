import { describe, expect, test } from 'vitest'
import type {
  EntireStoaCheckpointExport,
  EvolverPublishedContext,
  EvolverStoaRunResult,
  MemoryEvolutionBridgeRef
} from './direct-memory'

describe('direct memory bridge contracts', () => {
  test('models Entire checkpoint export refs without inline transcript ownership', () => {
    const checkpoint: EntireStoaCheckpointExport = {
      checkpoint_id: 'chk_1',
      checkpoint_format_version: 'v1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: 'source-sha',
      root_metadata_ref: '.entire/checkpoints/chk_1/metadata.json',
      sessions: [
        {
          session_id: 'provider-session-1',
          agent: 'codex',
          model: 'gpt',
          turn_id: 'turn-1',
          metadata_ref: '.entire/checkpoints/chk_1/sessions/provider-session-1/metadata.json',
          transcript_ref: '.entire/checkpoints/chk_1/sessions/provider-session-1/transcript.jsonl',
          transcript_text: '{"type":"item.added"}\n',
          prompt_ref: null,
          prompt_text: null,
          summary: 'implemented feature',
          initial_attribution: { files: 2 }
        }
      ],
      token_usage: { input: 10 },
      combined_attribution: { agent_lines: 12 }
    }

    expect(checkpoint.sessions[0]!.transcript_ref).toContain('transcript')
    expect(checkpoint).not.toHaveProperty('transcript')
  })

  test('models Evolver run and publish outputs as refs plus projection content', () => {
    const run: EvolverStoaRunResult = {
      ok: true,
      run_id: 'run_1',
      repo_root: 'C:/repo/.stoa/worktrees/run_1',
      memory_dir: 'C:/repo/.stoa/direct-memory/run_1/memory',
      evolution_dir: 'C:/repo/.stoa/direct-memory/run_1/memory/evolution',
      gep_assets_dir: 'C:/repo/.stoa/direct-memory/run_1/assets/gep',
      session_scope: 'provider-session-1',
      selected_gene_id: 'gene_1',
      signals: ['test_failure'],
      review_status: 'pending',
      exit_code: 0,
      artifact_refs: {
        review_state_ref: 'memory/evolution/evolution_solidify_state.json',
        genes_ref: 'assets/gep/genes.json',
        genes_jsonl_ref: 'assets/gep/genes.jsonl',
        capsules_ref: 'assets/gep/capsules.json',
        capsules_jsonl_ref: 'assets/gep/capsules.jsonl',
        events_ref: 'assets/gep/events.jsonl',
        candidates_ref: 'assets/gep/candidates.jsonl',
        external_candidates_ref: 'assets/gep/external_candidates.jsonl',
        failed_capsules_ref: 'assets/gep/failed_capsules.json',
        memory_graph_ref: 'memory/evolution/memory_graph.jsonl',
        stdout_ref: 'memory/evolution/stoa-evolver-run.stdout.log',
        stderr_ref: 'memory/evolution/stoa-evolver-run.stderr.log'
      },
      bridge: {
        project_id: 'project_1',
        stoa_session_id: 'session_1',
        provider_session_id: 'provider-session-1',
        source_checkpoint_id: 'chk_1',
        checkpoint_metadata_commit_sha: 'meta-sha',
        source_worktree_commit_sha: 'source-sha'
      },
      error: null
    }

    const published: EvolverPublishedContext = {
      ok: true,
      target: 'codex',
      format: 'jsonl',
      run_id: run.run_id,
      source_checkpoint_id: 'chk_1',
      source_refs: [
        { kind: 'gene', id: 'gene_1', ref: 'assets/gep/genes.json', score: 0.9, reason: 'matched signal' }
      ],
      content: '{"type":"MemoryGraphEvent"}\n',
      metadata: {
        generated_at: '2026-04-26T00:00:00.000Z',
        token_budget: null,
        selection_policy: 'evolver-native-memory-graph-v1'
      },
      bridge: run.bridge,
      error: null
    }

    expect(published.source_refs[0]!.kind).toBe('gene')
    expect(typeof published.content).toBe('string')
  })

  test('models Stoa bridge refs as indexes rather than source memory', () => {
    const ref: MemoryEvolutionBridgeRef = {
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      providerType: 'codex',
      repoRoot: 'C:/repo',
      entireCheckpointId: 'chk_1',
      entireCheckpointMetadataCommitSha: 'meta-sha',
      entireSourceWorktreeCommitSha: 'source-sha',
      evolverRunId: 'run_1',
      evolverWorktreePath: 'C:/repo/.stoa/worktrees/run_1',
      evolverMemoryDir: 'C:/repo/.stoa/direct-memory/run_1/memory',
      evolverEvolutionDir: 'C:/repo/.stoa/direct-memory/run_1/memory/evolution',
      evolverGepAssetsDir: 'C:/repo/.stoa/direct-memory/run_1/assets/gep',
      evolverReviewStateRef: 'memory/evolution/evolution_solidify_state.json',
      lastPublishedContextTarget: 'codex',
      lastPublishedContextHash: 'sha256:abc',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z'
    }

    expect(ref).not.toHaveProperty('genes')
    expect(ref).not.toHaveProperty('memoryGraph')
  })
})
