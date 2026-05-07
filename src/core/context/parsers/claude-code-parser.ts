import type { NormalizedTurn, ToolCallSummary } from '../types'

interface ParseOptions {
  includeThinking: boolean
}

export function* parseClaudeCodeSession(
  jsonlContent: string,
  options: ParseOptions
): Generator<NormalizedTurn> {
  for (const line of jsonlContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let entry: any
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }

    // Only process user and assistant message types
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (!entry.message?.content) continue

    const content = entry.message.content
    const timestamp = parseTimestamp(entry.timestamp)

    if (entry.type === 'user') {
      yield* parseUserContent(content, timestamp)
    } else {
      yield parseAssistantContent(content, timestamp, options)
    }
  }
}

function* parseUserContent(content: any, timestamp: number): Generator<NormalizedTurn> {
  if (typeof content === 'string') {
    if (content.trim()) {
      yield { role: 'user', text: content, timestamp }
    }
    return
  }

  if (Array.isArray(content)) {
    const texts: string[] = []
    const tools: ToolCallSummary[] = []

    for (const block of content) {
      if (block.type === 'tool_result') {
        const resultText = extractToolResultText(block)
        if (resultText) {
          tools.push({
            name: 'result',
            inputPreview: '',
            outputPreview: resultText.slice(0, 200)
          })
        }
      }
    }

    if (tools.length > 0 && texts.length === 0) {
      yield { role: 'user', text: '', toolCalls: tools, timestamp }
    } else if (texts.length > 0) {
      yield { role: 'user', text: texts.join('\n'), toolCalls: tools.length ? tools : undefined, timestamp }
    }
  }
}

function parseAssistantContent(content: any, timestamp: number, options: ParseOptions): NormalizedTurn {
  const textParts: string[] = []
  const toolCalls: ToolCallSummary[] = []

  const blocks = Array.isArray(content) ? content : [content]
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text)
    }
    if (block.type === 'thinking' && options.includeThinking && block.thinking) {
      textParts.push(block.thinking)
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        name: block.name ?? 'unknown',
        inputPreview: JSON.stringify(block.input ?? {}).slice(0, 120)
      })
    }
  }

  return {
    role: 'assistant',
    text: textParts.join('\n'),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    timestamp
  }
}

function extractToolResultText(block: any): string {
  const c = block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text ?? '')
      .join('\n')
  }
  return ''
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return 0
  const ms = new Date(ts).getTime()
  return Number.isFinite(ms) ? ms : 0
}
