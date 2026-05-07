import { describe, it, expect } from 'vitest'
import type { NormalizedTurn, FullTextExportOptions, FullTextExportResult } from './types'

describe('context types', () => {
  it('NormalizedTurn has required fields', () => {
    const turn: NormalizedTurn = {
      role: 'user',
      text: 'hello',
      timestamp: 1000
    }
    expect(turn.role).toBe('user')
    expect(turn.text).toBe('hello')
  })

  it('FullTextExportOptions defaults are explicit', () => {
    const opts: FullTextExportOptions = {
      includeThinking: false,
      includeToolDetails: false
    }
    expect(opts.includeThinking).toBe(false)
    expect(opts.maxChars).toBeUndefined()
  })

  it('FullTextExportResult has text and metadata', () => {
    const result: FullTextExportResult = {
      text: 'output',
      truncated: false,
      totalTurns: 1
    }
    expect(result.nextCursor).toBeUndefined()
    expect(result.totalTurns).toBe(1)
  })
})
