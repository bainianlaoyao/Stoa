import type { NormalizedTurn, ToolCallSummary } from '../types'
import type Database from 'better-sqlite3'

interface ParseOptions {
  includeThinking: boolean
}

export function* parseOpenCodeSession(
  db: Database.Database,
  sessionId: string,
  options: ParseOptions
): Generator<NormalizedTurn> {
  const messages = db.prepare(
    'SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created'
  ).all(sessionId) as Array<{ id: string; data: string; time_created: number }>

  for (const msg of messages) {
    let msgData: { role?: string; time?: { created?: number } }
    try {
      msgData = JSON.parse(msg.data)
    } catch {
      continue
    }

    const role = msgData.role
    if (role !== 'user' && role !== 'assistant') continue

    const parts = db.prepare(
      'SELECT data, time_created FROM part WHERE message_id = ? ORDER BY time_created'
    ).all(msg.id) as Array<{ data: string; time_created: number }>

    const textParts: string[] = []
    const toolCalls: ToolCallSummary[] = []

    for (const p of parts) {
      let partData: { type?: string; text?: string; tool?: string; state?: unknown }
      try {
        partData = JSON.parse(p.data)
      } catch {
        continue
      }

      if (partData.type === 'text' && partData.text) {
        textParts.push(partData.text)
      }
      if (partData.type === 'reasoning' && options.includeThinking && partData.text) {
        textParts.push(partData.text)
      }
      if (partData.type === 'tool' && partData.tool) {
        const state = (partData.state ?? {}) as Record<string, unknown>
        const input = state.input ? JSON.stringify(state.input).slice(0, 120) : ''
        const output = typeof state.output === 'string' ? state.output.slice(0, 200) : undefined
        toolCalls.push({ name: partData.tool, inputPreview: input, outputPreview: output })
      }
      // step-start, step-finish → skip (metadata only)
    }

    if (textParts.length > 0 || toolCalls.length > 0) {
      yield {
        role: role as 'user' | 'assistant',
        text: textParts.join('\n'),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: msgData.time?.created ?? msg.time_created ?? 0
      }
    }
  }
}
