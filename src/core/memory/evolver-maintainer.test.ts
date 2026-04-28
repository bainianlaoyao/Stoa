import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { EvolverMaintainer } from './evolver-maintainer'
import { RuntimeStateStore } from './runtime-state-store'
import type { SessionEvidenceSnapshot } from './session-evidence-store'

describe('EvolverMaintainer', () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'stoa-evolver-maintainer-'))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  test('summarizes unseen evidence, runs evolver review/distill, and persists runtime state', async () => {
    const evidenceSnapshots = [snapshot({
      eventId: 'evt-1',
      evidenceKey: 'evidence-1',
      providerSessionId: 'provider-session-1',
      payload: {
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop'
      },
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        providerSessionId: 'provider-session-1',
        promptText: 'install a package',
        lastAssistantMessage: 'I used pip.'
      }
    })]
    const summarizeSession = vi.fn().mockResolvedValue({
      summary: 'The user wants Python package work done with uv instead of pip.',
      outcome: 'success',
      lessons: ['Use uv for Python environments and packages.']
    })
    const review = vi.fn().mockResolvedValue({
      decision: 'approve',
      summary: 'This mutation is appropriate.',
      concerns: []
    })
    const distill = vi.fn().mockResolvedValue({
      responseText: '{"type":"Gene","id":"gene_distilled_uv","category":"repair","signals_match":["tooling_preference"],"strategy":["Use uv."],"constraints":{"max_files":5,"forbidden_paths":[".git","node_modules"]}}'
    })
    const run = vi.fn().mockResolvedValue({
      ok: true,
      run_id: 'run-1',
      repo_root: join(projectPath, 'worktree'),
      memory_dir: join(projectPath, '.stoa', 'memory', 'runs', 'run-1', 'memory'),
      evolution_dir: join(projectPath, '.stoa', 'memory', 'runs', 'run-1', 'evolution', 'scopes', 'provider-session-1'),
      gep_assets_dir: join(projectPath, '.stoa', 'memory', 'runs', 'run-1', 'gep-assets', 'scopes', 'provider-session-1'),
      session_scope: 'provider-session-1',
      selected_gene_id: 'gene_uv',
      signals: ['tooling_preference'],
      review_status: 'pending',
      exit_code: 0,
      artifact_refs: {
        review_state_ref: 'review-state.json',
        genes_ref: 'genes.json',
        genes_jsonl_ref: null,
        capsules_ref: null,
        capsules_jsonl_ref: null,
        events_ref: null,
        candidates_ref: null,
        external_candidates_ref: null,
        failed_capsules_ref: null,
        memory_graph_ref: 'memory_graph.jsonl',
        stdout_ref: 'stdout.log',
        stderr_ref: 'stderr.log'
      },
      bridge: {
        project_id: 'project-1',
        stoa_session_id: 'session-1',
        provider_session_id: 'provider-session-1'
      },
      error: null
    })
    const exportReview = vi.fn().mockResolvedValue({
      ok: true,
      review: {
        ok: true,
        status: 'pending',
        run_id: 'run-1',
        selected_gene_id: 'gene_uv',
        signals: ['tooling_preference'],
        mutation_id: 'mutation-1',
        review_state_ref: 'review-state.json',
        diff_ref: 'review.diff',
        validation_report_ref: null,
        bridge: null,
        error: null
      },
      gene: { id: 'gene_uv', strategy: ['Use uv.'] },
      mutation: { id: 'mutation-1' },
      diff: 'diff --git a/pyproject.toml b/pyproject.toml',
      error: null
    })
    const approveReview = vi.fn().mockResolvedValue({
      ok: true,
      status: 'approved',
      run_id: 'run-1',
      selected_gene_id: 'gene_uv',
      signals: ['tooling_preference'],
      mutation_id: 'mutation-1',
      review_state_ref: 'review-state.json',
      diff_ref: 'review.diff',
      validation_report_ref: null,
      bridge: null,
      error: null
    })
    const prepareDistillation = vi.fn().mockResolvedValue({
      ok: true,
      reason: null,
      prompt_path: join(projectPath, 'distill-prompt.md'),
      request_path: join(projectPath, 'distill-request.json'),
      input_capsule_count: 12,
      error: null
    })
    const completeDistillation = vi.fn().mockResolvedValue({
      ok: true,
      reason: null,
      gene_id: 'gene_distilled_uv',
      gene: { id: 'gene_distilled_uv' },
      error: null
    })

    const maintainer = new EvolverMaintainer(
      {
        getSettings: () => ({ ...DEFAULT_SETTINGS, memoryAiProvider: 'claude-code' })
      },
      {
        evidenceStore: {
          listSnapshots: vi.fn().mockResolvedValue(evidenceSnapshots)
        },
        buildCliAiProvider: () => ({
          summarizeSession,
          review,
          distill
        }),
        buildEvolverClient: async () => ({
          run,
          exportReview,
          approveReview,
          rejectReview: vi.fn(),
          prepareDistillation,
          completeDistillation
        }),
        resolveRepoRoot: vi.fn().mockResolvedValue(projectPath),
        resolveHeadCommitSha: vi.fn().mockResolvedValue('abc123'),
        createWorktree: vi.fn().mockResolvedValue({
          path: join(projectPath, 'worktree'),
          sourceWorktreeCommitSha: 'abc123'
        }),
        readTextFile: vi.fn(async (filePath: string) => {
          if (filePath.endsWith('distill-prompt.md')) {
            return 'Gene synthesis engine prompt'
          }
          return '{"type":"DistillationRequest"}'
        }),
        writeTextFile: vi.fn(async () => {}),
        nowIso: () => '2026-04-28T10:00:00.000Z'
      }
    )

    await maintainer.processTurnCompletion({
      projectPath,
      event: completedEvent()
    })

    expect(summarizeSession).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-session-1',
      repoRoot: join(projectPath, 'worktree'),
      sessionScope: 'provider-session-1'
    }))
    expect(review).toHaveBeenCalledTimes(1)
    expect(prepareDistillation).toHaveBeenCalledTimes(1)
    expect(completeDistillation).toHaveBeenCalledTimes(1)

    const stateStore = new RuntimeStateStore(projectPath)
    await expect(stateStore.getSessionProgress('project-1', 'session-1')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      lastProcessedEvidenceKey: 'evidence-1',
      updatedAt: '2026-04-28T10:00:00.000Z'
    })
    await expect(stateStore.getRunRecord('project-1', 'session-1')).resolves.toMatchObject({
      providerSessionId: 'provider-session-1',
      runId: 'run-1',
      reviewStatus: 'approved',
      reviewStateRef: 'review-state.json',
      lastError: null
    })
    await expect(stateStore.getPublishedRecord('project-1', 'session-1', 'claude-code')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      consumer: 'claude-code',
      deliveryState: 'pending',
      runId: 'run-1',
      publishedHash: null,
      updatedAt: '2026-04-28T10:00:00.000Z'
    })
  })

  test('does not advance evidence progress when the maintainer fails before evolver run', async () => {
    const maintainer = new EvolverMaintainer(
      {
        getSettings: () => ({ ...DEFAULT_SETTINGS, memoryAiProvider: 'claude-code' })
      },
      {
        evidenceStore: {
          listSnapshots: vi.fn().mockResolvedValue([snapshot({
            eventId: 'evt-1',
            evidenceKey: 'evidence-1'
          })])
        },
        buildCliAiProvider: () => ({
          summarizeSession: vi.fn().mockRejectedValue(new Error('llm offline')),
          review: vi.fn(),
          distill: vi.fn()
        }),
        nowIso: () => '2026-04-28T11:00:00.000Z'
      }
    )

    await expect(maintainer.processTurnCompletion({
      projectPath,
      event: completedEvent()
    })).rejects.toThrow('llm offline')

    await expect(readFile(join(projectPath, '.stoa', 'memory', 'runtime-state.json'), 'utf8')).rejects.toThrow()
  })

  test('does not advance evidence progress or queue publication when distillation fails after approval', async () => {
    const maintainer = new EvolverMaintainer(
      {
        getSettings: () => ({ ...DEFAULT_SETTINGS, memoryAiProvider: 'claude-code' })
      },
      {
        evidenceStore: {
          listSnapshots: vi.fn().mockResolvedValue([snapshot({
            eventId: 'evt-1',
            evidenceKey: 'evidence-1'
          })])
        },
        buildCliAiProvider: () => ({
          summarizeSession: vi.fn().mockResolvedValue({
            summary: 'Use uv.',
            outcome: 'success',
            lessons: ['Use uv.']
          }),
          review: vi.fn().mockResolvedValue({
            decision: 'approve',
            summary: 'ok',
            concerns: []
          }),
          distill: vi.fn().mockResolvedValue({
            responseText: '{"type":"Gene","id":"gene_uv"}'
          })
        }),
        buildEvolverClient: async () => ({
          run: vi.fn().mockResolvedValue({
            ok: true,
            run_id: 'run-1',
            repo_root: join(projectPath, 'worktree'),
            memory_dir: join(projectPath, '.stoa', 'memory', 'runs', 'run-1', 'memory'),
            evolution_dir: join(projectPath, '.stoa', 'memory', 'runs', 'run-1', 'evolution', 'scopes', 'provider-session-1'),
            gep_assets_dir: join(projectPath, '.stoa', 'memory', 'runs', 'run-1', 'gep-assets', 'scopes', 'provider-session-1'),
            session_scope: 'provider-session-1',
            selected_gene_id: 'gene_uv',
            signals: ['tooling_preference'],
            review_status: 'pending',
            exit_code: 0,
            artifact_refs: {
              review_state_ref: 'review-state.json',
              genes_ref: 'genes.json',
              genes_jsonl_ref: null,
              capsules_ref: null,
              capsules_jsonl_ref: null,
              events_ref: null,
              candidates_ref: null,
              external_candidates_ref: null,
              failed_capsules_ref: null,
              memory_graph_ref: 'memory_graph.jsonl',
              stdout_ref: 'stdout.log',
              stderr_ref: 'stderr.log'
            },
            bridge: {
              project_id: 'project-1',
              stoa_session_id: 'session-1',
              provider_session_id: 'provider-session-1'
            },
            error: null
          }),
          exportReview: vi.fn().mockResolvedValue({
            ok: true,
            review: {
              ok: true,
              status: 'pending',
              run_id: 'run-1',
              selected_gene_id: 'gene_uv',
              signals: ['tooling_preference'],
              mutation_id: 'mutation-1',
              review_state_ref: 'review-state.json',
              diff_ref: 'review.diff',
              validation_report_ref: null,
              bridge: null,
              error: null
            },
            gene: { id: 'gene_uv' },
            mutation: { id: 'mutation-1' },
            diff: 'diff',
            error: null
          }),
          approveReview: vi.fn().mockResolvedValue({
            ok: true,
            status: 'approved',
            run_id: 'run-1',
            selected_gene_id: 'gene_uv',
            signals: ['tooling_preference'],
            mutation_id: 'mutation-1',
            review_state_ref: 'review-state.json',
            diff_ref: 'review.diff',
            validation_report_ref: null,
            bridge: null,
            error: null
          }),
          rejectReview: vi.fn(),
          prepareDistillation: vi.fn().mockResolvedValue({
            ok: true,
            reason: null,
            prompt_path: join(projectPath, 'distill-prompt.md'),
            request_path: join(projectPath, 'distill-request.json'),
            input_capsule_count: 1,
            error: null
          }),
          completeDistillation: vi.fn().mockResolvedValue({
            ok: false,
            reason: 'validator rejected gene',
            gene_id: null,
            gene: null,
            error: 'validator rejected gene'
          })
        }),
        resolveRepoRoot: vi.fn().mockResolvedValue(projectPath),
        resolveHeadCommitSha: vi.fn().mockResolvedValue('abc123'),
        createWorktree: vi.fn().mockResolvedValue({
          path: join(projectPath, 'worktree'),
          sourceWorktreeCommitSha: 'abc123'
        }),
        readTextFile: vi.fn(async (filePath: string) => {
          if (filePath.endsWith('distill-prompt.md')) {
            return 'Gene synthesis engine prompt'
          }
          return '{"type":"DistillationRequest"}'
        }),
        writeTextFile: vi.fn(async () => {}),
        nowIso: () => '2026-04-28T12:00:00.000Z'
      }
    )

    await expect(maintainer.processTurnCompletion({
      projectPath,
      event: completedEvent()
    })).rejects.toThrow('validator rejected gene')

    const stateStore = new RuntimeStateStore(projectPath)
    await expect(stateStore.getSessionProgress('project-1', 'session-1')).resolves.toBeNull()
    await expect(stateStore.getPublishedRecord('project-1', 'session-1', 'claude-code')).resolves.toBeNull()
    await expect(stateStore.getRunRecord('project-1', 'session-1')).resolves.toMatchObject({
      runId: 'run-1',
      reviewStatus: 'approved',
      lastError: 'validator rejected gene'
    })
  })
})

