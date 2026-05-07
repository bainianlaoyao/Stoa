# Terminal File Link Detection + Ctrl+Click Navigation (P1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect file paths and URLs in terminal session output, resolve them against CWD, validate existence, and allow Ctrl+click to open files in VS Code at the correct line:column.

**Architecture:** A new xterm.js `ITerminalAddon` (`FileLinkProvider`) registers via `registerLinkProvider` alongside the existing `WebLinksAddon`. Path detection uses a two-phase approach adapted from VS Code: suffix-based detection (`:line:col` patterns) + bare path detection (platform-specific regexes). Path resolution uses `ShellIntegrationAddon.currentCwd` to convert relative paths to absolute. File existence validation happens via a new IPC channel (`shell:open-file`) that resolves paths and spawns VS Code with `--goto file:line:col`.

**Tech Stack:** xterm.js ILinkProvider API, Electron IPC, VS Code `--goto` flag, ShellIntegrationAddon CWD tracking

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/terminal/link-parsing.ts` | **Create** | Path + suffix regex engine (adapted from VS Code `terminalLinkParsing.ts`) |
| `src/renderer/terminal/link-parsing.test.ts` | **Create** | Unit tests for path/suffix detection |
| `src/renderer/terminal/file-link-provider.ts` | **Create** | xterm.js `ITerminalAddon` implementing `ILinkProvider` |
| `src/renderer/terminal/file-link-provider.test.ts` | **Create** | Unit tests for FileLinkProvider |
| `src/renderer/terminal/link-cache.ts` | **Create** | Simple TTL cache for resolved file links |
| `src/renderer/terminal/link-cache.test.ts` | **Create** | Unit tests for cache |
| `src/core/ipc-channels.ts` | **Modify** | Add `shellOpenFile` channel |
| `src/shared/project-session.ts` | **Modify** | Add `openFile` to `RendererApi` |
| `src/preload/index.ts` | **Modify** | Expose `openFile` via IPC |
| `src/main/index.ts` | **Modify** | Add IPC handler for `shellOpenFile` |
| `src/renderer/terminal/xterm-runtime.ts` | **Modify** | Create and load `FileLinkProvider` |
| `src/renderer/terminal/xterm-runtime.test.ts` | **Modify** | Update tests for new addon |
| `src/renderer/components/TerminalViewport.vue` | **Modify** | Pass `openExternal` and `shellIntegrationAddon` refs |

---

## Task 1: Link Parsing Engine

**Files:**
- Create: `src/renderer/terminal/link-parsing.ts`
- Create: `src/renderer/terminal/link-parsing.test.ts`

**Reference:** VS Code `terminalLinkParsing.ts` — the same suffix regex and two-phase detection strategy, simplified for our needs (no remote authority, no WSL path translation).

- [ ] **Step 1: Write the failing test for suffix detection**

```typescript
// src/renderer/terminal/link-parsing.test.ts
import { describe, expect, test } from 'vitest'
import { detectLinkSuffix, removeLinkSuffix, detectLinks, type IParsedLink } from './link-parsing'

