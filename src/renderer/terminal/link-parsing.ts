/**
 * Terminal link parsing engine for detecting file paths and line:col suffixes
 * in xterm.js terminal output. Adapted from VS Code's link detection logic.
 *
 * Pure computation module — no side effects, no Node.js built-ins.
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ILinkSuffix {
  /** 1-based line number */
  line: number
  /** 1-based column number, or -1 if not specified */
  col: number
  /** Full suffix text (e.g. ":339:12") */
  suffix: string
  /** Index in the original string where the suffix starts */
  index: number
}

export interface ILinkPartialRange {
  /** Start index of the path in the line */
  pathStartIndex: number
  /** End index of the path in the line (exclusive) */
  pathEndIndex: number
}

export interface IParsedLink {
  /** The full matched text (path + suffix) */
  text: string
  /** Start index in the line */
  index: number
  /** End index in the line (exclusive) */
  endIndex: number
  /** Parsed suffix, if any */
  suffix: ILinkSuffix | null
  /** The path portion only (without suffix) */
  path: string
}

// ── Suffix Detection ────────────────────────────────────────────────────────

/**
 * Regex that captures line/col suffixes in various formats:
 *   :339, :339:12, :339:12-789, :339.12
 *   " 339", " 339:12"
 *   "#339", "#339:12"
 *   ",339", '",339'
 *   ", line 339", ", line 339, col 12", ", line 339, column 12"
 *   "(339)", "(339,12)", "(339, 12)"
 * Also supports line ranges like :339:12-341.789
 */
const LINK_SUFFIX = new RegExp(
  [
    // Group 1: colon-separated  :line or :line:col or :line:col-line2.col2
    '(?::(?<col1Line>\\d+)(?::(?<col1Col>\\d+)(?:-(?<col1LineEnd>\\d+)\\.(?<col1ColEnd>\\d+))?)?)',
    // Group 2: space-separated  line or line:col
    '|(?: (?<spaceLine>\\d+)(?::(?<spaceCol>\\d+))?)',
    // Group 3: hash-separated (Ruby)  #line or #line:col
    '|(?:#(?<hashLine>\\d+)(?::(?<hashCol>\\d+))?)',
    // Group 4: comma-separated  ,line or ,line:col
    '|(?:,(?<commaLine>\\d+)(?::(?<commaCol>\\d+))?)',
    // Group 5: ", line N[, col N]" or ", line N, column N"
    '|(?:,\\s+line\\s+(?<textLine>\\d+)(?:,\\s+(?:col|column)\\s+(?<textCol>\\d+))?)',
    // Group 6: parenthesized  (line) or (line,col) or (line, col)
    '|(?:\\((?<parenLine>\\d+)(?:,\\s*(?<parenCol>\\d+))?\\))',
  ].join(''),
)

/**
 * Detect a line:col suffix at the end of the given text.
 * Returns null if no suffix is found.
 */
export function detectLinkSuffix(text: string): ILinkSuffix | null {
  const match = text.match(new RegExp(LINK_SUFFIX.source + '$'))
  if (!match || match.index === undefined) {
    return null
  }

  const groups = match.groups ?? {}
  const suffix = match[0]

  const lineStr =
    groups['col1Line'] ??
    groups['spaceLine'] ??
    groups['hashLine'] ??
    groups['commaLine'] ??
    groups['textLine'] ??
    groups['parenLine']

  const colStr =
    groups['col1Col'] ??
    groups['spaceCol'] ??
    groups['hashCol'] ??
    groups['commaCol'] ??
    groups['textCol'] ??
    groups['parenCol']

  if (!lineStr) {
    return null
  }

  const line = parseInt(lineStr, 10)
  if (line < 1 || !isFinite(line)) {
    return null
  }

  const col = colStr ? parseInt(colStr, 10) : -1
  if (col !== -1 && (col < 1 || !isFinite(col))) {
    return null
  }

  return {
    line,
    col,
    suffix,
    index: match.index,
  }
}

// ── Suffix / Query String Removal ───────────────────────────────────────────

/**
 * Strip the trailing line:col suffix from a link string.
 */
export function removeLinkSuffix(link: string): string {
  const suffix = detectLinkSuffix(link)
  if (suffix) {
    return link.slice(0, suffix.index)
  }
  return link
}

/**
 * Strip query string (everything after first `?`) from a link.
 */
export function removeLinkQueryString(link: string): string {
  const qIndex = link.indexOf('?')
  if (qIndex === -1) {
    return link
  }
  return link.slice(0, qIndex)
}

// ── Path Extraction (Phase 1: suffix-based) ─────────────────────────────────

/**
 * Regex to extract the path portion preceding a suffix match.
 * Handles optional `file:///` prefix.
 */
