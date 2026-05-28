import { execFile } from 'node:child_process'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type {
  GitBranchInfo,
  GitCommitRequest,
  GitFileStatus,
  GitLogEntry,
  GitMergeRequest,
  GitPushRequest,
  GitRebaseRequest,
  GitStagingState,
  GitStatusEntry,
  GitStatusResult
} from '@shared/sidebar-types'

const GIT_MAX_BUFFER = 10 * 1024 * 1024

type ExecFileError = Error & {
  code?: number | string
  stdout?: string
  stderr?: string
}

function execGit(projectPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: projectPath, maxBuffer: GIT_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const execError = error as ExecFileError
        execError.stdout = stdout
        execError.stderr = stderr
        reject(execError)
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

function formatGitError(action: string, error: unknown): Error {
  if (error instanceof Error) {
    const execError = error as ExecFileError
    const stderr = execError.stderr?.trim()
    const stdout = execError.stdout?.trim()
    const detail = stderr || stdout || execError.message
    return new Error(`Git ${action} failed: ${detail}`)
  }

  return new Error(`Git ${action} failed: ${String(error)}`)
}

function decodeGitPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"')) {
    return trimmed
  }

  try {
    return JSON.parse(trimmed) as string
  } catch {
    return trimmed.slice(1, -1)
  }
}

function mapGitCodeToStatus(code: string): GitFileStatus | null {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case '?':
      return 'untracked'
    default:
      return null
  }
}

function pushStatusEntry(entries: GitStatusEntry[], path: string, code: string, staging: GitStagingState, oldPath?: string): void {
  const status = mapGitCodeToStatus(code)
  if (!status) {
    return
  }

  entries.push({
    path,
    oldPath,
    status,
    staging,
  })
}

function parseOrdinaryStatusLine(entries: GitStatusEntry[], line: string): void {
  const match = /^1 (..)(?: \S+){6} (.+)$/.exec(line)
  if (!match) {
    return
  }

  const xy = match[1]
  const path = decodeGitPath(match[2])
  const stagedCode = xy[0]
  const unstagedCode = xy[1]

  if (stagedCode !== '.') {
    pushStatusEntry(entries, path, stagedCode, 'staged')
  }

  if (unstagedCode !== '.') {
    pushStatusEntry(entries, path, unstagedCode, 'unstaged')
  }
}

function parseRenameStatusLine(entries: GitStatusEntry[], line: string): void {
  const match = /^2 (..)(?: \S+){7} (.+)$/.exec(line)
  if (!match) {
    return
  }

  const xy = match[1]
  const pathBlock = match[2]
  const [targetPathRaw, sourcePathRaw] = pathBlock.split('\t')
  const path = decodeGitPath(targetPathRaw ?? '')
  const oldPath = decodeGitPath(sourcePathRaw ?? '')
  const stagedCode = xy[0]
  const unstagedCode = xy[1]

  if (stagedCode !== '.') {
    pushStatusEntry(entries, path, stagedCode, 'staged', oldPath)
  }

  if (unstagedCode !== '.') {
    pushStatusEntry(entries, path, unstagedCode, 'unstaged', oldPath)
  }
}

function parseUnmergedStatusLine(entries: GitStatusEntry[], line: string): boolean {
  const match = /^u \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/.exec(line)
  if (!match) {
    return false
  }

  pushStatusEntry(entries, decodeGitPath(match[1]), 'M', 'unstaged')
  return true
}

function parseGitStatus(stdout: string): GitStatusResult {
  let branch = 'HEAD'
  let ahead = 0
  let behind = 0
  let hasConflicts = false
  const entries: GitStatusEntry[] = []

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line) {
      continue
    }

    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim()
      continue
    }

    if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line)
      if (match) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }

    if (line.startsWith('? ')) {
      pushStatusEntry(entries, decodeGitPath(line.slice(2)), '?', 'untracked')
      continue
    }

    if (line.startsWith('u ')) {
      hasConflicts = parseUnmergedStatusLine(entries, line) || hasConflicts
      continue
    }

    if (line.startsWith('1 ')) {
      parseOrdinaryStatusLine(entries, line)
      continue
    }

    if (line.startsWith('2 ')) {
      parseRenameStatusLine(entries, line)
    }
  }

  return {
    branch,
    ahead,
    behind,
    clean: entries.length === 0 && !hasConflicts,
    entries,
    hasConflicts,
  }
}

function parseBranchInfo(stdout: string): GitBranchInfo {
  let current = ''
  const locals: string[] = []
  const remotes: string[] = []

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.includes('->')) {
      continue
    }

    const isCurrent = rawLine.trimStart().startsWith('*')
    const name = line.replace(/^\*\s+/, '')
    if (name.startsWith('remotes/')) {
      remotes.push(name.slice('remotes/'.length))
      continue
    }

    locals.push(name)
    if (isCurrent) {
      current = name
    }
  }

  return { current, locals, remotes }
}

