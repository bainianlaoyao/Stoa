/**
 * Git route group — Stoa Server side.
 *
 * Mounts at `/api/v1`. Endpoints mirror the Electron IPC handlers in
 * `src/main/sidebar-git-handlers.ts` but speak HTTP/JSON.
 *
 * The actual git operations are pure `child_process.execFile('git', ...)`.
 * No Electron dependency.
 */
import { Hono } from 'hono'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { nanoid } from 'nanoid'
import { AppError, type ApiResponse } from '../shared/errors'
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
  GitStatusResult,
} from 'stoa-shared'

const execFileAsync = promisify(execFile)
const GIT_MAX_BUFFER = 10 * 1024 * 1024

function envelope<T>(data: T): ApiResponse<T> {
  return {
    ok: true,
    data,
    meta: {
      requestId: nanoid(),
      timestamp: new Date().toISOString(),
    },
  }
}

// ---------------------------------------------------------------------------
// Git helpers (ported from sidebar-git-handlers.ts)
// ---------------------------------------------------------------------------

function decodeGitPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"')) return trimmed
  try {
    return JSON.parse(trimmed) as string
  } catch {
    return trimmed.slice(1, -1)
  }
}

function mapGitCodeToStatus(code: string): GitFileStatus | null {
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case '?': return 'untracked'
    default: return null
  }
}

function pushStatusEntry(
  entries: GitStatusEntry[],
  filePath: string,
  code: string,
  staging: GitStagingState,
  oldPath?: string,
): void {
  const status = mapGitCodeToStatus(code)
  if (!status) return
  entries.push({ path: filePath, oldPath, status, staging })
}

function parseOrdinaryStatusLine(entries: GitStatusEntry[], line: string): void {
  const match = /^1 (..)(?: \S+){6} (.+)$/.exec(line)
  if (!match) return
  const xy = match[1]!
  const filePath = decodeGitPath(match[2]!)
  const stagedCode = xy[0]
  const unstagedCode = xy[1]
  if (stagedCode !== '.') pushStatusEntry(entries, filePath, stagedCode, 'staged')
  if (unstagedCode !== '.') pushStatusEntry(entries, filePath, unstagedCode, 'unstaged')
}

function parseRenameStatusLine(entries: GitStatusEntry[], line: string): void {
  const match = /^2 (..)(?: \S+){7} (.+)$/.exec(line)
  if (!match) return
  const xy = match[1]!
  const pathBlock = match[2]!
  const [targetPathRaw, sourcePathRaw] = pathBlock.split('\t')
  const filePath = decodeGitPath(targetPathRaw ?? '')
  const oldPath = decodeGitPath(sourcePathRaw ?? '')
  const stagedCode = xy[0]
  const unstagedCode = xy[1]
  if (stagedCode !== '.') pushStatusEntry(entries, filePath, stagedCode, 'staged', oldPath)
  if (unstagedCode !== '.') pushStatusEntry(entries, filePath, unstagedCode, 'unstaged', oldPath)
}

function parseUnmergedStatusLine(entries: GitStatusEntry[], line: string): boolean {
  const match = /^u \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/.exec(line)
  if (!match) return false
  pushStatusEntry(entries, decodeGitPath(match[1]!), 'M', 'unstaged')
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
    if (!line) continue
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
    if (!line || line.includes('->')) continue
    const isCurrent = rawLine.trimStart().startsWith('*')
    const name = line.replace(/^\*\s+/, '')
    if (name.startsWith('remotes/')) {
      remotes.push(name.slice('remotes/'.length))
      continue
    }
    locals.push(name)
    if (isCurrent) current = name
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

async function execGit(
  projectPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd: projectPath,
      maxBuffer: GIT_MAX_BUFFER,
    })
  } catch (error) {
    const execError = error as Error & {
      code?: number | string
      stdout?: string
      stderr?: string
    }
    const stderr = execError.stderr?.trim()
    const stdout = execError.stdout?.trim()
    const detail = stderr || stdout || execError.message
    throw new AppError({
      code: 'internal_error',
      message: `Git failed: ${detail}`,
      statusCode: 500,
    })
  }
}

