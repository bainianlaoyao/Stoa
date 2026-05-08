import { describe, it, expect } from 'vitest'
import { formatSlimText } from './slim-text-formatter'
import type { NormalizedTurn } from './types'

const SAMPLE_TURNS: NormalizedTurn[] = [
  { role: 'user', text: 'Fix the build error', timestamp: 1000 },
  { role: 'assistant', text: 'Let me check the error.', timestamp: 2000 },
  { role: 'user', text: 'Go ahead', timestamp: 3000 },
  { role: 'assistant', text: 'The issue was a missing semicolon on line 42.', timestamp: 4000 }
]

describe('formatSlimText', () => {
  it('formats basic user + assistant text turns', () => {
    const result = formatSlimText(SAMPLE_TURNS)
    expect(result.text).toContain('[User]\nFix the build error')
    expect(result.text).toContain('[Assistant]\nLet me check the error.')
    expect(result.text).toContain('[User]\nGo ahead')
    expect(result.text).toContain('[Assistant]\nThe issue was a missing semicolon on line 42.')
    expect(result.truncated).toBe(false)
    expect(result.totalTurns).toBe(4)
  })

  it('filters out turns with only tool calls (no text)', () => {
    const turns: NormalizedTurn[] = [
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ name: 'Glob', inputPreview: '{"pattern":"**/*.ts"}', outputPreview: 'Found 42 files' }],
        timestamp: 1000
      },
      { role: 'user', text: 'Next prompt', timestamp: 2000 }
    ]
    const result = formatSlimText(turns)
    expect(result.text).not.toContain('[Tool:')
    expect(result.text).not.toContain('[Assistant]')
    expect(result.text).toContain('[User]\nNext prompt')
    expect(result.totalTurns).toBe(1)
  })

  it('shows only text from mixed turns (text + toolCalls)', () => {
    const turns: NormalizedTurn[] = [
      {
        role: 'assistant',
        text: 'I found the issue.',
        toolCalls: [{ name: 'Bash', inputPreview: '{"command":"ls"}' }],
        timestamp: 1000
      }
    ]
    const result = formatSlimText(turns)
    expect(result.text).toContain('[Assistant]\nI found the issue.')
    expect(result.text).not.toContain('[Tool:')
    expect(result.totalTurns).toBe(1)
  })

  it('skips empty text turns', () => {
    const turns: NormalizedTurn[] = [
      { role: 'user', text: '', timestamp: 1000 },
      { role: 'user', text: '   ', timestamp: 1500 },
      { role: 'assistant', text: 'Response', timestamp: 2000 }
    ]
    const result = formatSlimText(turns)
    expect(result.totalTurns).toBe(1)
    expect(result.text).toBe('[Assistant]\nResponse')
  })

  it('paginates with maxChars and returns nextCursor', () => {
    const result = formatSlimText(SAMPLE_TURNS, { maxChars: 50 })
    expect(result.truncated).toBe(true)
    expect(result.nextCursor).toBeDefined()
    expect(result.text.length).toBeLessThanOrEqual(50)
    expect(result.totalTurns).toBe(4)
  })

  it('totalTurns reports full filtered count, not page count', () => {
    const manyTurns: NormalizedTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `Turn ${i}: some content here`,
      timestamp: i * 1000
    }))

    const page1 = formatSlimText(manyTurns, { maxChars: 60 })
    expect(page1.truncated).toBe(true)
    expect(page1.totalTurns).toBe(20)

    const page2 = formatSlimText(manyTurns, { maxChars: 60, cursor: page1.nextCursor })
    expect(page2.totalTurns).toBe(20)
  })

  it('cursor-based pagination returns correct pages', () => {
    const page1 = formatSlimText(SAMPLE_TURNS, { maxChars: 50 })
    expect(page1.nextCursor).toBeDefined()

    const page2 = formatSlimText(SAMPLE_TURNS, { maxChars: 50, cursor: page1.nextCursor })
    expect(page2.text).not.toBe(page1.text)
  })

  it('handles empty turns array', () => {
    const result = formatSlimText([])
    expect(result.text).toBe('')
    expect(result.totalTurns).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('full pagination round-trip covers all content', () => {
    let cursor: string | undefined
    let allText = ''
    let remaining = 10
    do {
      const page = formatSlimText(SAMPLE_TURNS, { maxChars: 30, cursor })
      allText += page.text
      cursor = page.nextCursor
      remaining--
    } while (cursor && remaining > 0)

    expect(allText).toContain('Fix the build error')
    expect(allText).toContain('missing semicolon')
  })

  it('totalTurns excludes tool-only turns from count', () => {
    const turns: NormalizedTurn[] = [
      { role: 'user', text: 'Hello', timestamp: 1000 },
      { role: 'assistant', text: '', toolCalls: [{ name: 'Read', inputPreview: '{}' }], timestamp: 2000 },
      { role: 'assistant', text: '', toolCalls: [{ name: 'Bash', inputPreview: '{}' }], timestamp: 2500 },
      { role: 'assistant', text: 'Done', timestamp: 3000 }
    ]
    const result = formatSlimText(turns)
    expect(result.totalTurns).toBe(2)
    expect(result.text).toContain('[User]\nHello')
    expect(result.text).toContain('[Assistant]\nDone')
  })
})
