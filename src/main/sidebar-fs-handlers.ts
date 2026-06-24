import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type {
  DirEntry,
  FileCreateRequest,
  FileDeleteRequest,
  FileRenameRequest,
  FileWriteRequest,
  FsChangedEvent,
  SearchFileResult,
  SearchMatch,
  SearchOptions,
  SearchResult,
} from '@shared/sidebar-types'
import type { BrowserWindow } from 'electron'

type MainWindowGetter = () => BrowserWindow | null

interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

interface ChokidarWatchOptions {
  ignored?: string | RegExp | ((path: string) => boolean)
  ignoreInitial?: boolean
  persistent?: boolean
  awaitWriteFinish?: {
    stabilityThreshold: number
    pollInterval: number
  }
}

interface ChokidarWatcher {
  on(event: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', listener: (filePath: string) => void): ChokidarWatcher
  on(event: 'error', listener: (error: Error) => void): ChokidarWatcher
  close(): Promise<void> | void
}

interface ChokidarModule {
  watch(paths: string | readonly string[], options?: ChokidarWatchOptions): ChokidarWatcher
}

interface SearchAccumulator {
  files: SearchFileResult[]
  fileMap: Map<string, SearchFileResult>
  totalMatches: number
  truncated: boolean
  maxResults: number
}

interface WatcherState {
  watcher: ChokidarWatcher
  pendingEvents: Map<string, FsChangedEvent>
  debounceTimer: NodeJS.Timeout | null
}

const WATCH_DEBOUNCE_MS = 100
const RG_MAX_COUNT = 500
const RG_MAX_FILESIZE = '1M'
const CHOKIDAR_MODULE_NAME = 'chokidar'
const HIDDEN_WORKSPACE_DIR_NAMES = new Set(['.git', '.stoa'])
const INTERNAL_WORKSPACE_DIR_SEGMENT = /(^|[\\/])\.(?:git|stoa)([\\/]|$)/

let mainWindowGetter: MainWindowGetter | null = null
let chokidarPromise: Promise<ChokidarModule> | null = null

const watcherStates = new Map<string, WatcherState>()
const watcherStartPromises = new Map<string, Promise<void>>()

function normalizeRelativePath(targetPath: string, rootPath: string): string {
  const relativePath = path.relative(rootPath, targetPath)
  return relativePath.split(path.sep).join('/')
}

function formatHandlerError(action: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`Filesystem ${action} failed: ${error.message}`)
  }

  return new Error(`Filesystem ${action} failed: ${String(error)}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchPattern(options: SearchOptions): string {
  if (options.useRegex) {
    return options.query
  }

  return escapeRegExp(options.query)
}

function shouldIgnoreWatchPath(filePath: string): boolean {
  return INTERNAL_WORKSPACE_DIR_SEGMENT.test(filePath)
}

function addSearchMatch(accumulator: SearchAccumulator, filePath: string, relativePath: string, match: SearchMatch): void {
  if (accumulator.totalMatches >= accumulator.maxResults) {
    accumulator.truncated = true
    return
  }

  let fileResult = accumulator.fileMap.get(filePath)
  if (!fileResult) {
    fileResult = {
      filePath,
      relativePath,
      matches: [],
    }
    accumulator.fileMap.set(filePath, fileResult)
    accumulator.files.push(fileResult)
  }

  fileResult.matches.push(match)
  accumulator.totalMatches += 1

  if (accumulator.totalMatches >= accumulator.maxResults) {
    accumulator.truncated = true
  }
}

function createSearchAccumulator(maxResults: number): SearchAccumulator {
  return {
    files: [],
    fileMap: new Map<string, SearchFileResult>(),
    totalMatches: 0,
    truncated: false,
    maxResults,
  }
}

function finalizeSearchResult(accumulator: SearchAccumulator): SearchResult {
  return {
    files: accumulator.files,
    totalMatches: accumulator.totalMatches,
    truncated: accumulator.truncated,
  }
}

function spawnCommand(command: string, args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

async function loadChokidar(): Promise<ChokidarModule> {
  if (!chokidarPromise) {
    chokidarPromise = (async () => {
      const imported = await import(CHOKIDAR_MODULE_NAME) as Partial<ChokidarModule> & {
        default?: Partial<ChokidarModule>
      }
      const candidate = typeof imported.watch === 'function' ? imported : imported.default

      if (!candidate || typeof candidate.watch !== 'function') {
        throw new Error('chokidar is not available in this build.')
      }

      return {
        watch: candidate.watch.bind(candidate),
      }
    })()
  }

  return chokidarPromise
}

function flushWatcherEvents(projectPath: string): void {
  const state = watcherStates.get(projectPath)
  const getWindow = mainWindowGetter
  if (!state || !getWindow) {
    return
  }

  state.debounceTimer = null
  const mainWindow = getWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    state.pendingEvents.clear()
    return
  }

  for (const event of state.pendingEvents.values()) {
    mainWindow.webContents.send(IPC_CHANNELS.fsChanged, event)
  }

  state.pendingEvents.clear()
}

function queueWatcherEvent(projectPath: string, absolutePath: string, kind: FsChangedEvent['kind']): void {
  const state = watcherStates.get(projectPath)
  if (!state || shouldIgnoreWatchPath(absolutePath)) {
    return
  }

  const relativePath = normalizeRelativePath(absolutePath, projectPath)
  if (!relativePath || relativePath === '.git' || relativePath.startsWith('.git/') || relativePath === '.stoa' || relativePath.startsWith('.stoa/')) {
    return
  }

  state.pendingEvents.set(relativePath, {
    projectPath,
    relativePath,
    kind,
  })

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
  }

  state.debounceTimer = setTimeout(() => {
    flushWatcherEvents(projectPath)
  }, WATCH_DEBOUNCE_MS)
}

async function runRipgrepSearch(options: SearchOptions): Promise<SearchResult> {
  const pattern = buildSearchPattern(options)
  const maxResults = Math.min(Math.max(options.maxResults, 1), RG_MAX_COUNT)
  const args = ['--json', '--max-count', String(RG_MAX_COUNT), '--max-filesize', RG_MAX_FILESIZE]

  if (options.caseSensitive) {
    args.push('--case-sensitive')
  } else {
    args.push('--ignore-case')
  }

  if (options.wholeWord) {
    args.push('--word-regexp')
  }

  // Glob filters must come BEFORE the pattern
  if (options.includePattern.trim()) {
    args.push('--glob', options.includePattern.trim())
  }

  if (options.excludePattern.trim()) {
    args.push('--glob', `!${options.excludePattern.trim()}`)
  }

  // Note: rg already skips .git by default (respects .gitignore + hidden files)

  // --regexp (or raw pattern) must be the LAST argument before the path
  if (!options.useRegex) {
    args.push('--regexp', pattern)
  } else {
    args.push(pattern)
  }

  args.push('.')

  const result = await spawnCommand('rg', args, options.rootPath)
  if (result.code === 1) {
    return { files: [], totalMatches: 0, truncated: false }
  }

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `rg exited with code ${result.code}`)
  }

  const accumulator = createSearchAccumulator(maxResults)
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      continue
    }

    const parsed = JSON.parse(rawLine) as {
      type?: string
      data?: {
        path?: { text?: string }
        lines?: { text?: string }
        line_number?: number
        submatches?: Array<{ start: number; end: number }>
      }
    }

    if (parsed.type !== 'match' || !parsed.data?.path?.text || !parsed.data.lines?.text || !parsed.data.submatches) {
      continue
    }

    const rawRelativePath = parsed.data.path.text
    // Strip leading .\ or ./ prefix that rg produces on Windows
    const relativePath = rawRelativePath.replace(/^\.[\\/]/, '')
    const filePath = path.join(options.rootPath, relativePath)
    const lineNumber = parsed.data.line_number ?? 1
    const lineContent = parsed.data.lines.text.replace(/[\r\n]+$/, '')

    for (const submatch of parsed.data.submatches) {
      addSearchMatch(accumulator, filePath, relativePath.split(path.sep).join('/'), {
        line: lineNumber,
        column: submatch.start + 1,
        matchLength: submatch.end - submatch.start,
        lineContent,
      })
    }
  }

  return finalizeSearchResult(accumulator)
}

async function runGitGrepSearch(options: SearchOptions): Promise<SearchResult> {
  const pattern = buildSearchPattern(options)
  const maxResults = Math.min(Math.max(options.maxResults, 1), RG_MAX_COUNT)
  const args = ['grep', '-n', '--column', '-I']

  if (!options.caseSensitive) {
    args.push('-i')
  }

  if (options.wholeWord) {
    args.push('--word-regexp')
  }

  args.push(options.useRegex ? '-E' : '-F', pattern, '--')

  if (options.includePattern.trim()) {
    args.push(`:(glob)${options.includePattern.trim()}`)
  }

  if (options.excludePattern.trim()) {
    args.push(`:(exclude,glob)${options.excludePattern.trim()}`)
  }

  args.push(':(exclude).git')

  const result = await spawnCommand('git', args, options.rootPath)
  if (result.code === 1) {
    return { files: [], totalMatches: 0, truncated: false }
  }

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git grep exited with code ${result.code}`)
  }

  const accumulator = createSearchAccumulator(maxResults)
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      continue
    }

    const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(rawLine)
    if (!match) {
      continue
    }

    const relativePath = match[1]
    const filePath = path.join(options.rootPath, relativePath)
    addSearchMatch(accumulator, filePath, relativePath.split(path.sep).join('/'), {
      line: Number(match[2]),
      column: Number(match[3]),
      matchLength: options.query.length,
      lineContent: match[4],
    })
  }

  return finalizeSearchResult(accumulator)
}

