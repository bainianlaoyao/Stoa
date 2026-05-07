import { describe, it, expect } from 'vitest'
import { parseCodexSession } from './codex-parser'

const FIXTURE = [
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the bug in app.ts' }] },
    timestamp: '2026-05-07T12:00:00.000Z'
  }),
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'function_call', name: 'shell_command', call_id: 'call_1', arguments: '{"command":"cat app.ts"}' },
    timestamp: '2026-05-07T12:00:05.000Z'
  }),
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call_1', output: 'const x = 1\nconsole.log(x)' },
    timestamp: '2026-05-07T12:00:06.000Z'
  }),
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The issue was a missing type annotation.' }] },
    timestamp: '2026-05-07T12:00:10.000Z'
  }),
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>System prompt injection</permissions>' }] },
    timestamp: '2026-05-07T12:00:00.000Z'
  }),
  JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-05-07T12:00:00.000Z'
  }),
  JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-05-07T12:00:00.000Z'
  })
].join('\n')

describe('parseCodexSession', () => {
  it('yields at least one user and one assistant turn', () => {
    const turns = [...parseCodexSession(FIXTURE, { includeThinking: false })]
    const roles = turns.map(t => t.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('skips developer/role system injections', () => {
    const turns = [...parseCodexSession(FIXTURE, { includeThinking: false })]
    for (const t of turns) {
      expect(t.text).not.toContain('<permissions instructions>')
    }
  })

  it('skips session_meta, turn_context, event_msg entries', () => {
    const turns = [...parseCodexSession(FIXTURE, { includeThinking: false })]
    for (const t of turns) {
      expect(t.text).not.toContain('session_meta')
    }
  })

  it('assistant turns contain output_text content', () => {
    const turns = [...parseCodexSession(FIXTURE, { includeThinking: false })]
    const assistantTexts = turns.filter(t => t.role === 'assistant').map(t => t.text)
    const hasContent = assistantTexts.some(t => t.length > 0)
    expect(hasContent).toBe(true)
  })

  it('function_call entries produce toolCall summaries', () => {
    const turns = [...parseCodexSession(FIXTURE, { includeThinking: false })]
    const withTools = turns.filter(t => t.toolCalls && t.toolCalls.length > 0)
    expect(withTools.length).toBeGreaterThan(0)
  })

  it('handles empty input', () => {
    const turns = [...parseCodexSession('', { includeThinking: false })]
    expect(turns).toEqual([])
  })
})
