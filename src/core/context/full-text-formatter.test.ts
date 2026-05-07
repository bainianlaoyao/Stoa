import { describe, it, expect } from 'vitest'
import { formatFullText } from './full-text-formatter'
import type { NormalizedTurn, FullTextExportOptions } from './types'

const SAMPLE_TURNS: NormalizedTurn[] = [
  { role: 'user', text: 'Fix the build error', timestamp: 1000 },
  { role: 'assistant', text: 'Let me check the error.', timestamp: 2000 },
  { role: 'user', text: 'Go ahead', timestamp: 3000 },
  { role: 'assistant', text: 'The issue was a missing semicolon on line 42.', timestamp: 4000 }
]

describe('formatFullText', () => {
  it('formats basic turns with role headers', () => {
    const result = formatFullText(SAMPLE_TURNS, { includeThinking: false, includeToolDetails: false })
    expect(result.text).toContain('[User]\nFix the build error')
    expect(result.text).toContain('[Assistant]\nLet me check the error.')
    expect(result.truncated).toBe(false)
    expect(result.totalTurns).toBe(4)
  })

  it('formats turns with tool calls when includeToolDetails=true', () => {
    const turns: NormalizedTurn[] = [
      {
        role: 'assistant',
        text: '',
        toolCalls: [
          { name: 'Glob', inputPreview: '{"pattern":"**/*.ts"}', outputPreview: 'Found 42 files' }
        ],
        timestamp: 1000
      }
    ]
    const result = formatFullText(turns, { includeThinking: false, includeToolDetails: true })
    expect(result.text).toContain('[Assistant]')
    expect(result.text).toContain('[Tool: Glob]')
    expect(result.text).toContain('Found 42 files')
  })

  it('hides tool calls when includeToolDetails=false', () => {
    const turns: NormalizedTurn[] = [
      {
        role: 'assistant',
        text: 'Done.',
        toolCalls: [{ name: 'Bash', inputPreview: '{"command":"ls"}' }],
        timestamp: 1000
      }
    ]
    const result = formatFullText(turns, { includeThinking: false, includeToolDetails: false })
    expect(result.text).not.toContain('[Tool:')
    expect(result.text).toContain('Done.')
  })

  it('skips empty turns', () => {
    const turns: NormalizedTurn[] = [
      { role: 'user', text: '', timestamp: 1000 },
      { role: 'assistant', text: 'Response', timestamp: 2000 }
    ]
    const result = formatFullText(turns, { includeThinking: false, includeToolDetails: false })
    expect(result.totalTurns).toBe(2)
    expect(result.text).not.toContain('[User]')
    expect(result.text).toContain('[Assistant]')
  })

  it('skips turns with only tool calls when includeToolDetails=false', () => {
    const turns: NormalizedTurn[] = [
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ name: 'Read', inputPreview: '{"path":"x.ts"}' }],
        timestamp: 1000
      },
      { role: 'user', text: 'Next prompt', timestamp: 2000 }
    ]
    const result = formatFullText(turns, { includeThinking: false, includeToolDetails: false })
    expect(result.totalTurns).toBe(2)
    expect(result.text).toContain('[User]\nNext prompt')
  })

  it('paginates with maxChars and returns nextCursor', () => {
    const result = formatFullText(SAMPLE_TURNS, {
      maxChars: 50,
      includeThinking: false,
      includeToolDetails: false
    })
    expect(result.truncated).toBe(true)
    expect(result.nextCursor).toBeDefined()
    expect(result.text.length).toBeLessThanOrEqual(50)
    expect(result.totalTurns).toBe(4)
  })

  it('resumes from cursor', () => {
    const page1 = formatFullText(SAMPLE_TURNS, {
      maxChars: 50,
      includeThinking: false,
      includeToolDetails: false
    })
    expect(page1.nextCursor).toBeDefined()

    const page2 = formatFullText(SAMPLE_TURNS, {
      maxChars: 50,
      cursor: page1.nextCursor,
      includeThinking: false,
      includeToolDetails: false
    })
    // page2 should start where page1 left off — different content
    expect(page2.text).not.toBe(page1.text)
  })

  it('handles empty turns array', () => {
    const result = formatFullText([], { includeThinking: false, includeToolDetails: false })
    expect(result.text).toBe('')
    expect(result.totalTurns).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('full pagination round-trip covers all content', () => {
    let cursor: string | undefined
    let allText = ''
    let remaining = 10 // safety limit
    do {
      const page = formatFullText(SAMPLE_TURNS, {
        maxChars: 30,
        cursor,
        includeThinking: false,
        includeToolDetails: false
      })
      allText += page.text
      cursor = page.nextCursor
      remaining--
    } while (cursor && remaining > 0)

    // All user/assistant text should appear somewhere
    expect(allText).toContain('Fix the build error')
    expect(allText).toContain('missing semicolon')
  })

  it('reports full session turn count even when paginated', () => {
    const manyTurns: NormalizedTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `Turn ${i}: some content here`,
      timestamp: i * 1000
    }))

    const page1 = formatFullText(manyTurns, {
      maxChars: 60,
      includeThinking: false,
      includeToolDetails: false
    })
    expect(page1.truncated).toBe(true)
    expect(page1.totalTurns).toBe(20)

    const page2 = formatFullText(manyTurns, {
      maxChars: 60,
      cursor: page1.nextCursor,
      includeThinking: false,
      includeToolDetails: false
    })
    expect(page2.totalTurns).toBe(20)
  })
})