function completedEvent() {
  return {
    event_version: 1 as const,
    event_id: 'evt-1',
    event_type: 'codex.Stop',
    timestamp: '2026-04-28T00:00:00.000Z',
    session_id: 'session-1',
    project_id: 'project-1',
    source: 'provider-adapter' as const,
    payload: {
      intent: 'agent.turn_completed' as const,
      agentState: 'idle' as const,
      hasUnseenCompletion: true,
      summary: 'done'
    },
    evidence: {
      rawSource: {
        provider: 'claude-code' as const,
        channel: 'hook' as const,
        rawEventName: 'Stop'
      },
      providerSessionId: 'provider-session-1'
    }
  }
}

function snapshot(overrides: Partial<SessionEvidenceSnapshot> = {}): SessionEvidenceSnapshot {
  return {
    eventId: 'evt-1',
    eventType: 'claude-code.Stop',
    sessionId: 'session-1',
    projectId: 'project-1',
    timestamp: '2026-04-28T00:00:00.000Z',
    provider: 'claude-code',
    providerSessionId: 'provider-session-1',
    turnId: 'turn-1',
    evidenceKey: 'evidence-1',
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'Stop'
    },
    evidence: {
      rawSource: {
        provider: 'claude-code',
        channel: 'hook',
        rawEventName: 'Stop'
      },
      providerSessionId: 'provider-session-1',
      promptText: 'install a package',
      lastAssistantMessage: 'Done.'
    },
    snapshot: {
      kind: 'turn-slice',
      fileName: 'turn-slice.json',
      content: '{"event":"done"}',
      sourceTranscriptPath: null
    },
    ...overrides
  }
}