async function searchContent(options: SearchOptions): Promise<SearchResult> {
  try {
    return await runRipgrepSearch(options)
  } catch (error) {
    if (error instanceof Error && /ENOENT|not recognized|not available/i.test(error.message)) {
      return runGitGrepSearch(options)
    }

    throw error
  }
}

async function listDirectory(projectPath: string, relativePath?: string): Promise<DirEntry[]> {
  const fullPath = relativePath ? path.join(projectPath, relativePath) : projectPath
  const entries = await readdir(fullPath, { withFileTypes: true })

  const directoryEntries = await Promise.all(entries
    .filter((entry) => !HIDDEN_WORKSPACE_DIR_NAMES.has(entry.name))
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
        modifiedAt: Number.isNaN(stats.mtime.getTime()) ? null : stats.mtime.toISOString(),
      } satisfies DirEntry
    }))

  return directoryEntries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}

export async function startFsWatcher(projectPath: string): Promise<void> {
  if (watcherStates.has(projectPath)) {
    return
  }

  const inFlight = watcherStartPromises.get(projectPath)
  if (inFlight) {
    await inFlight
    return
  }

  const startPromise = (async () => {
    const chokidar = await loadChokidar()
    const watcher = chokidar.watch(projectPath, {
      ignored: shouldIgnoreWatchPath,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: WATCH_DEBOUNCE_MS,
        pollInterval: 25,
      },
    })

    const state: WatcherState = {
      watcher,
      pendingEvents: new Map(),
      debounceTimer: null,
    }

    watcher
      .on('add', (filePath) => queueWatcherEvent(projectPath, filePath, 'create'))
      .on('addDir', (filePath) => queueWatcherEvent(projectPath, filePath, 'create'))
      .on('change', (filePath) => queueWatcherEvent(projectPath, filePath, 'modify'))
      .on('unlink', (filePath) => queueWatcherEvent(projectPath, filePath, 'delete'))
      .on('unlinkDir', (filePath) => queueWatcherEvent(projectPath, filePath, 'delete'))
      .on('error', (error) => {
        console.error('[sidebar-fs-handlers] Watcher error:', error)
      })

    watcherStates.set(projectPath, state)
  })()

  watcherStartPromises.set(projectPath, startPromise)

  try {
    await startPromise
  } finally {
    watcherStartPromises.delete(projectPath)
  }
}

