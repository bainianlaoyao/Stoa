import { describe, expect, test, vi } from 'vitest'
import { EvolverClient } from './evolver-client'
import type {
  EvolverBridgeRefs,
  EvolverStoaReviewState,
  EvolverStoaRunResult
} from '@shared/direct-memory'

const bridge: EvolverBridgeRefs = {
  project_id: 'project_1',
  stoa_session_id: 'session_1',
  provider_session_id: 'provider-session-1',
  source_checkpoint_id: 'chk_1',
  checkpoint_metadata_commit_sha: 'meta-sha',
  source_worktree_commit_sha: 'source-sha'
}

describe('EvolverClient', () => {
  test('runs Evolver with path controls and bridge refs', async () => {
    const result: EvolverStoaRunResult = {
      ok: true,
      run_id: 'run_1',
      repo_root: 'C:/repo/.stoa/worktrees/run_1',
      memory_dir: 'C:/repo/.stoa/direct-memory/run_1/memory',
      evolution_dir: 'C:/repo/.stoa/direct-memory/run_1/evolution',
      gep_assets_dir: 'C:/repo/.stoa/direct-memory/run_1/assets/gep',
      session_scope: 'provider-session-1',
      selected_gene_id: null,
      signals: [],
      review_status: 'none',
      exit_code: 0,
      artifact_refs: {
        review_state_ref: null,
        genes_ref: 'genes.json',
        genes_jsonl_ref: 'genes.jsonl',
        capsules_ref: 'capsules.json',
        capsules_jsonl_ref: 'capsules.jsonl',
        events_ref: 'events.jsonl',
        candidates_ref: 'candidates.jsonl',
        external_candidates_ref: 'external_candidates.jsonl',
        failed_capsules_ref: 'failed_capsules.json',
        memory_graph_ref: null,
        stdout_ref: 'stdout.log',
        stderr_ref: 'stderr.log'
      },
      bridge,
      error: null
    }
    const runner = vi.fn().mockResolvedValue(result)
    const client = new EvolverClient({
      command: 'node',
      cwd: 'C:/repo',
      argsPrefix: ['index.js'],
      runJsonCommand: runner
    })

    await expect(client.run({
      bridge,
      repoRoot: 'C:/worktree',
      memoryDir: 'C:/memory',
      evolutionDir: 'C:/evolution',
      gepAssetsDir: 'C:/assets',
      sessionScope: 'provider-session-1'
    })).resolves.toEqual(result)

    expect(runner).toHaveBeenCalledWith({
      command: 'node',
      args: ['index.js', 'run', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({
        EVOLVER_REPO_ROOT: 'C:/worktree',
        MEMORY_DIR: 'C:/memory',
        EVOLUTION_DIR: 'C:/evolution',
        GEP_ASSETS_DIR: 'C:/assets',
        EVOLVER_SESSION_SCOPE: 'provider-session-1',
        STOA_PROJECT_ID: 'project_1',
        STOA_SESSION_ID: 'session_1',
        STOA_PROVIDER_SESSION_ID: 'provider-session-1',
        STOA_SOURCE_CHECKPOINT_ID: 'chk_1',
        STOA_CHECKPOINT_METADATA_COMMIT_SHA: 'meta-sha',
        STOA_SOURCE_WORKTREE_COMMIT_SHA: 'source-sha'
      })
    })
  })

  test('delegates review commands', async () => {
    const review: EvolverStoaReviewState = {
      ok: true,
      status: 'pending',
      run_id: 'run_1',
      selected_gene_id: 'gene_1',
      signals: ['test_failure'],
      mutation_id: 'mut_1',
      review_state_ref: 'state.json',
      diff_ref: null,
      validation_report_ref: null,
      bridge,
      error: null
    }
    const runner = vi.fn()
      .mockResolvedValueOnce(review)
      .mockResolvedValueOnce({ ...review, status: 'approved' })
      .mockResolvedValueOnce({ ...review, status: 'rejected' })
    const client = new EvolverClient({ command: 'evolver', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.review()).resolves.toEqual(review)
    await expect(client.approveReview()).resolves.toMatchObject({ status: 'approved' })
    await expect(client.rejectReview()).resolves.toMatchObject({ status: 'rejected' })

    expect(runner).toHaveBeenNthCalledWith(1, { command: 'evolver', args: ['review', '--json'], cwd: 'C:/repo' })
    expect(runner).toHaveBeenNthCalledWith(2, { command: 'evolver', args: ['review', '--approve', '--json'], cwd: 'C:/repo' })
    expect(runner).toHaveBeenNthCalledWith(3, { command: 'evolver', args: ['review', '--reject', '--json'], cwd: 'C:/repo' })
  })
})
