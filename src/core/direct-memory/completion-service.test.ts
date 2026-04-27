import { describe, expect, test, vi } from 'vitest'
import type {
  BootstrapState,
  CanonicalSessionEvent,
  ProjectSummary,
  SessionSummary
} from '@shared/project-session'
import type {
  EntireStoaCheckpointRef,
  MemoryEvolutionBridgeRef
} from '@shared/direct-memory'
import { DirectMemoryCompletionService } from './completion-service'

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project_1',
    name: 'Demo',
    path: 'C:/workspace/demo/subdir',
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
    ...overrides
  }
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'claude-code',
    runtimeState: 'alive',
    agentState: 'idle',
    hasUnseenCompletion: true,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 3,
    blockingReason: null,
    title: 'Claude Session',
    summary: 'Stop',
    recoveryMode: 'resume-external',
    externalSessionId: 'provider-session-1',
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
    lastActivatedAt: '2026-04-27T00:00:00.000Z',
    archived: false,
    ...overrides
  }
}

function state(overrides: {
  project?: ProjectSummary
  session?: SessionSummary
} = {}): BootstrapState {
  return {
    activeProjectId: 'project_1',
    activeSessionId: 'session_1',
    terminalWebhookPort: 43127,
    projects: [overrides.project ?? project()],
    sessions: [overrides.session ?? session()]
  }
}

function completionEvent(overrides: Partial<CanonicalSessionEvent> = {}): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'evt_1',
    event_type: 'claude-code.Stop',
    timestamp: '2026-04-27T00:00:10.000Z',
    session_id: 'session_1',
    project_id: 'project_1',
    source: 'provider-adapter',
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'Stop',
      externalSessionId: 'provider-session-1'
    },
    ...overrides
  }
}

function checkpointRef(overrides: Partial<EntireStoaCheckpointRef> = {}): EntireStoaCheckpointRef {
  return {
    checkpoint_id: 'chk_1',
    checkpoint_format_version: 'v1',
    checkpoint_metadata_commit_sha: 'meta-sha',
    source_worktree_commit_sha: 'source-sha',
    session_ids: ['provider-session-1'],
    latest_session_id: 'provider-session-1',
    agent: 'Claude Code',
    model: 'claude-sonnet-4',
    summary: 'Use uv instead of pip',
    created_at: '2026-04-27T00:00:09.000Z',
    updated_at: '2026-04-27T00:00:09.000Z',
    ...overrides
  }
}

function bridgeRef(overrides: Partial<MemoryEvolutionBridgeRef> = {}): MemoryEvolutionBridgeRef {
  return {
    projectId: 'project_1',
    stoaSessionId: 'session_1',
    providerSessionId: 'provider-session-1',
    providerType: 'claude-code',
    repoRoot: 'C:/workspace/demo',
    entireCheckpointId: 'chk_1',
    entireCheckpointMetadataCommitSha: 'meta-sha',
    entireSourceWorktreeCommitSha: 'source-sha',
    evolverRunId: 'run_1',
    evolverWorktreePath: 'C:/workspace/demo/.stoa/direct-memory/worktrees/run_1',
    evolverMemoryDir: 'C:/workspace/demo/.stoa/direct-memory/run_1/memory',
    evolverEvolutionDir: 'C:/workspace/demo/.stoa/direct-memory/run_1/memory/evolution',
    evolverGepAssetsDir: 'C:/workspace/demo/.stoa/direct-memory/run_1/assets/gep',
    evolverReviewStateRef: 'C:/workspace/demo/.stoa/direct-memory/run_1/memory/evolution/evolution_solidify_state.json',
    lastPublishedContextTarget: 'claude-code',
    lastPublishedContextHash: 'sha256:abc',
    createdAt: '2026-04-27T00:00:10.000Z',
    updatedAt: '2026-04-27T00:00:10.000Z',
    ...overrides
  }
}