describe('detectLinkSuffix', () => {
  test('detects :line', () => {
    const result = detectLinkSuffix(':42')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(42)
    expect(result!.col).toBeUndefined()
  })

  test('detects :line:col', () => {
    const result = detectLinkSuffix(':42:5')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(42)
    expect(result!.col).toBe(5)
  })

  test('detects space separator for line number', () => {
    const result = detectLinkSuffix(' 42')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(42)
  })

  test('detects (line,col) parenthesized format', () => {
    const result = detectLinkSuffix('(339,12)')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects #line hash format (Ruby)', () => {
    const result = detectLinkSuffix('#339')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(339)
  })

  test('detects line range :line:col-lineEnd.colEnd', () => {
    const result = detectLinkSuffix(':339:12-341.789')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(339)
    expect(result!.col).toBe(12)
    expect(result!.rowEnd).toBe(341)
    expect(result!.colEnd).toBe(789)
  })

  test('detects ", line N, col N" Python format', () => {
    const result = detectLinkSuffix(', line 339, col 12')
    expect(result).not.toBeNull()
    expect(result!.row).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('returns null for no suffix', () => {
    const result = detectLinkSuffix('')
    expect(result).toBeNull()
  })
})

describe('removeLinkSuffix', () => {
  test('removes :line:col suffix', () => {
    expect(removeLinkSuffix('src/foo.ts:42:5')).toBe('src/foo.ts')
  })

  test('returns unchanged string when no suffix', () => {
    expect(removeLinkSuffix('src/foo.ts')).toBe('src/foo.ts')
  })
})

describe('detectLinks', () => {
  test('detects Unix absolute path with suffix', () => {
    const links = detectLinks('/home/user/project/src/foo.ts:42:5', 'linux')
    expect(links.length).toBeGreaterThan(0)
    const link = links.find(l => l.path.text.includes('foo.ts'))
    expect(link).toBeDefined()
    expect(link!.suffix).toBeDefined()
    expect(link!.suffix!.row).toBe(42)
    expect(link!.suffix!.col).toBe(5)
  })

  test('detects Windows absolute path with suffix', () => {
    const links = detectLinks('C:\\Users\\project\\src\\foo.ts:42', 'win32')
    expect(links.length).toBeGreaterThan(0)
    const link = links.find(l => l.path.text.includes('foo.ts'))
    expect(link).toBeDefined()
    expect(link!.suffix).toBeDefined()
    expect(link!.suffix!.row).toBe(42)
  })

  test('detects relative path ./src/foo.ts', () => {
    const links = detectLinks('./src/foo.ts:10', 'linux')
    expect(links.length).toBeGreaterThan(0)
    const link = links.find(l => l.path.text.includes('foo.ts'))
    expect(link).toBeDefined()
    expect(link!.suffix!.row).toBe(10)
  })

  test('detects relative path ../lib/utils.ts', () => {
    const links = detectLinks('../lib/utils.ts', 'linux')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].path.text).toContain('utils.ts')
  })

  test('detects path without suffix', () => {
    const links = detectLinks('src/App.vue', 'linux')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].path.text).toBe('src/App.vue')
    expect(links[0].suffix).toBeUndefined()
  })

  test('detects bare filename with extension', () => {
    const links = detectLinks('file.test.ts', 'linux')
    // Bare filenames may not match since the regex requires path separators
    // This documents expected behavior
  })

  test('detects multiple paths on same line', () => {
    const links = detectLinks('error in src/foo.ts:10 and src/bar.ts:20', 'linux')
    expect(links.length).toBeGreaterThanOrEqual(2)
  })

  test('does not detect URLs as file paths', () => {
    const links = detectLinks('https://example.com/path', 'linux')
    const httpLinks = links.filter(l => l.path.text.startsWith('http'))
    expect(httpLinks.length).toBe(0)
  })

  test('detects file:/// URI', () => {
    const links = detectLinks('file:///home/user/foo.ts:42', 'linux')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].path.text).toContain('foo.ts')
  })

  test('handles git diff a/ b/ prefix stripping', () => {
    const links = detectLinks('--- a/src/foo.ts', 'linux')
    expect(links.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/terminal/link-parsing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement link-parsing.ts**

```typescript
// src/renderer/terminal/link-parsing.ts

/**
 * Link parsing engine adapted from VS Code's terminalLinkParsing.ts.
 * Detects file paths with optional line:col suffixes in terminal output.
 */

export interface ILinkPartialRange {
  index: number
  text: string
}

export interface ILinkSuffix {
  row: number | undefined
  col: number | undefined
  rowEnd: number | undefined
  colEnd: number | undefined
  suffix: ILinkPartialRange
}

export interface IParsedLink {
  path: ILinkPartialRange
  prefix?: ILinkPartialRange
  suffix?: ILinkSuffix
}

// --- Suffix regex generation (adapted from VS Code) ---

function generateLinkSuffixRegex(eolOnly: boolean): RegExp {
  let ri = 0
  let ci = 0
  let rei = 0
  let cei = 0
  function r(): string { return `(?<row${ri++}>\\d+)` }
  function c(): string { return `(?<col${ci++}>\\d+)` }
  function re(): string { return `(?<rowEnd${rei++}>\\d+)` }
  function ce(): string { return `(?<colEnd${cei++}>\\d+)` }

  const eolSuffix = eolOnly ? '$' : ''

  const lineAndColumnRegexClauses = [
    // :339  :339:12  :339:12-789  :339.12  #339  339:12  ,339
    `(?::|#| |['"],|, )${r()}([:.]${c()}(?:-(?:${re()}\\.)?${ce()})?)?` + eolSuffix,
    // ", line 339"  ", line 339, col 12"  ", line 339, column 12"  etc.
    `['"]?(?:,? |: ?| on )lines? ${r()}(?:-${re()})?(?:,? (?:col(?:umn)?|characters?) ${c()}(?:-${ce()})?)?` + eolSuffix,
    // (339)  (339,12)  (339, 12)  with optional preceding : or space
    `:? ?[\\[\\(]${r()}(?:(?:, ?|:)${c()})?[\\]\\)]` + eolSuffix,
  ]

  const suffixClause = lineAndColumnRegexClauses
    .join('|')
    .replace(/ /g, `[${'\u00A0'} ]`)

  return new RegExp(`(${suffixClause})`, eolOnly ? undefined : 'g')
}

let _linkSuffixRegexEol: RegExp | null = null
let _linkSuffixRegex: RegExp | null = null

function getLinkSuffixRegexEol(): RegExp {
  if (!_linkSuffixRegexEol) _linkSuffixRegexEol = generateLinkSuffixRegex(true)
  return _linkSuffixRegexEol
}

function getLinkSuffixRegex(): RegExp {
  if (!_linkSuffixRegex) _linkSuffixRegex = generateLinkSuffixRegex(false)
  return _linkSuffixRegex
}

export function detectLinkSuffix(text: string): ILinkSuffix | null {
  return toLinkSuffix(getLinkSuffixRegexEol().exec(text))
}

function toLinkSuffix(match: RegExpExecArray | null): ILinkSuffix | null {
  const groups = match?.groups
  if (!groups || match!.length < 1) return null
  return {
    row: parseIntOptional(groups.row0 || groups.row1 || groups.row2),
    col: parseIntOptional(groups.col0 || groups.col1 || groups.col2),
    rowEnd: parseIntOptional(groups.rowEnd0 || groups.rowEnd1 || groups.rowEnd2),
    colEnd: parseIntOptional(groups.colEnd0 || groups.colEnd1 || groups.colEnd2),
    suffix: { index: match!.index, text: match![0] }
  }
}

function parseIntOptional(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  return parseInt(value)
}

export function removeLinkSuffix(link: string): string {
  const suffix = detectLinkSuffix(link)?.suffix
  if (!suffix) return link
  return link.substring(0, suffix.index)
}

export function removeLinkQueryString(link: string): string {
  const start = link.startsWith('\\\\?\\') ? 4 : 0
  const index = link.indexOf('?', start)
  if (index === -1) return link
  return link.substring(0, index)
}

// --- Path detection (adapted from VS Code) ---

const linkWithSuffixPathCharacters = /(?<path>(?:file:\/\/\/)?[^\s\|<>\[\({][^\s\|<>]*)$/

const ExcludedPathCharactersClause = '[^\\0<>\\?\\s!`&*()\'":;\\\\]'
const ExcludedStartPathCharactersClause = '[^\\0<>\\?\\s!`&*()\\[\\]\'":;\\\\]'
const PathPrefix = '(?:\\.\\.?|\\~|file:\\/\\/)'
const PathSeparatorClause = '\\/'

const WinExcludedPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\'":;]'
const WinExcludedStartPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]\'":;]'
export const winDrivePrefix = '(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:'

const unixLocalLinkClause = '(?:(?:' + PathPrefix + '|(?:' + ExcludedStartPathCharactersClause + ExcludedPathCharactersClause + '*))?(?:' + PathSeparatorClause + '(?:' + ExcludedPathCharactersClause + ')+)+)'

const winLocalLinkClause = '(?:(?:' + `(?:${winDrivePrefix}|${PathPrefix.replace('file:\\/\\/', '')})` + '|(?:' + WinExcludedStartPathCharactersClause + WinExcludedPathCharactersClause + '*))?(?:\\\\|\\/)(?:' + WinExcludedPathCharactersClause + ')+)+'

function detectLinksViaSuffix(line: string): IParsedLink[] {
  const results: IParsedLink[] = []
  const regex = getLinkSuffixRegex()
  regex.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(line)) !== null) {
    const suffix = toLinkSuffix(match)
    if (suffix === null) break

    const beforeSuffix = line.substring(0, suffix.suffix.index)
    const possiblePathMatch = beforeSuffix.match(linkWithSuffixPathCharacters)
    if (possiblePathMatch && possiblePathMatch.index !== undefined && possiblePathMatch.groups?.path) {
      let linkStartIndex = possiblePathMatch.index
      let path = possiblePathMatch.groups.path

      let prefix: ILinkPartialRange | undefined
      const prefixMatch = path.match(/^(?<prefix>['"]+)/)
      if (prefixMatch?.groups?.prefix) {
        prefix = { index: linkStartIndex, text: prefixMatch.groups.prefix }
        path = path.substring(prefix.text.length)
        if (path.trim().length === 0) continue
      }

      results.push({
        path: { index: linkStartIndex + (prefix?.text.length || 0), text: path },
        prefix,
        suffix
      })
    }
  }

  return results
}

function detectPathsNoSuffix(line: string, os: string): IParsedLink[] {
  const results: IParsedLink[] = []
  const regex = new RegExp(os === 'win32' ? winLocalLinkClause : unixLocalLinkClause, 'g')
  let match

  while ((match = regex.exec(line)) !== null) {
    let text = match[0]
    let index = match.index
    if (!text) break

    // Strip git diff a/ b/ prefixes
    if (
      ((line.startsWith('--- a/') || line.startsWith('+++ b/')) && index === 4) ||
      (line.startsWith('diff --git') && (text.startsWith('a/') || text.startsWith('b/')))
    ) {
      text = text.substring(2)
      index += 2
    }

    results.push({ path: { index, text }, prefix: undefined, suffix: undefined })
  }

  return results
}

function binaryInsertList(list: IParsedLink[], newItems: IParsedLink[]): void {
  if (list.length === 0) {
    list.push(...newItems)
    return
  }
  for (const item of newItems) {
    binaryInsert(list, item, 0, list.length)
  }
}

function binaryInsert(list: IParsedLink[], newItem: IParsedLink, low: number, high: number): void {
  if (list.length === 0) { list.push(newItem); return }
  if (low > high) return
  const mid = Math.floor((low + high) / 2)
  if (
    mid >= list.length ||
    (newItem.path.index < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index))
  ) {
    if (
      mid >= list.length ||
      (newItem.path.index + newItem.path.text.length < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index + list[mid - 1].path.text.length))
    ) {
      list.splice(mid, 0, newItem)
    }
    return
  }
  if (newItem.path.index > list[mid].path.index) {
    binaryInsert(list, newItem, mid + 1, high)
  } else {
    binaryInsert(list, newItem, low, mid - 1)
  }
}

export function detectLinks(line: string, os: string): IParsedLink[] {
  const results = detectLinksViaSuffix(line)
  const noSuffixPaths = detectPathsNoSuffix(line, os)
  binaryInsertList(results, noSuffixPaths)
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/terminal/link-parsing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/terminal/link-parsing.ts src/renderer/terminal/link-parsing.test.ts
git commit -m "feat: add terminal link parsing engine for file path detection"
```

---

## Task 2: Link Cache

**Files:**
- Create: `src/renderer/terminal/link-cache.ts`
- Create: `src/renderer/terminal/link-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/terminal/link-cache.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LinkCache } from './link-cache'

describe('LinkCache', () => {
  beforeEach(() => { vi.useFakeTimers() })

  test('stores and retrieves values', () => {
    const cache = new LinkCache(10_000)
    cache.set('key', { path: '/foo.ts', exists: true })
    expect(cache.get('key')).toEqual({ path: '/foo.ts', exists: true })
  })

  test('returns undefined for missing keys', () => {
    const cache = new LinkCache(10_000)
    expect(cache.get('missing')).toBeUndefined()
  })

  test('expires entries after TTL', () => {
    const cache = new LinkCache(5_000)
    cache.set('key', { path: '/foo.ts', exists: true })
    vi.advanceTimersByTime(4_999)
    expect(cache.get('key')).toBeDefined()
    vi.advanceTimersByTime(1)
    expect(cache.get('key')).toBeUndefined()
  })

  test('TTL resets on set', () => {
    const cache = new LinkCache(5_000)
    cache.set('key', { path: '/foo.ts', exists: true })
    vi.advanceTimersByTime(3_000)
    cache.set('key2', { path: '/bar.ts', exists: true })
    vi.advanceTimersByTime(3_000)
    // Both should still be alive since the TTL was reset
    expect(cache.get('key')).toBeDefined()
    expect(cache.get('key2')).toBeDefined()
  })

  test('clear removes all entries', () => {
    const cache = new LinkCache(10_000)
    cache.set('a', { path: '/a.ts', exists: true })
    cache.set('b', { path: '/b.ts', exists: true })
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/terminal/link-cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement LinkCache**

```typescript
// src/renderer/terminal/link-cache.ts

export interface CachedLink {
  path: string
  exists: boolean
}

export class LinkCache {
  private readonly _cache = new Map<string, CachedLink>()
  private _timeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly _ttlMs: number) {}

  set(key: string, value: CachedLink): void {
    this._cache.set(key, value)
    this._resetTtl()
  }

  get(key: string): CachedLink | undefined {
    return this._cache.get(key)
  }

  clear(): void {
    this._cache.clear()
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId)
      this._timeoutId = null
    }
  }

  dispose(): void {
    this.clear()
  }

  private _resetTtl(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId)
    }
    this._timeoutId = setTimeout(() => this._cache.clear(), this._ttlMs)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/terminal/link-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/terminal/link-cache.ts src/renderer/terminal/link-cache.test.ts
git commit -m "feat: add TTL-based link cache for file path resolution"
```

---

## Task 3: IPC Channel + RendererApi Contract

**Files:**
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/shared/project-session.ts`

- [ ] **Step 1: Add `shellOpenFile` to IPC_CHANNELS**

In `src/core/ipc-channels.ts`, add the new channel after `shellGetScriptsDir`:

```typescript
shellOpenFile: 'shell:open-file',
```

- [ ] **Step 2: Add `openFile` to RendererApi**

In `src/shared/project-session.ts`, add to the `RendererApi` interface after `detectVscode`:

```typescript
openFile: (filePath: string, line?: number, col?: number) => Promise<void>
```

- [ ] **Step 3: Commit**

```bash
git add src/core/ipc-channels.ts src/shared/project-session.ts
git commit -m "feat: add shell:open-file IPC channel and RendererApi contract"
```

---

## Task 4: Main Process Handler + Preload Bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add IPC handler in main process**

In `src/main/index.ts`, after the `settingsDetectVscode` handler (around line 897), add:

```typescript
ipcMain.handle(IPC_CHANNELS.shellOpenFile, async (_event, filePath: string, line?: number, col?: number) => {
  const configuredExecutable = projectSessionManager?.getSettings().workspaceIde.executablePath.trim()
  const candidates: string[] = []

  if (configuredExecutable.length > 0) {
    candidates.push(configuredExecutable)
  }

  const detected = await detectVscode()
  if (detected) {
    candidates.push(detected)
  }
  candidates.push('code', 'code.cmd')

  const gotoArg = line != null
    ? col != null ? `${filePath}:${line}:${col}` : `${filePath}:${line}`
    : filePath

  for (const executable of candidates) {
    try {
      const child = spawn(executable, ['--goto', gotoArg], {
        cwd: filePath,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
        env: process.env
      })
      child.unref()
      return
    } catch {
      continue
    }
  }

  // Fallback to system default editor
  await shell.openPath(filePath)
})
```

Ensure `spawn` is already imported in the file (it is, used by `workspace-launcher`).

- [ ] **Step 2: Add preload bridge**

In `src/preload/index.ts`, add to the `api` object after `detectVscode`:

```typescript
async openFile(filePath, line, col) {
  return ipcRenderer.invoke(IPC_CHANNELS.shellOpenFile, filePath, line, col)
},
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: add shell:open-file IPC handler with VS Code --goto support"
```

---

## Task 5: FileLinkProvider (Core Addon)

**Files:**
- Create: `src/renderer/terminal/file-link-provider.ts`
- Create: `src/renderer/terminal/file-link-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/terminal/file-link-provider.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Terminal, ILink } from '@xterm/xterm'

// Minimal mock for xterm buffer access
function createMockTerminal(lines: string[]): { terminal: Terminal; linkProvider: any } {
  const bufferLines = lines.map(text => ({
    translateToString: (_trimRight?: boolean, _startCol?: number, _endCol?: number) => text,
    getCell: (x: number) => ({ getChars: () => text[x] ?? '' }),
    length: text.length,
    isWrapped: false,
  }))

  const terminal = {
    buffer: {
      active: {
        getLine: (y: number) => bufferLines[y] ?? null,
        length: bufferLines.length,
        viewportY: 0,
      }
    },
    cols: 80,
    registerLinkProvider: vi.fn(),
  } as unknown as Terminal

  return { terminal, linkProvider: null }
}

describe('FileLinkProvider', () => {
  test('detects file path with line:col in a buffer line', async () => {
    const { FileLinkProvider } = await import('./file-link-provider')
    const provider = new FileLinkProvider(() => '/home/user/project')
    const mockTerminal = createMockTerminal(['error in src/foo.ts:42:5'])
    provider.activate(mockTerminal.terminal)

    const links: ILink[] = await new Promise(resolve => {
      provider.provideLinks(0, (result) => resolve(result ?? []))
    })

    expect(links.length).toBeGreaterThan(0)
    expect(links[0].text).toContain('src/foo.ts')
  })

  test('does not activate on regular click (only Ctrl+click)', async () => {
    const { FileLinkProvider } = await import('./file-link-provider')
    const openFileMock = vi.fn().mockResolvedValue(undefined)
    const provider = new FileLinkProvider(() => '/home/user/project', openFileMock)
    const mockTerminal = createMockTerminal(['src/foo.ts:10'])
    provider.activate(mockTerminal.terminal)

    const links: ILink[] = await new Promise(resolve => {
      provider.provideLinks(0, (result) => resolve(result ?? []))
    })
    expect(links.length).toBeGreaterThan(0)

    // Simulate regular click (no Ctrl)
    const regularEvent = { ctrlKey: false, metaKey: false, altKey: false } as MouseEvent
    links[0].activate(regularEvent, links[0].text)
    expect(openFileMock).not.toHaveBeenCalled()
  })

  test('activates on Ctrl+click', async () => {
    const { FileLinkProvider } = await import('./file-link-provider')
    const openFileMock = vi.fn().mockResolvedValue(undefined)
    const provider = new FileLinkProvider(() => '/home/user/project', openFileMock)
    const mockTerminal = createMockTerminal(['src/foo.ts:10:5'])
    provider.activate(mockTerminal.terminal)

    const links: ILink[] = await new Promise(resolve => {
      provider.provideLinks(0, (result) => resolve(result ?? []))
    })
    expect(links.length).toBeGreaterThan(0)

    const ctrlEvent = { ctrlKey: true, metaKey: false, altKey: false } as MouseEvent
    links[0].activate(ctrlEvent, links[0].text)
    expect(openFileMock).toHaveBeenCalledWith(expect.stringContaining('foo.ts'), 10, 5)
  })

  test('resolves relative paths using CWD', async () => {
    const { FileLinkProvider } = await import('./file-link-provider')
    const openFileMock = vi.fn().mockResolvedValue(undefined)
    const provider = new FileLinkProvider(() => '/home/user/project', openFileMock)
    const mockTerminal = createMockTerminal(['./src/bar.ts:20'])
    provider.activate(mockTerminal.terminal)

    const links: ILink[] = await new Promise(resolve => {
      provider.provideLinks(0, (result) => resolve(result ?? []))
    })

    expect(links.length).toBeGreaterThan(0)
    const ctrlEvent = { ctrlKey: true, metaKey: false, altKey: false } as MouseEvent
    links[0].activate(ctrlEvent, links[0].text)
    expect(openFileMock).toHaveBeenCalledWith(
      expect.stringContaining('src/bar.ts'),
      20,
      undefined
    )
  })

  test('detects Windows absolute path', async () => {
    const { FileLinkProvider } = await import('./file-link-provider')
    const openFileMock = vi.fn().mockResolvedValue(undefined)
    const provider = new FileLinkProvider(() => 'C:\\project', openFileMock, 'win32')
    const mockTerminal = createMockTerminal(['C:\\project\\src\\foo.ts:42'])
    provider.activate(mockTerminal.terminal)

    const links: ILink[] = await new Promise(resolve => {
      provider.provideLinks(0, (result) => resolve(result ?? []))
    })

    expect(links.length).toBeGreaterThan(0)
    expect(links[0].text).toContain('foo.ts')
  })

  test('returns no links for empty line', async () => {
    const { FileLinkProvider } = await import('./file-link-provider')
    const provider = new FileLinkProvider(() => '/home/user/project')
    const mockTerminal = createMockTerminal([''])
    provider.activate(mockTerminal.terminal)

    const links: ILink[] = await new Promise(resolve => {
      provider.provideLinks(0, (result) => resolve(result ?? []))
    })

    expect(links.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/terminal/file-link-provider.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement FileLinkProvider**

```typescript
// src/renderer/terminal/file-link-provider.ts
import type { ITerminalAddon, Terminal, ILink, ILinkProvider } from '@xterm/xterm'
import { detectLinks, removeLinkSuffix, type IParsedLink } from './link-parsing'
import { join, normalize, isAbsolute } from '@renderer/terminal/path-utils'

export interface FileLinkOpener {
  (absolutePath: string, line?: number, col?: number): Promise<void>
}

export class FileLinkProvider implements ITerminalAddon {
  private terminal: Terminal | null = null
  private readonly _linkProvider: ILinkProvider

  constructor(
    private readonly _getCwd: () => string | null,
    private readonly _openFile: FileLinkOpener = async (path, line, col) => {
      if (typeof window !== 'undefined' && window.stoa) {
        await window.stoa.openFile(path, line, col)
      }
    },
    private readonly _os: string = typeof process !== 'undefined' ? process.platform : 'linux'
  ) {
    this._linkProvider = {
      provideLinks: (y: number, callback: (links: ILink[] | undefined) => void) => {
        this._provideLinks(y, callback)
      }
    }
  }

  activate(terminal: Terminal): void {
    this.terminal = terminal
    terminal.registerLinkProvider(this._linkProvider)
  }

  dispose(): void {
    this.terminal = null
  }

  private _provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    if (!this.terminal) { callback(undefined); return }

    const line = this.terminal.buffer.active.getLine(y)
    if (!line) { callback(undefined); return }

    const text = line.translateToString(true)
    if (!text || text.length > 2000) { callback(undefined); return }

    const parsedLinks = detectLinks(text, this._os)
    if (parsedLinks.length === 0) { callback(undefined); return }

    const links: ILink[] = []

    for (const parsed of parsedLinks) {
      if (parsed.path.text.length > 1024) continue

      const startCol = (parsed.prefix?.index ?? parsed.path.index) + 1
      const endCol = parsed.path.index + parsed.path.text.length + (parsed.suffix?.suffix.text.length ?? 0) + 1

      // Skip if range is invalid
      if (startCol <= 0 || endCol <= startCol) continue

      const linkText = text.substring(
        parsed.prefix?.index ?? parsed.path.index,
        parsed.suffix ? parsed.suffix.suffix.index + parsed.suffix.suffix.text.length : parsed.path.index + parsed.path.text.length
      )

      links.push({
        range: {
          start: { x: startCol, y: y + 1 },
          end: { x: endCol > this.terminal.cols ? this.terminal.cols : endCol, y: y + 1 }
        },
        text: linkText,
        decorations: { underline: true, pointerCursor: true },
        activate: (event: MouseEvent, _text: string) => {
          if (!event.ctrlKey && !event.metaKey) return
          this._handleActivate(parsed)
        }
      })
    }

    callback(links.length > 0 ? links : undefined)
  }

  private async _handleActivate(parsed: IParsedLink): Promise<void> {
    const rawPath = parsed.path.text
    const cwd = this._getCwd()
    let absolutePath: string

    if (rawPath.startsWith('file:///')) {
      absolutePath = decodeURIComponent(rawPath.substring('file:///'.length))
    } else if (rawPath.startsWith('~') && cwd) {
      // Best-effort ~ expansion; on Windows this may not work without userHome
      absolutePath = rawPath
    } else if (isAbsolute(rawPath, this._os)) {
      absolutePath = rawPath
    } else if (cwd) {
      absolutePath = join(cwd, rawPath, this._os)
    } else {
      absolutePath = rawPath
    }

    absolutePath = normalize(absolutePath, this._os)

    await this._openFile(
      absolutePath,
      parsed.suffix?.row,
      parsed.suffix?.col
    )
  }
}
```

- [ ] **Step 4: Create path utility shim**

Create `src/renderer/terminal/path-utils.ts`:

```typescript
// src/renderer/terminal/path-utils.ts
// Lightweight platform-aware path utilities for the renderer process.

export function isAbsolute(p: string, os: string): boolean {
  if (os === 'win32') {
    return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\')
  }
  return p.startsWith('/')
}

export function join(base: string, relative: string, os: string): string {
  const sep = os === 'win32' ? '\\' : '/'
  // Normalize forward/back slashes to the platform separator
  const cleanBase = base.replace(/[\\/]/g, sep).replace(/\/$/, '')
  const cleanRel = relative.replace(/[\\/]/g, sep)
  return `${cleanBase}${sep}${cleanRel}`
}

export function normalize(p: string, os: string): string {
  if (os === 'win32') {
    return p.replace(/\//g, '\\')
  }
  return p
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/renderer/terminal/file-link-provider.test.ts`
Expected: PASS (may need minor adjustments to mock structure)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/terminal/file-link-provider.ts src/renderer/terminal/file-link-provider.test.ts src/renderer/terminal/path-utils.ts
git commit -m "feat: add FileLinkProvider xterm addon for terminal file path detection"
```

---

## Task 6: Integration into XtermRuntime

**Files:**
- Modify: `src/renderer/terminal/xterm-runtime.ts`
- Modify: `src/renderer/terminal/xterm-runtime.test.ts`

- [ ] **Step 1: Import and integrate FileLinkProvider**

In `src/renderer/terminal/xterm-runtime.ts`:

1. Add import:
```typescript
import { FileLinkProvider } from './file-link-provider'
```

2. Add to `XtermRuntime` interface:
```typescript
export interface XtermRuntime {
  terminal: Terminal
  fitAddon: FitAddon
  serializeAddon: SerializeAddon
  unicode11Addon: Unicode11Addon
  webLinksAddon: WebLinksAddon
  webglAddon: WebglAddon | null
  searchAddon: SearchAddon
  shellIntegrationAddon: ShellIntegrationAddon
  fileLinkProvider: FileLinkProvider  // NEW
}
```

3. In `createTerminalRuntime`, after `shellIntegrationAddon` creation and before the WebGL section, create and load the provider:

```typescript
const fileLinkProvider = new FileLinkProvider(
  () => shellIntegrationAddon.getState().currentCwd,
  undefined, // use default openFile (window.stoa.openFile)
  platform
)
terminal.loadAddon(fileLinkProvider)
```

4. Add to return value:
```typescript
return {
  terminal,
  fitAddon,
  serializeAddon,
  unicode11Addon,
  webLinksAddon,
  webglAddon,
  searchAddon,
  shellIntegrationAddon,
  fileLinkProvider
}
```

- [ ] **Step 2: Update xterm-runtime.test.ts**

Add the FileLinkProvider mock alongside existing mocks:

```typescript
vi.mock('../terminal/file-link-provider', () => {
  return {
    FileLinkProvider: class {
      constructor() {}
      activate() {}
      dispose() {}
    },
  }
})
```

Verify existing tests still pass by checking that `runtime.fileLinkProvider` is an instance.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/terminal/xterm-runtime.ts src/renderer/terminal/xterm-runtime.test.ts
git commit -m "feat: integrate FileLinkProvider into xterm runtime with CWD tracking"
```

---

## Task 7: Fix Preload Type for openFile

**Files:**
- Modify: various test files that mock `window.stoa`

Search for all test files that create mock `RendererApi` objects and add the `openFile` method:

```typescript
openFile: vi.fn().mockResolvedValue(undefined),
```

Files to update (based on existing `detectVscode` mocks):
- `src/renderer/app/App.test.ts`
- `src/renderer/components/AppShell.test.ts`
- `src/renderer/stores/workspaces.test.ts`
- `src/renderer/stores/update.test.ts`
- `src/renderer/stores/settings.test.ts`
- `src/renderer/components/settings/ProvidersSettings.test.ts`
- `src/renderer/components/settings/GeneralSettings.test.ts`
- `src/renderer/components/settings/AboutSettings.test.ts`

- [ ] **Step 1: Add `openFile` mock to all test files**

In each file, find the mock `RendererApi` object and add:
```typescript
openFile: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "test: add openFile mock to all RendererApi test fixtures"
```

---

## Task 8: E2E IPC Bridge Test

**Files:**
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Add IPC round-trip test for `openFile`**

In `tests/e2e/ipc-bridge.test.ts`, add a test case that verifies the `shellOpenFile` channel is callable and forwards the correct arguments.

- [ ] **Step 2: Add static analysis guard**

In `tests/e2e/main-config-guard.test.ts`, verify:
- `IPC_CHANNELS` contains `shellOpenFile`
- preload exposes `openFile`
- main process handles `shellOpenFile`

- [ ] **Step 3: Run e2e tests**

Run: `npx vitest run tests/e2e/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts
git commit -m "test: add e2e IPC bridge coverage for shell:open-file"
```

---

## Task 9: Full Verification

- [ ] **Step 1: Run test generation**

Run: `npm run test:generate`
Expected: Deterministic output, no errors

- [ ] **Step 2: Run typecheck**

Run: `npx vue-tsc --noEmit` or `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Run full unit + integration suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Run behavior coverage**

Run: `npm run test:behavior-coverage`
Expected: Coverage budgets satisfied

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix: address verification failures for terminal file link feature"
```
