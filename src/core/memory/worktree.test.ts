import { describe, expect, test, vi } from 'vitest'
import { createMemoryWorktree, resolveGitHeadCommitSha, resolveGitRepoRoot } from './worktree'

describe('memory worktree helpers', () => {
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

    await expect(resolveGitRepoRoot('C:/not-git', runTextCommand)).rejects.toThrow('Memory runtime requires a git worktree')
  })

  test('resolves the git head commit sha from rev-parse output', async () => {
    const runTextCommand = vi.fn().mockResolvedValue('abc123\n')

    await expect(resolveGitHeadCommitSha('C:/repo', runTextCommand)).resolves.toBe('abc123')
    expect(runTextCommand).toHaveBeenCalledWith({
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: 'C:/repo'
    })
  })

  test('creates detached worktree from source commit under .stoa/memory/worktrees', async () => {
    const runTextCommand = vi.fn().mockResolvedValue('')

    await expect(createMemoryWorktree({
      repoRoot: 'C:/repo',
      runId: 'run_1',
      sourceWorktreeCommitSha: 'source-sha',
      runTextCommand
    })).resolves.toEqual({
      path: 'C:/repo/.stoa/memory/worktrees/run_1',
      sourceWorktreeCommitSha: 'source-sha'
    })

    expect(runTextCommand).toHaveBeenCalledWith({
      command: 'git',
      args: ['worktree', 'add', '--detach', 'C:/repo/.stoa/memory/worktrees/run_1', 'source-sha'],
      cwd: 'C:/repo'
    })
  })

  test('rejects missing source worktree commit', async () => {
    await expect(createMemoryWorktree({
      repoRoot: 'C:/repo',
      runId: 'run_1',
      sourceWorktreeCommitSha: null,
      runTextCommand: vi.fn()
    })).rejects.toThrow('sourceWorktreeCommitSha is required')
  })

  test('rejects unsafe run identifiers before invoking git', async () => {
    const runTextCommand = vi.fn()

    await expect(createMemoryWorktree({
      repoRoot: 'C:/repo',
      runId: '../escape',
      sourceWorktreeCommitSha: 'source-sha',
      runTextCommand
    })).rejects.toThrow('runId must resolve to a safe worktree path segment')
    expect(runTextCommand).not.toHaveBeenCalled()
  })
})