export async function stopFsWatcher(projectPath: string): Promise<void> {
  const state = watcherStates.get(projectPath)
  if (!state) {
    return
  }

  watcherStates.delete(projectPath)

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
  }

  state.pendingEvents.clear()
  await state.watcher.close()
}

export function registerFilesystemHandlers(ipcMain: Electron.IpcMain, getMainWindow: MainWindowGetter): void {
  mainWindowGetter = getMainWindow

  ipcMain.handle(IPC_CHANNELS.fsReadDir, async (_event, projectPath: string, relativePath?: string) => {
    try {
      // Start watcher in background — do not block listing on watcher startup
      void startFsWatcher(projectPath).catch(() => {})
      return await listDirectory(projectPath, relativePath)
    } catch (error) {
      throw formatHandlerError('read-dir', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsReadFile, async (_event, projectPath: string, relativePath: string) => {
    try {
      return await readFile(path.join(projectPath, relativePath), 'utf-8')
    } catch (error) {
      throw formatHandlerError('read-file', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsWriteFile, async (_event, request: FileWriteRequest) => {
    try {
      const fullPath = path.join(request.projectPath, request.relativePath)
      await mkdir(path.dirname(fullPath), { recursive: true })
      await writeFile(fullPath, request.content, 'utf-8')
    } catch (error) {
      throw formatHandlerError('write-file', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsCreate, async (_event, request: FileCreateRequest) => {
    try {
      const fullPath = path.join(request.projectPath, request.relativePath)
      if (request.isDirectory) {
        await mkdir(fullPath, { recursive: true })
        return
      }

      await mkdir(path.dirname(fullPath), { recursive: true })
      await writeFile(fullPath, '', 'utf-8')
    } catch (error) {
      throw formatHandlerError('create', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsRename, async (_event, request: FileRenameRequest) => {
    try {
      const fromPath = path.join(request.projectPath, request.oldRelativePath)
      const toPath = path.join(request.projectPath, request.newRelativePath)
      await mkdir(path.dirname(toPath), { recursive: true })
      await rename(fromPath, toPath)
    } catch (error) {
      throw formatHandlerError('rename', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsDelete, async (_event, request: FileDeleteRequest) => {
    try {
      await rm(path.join(request.projectPath, request.relativePath), { recursive: true, force: true })
    } catch (error) {
      throw formatHandlerError('delete', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsSearch, async (_event, options: SearchOptions) => {
    try {
      return await searchContent(options)
    } catch (error) {
      throw formatHandlerError('search', error)
    }
  })
}
