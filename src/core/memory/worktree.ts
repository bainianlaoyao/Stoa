import { execFile } from 'node:child_process'
import { join } from 'node:path'

export type RunTextCommand = (options: {
  command: string
  args: string[]
  cwd: string
}) => Promise<string>

export interface MemoryWorktree {
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
    throw new Error(`Memory runtime requires a git worktree: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function resolveGitHeadCommitSha(
  repoRoot: string,
  runTextCommand: RunTextCommand = defaultRunTextCommand
): Promise<string> {
  try {
    const stdout = await runTextCommand({
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: repoRoot
    })
    return stdout.trim()
  } catch (error) {
    throw new Error(`Memory runtime requires a resolvable git HEAD: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function createMemoryWorktree(options: {
  repoRoot: string
  runId: string
  sourceWorktreeCommitSha: string | null
  runTextCommand?: RunTextCommand
}): Promise<MemoryWorktree> {
  if (!options.sourceWorktreeCommitSha) {
    throw new Error('sourceWorktreeCommitSha is required for memory worktree creation')
  }

  const safeRunId = sanitizeRunId(options.runId)
  const worktreePath = join(options.repoRoot, '.stoa', 'memory', 'worktrees', safeRunId).replace(/\\/g, '/')
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

function sanitizeRunId(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_\-.]/g, '-').slice(0, 128)
  if (!safe || safe === '.' || safe === '..' || safe.includes('..')) {
    throw new Error('runId must resolve to a safe worktree path segment')
  }
  return safe
}
