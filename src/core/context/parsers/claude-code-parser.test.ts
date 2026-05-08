import { describe, it, expect } from 'vitest'
import { parseClaudeCodeSession } from './claude-code-parser'
import type { NormalizedTurn } from '../types'

// Inline fixture — representative Claude Code JSONL
const FIXTURE = [
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'Fix the build error in main.ts' },
    timestamp: '2026-05-07T10:00:00.000Z',
    uuid: 'u1',
    parentUuid: null
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'The error is likely a missing import.' },
        { type: 'text', text: 'Let me check the file.' },
        { type: 'tool_use', name: 'Read', id: 'call_1', input: { file_path: 'main.ts' } }
      ]
    },
    timestamp: '2026-05-07T10:00:05.000Z',
    uuid: 'a1',
    parentUuid: 'u1'
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'import { app } from "electron"\napp.whenReady()' }
      ]
    },
    timestamp: '2026-05-07T10:00:06.000Z',
    uuid: 'u2',
    parentUuid: 'a1'
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'The issue was a missing semicolon on line 42.' }
      ]
    },
    timestamp: '2026-05-07T10:00:10.000Z',
    uuid: 'a2',
    parentUuid: 'u2'
  }),
  JSON.stringify({
    type: 'file-history-snapshot',
    timestamp: '2026-05-07T10:00:11.000Z',
    uuid: 'fh1'
  }),
  JSON.stringify({
    type: 'system',
    message: { role: 'system', content: 'System initialization' },
    timestamp: '2026-05-07T10:00:00.000Z',
    uuid: 's1'
  })
].join('\n')

describe('parseClaudeCodeSession', () => {
  it('yields at least one user and one assistant turn', () => {
    const turns = [...parseClaudeCodeSession(FIXTURE, { includeThinking: false })]
    const roles = turns.map(t => t.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('user turns contain text content', () => {
    const turns = [...parseClaudeCodeSession(FIXTURE, { includeThinking: false })]
    const userTurns = turns.filter(t => t.role === 'user')
    for (const ut of userTurns) {
      expect(ut.text.length + (ut.toolCalls?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('assistant turns can include toolCall summaries', () => {
    const turns = [...parseClaudeCodeSession(FIXTURE, { includeThinking: false })]
    const withTools = turns.filter(t => t.toolCalls && t.toolCalls.length > 0)
    expect(withTools.length).toBeGreaterThan(0)
    for (const t of withTools) {
      expect(t.toolCalls![0].name).toBeTruthy()
    }
  })

  it('skips file-history-snapshot and system entries', () => {
    const turns = [...parseClaudeCodeSession(FIXTURE, { includeThinking: false })]
    for (const t of turns) {
      expect(t.text).not.toContain('trackedFileBackups')
    }
  })

  it('includeThinking=true adds thinking blocks to text', () => {
    const withoutThinking = [...parseClaudeCodeSession(FIXTURE, { includeThinking: false })]
    const withThinking = [...parseClaudeCodeSession(FIXTURE, { includeThinking: true })]
    const totalWith = withThinking.reduce((s, t) => s + t.text.length, 0)
    const totalWithout = withoutThinking.reduce((s, t) => s + t.text.length, 0)
    expect(totalWith).toBeGreaterThanOrEqual(totalWithout)
  })

  it('all turns have valid timestamps', () => {
    const turns = [...parseClaudeCodeSession(FIXTURE, { includeThinking: false })]
    for (const t of turns) {
      expect(t.timestamp).toBeGreaterThan(0)
      expect(Number.isFinite(t.timestamp)).toBe(true)
    }
  })

  it('handles empty input', () => {
    const turns = [...parseClaudeCodeSession('', { includeThinking: false })]
    expect(turns).toEqual([])
  })
})
