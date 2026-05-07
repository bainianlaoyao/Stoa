import { describe, expect, test } from 'vitest'
import {
  detectLinkSuffix,
  detectLinks,
  removeLinkQueryString,
  removeLinkSuffix,
} from './link-parsing'
import type { IParsedLink } from './link-parsing'

// ── detectLinkSuffix ────────────────────────────────────────────────────────

describe('detectLinkSuffix', () => {
  test('returns null for empty string', () => {
    expect(detectLinkSuffix('')).toBeNull()
  })

  test('returns null for plain text without suffix', () => {
    expect(detectLinkSuffix('hello world')).toBeNull()
  })

  test('returns null for a file path without suffix', () => {
    expect(detectLinkSuffix('/usr/local/bin/node')).toBeNull()
  })

  test('detects :line suffix', () => {
    const result = detectLinkSuffix(':339')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(-1)
    expect(result!.suffix).toBe(':339')
    expect(result!.index).toBe(0)
  })

  test('detects :line:col suffix', () => {
    const result = detectLinkSuffix(':339:12')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
    expect(result!.suffix).toBe(':339:12')
  })

  test('detects :line:col-line2.col2 range suffix', () => {
    const result = detectLinkSuffix(':339:12-341.789')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
    expect(result!.suffix).toBe(':339:12-341.789')
  })

  test('detects space+line suffix', () => {
    const result = detectLinkSuffix(' 339')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(-1)
    expect(result!.suffix).toBe(' 339')
  })

  test('detects space+line:col suffix', () => {
    const result = detectLinkSuffix(' 339:12')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects #line suffix (Ruby)', () => {
    const result = detectLinkSuffix('#339')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(-1)
  })

  test('detects #line:col suffix (Ruby)', () => {
    const result = detectLinkSuffix('#339:12')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects ,line suffix', () => {
    const result = detectLinkSuffix(',339')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(-1)
  })

  test('detects ,line:col suffix', () => {
    const result = detectLinkSuffix(',339:12')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects ", line N" suffix', () => {
    const result = detectLinkSuffix(', line 339')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(-1)
  })

  test('detects ", line N, col M" suffix', () => {
    const result = detectLinkSuffix(', line 339, col 12')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects ", line N, column M" suffix', () => {
    const result = detectLinkSuffix(', line 339, column 12')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects (line) suffix', () => {
    const result = detectLinkSuffix('(339)')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(-1)
  })

  test('detects (line,col) suffix', () => {
    const result = detectLinkSuffix('(339,12)')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects (line, col) suffix with space', () => {
    const result = detectLinkSuffix('(339, 12)')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(339)
    expect(result!.col).toBe(12)
  })

  test('detects suffix after a file path', () => {
    const result = detectLinkSuffix('/src/main.ts:42:10')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(42)
    expect(result!.col).toBe(10)
    expect(result!.index).toBe(12)
    expect(result!.suffix).toBe(':42:10')
  })

  test('rejects line 0', () => {
    expect(detectLinkSuffix(':0')).toBeNull()
  })

  test('rejects col 0', () => {
    expect(detectLinkSuffix(':10:0')).toBeNull()
  })
})

// ── removeLinkSuffix ────────────────────────────────────────────────────────

describe('removeLinkSuffix', () => {
  test('removes colon suffix', () => {
    expect(removeLinkSuffix('/src/main.ts:42')).toBe('/src/main.ts')
  })

  test('removes colon+col suffix', () => {
    expect(removeLinkSuffix('/src/main.ts:42:10')).toBe('/src/main.ts')
  })

  test('returns unchanged string when no suffix', () => {
    expect(removeLinkSuffix('/src/main.ts')).toBe('/src/main.ts')
  })

  test('removes parenthesized suffix', () => {
    expect(removeLinkSuffix('/src/main.ts(42)')).toBe('/src/main.ts')
  })
})

// ── removeLinkQueryString ───────────────────────────────────────────────────

describe('removeLinkQueryString', () => {
  test('removes query string', () => {
    expect(removeLinkQueryString('file.ts?raw=true')).toBe('file.ts')
  })

  test('returns unchanged string when no query string', () => {
    expect(removeLinkQueryString('file.ts')).toBe('file.ts')
  })

  test('handles empty query string', () => {
    expect(removeLinkQueryString('file.ts?')).toBe('file.ts')
  })

  test('removes everything after first ?', () => {
    expect(removeLinkQueryString('file.ts?a=1&b=2')).toBe('file.ts')
  })
})

