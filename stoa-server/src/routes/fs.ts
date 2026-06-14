/**
 * Filesystem route group — Stoa Server side.
 *
 * Mounts at `/api/v1`. Endpoints mirror the Electron IPC handlers in
 * `src/main/sidebar-fs-handlers.ts` but speak HTTP/JSON and broadcast
 * `fs:changed` events over the WebSocket hub.
 *
 * The actual filesystem operations are pure Node (`fs/promises` + `child_process`).
 * No Electron dependency.
 */
import { Hono } from 'hono'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile, type ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { AppError, type ApiResponse } from '../shared/errors'
import type { WsHub } from '../ws/hub'
import type {
  DirEntry,
  FileCreateRequest,
  FileDeleteRequest,
  FileRenameRequest,
  FileWriteRequest,
  SearchOptions,
  SearchResult,
  SearchMatch,
  SearchFileResult,
} from 'stoa-shared'

const execFileAsync = promisify(execFile)

export interface FsRouteDeps {
  /** WebSocket hub for broadcasting `fs:changed` events. */
  wsHub: WsHub
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Path traversal guard: resolve and verify the resolved path starts with `base`. */
function safeResolve(base: string, relative: string): string {
  const resolved = path.resolve(base, relative)
  // Normalise both for comparison (handles drive-letter casing on Windows)
  const normBase = path.normalize(base)
  const normResolved = path.normalize(resolved)
  if (!normResolved.startsWith(normBase + path.sep) && normResolved !== normBase) {
    throw new AppError({
      code: 'path_traversal',
      message: 'Resolved path escapes the project root',
      statusCode: 403,
    })
  }
  return resolved
}

function normalizeRelativePath(targetPath: string, rootPath: string): string {
  const relativePath = path.relative(rootPath, targetPath)
  return relativePath.split(path.sep).join('/')
}

const RG_MAX_COUNT = 500
const RG_MAX_FILESIZE = '1M'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchPattern(options: SearchOptions): string {
  if (options.useRegex) return options.query
  return escapeRegExp(options.query)
}

function emptySearchResult(): SearchResult {
  return { files: [], totalMatches: 0, truncated: false }
}

function isNoMatchExit(error: unknown): error is ExecFileException {
  return error instanceof Error && 'code' in error && error.code === 1
}

interface SearchAccumulator {
  files: SearchFileResult[]
  fileMap: Map<string, SearchFileResult>
  totalMatches: number
  truncated: boolean
  maxResults: number
}

function addSearchMatch(
  accumulator: SearchAccumulator,
  filePath: string,
  relativePath: string,
  match: SearchMatch,
): void {
  if (accumulator.totalMatches >= accumulator.maxResults) {
    accumulator.truncated = true
    return
  }
  let fileResult = accumulator.fileMap.get(filePath)
  if (!fileResult) {
    fileResult = { filePath, relativePath, matches: [] }
    accumulator.fileMap.set(filePath, fileResult)
    accumulator.files.push(fileResult)
  }
  fileResult.matches.push(match)
  accumulator.totalMatches += 1
  if (accumulator.totalMatches >= accumulator.maxResults) {
    accumulator.truncated = true
  }
}

async function runRipgrepSearch(options: SearchOptions): Promise<SearchResult> {
  const pattern = buildSearchPattern(options)
  const maxResults = Math.min(Math.max(options.maxResults, 1), RG_MAX_COUNT)
  const args = [
    '--json', '--max-count', String(RG_MAX_COUNT),
    '--max-filesize', RG_MAX_FILESIZE,
  ]
  if (options.caseSensitive) {
    args.push('--case-sensitive')
  } else {
    args.push('--ignore-case')
  }
  if (options.wholeWord) args.push('--word-regexp')
  if (options.includePattern.trim()) {
    args.push('--glob', options.includePattern.trim())
  }
  if (options.excludePattern.trim()) {
    args.push('--glob', `!${options.excludePattern.trim()}`)
  }
  if (!options.useRegex) {
    args.push('--regexp', pattern)
  } else {
    args.push(pattern)
  }
  args.push('.')

  let stdout: string
  try {
    const result = await execFileAsync('rg', args, {
      cwd: options.rootPath,
      maxBuffer: 10 * 1024 * 1024,
    })
    stdout = result.stdout
  } catch (error) {
    if (isNoMatchExit(error)) {
      return emptySearchResult()
    }
    throw error
  }
  if (!stdout.trim()) {
    return emptySearchResult()
  }

  const accumulator: SearchAccumulator = {
    files: [],
    fileMap: new Map(),
    totalMatches: 0,
    truncated: false,
    maxResults,
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    let parsed: {
      type?: string
      data?: {
        path?: { text?: string }
        lines?: { text?: string }
        line_number?: number
        submatches?: Array<{ start: number; end: number }>
      }
    }
    try {
      parsed = JSON.parse(rawLine)
    } catch {
      continue
    }
    if (
      parsed.type !== 'match' ||
      !parsed.data?.path?.text ||
      !parsed.data?.lines?.text ||
      !parsed.data?.submatches
    ) {
      continue
    }
    const rawRelativePath = parsed.data.path.text
    const relativePath = rawRelativePath.replace(/^\.[\\/]/, '')
    const filePath = path.join(options.rootPath, relativePath)
    const lineNumber = parsed.data.line_number ?? 1
    const lineContent = parsed.data.lines.text.replace(/[\r\n]+$/, '')
    for (const submatch of parsed.data.submatches) {
      addSearchMatch(
        accumulator,
        filePath,
        relativePath.split(path.sep).join('/'),
        {
          line: lineNumber,
          column: submatch.start + 1,
          matchLength: submatch.end - submatch.start,
          lineContent,
        },
      )
    }
  }

  return {
    files: accumulator.files,
    totalMatches: accumulator.totalMatches,
    truncated: accumulator.truncated,
  }
}

async function runGitGrepSearch(options: SearchOptions): Promise<SearchResult> {
  const pattern = buildSearchPattern(options)
  const maxResults = Math.min(Math.max(options.maxResults, 1), RG_MAX_COUNT)
  const args = ['grep', '-n', '--column', '-I']
  if (!options.caseSensitive) args.push('-i')
  if (options.wholeWord) args.push('--word-regexp')
  args.push(options.useRegex ? '-E' : '-F', pattern, '--')
  if (options.includePattern.trim()) {
    args.push(`:(glob)${options.includePattern.trim()}`)
  }
  if (options.excludePattern.trim()) {
    args.push(`:(exclude,glob)${options.excludePattern.trim()}`)
  }
  args.push(':(exclude).git')

  let stdout: string
  try {
    const result = await execFileAsync('git', args, {
      cwd: options.rootPath,
      maxBuffer: 10 * 1024 * 1024,
    })
    stdout = result.stdout
  } catch (error) {
    if (isNoMatchExit(error)) {
      return emptySearchResult()
    }
    throw error
  }
  if (!stdout.trim()) {
    return emptySearchResult()
  }

  const accumulator: SearchAccumulator = {
    files: [],
    fileMap: new Map(),
    totalMatches: 0,
    truncated: false,
    maxResults,
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(rawLine)
    if (!match) continue
    const relativePath = match[1]!
    const filePath = path.join(options.rootPath, relativePath)
    addSearchMatch(
      accumulator,
      filePath,
      relativePath.split(path.sep).join('/'),
      {
        line: Number(match[2]),
        column: Number(match[3]),
        matchLength: options.query.length,
        lineContent: match[4]!,
      },
    )
  }

  return {
    files: accumulator.files,
    totalMatches: accumulator.totalMatches,
    truncated: accumulator.truncated,
  }
}

async function searchContent(options: SearchOptions): Promise<SearchResult> {
  try {
    return await runRipgrepSearch(options)
  } catch (error) {
    if (
      error instanceof Error &&
      /ENOENT|not recognized|not available/i.test(error.message)
    ) {
      return runGitGrepSearch(options)
    }
    throw error
  }
}

async function listDirectory(
  projectPath: string,
  relativePath?: string,
): Promise<DirEntry[]> {
  const fullPath = relativePath
    ? path.join(projectPath, relativePath)
    : projectPath
  const entries = await readdir(fullPath, { withFileTypes: true })
  const directoryEntries = await Promise.all(
    entries
      .filter((entry) => entry.name !== '.git')
      .map(async (entry) => {
        const entryPath = path.join(fullPath, entry.name)
        const stats = await stat(entryPath)
        return {
          name: entry.name,
          path: entryPath,
          relativePath: normalizeRelativePath(entryPath, projectPath),
          isDirectory: entry.isDirectory(),
          isSymlink: entry.isSymbolicLink(),
          size: stats.size,
          modifiedAt: Number.isNaN(stats.mtime.getTime())
            ? null
            : stats.mtime.toISOString(),
        } satisfies DirEntry
      }),
  )
  return directoryEntries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createFsRoutes(deps: FsRouteDeps): Hono {
  const routes = new Hono()

  // GET /fs/dir?projectPath=...&path=...
  routes.get('/fs/dir', async (c) => {
    const projectPath = c.req.query('projectPath')
    if (!projectPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Missing query parameter "projectPath"',
        statusCode: 422,
      })
    }
    const relativePath = c.req.query('path') ?? undefined
    try {
      const entries = await listDirectory(projectPath, relativePath)
      return c.json(envelope(entries))
    } catch (error) {
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem read-dir failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  // GET /fs/file?projectPath=...&path=...
  routes.get('/fs/file', async (c) => {
    const projectPath = c.req.query('projectPath')
    const relativePath = c.req.query('path')
    if (!projectPath || !relativePath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Missing query parameters "projectPath" and "path"',
        statusCode: 422,
      })
    }
    try {
      const fullPath = safeResolve(projectPath, relativePath)
      const content = await readFile(fullPath, 'utf-8')
      return c.json(envelope(content))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem read-file failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  // PUT /fs/file
  routes.put('/fs/file', async (c) => {
    const body = await c.req.json().catch(() => null) as FileWriteRequest | null
    if (!body || !body.projectPath || !body.relativePath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and relativePath',
        statusCode: 422,
      })
    }
    try {
      const fullPath = safeResolve(body.projectPath, body.relativePath)
      await mkdir(path.dirname(fullPath), { recursive: true })
      await writeFile(fullPath, body.content, 'utf-8')
      deps.wsHub.broadcast('fs:changed', {
        projectPath: body.projectPath,
        relativePath: body.relativePath,
        kind: 'modify',
      })
      return c.json(envelope({ written: true }))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem write-file failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  // POST /fs/entry (create file or directory)
  routes.post('/fs/entry', async (c) => {
    const body = await c.req.json().catch(() => null) as FileCreateRequest | null
    if (!body || !body.projectPath || !body.relativePath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and relativePath',
        statusCode: 422,
      })
    }
    try {
      const fullPath = safeResolve(body.projectPath, body.relativePath)
      if (body.isDirectory) {
        await mkdir(fullPath, { recursive: true })
      } else {
        await mkdir(path.dirname(fullPath), { recursive: true })
        await writeFile(fullPath, '', 'utf-8')
      }
      deps.wsHub.broadcast('fs:changed', {
        projectPath: body.projectPath,
        relativePath: body.relativePath,
        kind: 'create',
      })
      return c.json(envelope({ created: true }))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem create failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  // POST /fs/rename
  routes.post('/fs/rename', async (c) => {
    const body = await c.req.json().catch(() => null) as FileRenameRequest | null
    if (!body || !body.projectPath || !body.oldRelativePath || !body.newRelativePath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath, oldRelativePath, and newRelativePath',
        statusCode: 422,
      })
    }
    try {
      const fromPath = safeResolve(body.projectPath, body.oldRelativePath)
      const toPath = safeResolve(body.projectPath, body.newRelativePath)
      await mkdir(path.dirname(toPath), { recursive: true })
      await rename(fromPath, toPath)
      deps.wsHub.broadcast('fs:changed', {
        projectPath: body.projectPath,
        relativePath: body.oldRelativePath,
        kind: 'delete',
      })
      deps.wsHub.broadcast('fs:changed', {
        projectPath: body.projectPath,
        relativePath: body.newRelativePath,
        kind: 'create',
      })
      return c.json(envelope({ renamed: true }))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem rename failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  // DELETE /fs/entry
  routes.delete('/fs/entry', async (c) => {
    const body = await c.req.json().catch(() => null) as FileDeleteRequest | null
    if (!body || !body.projectPath || !body.relativePath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include projectPath and relativePath',
        statusCode: 422,
      })
    }
    try {
      const fullPath = safeResolve(body.projectPath, body.relativePath)
      await rm(fullPath, { recursive: true, force: true })
      deps.wsHub.broadcast('fs:changed', {
        projectPath: body.projectPath,
        relativePath: body.relativePath,
        kind: 'delete',
      })
      return c.json(envelope({ deleted: true }))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem delete failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  // POST /fs/search
  routes.post('/fs/search', async (c) => {
    const body = await c.req.json().catch(() => null) as SearchOptions | null
    if (!body || !body.query || !body.rootPath) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include query and rootPath',
        statusCode: 422,
      })
    }
    try {
      const result = await searchContent(body)
      return c.json(envelope(result))
    } catch (error) {
      throw new AppError({
        code: 'internal_error',
        message: `Filesystem search failed: ${error instanceof Error ? error.message : String(error)}`,
        statusCode: 500,
      })
    }
  })

  return routes
}