function requireProjectPath(body: Record<string, unknown> | null): string {
  if (!body || typeof body.projectPath !== 'string' || !body.projectPath) {
    throw new AppError({
      code: 'validation_error',
      message: 'Missing or invalid "projectPath"',
      statusCode: 422,
    })
  }
  return body.projectPath
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createGitRoutes(): Hono {
  const routes = new Hono()

  // GET /git/status?projectPath=...
  routes.get('/git/status', async (c) => {
    const projectPath = c.req.query('projectPath')
    if (!projectPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Missing query parameter "projectPath"',
        statusCode: 422,
      })
    }
    const { stdout } = await execGit(projectPath, [
      '-c', 'core.quotePath=false',
      'status', '--porcelain=v2', '--branch', '--untracked-files=all',
    ])
    return c.json(envelope(parseGitStatus(stdout)))
  })

  // POST /git/stage
  routes.post('/git/stage', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    const projectPath = requireProjectPath(body)
    const paths = body!.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new AppError({
        code: 'validation_error',
        message: '"paths" must be a non-empty array of strings',
        statusCode: 422,
      })
    }
    await execGit(projectPath, ['add', '--', ...(paths as string[])])
    return c.json(envelope({ staged: true }))
  })

  // POST /git/unstage
  routes.post('/git/unstage', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    const projectPath = requireProjectPath(body)
    const paths = body!.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new AppError({
        code: 'validation_error',
        message: '"paths" must be a non-empty array of strings',
        statusCode: 422,
      })
    }
    await execGit(projectPath, ['restore', '--staged', '--', ...(paths as string[])])
    return c.json(envelope({ unstaged: true }))
  })

  // POST /git/discard
  routes.post('/git/discard', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    const projectPath = requireProjectPath(body)
    const paths = body!.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new AppError({
        code: 'validation_error',
        message: '"paths" must be a non-empty array of strings',
        statusCode: 422,
      })
    }
    for (const filePath of paths as string[]) {
      let isTracked = false
      try {
        await execGit(projectPath, ['ls-files', '--error-unmatch', '--', filePath])
        isTracked = true
      } catch {
        isTracked = false
      }
      if (isTracked) {
        await execGit(projectPath, ['restore', '--', filePath])
      } else {
        await execGit(projectPath, ['clean', '-fd', '--', filePath])
      }
    }
    return c.json(envelope({ discarded: true }))
  })

  // POST /git/commit
  routes.post('/git/commit', async (c) => {
    const body = await c.req.json().catch(() => null) as GitCommitRequest | null
    if (!body || !body.projectPath || !body.message) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and message',
        statusCode: 422,
      })
    }
    await execGit(body.projectPath, ['commit', '-m', body.message])
    return c.json(envelope({ committed: true }))
  })

  // POST /git/push
  routes.post('/git/push', async (c) => {
    const body = await c.req.json().catch(() => null) as GitPushRequest | null
    if (!body || !body.projectPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath',
        statusCode: 422,
      })
    }
    const status = await execGit(body.projectPath, [
      'status', '--porcelain=v2', '--branch',
    ])
    const parsed = parseGitStatus(status.stdout)
    const args = ['push']
    if (body.forceWithLease) args.push('--force-with-lease')
    if (body.setUpstream) {
      args.push('--set-upstream', 'origin', parsed.branch)
    }
    await execGit(body.projectPath, args)
    return c.json(envelope({ pushed: true }))
  })

  // POST /git/pull
  routes.post('/git/pull', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    const projectPath = requireProjectPath(body)
    await execGit(projectPath, ['pull'])
    return c.json(envelope({ pulled: true }))
  })

  // POST /git/fetch
  routes.post('/git/fetch', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    const projectPath = requireProjectPath(body)
    await execGit(projectPath, ['fetch'])
    return c.json(envelope({ fetched: true }))
  })

  // POST /git/rebase
  routes.post('/git/rebase', async (c) => {
    const body = await c.req.json().catch(() => null) as GitRebaseRequest | null
    if (!body || !body.projectPath || !body.onto) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and onto',
        statusCode: 422,
      })
    }
    await execGit(body.projectPath, ['rebase', body.onto])
    return c.json(envelope({ rebased: true }))
  })

  // POST /git/merge
  routes.post('/git/merge', async (c) => {
    const body = await c.req.json().catch(() => null) as GitMergeRequest | null
    if (!body || !body.projectPath || !body.branch) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and branch',
        statusCode: 422,
      })
    }
    await execGit(body.projectPath, ['merge', body.branch])
    return c.json(envelope({ merged: true }))
  })

  // GET /git/branches?projectPath=...
  routes.get('/git/branches', async (c) => {
    const projectPath = c.req.query('projectPath')
    if (!projectPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Missing query parameter "projectPath"',
        statusCode: 422,
      })
    }
    const { stdout } = await execGit(projectPath, [
      'branch', '-a', '--no-color',
    ])
    return c.json(envelope(parseBranchInfo(stdout)))
  })

  // GET /git/log?projectPath=...&limit=...
  routes.get('/git/log', async (c) => {
    const projectPath = c.req.query('projectPath')
    if (!projectPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Missing query parameter "projectPath"',
        statusCode: 422,
      })
    }
    const limitRaw = c.req.query('limit')
    const limit = limitRaw
      ? Math.max(1, Math.trunc(Number.parseInt(limitRaw, 10) || 50))
      : 50
    const { stdout } = await execGit(projectPath, [
      'log', '--format=%H%n%h%n%s%n%an%n%aI%n%D%n---', `-${limit}`,
    ])
    return c.json(envelope(parseGitLog(stdout)))
  })

  // GET /git/diff?projectPath=...&filePath=...&staged=...
  routes.get('/git/diff', async (c) => {
    const projectPath = c.req.query('projectPath')
    if (!projectPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Missing query parameter "projectPath"',
        statusCode: 422,
      })
    }
    const filePath = c.req.query('filePath')
    const staged = c.req.query('staged') === 'true'
    const args = ['diff']
    if (staged) args.push('--staged')
    if (filePath) args.push('--', filePath)
    const { stdout } = await execGit(projectPath, args)
    return c.json(envelope(stdout))
  })

  // POST /git/checkout
  routes.post('/git/checkout', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body.projectPath !== 'string' || typeof body.branch !== 'string') {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and branch',
        statusCode: 422,
      })
    }
    await execGit(body.projectPath, ['checkout', body.branch])
    return c.json(envelope({ checkedOut: true }))
  })

  // POST /git/branches (create branch)
  routes.post('/git/branches', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body.projectPath !== 'string' || typeof body.name !== 'string') {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and name',
        statusCode: 422,
      })
    }
    await execGit(body.projectPath, ['checkout', '-b', body.name])
    return c.json(envelope({ created: true }))
  })

  return routes
}