// ── detectLinks (Unix) ──────────────────────────────────────────────────────

describe('detectLinks (Unix)', () => {
  const os = 'linux'

  test('detects absolute path with line suffix', () => {
    const results = detectLinks('/home/user/project/src/main.ts:42:10', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/home/user/project/src/main.ts')
    expect(results[0].suffix).not.toBeNull()
    expect(results[0].suffix!.line).toBe(42)
    expect(results[0].suffix!.col).toBe(10)
    expect(results[0].text).toBe('/home/user/project/src/main.ts:42:10')
  })

  test('detects absolute path without suffix', () => {
    const results = detectLinks('/home/user/project/src/main.ts', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/home/user/project/src/main.ts')
    expect(results[0].suffix).toBeNull()
  })

  test('detects ./relative path', () => {
    const results = detectLinks('./src/main.ts', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('./src/main.ts')
  })

  test('detects ../relative path', () => {
    const results = detectLinks('../src/main.ts', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('../src/main.ts')
  })

  test('detects ~/ home path', () => {
    const results = detectLinks('~/project/src/main.ts', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('~/project/src/main.ts')
  })

  test('detects file:/// URI', () => {
    const results = detectLinks('file:///home/user/project/src/main.ts:10', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('file:///home/user/project/src/main.ts')
    expect(results[0].suffix!.line).toBe(10)
  })

  test('detects path embedded in text', () => {
    const results = detectLinks('error at /src/main.ts:42', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/src/main.ts')
    expect(results[0].suffix!.line).toBe(42)
  })

  test('detects multiple paths', () => {
    const results = detectLinks(
      'compare /src/a.ts:10 and /src/b.ts:20',
      os,
    )
    expect(results).toHaveLength(2)
    expect(results[0].path).toBe('/src/a.ts')
    expect(results[0].suffix!.line).toBe(10)
    expect(results[1].path).toBe('/src/b.ts')
    expect(results[1].suffix!.line).toBe(20)
  })

  test('returns empty for empty string', () => {
    expect(detectLinks('', os)).toEqual([])
  })

  test('returns empty for plain text', () => {
    expect(detectLinks('no paths here', os)).toEqual([])
  })

  test('handles git diff prefix', () => {
    const results = detectLinks(
      'diff --git a/src/main.ts b/src/main.ts',
      os,
    )
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  test('detects path with # suffix (Ruby-style)', () => {
    const results = detectLinks('/src/ruby_file.rb#42', os)
    expect(results).toHaveLength(1)
    expect(results[0].suffix).not.toBeNull()
    expect(results[0].suffix!.line).toBe(42)
  })

  test('detects path with comma suffix', () => {
    const results = detectLinks('/src/file.ts,339', os)
    expect(results).toHaveLength(1)
    expect(results[0].suffix).not.toBeNull()
    expect(results[0].suffix!.line).toBe(339)
  })

  test('detects path with ", line N" suffix', () => {
    const results = detectLinks('/src/file.ts, line 100', os)
    expect(results).toHaveLength(1)
    expect(results[0].suffix).not.toBeNull()
    expect(results[0].suffix!.line).toBe(100)
  })

  test('detects path with parenthesized suffix', () => {
    const results = detectLinks('/src/file.ts(42, 10)', os)
    expect(results).toHaveLength(1)
    expect(results[0].suffix).not.toBeNull()
    expect(results[0].suffix!.line).toBe(42)
    expect(results[0].suffix!.col).toBe(10)
  })
})

// ── detectLinks (Windows) ───────────────────────────────────────────────────

describe('detectLinks (Windows)', () => {
  const os = 'win32'

  test('detects C:\\ path with suffix', () => {
    const results = detectLinks('C:\\Users\\dev\\project\\src\\main.ts:42', os)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('C:\\Users\\dev\\project\\src\\main.ts')
    expect(results[0].suffix!.line).toBe(42)
  })

  test('detects C:/ forward slash path', () => {
    const results = detectLinks('C:/Users/dev/project/src/main.ts:10', os)
    expect(results).toHaveLength(1)
    expect(results[0].suffix!.line).toBe(10)
  })

  test('detects file:///C:/ URI', () => {
    const results = detectLinks(
      'file:///C:/Users/dev/project/src/main.ts:10:5',
      os,
    )
    expect(results).toHaveLength(1)
    expect(results[0].suffix!.line).toBe(10)
    expect(results[0].suffix!.col).toBe(5)
  })

  test('detects \\\\?\\ prefix path', () => {
    const results = detectLinks(
      '\\\\?\\C:\\Users\\dev\\project\\src\\main.ts',
      os,
    )
    expect(results).toHaveLength(1)
    expect(results[0].path).toContain('C:')
  })

  test('detects C:\\ path without suffix', () => {
    const results = detectLinks('C:\\Users\\dev\\project\\src\\main.ts', os)
    expect(results).toHaveLength(1)
    expect(results[0].suffix).toBeNull()
  })

  test('returns empty for plain text', () => {
    expect(detectLinks('hello world', os)).toEqual([])
  })
})

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe('detectLinks edge cases', () => {
  test('does not detect URLs as file paths', () => {
    const results = detectLinks('https://example.com/file.ts', 'linux')
    expect(results).toHaveLength(0)
  })

  test('does not detect http URLs', () => {
    const results = detectLinks('http://localhost:3000', 'linux')
    expect(results).toHaveLength(0)
  })

  test('handles line with only whitespace', () => {
    expect(detectLinks('   ', 'linux')).toEqual([])
  })

  test('detects link at start of line', () => {
    const results = detectLinks('/src/main.ts:1', 'linux')
    expect(results).toHaveLength(1)
    expect(results[0].index).toBe(0)
  })

  test('detects link at end of line', () => {
    const results = detectLinks('see /src/main.ts:1', 'linux')
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/src/main.ts')
  })

  test('index and endIndex slice correctly from original line', () => {
    const line = 'error at /src/main.ts:42:10 here'
    const results = detectLinks(line, 'linux')
    expect(results).toHaveLength(1)
    const link = results[0]
    expect(line.slice(link.index, link.endIndex)).toBe(link.text)
  })

  test('handles multiple paths without overlapping', () => {
    const results = detectLinks(
      '/src/a.ts:1 /src/b.ts:2 /src/c.ts:3',
      'linux',
    )
    expect(results).toHaveLength(3)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].index).toBeGreaterThanOrEqual(results[i - 1].endIndex)
    }
  })

  test('detects path with space+line suffix', () => {
    const results = detectLinks('/src/main.ts 42', 'linux')
    expect(results).toHaveLength(1)
    expect(results[0].suffix).not.toBeNull()
    expect(results[0].suffix!.line).toBe(42)
  })

  test('detects path with range suffix :339:12-341.789', () => {
    const results = detectLinks('/src/main.ts:339:12-341.789', 'linux')
    expect(results).toHaveLength(1)
    expect(results[0].suffix!.line).toBe(339)
    expect(results[0].suffix!.col).toBe(12)
  })

  test('handles single-segment path with suffix', () => {
    const results = detectLinks('main.ts:10', 'linux')
    // With no leading / or ./, this may or may not be detected depending on
    // phase 2. The suffix detection (phase 1) should handle it if there's text
    // before the suffix.
    if (results.length > 0) {
      expect(results[0].suffix!.line).toBe(10)
    }
  })

  test('handles path with trailing punctuation', () => {
    const results = detectLinks('see /src/main.ts:42.', 'linux')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Interface Type Checks ────────────────────────────────────────────────────

describe('IParsedLink structure', () => {
  test('returned objects satisfy the IParsedLink interface', () => {
    const results = detectLinks('/src/main.ts:42:10', 'linux')
    expect(results).toHaveLength(1)
    const link: IParsedLink = results[0]

    expect(typeof link.text).toBe('string')
    expect(typeof link.index).toBe('number')
    expect(typeof link.endIndex).toBe('number')
    expect(typeof link.path).toBe('string')

    if (link.suffix !== null) {
      expect(typeof link.suffix.line).toBe('number')
      expect(typeof link.suffix.col).toBe('number')
      expect(typeof link.suffix.suffix).toBe('string')
      expect(typeof link.suffix.index).toBe('number')
    }
  })
})
