import type { NormalizedTurn, FullTextExportResult } from './types'

function encodeCursor(byteOffset: number): string {
  return Buffer.from(String(byteOffset)).toString('base64')
}

function decodeCursor(cursor: string): number {
  return parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10)
}

export function formatSlimText(
  turns: NormalizedTurn[],
  options: { maxChars?: number; cursor?: string } = {}
): FullTextExportResult {
  const maxChars = options.maxChars ?? Infinity
  const filtered = turns.filter(t => t.text.trim() !== '')

  const startTurnIndex = options.cursor ? decodeCursor(options.cursor) : 0

  const lines: string[] = []
  let charCount = 0
  const SEPARATOR = '\n'

  for (let i = startTurnIndex; i < filtered.length; i++) {
    const turn = filtered[i]
    const header = turn.role === 'user' ? '[User]' : '[Assistant]'
    const block = `${header}\n${turn.text}`

    const blockWithSep = (lines.length > 0 ? SEPARATOR : '') + block

    if (charCount + blockWithSep.length > maxChars) {
      if (lines.length === 0) {
        lines.push(block)
        i++
        if (i < filtered.length) {
          return {
            text: lines.join(SEPARATOR),
            nextCursor: encodeCursor(i),
            truncated: true,
            totalTurns: filtered.length
          }
        }
      } else {
        return {
          text: lines.join(SEPARATOR),
          nextCursor: encodeCursor(i),
          truncated: true,
          totalTurns: filtered.length
        }
      }
    } else {
      lines.push(block)
      charCount += blockWithSep.length
    }
  }

  return {
    text: lines.join(SEPARATOR),
    truncated: false,
    totalTurns: filtered.length
  }
}
