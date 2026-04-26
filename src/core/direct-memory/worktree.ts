import { execFile } from 'node:child_process'
import { join } from 'node:path'

export type RunTextCommand = (options: {
  command: string
  args: string[]
  cwd: string
}) => Promise<string>

export interface DirectMemoryWorktree {
  path: string
  sourceWorktreeCommitSha: string
}

export async function defaultRunTextCommand(options: {
  command: string
  args: string[]
  cwd: string
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(options.command, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }

      resolve(stdout)
    })
  })
}

export async function resolveGitRepoRoot(
  cwd: string,
  runTextCommand: RunTextCommand = defaultRunTextCommand
): Promise<string> {
  try {
    const stdout = await runTextCommand({
      command: 'git',
      args: ['rev-parse', '--show-toplevel'],
      cwd
    })
    return stdout.trim()
  } catch (error) {
    throw new Error(`Direct memory mode requires a git worktree: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function createDirectMemoryWorktree(options: {
  repoRoot: string
  runId: string
  sourceWorktreeCommitSha: string | null
  runTextCommand?: RunTextCommand
}): Promise<DirectMemoryWorktree> {
  if (!options.sourceWorktreeCommitSha) {
    throw new Error('source_worktree_commit_sha is required for direct memory worktree creation')
  }

  const worktreePath = join(options.repoRoot, '.stoa', 'direct-memory', 'worktrees', options.runId).replace(/\\/g, '/')
  await (options.runTextCommand ?? defaultRunTextCommand)({
    command: 'git',
    args: ['worktree', 'add', '--detach', worktreePath, options.sourceWorktreeCommitSha],
    cwd: options.repoRoot
  })

  return {
    path: worktreePath,
    sourceWorktreeCommitSha: options.sourceWorktreeCommitSha
  }
}
