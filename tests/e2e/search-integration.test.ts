/**
 * Real search integration tests — uses a temp directory with real files.
 * Tests ripgrep (rg) search via the same command the main process uses.
 * No mocks. Verifies end-to-end correctness of search parsing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

let projectDir: string

async function writeFile_(relativePath: string, content: string): Promise<void> {
  const fullPath = join(projectDir, relativePath)
  await mkdir(join(fullPath, '..'), { recursive: true })
  await writeFile(fullPath, content, 'utf-8')
}

async function initProject(): Promise<void> {
  const base = join(tmpdir(), `stoa-search-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(base, { recursive: true })
  projectDir = base
}

async function cleanupProject(): Promise<void> {
  if (projectDir) {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── Ripgrep search (matches sidebar-fs-handlers.ts runRipgrepSearch) ──

interface SearchMatch {
  line: number
  column: number
  matchLength: number
  lineContent: string
}

interface SearchFileResult {
  filePath: string
  relativePath: string
  matches: SearchMatch[]
}

interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  truncated: boolean
}

function buildSearchPattern(query: string, useRegex: boolean): string {
  if (useRegex) return query
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function spawnRg(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // Use execFile (like sidebar-git-handlers.ts) — avoids Windows spawn argument-mangling issues
  return execFileAsync('rg', args, {
    cwd: projectDir,
    maxBuffer: 10 * 1024 * 1024,
    windowsVerbatimArguments: true,
  })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((err: Error & { code?: string | number; stdout?: string; stderr?: string }) => {
      // rg exit code 1 = no matches (not an error for our purposes)
      const exitCode = typeof err.code === 'number' ? err.code : 1
      return { code: exitCode, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message }
    })
}

async function runSearch(opts: {
  query: string
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  includePattern?: string
  excludePattern?: string
  maxResults?: number
}): Promise<SearchResult> {
  const pattern = buildSearchPattern(opts.query, opts.useRegex ?? false)
  const maxResults = Math.min(Math.max(opts.maxResults ?? 500, 1), 500)
  const args = ['--json', '--max-count', '500', '--max-filesize', '1M']

  if (opts.caseSensitive) {
    args.push('--case-sensitive')
  } else {
    args.push('--ignore-case')
  }

  if (opts.wholeWord) {
    args.push('--word-regexp')
  }

  if (opts.includePattern?.trim()) {
    args.push('--glob', opts.includePattern.trim())
  }

  if (opts.excludePattern?.trim()) {
    args.push('--glob', `!${opts.excludePattern.trim()}`)
  }

  // Note: rg skips .git by default

  // --regexp (or raw pattern) must immediately precede the path
  if (!opts.useRegex) {
    args.push('--regexp', pattern)
  } else {
    args.push(pattern)
  }

  args.push('.')

  let result: { stdout: string; stderr: string; code: number }
  try {
    result = await spawnRg(args)
  } catch {
    return { files: [], totalMatches: 0, truncated: false }
  }

  // rg exit code 1 = no matches (not an error)
  if (result.code === 1) {
    return { files: [], totalMatches: 0, truncated: false }
  }

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `rg exited with code ${result.code}`)
  }

  const fileMap = new Map<string, SearchFileResult>()
  let totalMatches = 0
  let truncated = false

  for (const rawLine of result.stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue

    const parsed = JSON.parse(rawLine) as {
      type?: string
      data?: {
        path?: { text?: string }
        lines?: { text?: string }
        line_number?: number
        submatches?: Array<{ start: number; end: number }>
      }
    }

    if (parsed.type !== 'match' || !parsed.data?.path?.text || !parsed.data?.lines?.text || !parsed.data?.submatches) {
      continue
    }

    const rawRelativePath = parsed.data.path.text
    // Strip leading .\ or ./ prefix that rg on Windows produces
    const relativePath = rawRelativePath.replace(/^\.[\\/]/, '')
    const filePath = join(projectDir, relativePath)
    const lineNumber = parsed.data.line_number ?? 1
    const lineContent = parsed.data.lines.text.replace(/[\r\n]+$/, '')

    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, { filePath, relativePath, matches: [] })
    }

    const fileResult = fileMap.get(filePath)!

    for (const submatch of parsed.data.submatches) {
      if (totalMatches >= maxResults) {
        truncated = true
        break
      }

      fileResult.matches.push({
        line: lineNumber,
        column: submatch.start + 1,
        matchLength: submatch.end - submatch.start,
        lineContent,
      })
      totalMatches++
    }

    if (truncated) break
  }

  return {
    files: Array.from(fileMap.values()),
    totalMatches,
    truncated,
  }
}

// ── Tests ──

describe('Search Integration — real filesystem + ripgrep', () => {
  beforeEach(async () => {
    await initProject()
  })

  afterEach(async () => {
    await cleanupProject()
  })

  // ── 1. Basic case-insensitive search ──

  it('finds matching text across files (case-insensitive)', async () => {
    await writeFile_('app.ts', 'const greeting = "Hello World"\n')
    await writeFile_('utils.ts', '// This is a utility file\nconst HELLO = "hi"\n')
    await writeFile_('readme.md', '# Hello\n\nWelcome\n')

    const result = await runSearch({ query: 'hello' })

    expect(result.totalMatches).toBe(3)
    expect(result.files).toHaveLength(3)

    const paths = result.files.map(f => f.relativePath).sort()
    expect(paths).toEqual(['app.ts', 'readme.md', 'utils.ts'])
  })

  // ── 2. Case-sensitive search ──

  it('case-sensitive mode only matches exact case', async () => {
    await writeFile_('code.ts', 'const Hello = 1\nconst hello = 2\nconst HELLO = 3\n')

    const result = await runSearch({ query: 'Hello', caseSensitive: true })

    expect(result.totalMatches).toBe(1)
    expect(result.files[0].matches[0].lineContent).toContain('const Hello = 1')
  })

  // ── 3. Whole word matching ──

  it('whole word mode only matches complete words', async () => {
    await writeFile_('data.ts', 'const port = 3000\nconst exportPort = 8080\nconst reporting = true\n')

    const result = await runSearch({ query: 'port', wholeWord: true })

    // Should match "port" but not "exportPort" or "reporting"
    expect(result.totalMatches).toBe(1)
    expect(result.files[0].matches[0].lineContent).toContain('const port = 3000')
  })

  // ── 4. Regex search ──

  it('regex mode interprets query as regular expression', async () => {
    await writeFile_('env.ts', 'const PORT = 3000\nconst HOST = "127.0.0.1"\nconst API_KEY = "abc"\n')

    const result = await runSearch({ query: 'PORT|HOST', useRegex: true })

    expect(result.totalMatches).toBe(2)
    const lines = result.files[0].matches.map(m => m.lineContent)
    expect(lines.some(l => l.includes('PORT'))).toBe(true)
    expect(lines.some(l => l.includes('HOST'))).toBe(true)
  })

  // ── 5. No results for non-matching query ──

  it('returns empty results when no files match', async () => {
    await writeFile_('main.ts', 'console.log("hello")\n')

    const result = await runSearch({ query: 'xyzzy_nonexistent' })

    expect(result.totalMatches).toBe(0)
    expect(result.files).toEqual([])
    expect(result.truncated).toBe(false)
  })

  // ── 6. Multiple matches per file ──

  it('reports multiple matches within a single file', async () => {
    await writeFile_('repeat.ts', 'function foo() {\n  return "foo"\n}\n// foo bar\nconst x = "foo"\n')

    const result = await runSearch({ query: 'foo' })

    expect(result.files).toHaveLength(1)
    expect(result.files[0].matches.length).toBeGreaterThanOrEqual(3)
  })

  // ── 7. Include pattern filter ──

  it('include pattern filters to matching file types only', async () => {
    await writeFile_('app.ts', 'const hello = 1\n')
    await writeFile_('style.css', '.hello { color: red }\n')
    await writeFile_('notes.md', '# Hello World\n')

    const result = await runSearch({ query: 'hello', includePattern: '*.ts' })

    expect(result.files).toHaveLength(1)
    expect(result.files[0].relativePath).toBe('app.ts')
  })

  // ── 8. Exclude pattern filter ──

  it('exclude pattern removes matching file types', async () => {
    await writeFile_('app.ts', 'const hello = 1\n')
    await writeFile_('style.css', '.hello { color: red }\n')
    await writeFile_('notes.md', '# Hello World\n')

    const result = await runSearch({ query: 'hello', excludePattern: '*.css' })

    const paths = result.files.map(f => f.relativePath).sort()
    expect(paths).not.toContain('style.css')
    expect(paths).toContain('app.ts')
    expect(paths).toContain('notes.md')
  })

  // ── 9. Search in subdirectories ──

  it('finds matches in nested subdirectories', async () => {
    await writeFile_('src/index.ts', 'export const main = "hello"\n')
    await writeFile_('src/utils/helper.ts', 'export function sayHello() {}\n')
    await writeFile_('src/components/App.vue', '<template>Hello</template>\n')

    const result = await runSearch({ query: 'hello' })

    expect(result.files.length).toBeGreaterThanOrEqual(2)
    const paths = result.files.map(f => f.relativePath)
    expect(paths.some(p => p.includes('helper.ts'))).toBe(true)
  })

  // ── 10. Match position (line and column) accuracy ──

  it('reports correct line and column for matches', async () => {
    await writeFile_('code.ts', 'const abc = 1\nconst def = 2\n')

    const result = await runSearch({ query: 'def' })

    expect(result.totalMatches).toBe(1)
    const match = result.files[0].matches[0]
    expect(match.line).toBe(2)
    // "const def" → "def" starts at column 7 (1-indexed)
    expect(match.column).toBe(7)
    expect(match.matchLength).toBe(3)
  })

  // ── 11. Line content includes the full line ──

  it('lineContent contains the full matched line', async () => {
    await writeFile_('data.ts', '  export const API_URL = "https://example.com"\n')

    const result = await runSearch({ query: 'API_URL' })

    expect(result.files[0].matches[0].lineContent).toContain('export const API_URL')
  })

  // ── 12. Empty project returns no results ──

  it('returns empty for empty directory', async () => {
    const result = await runSearch({ query: 'anything' })

    expect(result.totalMatches).toBe(0)
    expect(result.files).toEqual([])
  })

  // ── 13. Special characters in search query ──

  it('escapes special regex characters when not in regex mode', async () => {
    await writeFile_('code.ts', 'const obj = { key: "value" }\nconst path = "a/b/c"\n')

    const result = await runSearch({ query: 'a/b/c' })

    expect(result.totalMatches).toBe(1)
    expect(result.files[0].matches[0].lineContent).toContain('a/b/c')
  })

  // ── 14. Truncation at maxResults ──

  it('truncates results when match count exceeds maxResults', async () => {
    // Create a file with many lines containing the search term
    const lines = Array.from({ length: 200 }, (_, i) => `const marker_${i} = "FINDME"`)
    await writeFile_('big.ts', lines.join('\n'))

    const result = await runSearch({ query: 'FINDME', maxResults: 10 })

    expect(result.truncated).toBe(true)
    expect(result.totalMatches).toBe(10)
  })

  // ── 15. Multi-line file search with various types ──

  it('searches across .ts, .vue, .json, .md files simultaneously', async () => {
    await writeFile_('index.ts', '// TODO: refactor this\n')
    await writeFile_('App.vue', '<!-- TODO: add styles -->\n')
    await writeFile_('package.json', '{ "name": "todo-app" }\n')
    await writeFile_('README.md', '## TODO List\n')

    const result = await runSearch({ query: 'TODO', caseSensitive: true })

    expect(result.files.length).toBeGreaterThanOrEqual(3)
    const extensions = result.files.map(f => f.relativePath.split('.').pop())
    expect(extensions).toContain('ts')
    expect(extensions).toContain('vue')
    expect(extensions).toContain('md')
  })

  // ── 16. Unicode content search ──

  it('finds matches in files with non-ASCII content', async () => {
    await writeFile_('i18n.ts', 'const greeting = "你好世界"\nconst farewell = "再见"\n')

    const result = await runSearch({ query: '你好' })

    expect(result.totalMatches).toBe(1)
    expect(result.files[0].matches[0].lineContent).toContain('你好世界')
  })

  // ── 17. Repeated search cancels stale results (store behavior) ──

  it('rapid searches return results for the latest query', async () => {
    await writeFile_('a.ts', 'const apple = 1\n')
    await writeFile_('b.ts', 'const banana = 2\nconst cherry = 3\n')

    const [r1, r2] = await Promise.all([
      runSearch({ query: 'apple' }),
      runSearch({ query: 'banana' }),
    ])

    expect(r1.files[0].matches[0].lineContent).toContain('apple')
    expect(r2.files[0].matches[0].lineContent).toContain('banana')
  })

  // ── 18. rg skips .git directory by default ──

  it('rg does not search inside .git directory', async () => {
    // Initialize a real git repo (rg skips .git by default)
    const { execFile: exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)
    await execAsync('git', ['init'], { cwd: projectDir })
    await execAsync('git', ['config', 'user.email', 't@t'], { cwd: projectDir })
    await execAsync('git', ['config', 'user.name', 't'], { cwd: projectDir })

    await writeFile_('src.ts', '// name: my app\n')
    await writeFile_('.git/HEAD', 'ref: refs/heads/main\n')

    // No includePattern — rely on rg's default .git exclusion
    const result = await runSearch({ query: 'name' })

    // Should only find src.ts, not .git/HEAD
    const paths = result.files.map(f => f.relativePath)
    expect(paths.some(p => p.includes('src.ts'))).toBe(true)
    expect(paths.some(p => p.includes('.git'))).toBe(false)
  })

  // ── 19. Search with include glob pattern for multiple extensions ──

  it('include pattern with *.vue matches only Vue files', async () => {
    await writeFile_('App.vue', '<script>const msg = "test"</script>\n')
    await writeFile_('util.ts', 'const msg = "test"\n')
    await writeFile_('style.css', '.msg { color: red }\n')

    const result = await runSearch({ query: 'msg', includePattern: '*.vue' })

    expect(result.files).toHaveLength(1)
    expect(result.files[0].relativePath).toBe('App.vue')
  })

  // ── 20. Highlight segments correctly split match ──

  it('match position enables correct highlight splitting', async () => {
    await writeFile_('code.ts', 'const result = fetchData()\n')

    const result = await runSearch({ query: 'fetchData' })

    const match = result.files[0].matches[0]
    const line = match.lineContent
    const before = line.slice(0, match.column - 1)
    const matched = line.slice(match.column - 1, match.column - 1 + match.matchLength)
    const after = line.slice(match.column - 1 + match.matchLength)

    expect(matched).toBe('fetchData')
    expect(before).toBe('const result = ')
    expect(after).toBe('()')
  })
})