describe('DirectMemoryCompletionService', () => {
  test('polls Entire until a new matching checkpoint appears and then evolves it', async () => {
    const resolveRepoRoot = vi.fn(async () => 'C:/workspace/demo')
    const listCheckpoints = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        checkpointRef({ checkpoint_id: 'chk_other', latest_session_id: 'other-session', session_ids: ['other-session'] }),
        checkpointRef()
      ])
    const listBridgeRefs = vi.fn(async () => [])
    const evolveAndPublish = vi.fn(async () => undefined)
    const sleep = vi.fn(async () => {})

    const service = new DirectMemoryCompletionService({
      manager: {
        snapshot: () => state()
      },
      resolveRepoRoot,
      sleep,
      pollIntervalMs: 25,
      maxPollAttempts: 3,
      createRepoRuntime: () => ({
        listCheckpoints,
        listBridgeRefs,
        evolveAndPublish
      })
    })

    service.notifyCanonicalEvent(completionEvent())
    await service.waitForIdle('session_1')

    expect(resolveRepoRoot).toHaveBeenCalledWith('C:/workspace/demo/subdir')
    expect(listCheckpoints).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(25)
    expect(evolveAndPublish).toHaveBeenCalledWith({
      projectId: 'project_1',
      stoaSessionId: 'session_1',
      providerSessionId: 'provider-session-1',
      providerType: 'claude-code',
      repoRoot: 'C:/workspace/demo',
      checkpointId: 'chk_1',
      target: 'claude-code'
    })
  })

  test('skips checkpoints that were already handled for the session', async () => {
    const listCheckpoints = vi.fn(async () => [checkpointRef()])
    const listBridgeRefs = vi.fn(async () => [bridgeRef()])
    const evolveAndPublish = vi.fn(async () => undefined)

    const service = new DirectMemoryCompletionService({
      manager: {
        snapshot: () => state()
      },
      resolveRepoRoot: async () => 'C:/workspace/demo',
      maxPollAttempts: 1,
      createRepoRuntime: () => ({
        listCheckpoints,
        listBridgeRefs,
        evolveAndPublish
      })
    })

    service.notifyCanonicalEvent(completionEvent())
    await service.waitForIdle('session_1')

    expect(listCheckpoints).toHaveBeenCalledTimes(1)
    expect(evolveAndPublish).not.toHaveBeenCalled()
  })

  test('ignores non-completion events and unsupported capture sessions', async () => {
    const resolveRepoRoot = vi.fn(async () => 'C:/workspace/demo')
    const listCheckpoints = vi.fn(async () => [checkpointRef()])
    const listBridgeRefs = vi.fn(async () => [])
    const evolveAndPublish = vi.fn(async () => undefined)

    const service = new DirectMemoryCompletionService({
      manager: {
        snapshot: () => state({
          session: session({
            id: 'session_2',
            type: 'codex',
            externalSessionId: 'codex-thread-1'
          })
        })
      },
      resolveRepoRoot,
      createRepoRuntime: () => ({
        listCheckpoints,
        listBridgeRefs,
        evolveAndPublish
      })
    })

    service.notifyCanonicalEvent(completionEvent({
      session_id: 'session_2',
      event_type: 'codex.UserPromptSubmit',
      payload: {
        intent: 'agent.turn_started',
        agentState: 'working',
        summary: 'UserPromptSubmit',
        externalSessionId: 'codex-thread-1'
      }
    }))
    service.notifyCanonicalEvent(completionEvent({
      session_id: 'session_2',
      event_type: 'codex.Stop',
      payload: {
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop',
        externalSessionId: 'codex-thread-1'
      }
    }))
    await service.waitForIdle('session_2')

    expect(resolveRepoRoot).not.toHaveBeenCalled()
    expect(listCheckpoints).not.toHaveBeenCalled()
    expect(evolveAndPublish).not.toHaveBeenCalled()
  })

  test('skips non-git projects without reporting a direct memory failure', async () => {
    const onError = vi.fn()
    const evolveAndPublish = vi.fn(async () => undefined)

    const service = new DirectMemoryCompletionService({
      manager: {
        snapshot: () => state()
      },
      resolveRepoRoot: async () => {
        throw new Error('Direct memory mode requires a git worktree: fatal: not a git repository')
      },
      onError,
      createRepoRuntime: () => ({
        listCheckpoints: async () => [checkpointRef()],
        listBridgeRefs: async () => [],
        evolveAndPublish
      })
    })

    service.notifyCanonicalEvent(completionEvent())
    await service.waitForIdle('session_1')

    expect(onError).not.toHaveBeenCalled()
    expect(evolveAndPublish).not.toHaveBeenCalled()
  })

  test('stop cancels an in-flight checkpoint poll so shutdown does not hang', async () => {
    const listCheckpoints = vi.fn(async () => [])
    const listBridgeRefs = vi.fn(async () => [])
    const evolveAndPublish = vi.fn(async () => undefined)
    const sleep = vi.fn(() => new Promise<void>(() => {}))

    const service = new DirectMemoryCompletionService({
      manager: {
        snapshot: () => state()
      },
      resolveRepoRoot: async () => 'C:/workspace/demo',
      sleep,
      maxPollAttempts: 3,
      createRepoRuntime: () => ({
        listCheckpoints,
        listBridgeRefs,
        evolveAndPublish
      })
    })

    service.notifyCanonicalEvent(completionEvent())
    await vi.waitFor(() => {
      expect(listCheckpoints).toHaveBeenCalledTimes(1)
      expect(sleep).toHaveBeenCalledTimes(1)
    })

    await service.stop()
    await service.waitForIdle('session_1')

    expect(evolveAndPublish).not.toHaveBeenCalled()
  })
})
