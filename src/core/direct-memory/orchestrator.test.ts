import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DirectMemoryOrchestrator } from './orchestrator'
import { DirectMemoryBridgeStore } from './bridge-store'
import type {
  EntireStoaCheckpointExport,
  EvolverPublishedContext,
  EvolverStoaRunResult
} from '@shared/direct-memory'

const tempDirs: string[] = []

function checkpoint(): EntireStoaCheckpointExport {
  return {
    checkpoint_id: 'chk_1',
    checkpoint_format_version: 'v1',
    checkpoint_metadata_commit_sha: 'meta-sha',
    source_worktree_commit_sha: 'source-sha',
    root_metadata_ref: 'metadata.json',
    sessions: [{
      session_id: 'provider-session-1',
      agent: 'codex',
      model: 'gpt',
      turn_id: null,
      metadata_ref: 'session-metadata.json',
      transcript_ref: null,
      transcript_text: null,
      prompt_ref: null,
      prompt_text: null,
      summary: 'checkpoint summary',
      initial_attribution: null
    }],
    token_usage: null,
    combined_attribution: null
  }
}

function runResult(): EvolverStoaRunResult {
  return {
    ok: true,
    run_id: 'run_1',
    repo_root: 'C:/worktree',
    memory_dir: 'C:/memory',
    evolution_dir: 'C:/evolution',
    gep_assets_dir: 'C:/assets',
    session_scope: 'provider-session-1',
    selected_gene_id: 'gene_1',
    signals: ['test_failure'],
    review_status: 'pending',
    exit_code: 0,
    artifact_refs: {
      review_state_ref: 'state.json',
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
      provider_session_id: 'provider-session-1',
      source_checkpoint_id: 'chk_1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: 'source-sha'
    },
    error: null
  }
}

function published(target: 'codex' | 'generic' = 'codex'): EvolverPublishedContext {
  return {
    ok: true,
    target,
    format: 'jsonl',
    run_id: 'run_1',
    source_checkpoint_id: 'chk_1',
    source_refs: [],
    content: target === 'generic'
      ? '{"type":"MemoryGraphEvent","target":"generic"}\n'
      : '{"type":"MemoryGraphEvent","target":"codex"}\n',
    metadata: {
      generated_at: '2026-04-26T00:00:00.000Z',
      token_budget: null,
      selection_policy: 'test'
    },
    bridge: runResult().bridge,
    error: null
  }
}

describe('DirectMemoryOrchestrator', () => {
  let repoRoot: string
  let store: DirectMemoryBridgeStore

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'stoa-direct-memory-orchestrator-'))
    tempDirs.push(repoRoot)
    store = new DirectMemoryBridgeStore(join(repoRoot, '.stoa', 'direct-memory', 'bridge-refs.json'))
  })

  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('runs checkpoint to Evolver to published context happy path', async () => {
    const entire = { exportCheckpoint: vi.fn().mockResolvedValue(checkpoint()) }
    const evolver = {
      run: vi.fn().mockResolvedValue(runResult())
    }
    const createWorktree = vi.fn().mockResolvedValue({ path: join(repoRoot, '.stoa/direct-memory/worktrees/run_1'), sourceWorktreeCommitSha: 'source-sha' })
    const buildPublishedContext = vi.fn().mockResolvedValue(published('codex'))
    const orchestrator = new DirectMemoryOrchestrator({ entire, evolver, store, createWorktree, buildPublishedContext })

    const result = await orchestrator.evolveAndPublish({
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      providerType: 'codex',
      repoRoot,
      checkpointId: 'chk_1',
      target: 'codex'
    })

    expect(entire.exportCheckpoint).toHaveBeenCalledWith('chk_1')
    expect(createWorktree).toHaveBeenCalledWith({
      repoRoot,
      runId: expect.stringMatching(/^chk_1-session_1-/),
      sourceWorktreeCommitSha: 'source-sha'
    })
    expect(evolver.run).toHaveBeenCalledWith(expect.objectContaining({
      bridge: expect.objectContaining({
        project_id: 'project_1',
        source_checkpoint_id: 'chk_1'
      }),
      sessionScope: 'provider-session-1'
    }))
    expect(result.delivery.hash).toMatch(/^sha256:/)
    expect(buildPublishedContext).toHaveBeenCalledWith({
      checkpoint: expect.objectContaining({ checkpoint_id: 'chk_1' }),
      run: expect.objectContaining({ run_id: 'run_1' }),
      repoRoot,
      target: 'codex'
    })
    await expect(readFile(result.delivery.filePath, 'utf-8')).resolves.toBe('{"type":"MemoryGraphEvent","target":"codex"}\n')
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        evolverRunId: 'run_1',
        lastPublishedContextTarget: 'codex',
        lastPublishedContextHash: result.delivery.hash
      })
    ])
  })

  test('stops before Evolver when Entire export fails', async () => {
    const entire = { exportCheckpoint: vi.fn().mockRejectedValue(new Error('no checkpoint')) }
    const evolver = { run: vi.fn() }
    const orchestrator = new DirectMemoryOrchestrator({
      entire,
      evolver,
      store,
      createWorktree: vi.fn()
    })

    await expect(orchestrator.evolveAndPublish({
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      providerType: 'codex',
      repoRoot,
      checkpointId: 'chk_1',
      target: 'codex'
    })).rejects.toThrow('no checkpoint')

    expect(evolver.run).not.toHaveBeenCalled()
  })

  test('persists failed Evolver run refs without publishing', async () => {
    const failedRun = { ...runResult(), ok: false, error: 'mutation failed' }
    const entire = { exportCheckpoint: vi.fn().mockResolvedValue(checkpoint()) }
    const evolver = { run: vi.fn().mockResolvedValue(failedRun) }
    const buildPublishedContext = vi.fn()
    const orchestrator = new DirectMemoryOrchestrator({
      entire,
      evolver,
      store,
      createWorktree: vi.fn().mockResolvedValue({ path: join(repoRoot, 'worktree'), sourceWorktreeCommitSha: 'source-sha' }),
      buildPublishedContext
    })

    await expect(orchestrator.evolveAndPublish({
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      providerType: 'codex',
      repoRoot,
      checkpointId: 'chk_1',
      target: 'codex'
    })).rejects.toThrow('mutation failed')

    expect(buildPublishedContext).not.toHaveBeenCalled()
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        evolverRunId: 'run_1',
        lastPublishedContextTarget: null
      })
    ])
  })
})
