import { describe, expect, test, vi } from 'vitest'
import type {
  EvolverDistillationPrepareResult,
  EvolverPublishedContext,
  EvolverReviewExport,
  EvolverReviewState,
  EvolverRunResult
} from '@shared/memory-runtime'
import { EvolverClient } from './evolver-client'

describe('EvolverClient', () => {
  test('runs Evolver with path controls and runtime bridge refs', async () => {
    const result: EvolverRunResult = {
      ok: true,
      run_id: 'run_1',
      repo_root: 'C:/repo/.stoa/memory/worktrees/run_1',
      memory_dir: 'C:/repo/.stoa/memory/runs/run_1/memory',
      evolution_dir: 'C:/repo/.stoa/memory/runs/run_1/memory/evolution',
      gep_assets_dir: 'C:/repo/.stoa/memory/runs/run_1/assets/gep',
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
        memory_graph_ref: 'memory_graph.jsonl',
        stdout_ref: 'stdout.log',
        stderr_ref: 'stderr.log'
      },
      bridge: {
        project_id: 'project_1',
        stoa_session_id: 'session_1',
        provider_session_id: 'provider-session-1'
      },
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
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      repoRoot: 'C:/repo/.stoa/memory/worktrees/run_1',
      memoryDir: 'C:/repo/.stoa/memory/runs/run_1/memory',
      evolutionDir: 'C:/repo/.stoa/memory/runs/run_1/memory/evolution',
      gepAssetsDir: 'C:/repo/.stoa/memory/runs/run_1/assets/gep',
      sessionScope: 'provider-session-1'
    })).resolves.toEqual(result)

    expect(runner).toHaveBeenCalledWith({
      command: 'node',
      args: ['index.js', 'run', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({
        EVOLVER_QUIET_PARENT_GIT: 'true',
        EVOLVER_REPO_ROOT: 'C:/repo/.stoa/memory/worktrees/run_1',
        MEMORY_DIR: 'C:/repo/.stoa/memory/runs/run_1/memory',
        EVOLUTION_DIR: 'C:/repo/.stoa/memory/runs/run_1/memory/evolution',
        GEP_ASSETS_DIR: 'C:/repo/.stoa/memory/runs/run_1/assets/gep',
        EVOLVER_SESSION_SCOPE: 'provider-session-1',
        STOA_PROJECT_ID: 'project_1',
        STOA_SESSION_ID: 'session_1',
        STOA_PROVIDER_SESSION_ID: 'provider-session-1'
      })
    })

    const env = runner.mock.calls[0]?.[0]?.env as Record<string, unknown>
    expect(env.STOA_SOURCE_CHECKPOINT_ID).toBeUndefined()
    expect(env.STOA_CHECKPOINT_METADATA_COMMIT_SHA).toBeUndefined()
    expect(env.STOA_SOURCE_WORKTREE_COMMIT_SHA).toBeUndefined()
  })

  test('delegates review and review export commands', async () => {
    const review: EvolverReviewState = {
      ok: true,
      status: 'pending',
      run_id: 'run_1',
      selected_gene_id: 'gene_1',
      signals: ['test_failure'],
      mutation_id: 'mut_1',
      review_state_ref: 'state.json',
      diff_ref: 'review.diff',
      validation_report_ref: 'validation.json',
      bridge: {
        project_id: 'project_1',
        stoa_session_id: 'session_1',
        provider_session_id: 'provider-session-1'
      },
      error: null
    }
    const exportPayload: EvolverReviewExport = {
      ok: true,
      review,
      gene: {
        id: 'gene_1',
        category: 'repair',
        summary: 'Tighten validation',
        strategy: ['Run focused validation']
      },
      mutation: {
        id: 'mut_1',
        category: 'repair',
        risk_level: 'low'
      },
      diff: 'diff --git a/a b/a',
      error: null
    }
    const runner = vi.fn()
      .mockResolvedValueOnce(review)
      .mockResolvedValueOnce(exportPayload)
      .mockResolvedValueOnce({ ...review, status: 'approved' })
      .mockResolvedValueOnce({ ...review, status: 'rejected' })
    const client = new EvolverClient({ command: 'evolver', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.review()).resolves.toEqual(review)
    await expect(client.exportReview()).resolves.toEqual(exportPayload)
    await expect(client.approveReview()).resolves.toMatchObject({ status: 'approved' })
    await expect(client.rejectReview()).resolves.toMatchObject({ status: 'rejected' })

    expect(runner).toHaveBeenNthCalledWith(1, {
      command: 'evolver',
      args: ['review', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
    expect(runner).toHaveBeenNthCalledWith(2, {
      command: 'evolver',
      args: ['review', '--export', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
    expect(runner).toHaveBeenNthCalledWith(3, {
      command: 'evolver',
      args: ['review', '--approve', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
    expect(runner).toHaveBeenNthCalledWith(4, {
      command: 'evolver',
      args: ['review', '--reject', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
  })

  test('delegates distillation prepare and complete commands', async () => {
    const prepare: EvolverDistillationPrepareResult = {
      ok: true,
      reason: null,
      prompt_path: 'C:/repo/memory/evolution/distill_prompt.md',
      request_path: 'C:/repo/memory/evolution/distill_request.json',
      input_capsule_count: 12,
      error: null
    }
    const runner = vi.fn()
      .mockResolvedValueOnce(prepare)
      .mockResolvedValueOnce({
        ok: true,
        reason: null,
        gene_id: 'gene_distilled_1',
        gene: { id: 'gene_distilled_1', category: 'repair' },
        error: null
      })
    const client = new EvolverClient({ command: 'evolver', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.prepareDistillation()).resolves.toEqual(prepare)
    await expect(client.completeDistillation('C:/repo/tmp/response.json')).resolves.toMatchObject({
      ok: true,
      gene_id: 'gene_distilled_1',
      gene: { id: 'gene_distilled_1' }
    })

    expect(runner).toHaveBeenNthCalledWith(1, {
      command: 'evolver',
      args: ['distill', '--prepare', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
    expect(runner).toHaveBeenNthCalledWith(2, {
      command: 'evolver',
      args: ['distill', '--complete', '--response-file=C:/repo/tmp/response.json', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
  })

  test('delegates publish-context command', async () => {
    const published: EvolverPublishedContext = {
      ok: true,
      target: 'claude-code',
      format: 'jsonl',
      run_id: 'run_1',
      source_refs: [],
      content: '{"type":"MemoryGraphEvent"}\n',
      metadata: {
        generated_at: '2026-04-28T00:00:00.000Z',
        token_budget: null,
        selection_policy: 'claude-code-memory-graph-v1'
      },
      bridge: {
        project_id: 'project_1',
        stoa_session_id: 'session_1',
        provider_session_id: 'provider-session-1'
      },
      error: null
    }
    const runner = vi.fn().mockResolvedValue(published)
    const client = new EvolverClient({ command: 'evolver', cwd: 'C:/repo', runJsonCommand: runner })

    await expect(client.publishContext('claude-code')).resolves.toEqual(published)

    expect(runner).toHaveBeenCalledWith({
      command: 'evolver',
      args: ['publish-context', '--target=claude-code', '--json'],
      cwd: 'C:/repo',
      env: expect.objectContaining({ EVOLVER_QUIET_PARENT_GIT: 'true' })
    })
  })
})
