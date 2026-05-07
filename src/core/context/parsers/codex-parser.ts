import type { NormalizedTurn, ToolCallSummary } from '../types'

interface ParseOptions {
  includeThinking: boolean
}

interface PendingToolCall {
  callId: string
  name: string
  outputPreview?: string
}

export function* parseCodexSession(
  jsonlContent: string,
  options: ParseOptions
): Generator<NormalizedTurn> {
  const pendingTools = new Map<string, PendingToolCall>()

  for (const line of jsonlContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let entry: any
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (entry.type !== 'response_item') continue
    const payload = entry.payload
    if (!payload) continue

    const timestamp = parseTimestamp(entry.timestamp)

    if (payload.type === 'message' && payload.role === 'user') {
      const texts = extractInputTexts(payload.content)
      if (texts.length > 0) {
        yield { role: 'user', text: texts.join('\n'), timestamp }
      }
    }

    if (payload.type === 'message' && payload.role === 'assistant') {
      const texts = extractOutputTexts(payload.content)
      // Also flush any pending tool calls from before this message
      const toolCalls = flushPendingTools(pendingTools)
      if (texts.length > 0 || toolCalls.length > 0) {
        yield {
          role: 'assistant',
          text: texts.join('\n'),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp
        }
      }
    }

    if (payload.type === 'function_call') {
      pendingTools.set(payload.call_id, {
        callId: payload.call_id,
        name: payload.name ?? 'unknown'
      })
    }

    if (payload.type === 'function_call_output') {
      const pending = pendingTools.get(payload.call_id)
      if (pending) {
        pending.outputPreview = (payload.output ?? '').slice(0, 200)
      }
    }

    // Reasoning: encrypted, skip even with includeThinking=true
    // (Codex reasoning is encrypted_content, not readable)
  }

  const remaining = flushPendingTools(pendingTools)
  if (remaining.length > 0) {
    yield { role: 'assistant', text: '', toolCalls: remaining, timestamp: 0 }
  }
}

function extractInputTexts(content: any[] | undefined): string[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((c: any) => c.type === 'input_text' && typeof c.text === 'string')
    .map((c: any) => c.text as string)
    .filter((t: string) => !t.startsWith('<'))
}

function extractOutputTexts(content: any[] | undefined): string[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((c: any) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c: any) => c.text as string)
    .filter((t: string) => t.trim().length > 0)
}

function flushPendingTools(pendingTools: Map<string, PendingToolCall>): ToolCallSummary[] {
  if (pendingTools.size === 0) return []
  const tools: ToolCallSummary[] = []
  for (const pt of pendingTools.values()) {
    tools.push({
      name: pt.name,
      inputPreview: '',
      outputPreview: pt.outputPreview
    })
  }
  pendingTools.clear()
  return tools
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return 0
  const ms = new Date(ts).getTime()
  return Number.isFinite(ms) ? ms : 0
}