function parseGitLog(stdout: string): GitLogEntry[] {
  return stdout
    .split(/\r?\n---\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split(/\r?\n/)
      return {
        hash: lines[0] ?? '',
        hashAbbrev: lines[1] ?? '',
        message: lines[2] ?? '',
        author: lines[3] ?? '',
        date: lines[4] ?? '',
        refs: lines[5] ?? '',
      }
    })
}

async function isTrackedPath(projectPath: string, filePath: string): Promise<boolean> {
  const { stdout } = await execGit(projectPath, ['ls-files', '--', filePath])
  return stdout.trim().length > 0
}

export function registerGitHandlers(ipcMain: Electron.IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.gitStatus, async (_event, projectPath: string) => {
    try {
      const { stdout } = await execGit(projectPath, ['status', '--porcelain=v2', '--branch'])
      return parseGitStatus(stdout)
    } catch (error) {
      throw formatGitError('status', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitStage, async (_event, projectPath: string, paths: string[]) => {
    try {
      await execGit(projectPath, ['add', '--', ...paths])
    } catch (error) {
      throw formatGitError('stage', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitUnstage, async (_event, projectPath: string, paths: string[]) => {
    try {
      await execGit(projectPath, ['reset', 'HEAD', '--', ...paths])
    } catch (error) {
      throw formatGitError('unstage', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitDiscard, async (_event, projectPath: string, paths: string[]) => {
    try {
      for (const filePath of paths) {
        if (await isTrackedPath(projectPath, filePath)) {
          await execGit(projectPath, ['checkout', '--', filePath])
          continue
        }

        await execGit(projectPath, ['clean', '-f', '--', filePath])
      }
    } catch (error) {
      throw formatGitError('discard', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitCommit, async (_event, request: GitCommitRequest) => {
    try {
      await execGit(request.projectPath, ['commit', '-m', request.message])
    } catch (error) {
      throw formatGitError('commit', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitPush, async (_event, request: GitPushRequest) => {
    try {
      const status = await execGit(request.projectPath, ['status', '--porcelain=v2', '--branch'])
      const parsed = parseGitStatus(status.stdout)
      const args = ['push']

      if (request.forceWithLease) {
        args.push('--force-with-lease')
      }

      if (request.setUpstream) {
        args.push('--set-upstream', 'origin', parsed.branch)
      }

      await execGit(request.projectPath, args)
    } catch (error) {
      throw formatGitError('push', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitPull, async (_event, projectPath: string) => {
    try {
      await execGit(projectPath, ['pull'])
    } catch (error) {
      throw formatGitError('pull', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitFetch, async (_event, projectPath: string) => {
    try {
      await execGit(projectPath, ['fetch'])
    } catch (error) {
      throw formatGitError('fetch', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitRebase, async (_event, request: GitRebaseRequest) => {
    try {
      await execGit(request.projectPath, ['rebase', request.onto])
    } catch (error) {
      throw formatGitError('rebase', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitMerge, async (_event, request: GitMergeRequest) => {
    try {
      await execGit(request.projectPath, ['merge', request.branch])
    } catch (error) {
      throw formatGitError('merge', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitBranches, async (_event, projectPath: string) => {
    try {
      const { stdout } = await execGit(projectPath, ['branch', '-a', '--no-color'])
      return parseBranchInfo(stdout)
    } catch (error) {
      throw formatGitError('branches', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitLog, async (_event, projectPath: string, limit = 50) => {
    try {
      const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 50
      const { stdout } = await execGit(projectPath, ['log', '--format=%H%n%h%n%s%n%an%n%aI%n%D%n---', `-${normalizedLimit}`])
      return parseGitLog(stdout)
    } catch (error) {
      throw formatGitError('log', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitDiff, async (_event, projectPath: string, filePath?: string, staged?: boolean) => {
    try {
      const args = ['diff']
      if (staged) {
        args.push('--staged')
      }
      if (filePath) {
        args.push('--', filePath)
      }
      const { stdout } = await execGit(projectPath, args)
      return stdout
    } catch (error) {
      throw formatGitError('diff', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitCheckout, async (_event, projectPath: string, branch: string) => {
    try {
      await execGit(projectPath, ['checkout', branch])
    } catch (error) {
      throw formatGitError('checkout', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitCreateBranch, async (_event, projectPath: string, branch: string) => {
    try {
      await execGit(projectPath, ['checkout', '-b', branch])
    } catch (error) {
      throw formatGitError('createBranch', error)
    }
  })
}
