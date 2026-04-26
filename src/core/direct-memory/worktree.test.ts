import { describe, expect, test, vi } from 'vitest'
import { createDirectMemoryWorktree, resolveGitRepoRoot } from './worktree'

describe('direct memory worktree helpers', () => {
  test('resolves git repo root from rev-parse output', async () => {
    const runTextCommand = vi.fn().mockResolvedValue('C:/repo\n')

    await expect(resolveGitRepoRoot('C:/repo/app', runTextCommand)).resolves.toBe('C:/repo')
    expect(runTextCommand).toHaveBeenCalledWith({
      command: 'git',
      args: ['rev-parse', '--show-toplevel'],
      cwd: 'C:/repo/app'
    })
  })

  test('rejects non-git directories', async () => {
    const runTextCommand = vi.fn().mockRejectedValue(new Error('not a git repo'))

    await expect(resolveGitRepoRoot('C:/not-git', runTextCommand)).rejects.toThrow('Direct memory mode requires a git worktree')
  })

  test('creates detached worktree from source commit under .stoa', async () => {
    const runTextCommand = vi.fn().mockResolvedValue('')

    await expect(createDirectMemoryWorktree({
      repoRoot: 'C:/repo',
      runId: 'run_1',
      sourceWorktreeCommitSha: 'source-sha',
      runTextCommand
    })).resolves.toEqual({
      path: 'C:/repo/.stoa/direct-memory/worktrees/run_1',
      sourceWorktreeCommitSha: 'source-sha'
    })

    expect(runTextCommand).toHaveBeenCalledWith({
      command: 'git',
      args: ['worktree', 'add', '--detach', 'C:/repo/.stoa/direct-memory/worktrees/run_1', 'source-sha'],
      cwd: 'C:/repo'
    })
  })

  test('rejects missing source worktree commit', async () => {
    await expect(createDirectMemoryWorktree({
      repoRoot: 'C:/repo',
      runId: 'run_1',
      sourceWorktreeCommitSha: null,
      runTextCommand: vi.fn()
    })).rejects.toThrow('source_worktree_commit_sha is required')
  })
})