const PATH_BEFORE_SUFFIX =
  /(?:file:\/\/\/)?[^\s\|<>\[\({][^\s\|<>]*$/

const URL_SCHEME = /^https?:\/\//i

/**
 * Phase 1: Find links by detecting suffixes first, then extracting the
 * path text that precedes each suffix.
 */
function detectLinksViaSuffix(line: string): IParsedLink[] {
  const results: IParsedLink[] = []

  const suffixRegex = new RegExp(LINK_SUFFIX.source, 'g')
  let match: RegExpExecArray | null

  while ((match = suffixRegex.exec(line)) !== null) {
    const suffixStart = match.index
    const suffixEnd = suffixStart + match[0].length
    const textBeforeSuffix = line.slice(0, suffixStart)

    const pathMatch = textBeforeSuffix.match(PATH_BEFORE_SUFFIX)
    if (!pathMatch || pathMatch.index === undefined) {
      continue
    }

    const pathStart = pathMatch.index
    const pathText = pathMatch[0]

    if (URL_SCHEME.test(pathText)) {
      continue
    }

    const fullText = line.slice(pathStart, suffixEnd)

    const suffix = detectLinkSuffix(fullText)

    results.push({
      text: fullText,
      index: pathStart,
      endIndex: suffixEnd,
      suffix,
      path: pathText,
    })
  }

  return results
}

// ── Platform Path Detection (Phase 2: no suffix) ────────────────────────────

/**
 * Characters excluded from path detection.
 */
const EXCLUDED_CHARS = '\\0<>?|\\s!`&*()\'":;'

/**
 * Build a regex that matches a path segment (no excluded chars).
 */
function pathSegment(sep: string): string {
  return `[^${EXCLUDED_CHARS}${escapeForCharClass(sep)}]+`
}

function escapeForCharClass(ch: string): string {
  if (ch === '\\') return '\\\\'
  if (ch === ']') return '\\]'
  if (ch === '^') return '\\^'
  if (ch === '-') return '\\-'
  return ch
}

/**
 * Build the Windows path regex pattern.
 */
function windowsPathPattern(): string {
  const seg = pathSegment('/')
  const sep = `[\\\\/]`
  // Drive letter paths: C:\, \\?\C:\, file:///C:
  const patterns = [
    `(?:[a-zA-Z]:${sep}${seg}(?:${sep}${seg})*)`,          // C:\path\to\file
    `(?:\\\\\\?\\\\[a-zA-Z]:${sep}${seg}(?:${sep}${seg})*)`, // \\?\C:\path
    `(?:file:///[a-zA-Z]:${sep}${seg}(?:${sep}${seg})*)`,    // file:///C:/path
  ]
  return `(?:${patterns.join('|')})`
}

/**
 * Build the Unix path regex pattern.
 */
function unixPathPattern(): string {
  const seg = pathSegment('/')
  const sep = '/'
  const patterns = [
    `(?:/${seg}(?:${sep}${seg})*)`,       // /absolute/path
    `(?:\\.\\/${seg}(?:${sep}${seg})*)`,   // ./relative/path
    `(?:\\.\\.\\/${seg}(?:${sep}${seg})*)`, // ../relative/path
    `(?:~\\/${seg}(?:${sep}${seg})*)`,     // ~/home/path
    `(?:file:///${seg}(?:${sep}${seg})*)`, // file:///path
  ]
  return `(?:${patterns.join('|')})`
}

const windowsPathRegex = new RegExp(windowsPathPattern(), 'g')
const unixPathRegex = new RegExp(unixPathPattern(), 'g')

/**
 * Phase 2: Detect paths that have no suffix, using platform-specific regexes.
 */
function isPartOfUrl(line: string, matchStart: number): boolean {
  if (URL_SCHEME.test(line.slice(matchStart))) {
    return true
  }
  if (matchStart >= 3) {
    const before = line.slice(Math.max(0, matchStart - 8), matchStart + 1)
    if (/:\/\/.*$/.test(before)) {
      return true
    }
  }
  return false
}

function detectPathsNoSuffix(line: string, os: string): IParsedLink[] {
  const results: IParsedLink[] = []
  const regex = os === 'win32' ? windowsPathRegex : unixPathRegex

  regex.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(line)) !== null) {
    const start = match.index
    const text = match[0]
    const end = start + text.length

    if (isPartOfUrl(line, start)) {
      continue
    }

    results.push({
      text,
      index: start,
      endIndex: end,
      suffix: null,
      path: text,
    })
  }

  return results
}

// ── Merge with Binary Insert ────────────────────────────────────────────────

/**
 * Merge two arrays of parsed links, sorted by index, rejecting overlaps.
 */
function mergeLinks(a: IParsedLink[], b: IParsedLink[]): IParsedLink[] {
  const merged: IParsedLink[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i].index < b[j].index) {
      merged.push(a[i++])
    } else if (a[i].index > b[j].index) {
      merged.push(b[j++])
    } else {
      // Same start index: prefer the longer match
      if (a[i].endIndex >= b[j].endIndex) {
        merged.push(a[i++])
      } else {
        merged.push(b[j++])
      }
    }
  }

  while (i < a.length) merged.push(a[i++])
  while (j < b.length) merged.push(b[j++])

  // Remove overlapping entries
  const filtered: IParsedLink[] = []
  for (const link of merged) {
    if (filtered.length === 0) {
      filtered.push(link)
      continue
    }
    const prev = filtered[filtered.length - 1]
    if (link.index >= prev.endIndex) {
      filtered.push(link)
    }
    // If overlapping, keep the earlier one (already in filtered)
  }

  return filtered
}

// ── Main Detection Function ─────────────────────────────────────────────────

/**
 * Detect all file links in a terminal line.
 *
 * @param line - The terminal output line to scan
 * @param os - Platform identifier: `'win32'` or `'linux'`
 * @returns Array of parsed links sorted by position
 */
export function detectLinks(line: string, os: string): IParsedLink[] {
  if (!line) {
    return []
  }

  const suffixLinks = detectLinksViaSuffix(line)
  const plainLinks = detectPathsNoSuffix(line, os)

  return mergeLinks(suffixLinks, plainLinks)
}
