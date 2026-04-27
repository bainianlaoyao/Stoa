import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { EntireStoaCheckpointExport, EvolverStoaRunResult } from '@shared/direct-memory'
import { buildPublishedContext } from './published-context-builder'

describe('buildPublishedContext', () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'stoa-published-context-'))
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  test('builds hook-consumable provider publication from Entire checkpoint refs plus Evolver artifacts', async () => {
    const scopedEvolutionDir = join(repoRoot, '.stoa', 'direct-memory', 'run_1', 'memory', 'evolution', 'scopes', 'provider-session-1')
    const scopedAssetsDir = join(repoRoot, '.stoa', 'direct-memory', 'run_1', 'assets', 'gep', 'scopes', 'provider-session-1')
    await mkdir(scopedEvolutionDir, { recursive: true })
    await mkdir(scopedAssetsDir, { recursive: true })
    await writeFile(join(scopedEvolutionDir, 'stoa-evolver-run.stdout.log'), 'Generated prompt\nLine 2\n')
    await writeFile(join(scopedEvolutionDir, 'memory_graph.jsonl'), '{"type":"MemoryGraphEvent"}\n')
    await writeFile(join(scopedEvolutionDir, 'evolution_solidify_state.json'), '{"last_run":{"run_id":"run_1"}}\n')
    await writeFile(join(scopedAssetsDir, 'genes.json'), '[]')
    await writeFile(join(scopedAssetsDir, 'events.jsonl'), '')

    const checkpoint: EntireStoaCheckpointExport = {
      checkpoint_id: 'chk_1',
      checkpoint_format_version: 'v1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: 'source-sha',
      root_metadata_ref: '.entire/checkpoints/chk_1/metadata.json',
      sessions: [{
        session_id: 'provider-session-1',
        agent: 'codex',
        model: 'gpt-5',
        turn_id: 'turn-1',
        metadata_ref: '.entire/checkpoints/chk_1/sessions/provider-session-1/metadata.json',
        transcript_ref: '.entire/checkpoints/chk_1/sessions/provider-session-1/transcript.jsonl',
        transcript_text: '{"type":"item.added"}\n',
        prompt_ref: null,
        prompt_text: null,
        summary: 'Use uv instead of pip for Python package management.',
        initial_attribution: null
      }],
      token_usage: null,
      combined_attribution: null
    }

    const run: EvolverStoaRunResult = {
      ok: true,
      run_id: 'run_1',
      repo_root: join(repoRoot, '.stoa', 'direct-memory', 'worktrees', 'run_1'),
      memory_dir: join(repoRoot, '.stoa', 'direct-memory', 'run_1', 'memory'),
      evolution_dir: scopedEvolutionDir,
      gep_assets_dir: scopedAssetsDir,
      session_scope: 'provider-session-1',
      selected_gene_id: 'gene_uv',
      signals: ['tooling_preference'],
      review_status: 'pending',
      exit_code: 0,
      artifact_refs: {
        review_state_ref: join(scopedEvolutionDir, 'evolution_solidify_state.json'),
        genes_ref: join(scopedAssetsDir, 'genes.json'),
        genes_jsonl_ref: null,
        capsules_ref: null,
        capsules_jsonl_ref: null,
        events_ref: join(scopedAssetsDir, 'events.jsonl'),
        candidates_ref: null,
        external_candidates_ref: null,
        failed_capsules_ref: null,
        memory_graph_ref: join(scopedEvolutionDir, 'memory_graph.jsonl'),
        stdout_ref: join(scopedEvolutionDir, 'stoa-evolver-run.stdout.log'),
        stderr_ref: null
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

    const published = await buildPublishedContext({
      checkpoint,
      run,
      repoRoot,
      target: 'codex'
    })

    expect(published).toMatchObject({
      ok: true,
      target: 'codex',
      format: 'jsonl',
      run_id: 'run_1',
      source_checkpoint_id: 'chk_1'
    })
    expect(published.source_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'checkpoint_root', ref: '.entire/checkpoints/chk_1/metadata.json' }),
      expect.objectContaining({ kind: 'memory_graph', ref: '.stoa/direct-memory/run_1/memory/evolution/scopes/provider-session-1/memory_graph.jsonl' }),
      expect.objectContaining({ kind: 'gene', ref: '.stoa/direct-memory/run_1/assets/gep/scopes/provider-session-1/genes.json' }),
      expect.objectContaining({ kind: 'stdout', ref: '.stoa/direct-memory/run_1/memory/evolution/scopes/provider-session-1/stoa-evolver-run.stdout.log' })
    ]))
    const lines = published.content.trim().split('\n').map((line) => JSON.parse(line) as {
      outcome?: { note?: string; status?: string }
      signals?: string[]
    })
    expect(lines).toEqual([
      expect.objectContaining({
        signals: ['tooling_preference'],
        outcome: expect.objectContaining({
          status: 'success',
          note: expect.stringContaining('Use uv instead of pip')
        })
      })
    ])
  })

  test('builds empty native memory publication when scoped memory graph is missing', async () => {
    const checkpoint: EntireStoaCheckpointExport = {
      checkpoint_id: 'chk_2',
      checkpoint_format_version: 'v1',
      checkpoint_metadata_commit_sha: 'meta-sha',
      source_worktree_commit_sha: null,
      root_metadata_ref: '.entire/checkpoints/chk_2/metadata.json',
      sessions: [],
      token_usage: null,
      combined_attribution: null
    }

    const run: EvolverStoaRunResult = {
      ok: true,
      run_id: 'run_2',
      repo_root: join(repoRoot, '.stoa', 'direct-memory', 'worktrees', 'run_2'),
      memory_dir: join(repoRoot, '.stoa', 'direct-memory', 'run_2', 'memory'),
      evolution_dir: join(repoRoot, '.stoa', 'direct-memory', 'run_2', 'memory', 'evolution'),
      gep_assets_dir: join(repoRoot, '.stoa', 'direct-memory', 'run_2', 'assets', 'gep'),
      session_scope: 'provider-session-2',
      selected_gene_id: null,
      signals: [],
      review_status: 'none',
      exit_code: 0,
      artifact_refs: {
        review_state_ref: null,
        genes_ref: null,
        genes_jsonl_ref: null,
        capsules_ref: null,
        capsules_jsonl_ref: null,
        events_ref: null,
        candidates_ref: null,
        external_candidates_ref: null,
        failed_capsules_ref: null,
        memory_graph_ref: null,
        stdout_ref: join(repoRoot, '.stoa', 'direct-memory', 'run_2', 'memory', 'evolution', 'stoa-evolver-run.stdout.log'),
        stderr_ref: null
      },
      bridge: {
        project_id: 'project_1',
        stoa_session_id: 'session_2',
        provider_session_id: 'provider-session-2',
        source_checkpoint_id: 'chk_2',
        checkpoint_metadata_commit_sha: 'meta-sha',
        source_worktree_commit_sha: null
      },
      error: null
    }

    const published = await buildPublishedContext({
      checkpoint,
      run,
      repoRoot,
      target: 'generic'
    })

    expect(published.format).toBe('jsonl')
    expect(published.content).toBe('')
    expect(published.source_refs).toEqual([
      {
        kind: 'checkpoint_root',
        id: 'chk_2:root-metadata',
        ref: '.entire/checkpoints/chk_2/metadata.json',
        score: null,
        reason: 'Entire checkpoint root metadata.'
      }
    ])
  })
})
