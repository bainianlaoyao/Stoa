import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ClaudeCodeInjector, getClaudeCodePublishedContextPath } from './claude-code-injector'
import { RuntimeStateStore } from './runtime-state-store'

describe('ClaudeCodeInjector', () => {
  let projectPath: string
  let stateStore: RuntimeStateStore

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'stoa-claude-code-injector-'))
    stateStore = new RuntimeStateStore(projectPath)
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  test('publishes the latest approved run into the claude context file and updates delivery state', async () => {
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-session-1',
      runId: 'run-1',
      worktreePath: 'C:/repo/worktree',
      memoryDir: 'C:/repo/memory',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-1',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-1',
      reviewStateRef: 'review-state.json',
      reviewStatus: 'approved',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })
    await stateStore.upsertPublishedRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      consumer: 'claude-code',
      deliveryState: 'pending',
      runId: 'run-1',
      publishedHash: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })

    const publishContext = vi.fn().mockResolvedValue({
      ok: true,
      target: 'claude-code',
      format: 'jsonl',
      run_id: 'run-1',
      source_refs: [],
      content: '{"type":"MemoryGraphEvent","note":"Use uv instead of pip."}\n',
      metadata: {
        generated_at: '2026-04-28T12:00:00.000Z',
        token_budget: null,
        selection_policy: 'claude-code-memory-graph-v1'
      },
      bridge: null,
      error: null
    })
    const injector = new ClaudeCodeInjector({
      buildEvolverClient: async () => ({
        publishContext
      }),
      nowIso: () => '2026-04-28T12:05:00.000Z'
    })

    const result = await injector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      projectPath
    })

    expect(publishContext).toHaveBeenCalledWith('claude-code')
    expect(result).toEqual({
      filePath: getClaudeCodePublishedContextPath(projectPath),
      hash: expect.stringMatching(/^sha256:/)
    })
    await expect(readFile(getClaudeCodePublishedContextPath(projectPath), 'utf8')).resolves.toBe(
      '{"type":"MemoryGraphEvent","note":"Use uv instead of pip."}\n'
    )
    await expect(stateStore.getPublishedRecord('project-1', 'session-1', 'claude-code')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      consumer: 'claude-code',
      deliveryState: 'published',
      runId: 'run-1',
      publishedHash: result!.hash,
      updatedAt: '2026-04-28T12:05:00.000Z'
    })
  })

  test('skips republishing when the approved run already matches the current published hash', async () => {
    const existingContent = '{"type":"MemoryGraphEvent","note":"Use uv instead of pip."}\n'
    const injector = new ClaudeCodeInjector()
    const targetPath = getClaudeCodePublishedContextPath(projectPath)
    await mkdir(join(projectPath, '.stoa', 'generated', 'evolver-context'), { recursive: true })
    await writeFile(targetPath, existingContent, 'utf8')
    const hash = resultHash(existingContent)

    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-session-1',
      runId: 'run-1',
      worktreePath: 'C:/repo/worktree',
      memoryDir: 'C:/repo/memory',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-1',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-1',
      reviewStateRef: 'review-state.json',
      reviewStatus: 'approved',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })
    await stateStore.upsertPublishedRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      consumer: 'claude-code',
      deliveryState: 'published',
      runId: 'run-1',
      publishedHash: hash,
      updatedAt: '2026-04-28T12:05:00.000Z'
    })

    const publishContext = vi.fn()
    const cachedInjector = new ClaudeCodeInjector({
      buildEvolverClient: async () => ({
        publishContext
      })
    })

    const result = await cachedInjector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      projectPath
    })

    expect(publishContext).not.toHaveBeenCalled()
    expect(result).toEqual({
      filePath: targetPath,
      hash
    })
  })

  test('returns null when there is no approved run to publish', async () => {
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-session-1',
      runId: 'run-1',
      worktreePath: 'C:/repo/worktree',
      memoryDir: 'C:/repo/memory',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-1',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-1',
      reviewStateRef: 'review-state.json',
      reviewStatus: 'rejected',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })

    const injector = new ClaudeCodeInjector()
    await expect(injector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      projectPath
    })).resolves.toBeNull()
  })

  test('publishes a latest project run whose review status is none', async () => {
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-memory-source',
      providerSessionId: 'provider-session-source',
      runId: 'run-none',
      worktreePath: 'C:/repo/worktree-none',
      memoryDir: 'C:/repo/memory-none',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-none',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-none',
      reviewStateRef: null,
      reviewStatus: 'none',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })

    const publishContext = vi.fn().mockResolvedValue({
      ok: true,
      target: 'claude-code',
      format: 'jsonl',
      run_id: 'run-none',
      source_refs: [],
      content: '{"type":"MemoryGraphEvent","note":"Use uv instead of pip."}\n',
      metadata: {
        generated_at: '2026-04-28T12:00:00.000Z',
        token_budget: null,
        selection_policy: 'claude-code-memory-graph-v1'
      },
      bridge: null,
      error: null
    })
    const injector = new ClaudeCodeInjector({
      buildEvolverClient: async () => ({
        publishContext
      }),
      nowIso: () => '2026-04-28T12:01:00.000Z'
    })

    const result = await injector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-consumer',
      projectPath
    })

    expect(publishContext).toHaveBeenCalledWith('claude-code')
    await expect(stateStore.getPublishedRecord('project-1', 'session-consumer', 'claude-code')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-consumer',
      consumer: 'claude-code',
      deliveryState: 'published',
      runId: 'run-none',
      publishedHash: result!.hash,
      updatedAt: '2026-04-28T12:01:00.000Z'
    })
  })

  test('falls back to the latest approved run in the project when the current session has no approved run yet', async () => {
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-older',
      providerSessionId: 'provider-session-older',
      runId: 'run-approved',
      worktreePath: 'C:/repo/worktree-approved',
      memoryDir: 'C:/repo/memory-approved',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-approved',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-approved',
      reviewStateRef: 'review-approved.json',
      reviewStatus: 'approved',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-current',
      providerSessionId: 'provider-session-current',
      runId: 'run-pending',
      worktreePath: 'C:/repo/worktree-pending',
      memoryDir: 'C:/repo/memory-pending',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-pending',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-pending',
      reviewStateRef: 'review-pending.json',
      reviewStatus: 'pending',
      lastError: null,
      updatedAt: '2026-04-28T12:05:00.000Z'
    })

    const publishContext = vi.fn().mockResolvedValue({
      ok: true,
      target: 'claude-code',
      format: 'jsonl',
      run_id: 'run-approved',
      source_refs: [],
      content: '{"type":"MemoryGraphEvent","note":"Use uv instead of pip."}\n',
      metadata: {
        generated_at: '2026-04-28T12:00:00.000Z',
        token_budget: null,
        selection_policy: 'claude-code-memory-graph-v1'
      },
      bridge: null,
      error: null
    })
    const injector = new ClaudeCodeInjector({
      buildEvolverClient: async () => ({
        publishContext
      }),
      nowIso: () => '2026-04-28T12:06:00.000Z'
    })

    const result = await injector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-current',
      projectPath
    })

    expect(publishContext).toHaveBeenCalledWith('claude-code')
    expect(result).toEqual({
      filePath: getClaudeCodePublishedContextPath(projectPath),
      hash: expect.stringMatching(/^sha256:/)
    })
    await expect(stateStore.getPublishedRecord('project-1', 'session-current', 'claude-code')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-current',
      consumer: 'claude-code',
      deliveryState: 'published',
      runId: 'run-approved',
      publishedHash: result!.hash,
      updatedAt: '2026-04-28T12:06:00.000Z'
    })
  })

  test('ignores the current session run when it has a publishable review status but a maintainer error', async () => {
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-older',
      providerSessionId: 'provider-session-older',
      runId: 'run-approved',
      worktreePath: 'C:/repo/worktree-approved',
      memoryDir: 'C:/repo/memory-approved',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-approved',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-approved',
      reviewStateRef: 'review-approved.json',
      reviewStatus: 'approved',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })
    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-current',
      providerSessionId: 'provider-session-current',
      runId: 'run-broken',
      worktreePath: 'C:/repo/worktree-broken',
      memoryDir: 'C:/repo/memory-broken',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-broken',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-broken',
      reviewStateRef: 'review-broken.json',
      reviewStatus: 'approved',
      lastError: 'distillation failed',
      updatedAt: '2026-04-28T12:05:00.000Z'
    })

    const publishContext = vi.fn().mockResolvedValue({
      ok: true,
      target: 'claude-code',
      format: 'jsonl',
      run_id: 'run-approved',
      source_refs: [],
      content: '{"type":"MemoryGraphEvent","note":"Use uv instead of pip."}\n',
      metadata: {
        generated_at: '2026-04-28T12:00:00.000Z',
        token_budget: null,
        selection_policy: 'claude-code-memory-graph-v1'
      },
      bridge: null,
      error: null
    })
    const injector = new ClaudeCodeInjector({
      buildEvolverClient: async () => ({
        publishContext
      }),
      nowIso: () => '2026-04-28T12:06:00.000Z'
    })

    const result = await injector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-current',
      projectPath
    })

    expect(publishContext).toHaveBeenCalledWith('claude-code')
    await expect(stateStore.getPublishedRecord('project-1', 'session-current', 'claude-code')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-current',
      consumer: 'claude-code',
      deliveryState: 'published',
      runId: 'run-approved',
      publishedHash: result!.hash,
      updatedAt: '2026-04-28T12:06:00.000Z'
    })
  })

  test('marks delivery as failed when publish-context throws', async () => {
    const targetPath = getClaudeCodePublishedContextPath(projectPath)
    await mkdir(join(projectPath, '.stoa', 'generated', 'evolver-context'), { recursive: true })
    await writeFile(targetPath, '{"timestamp":"2026-04-28T12:00:00.000Z","outcome":{"status":"unknown","note":"stale context"}}\n', 'utf8')

    await stateStore.upsertRunRecord({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      providerSessionId: 'provider-session-1',
      runId: 'run-1',
      worktreePath: 'C:/repo/worktree',
      memoryDir: 'C:/repo/memory',
      evolutionDir: 'C:/repo/evolution/scopes/provider-session-1',
      gepAssetsDir: 'C:/repo/gep/scopes/provider-session-1',
      reviewStateRef: 'review-state.json',
      reviewStatus: 'approved',
      lastError: null,
      updatedAt: '2026-04-28T12:00:00.000Z'
    })

    const injector = new ClaudeCodeInjector({
      buildEvolverClient: async () => ({
        publishContext: vi.fn().mockRejectedValue(new Error('publish failed'))
      }),
      nowIso: () => '2026-04-28T12:05:00.000Z'
    })

    await expect(injector.injectLatestContext({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      projectPath
    })).rejects.toThrow('publish failed')

    await expect(readFile(targetPath, 'utf8')).rejects.toThrow()

    await expect(stateStore.getPublishedRecord('project-1', 'session-1', 'claude-code')).resolves.toEqual({
      projectId: 'project-1',
      stoaSessionId: 'session-1',
      consumer: 'claude-code',
      deliveryState: 'failed',
      runId: 'run-1',
      publishedHash: null,
      updatedAt: '2026-04-28T12:05:00.000Z'
    })
  })
})

function resultHash(content: string): string {
  const crypto = require('node:crypto') as typeof import('node:crypto')
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`
}
