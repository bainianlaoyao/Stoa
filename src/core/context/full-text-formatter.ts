import type { NormalizedTurn, FullTextExportOptions, FullTextExportResult } from './types'

function encodeCursor(byteOffset: number): string {
  return Buffer.from(String(byteOffset)).toString('base64')
}

function decodeCursor(cursor: string): number {
  return parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10)
}

export function formatFullText(
  turns: NormalizedTurn[],
  options: FullTextExportOptions
): FullTextExportResult {
  const maxChars = options.maxChars ?? Infinity
  const startTurnIndex = options.cursor ? decodeCursor(options.cursor) : 0

  const lines: string[] = []
  let charCount = 0
  let turnsIncluded = 0
  const SEPARATOR = '\n'

  for (let i = startTurnIndex; i < turns.length; i++) {
    const turn = turns[i]
    const block = formatTurn(turn, options)

    // Skip empty blocks
    if (!block) continue

    const blockWithSep = (lines.length > 0 ? SEPARATOR : '') + block

    if (charCount + blockWithSep.length > maxChars) {
      if (lines.length === 0) {
        // First block in page exceeds budget — include it to avoid empty pages
        lines.push(block)
        turnsIncluded++
        i++
        if (i < turns.length) {
          return {
            text: lines.join(SEPARATOR),
            nextCursor: encodeCursor(i),
            truncated: true,
            totalTurns: turnsIncluded
          }
        }
      } else {
        return {
          text: lines.join(SEPARATOR),
          nextCursor: encodeCursor(i),
          truncated: true,
          totalTurns: turnsIncluded
        }
      }
    } else {
      lines.push(block)
      charCount += blockWithSep.length
      turnsIncluded++
    }
  }

  return {
    text: lines.join(SEPARATOR),
    truncated: false,
    totalTurns: turnsIncluded
  }
}

function formatTurn(turn: NormalizedTurn, options: FullTextExportOptions): string {
  const parts: string[] = []
  const header = turn.role === 'user' ? '[User]' : '[Assistant]'

  if (turn.text.trim()) {
    parts.push(`${header}\n${turn.text}`)
  }

  if (options.includeToolDetails && turn.toolCalls?.length) {
    for (const tc of turn.toolCalls) {
      let toolLine = `[Tool: ${tc.name}] ${tc.inputPreview}`
      if (tc.outputPreview) {
        toolLine += `\n→ ${tc.outputPreview}`
      }
      if (!turn.text.trim()) {
        toolLine = `${header}\n${toolLine}`
      }
      parts.push(toolLine)
    }
  }

  return parts.join('\n')
}
