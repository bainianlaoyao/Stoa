/**
 * Full extraction script — processes COMPLETE session files for all three providers.
 * Usage: npx tsx --tsconfig tsconfig.node.json scripts/extract-context-samples.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Types
interface NormalizedTurn {
  role: 'user' | 'assistant'
  text: string
  toolCalls?: ToolCallSummary[]
  timestamp: number
}

interface ToolCallSummary {
  name: string
  inputPreview: string
  outputPreview?: string
}

// ANSI stripper
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\|\x1b[^[\]].?/g

// Formatter — outputs pure text blocks with role headers
function formatFullText(turns: NormalizedTurn[]): string {
  const lines: string[] = []
  for (const turn of turns) {
    const header = turn.role === 'user' ? '[User]' : '[Assistant]'
    const parts: string[] = []
    if (turn.text.trim()) {
      parts.push(`${header}\n${turn.text}`)
    }
    if (turn.toolCalls?.length) {
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
    const block = parts.join('\n')
    if (block) lines.push(block)
  }
  return lines.join('\n\n')
}

// Claude Code parser — processes full JSONL files
function* parseClaudeCode(jsonl: string): Generator<NormalizedTurn> {
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: any
    try { entry = JSON.parse(trimmed) } catch { continue }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (!entry.message?.content) continue
    const content = entry.message.content
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0

    if (entry.type === 'user') {
      if (typeof content === 'string' && content.trim()) {
        yield { role: 'user', text: content, timestamp: ts }
      } else if (Array.isArray(content)) {
        const tools: ToolCallSummary[] = []
        for (const block of content) {
          if (block.type === 'tool_result') {
            const c = block.content
            const resultText = typeof c === 'string' ? c :
              Array.isArray(c) ? c.filter((i: any) => i.type === 'text').map((i: any) => i.text ?? '').join('\n') : ''
            if (resultText) tools.push({ name: 'result', inputPreview: '', outputPreview: stripAnsi(resultText).slice(0, 500) })
          }
        }
        if (tools.length > 0) yield { role: 'user', text: '', toolCalls: tools, timestamp: ts }
      }
    } else {
      const textParts: string[] = []
      const toolCalls: ToolCallSummary[] = []
      const blocks = Array.isArray(content) ? content : [content]
      for (const block of blocks) {
        if (block.type === 'text' && block.text) textParts.push(block.text)
        if (block.type === 'tool_use') {
          toolCalls.push({ name: block.name ?? 'unknown', inputPreview: JSON.stringify(block.input ?? {}).slice(0, 200) })
        }
      }
      yield { role: 'assistant', text: textParts.join('\n'), toolCalls: toolCalls.length > 0 ? toolCalls : undefined, timestamp: ts }
    }
  }
}

// Codex parser — processes full JSONL rollouts
function* parseCodex(jsonl: string): Generator<NormalizedTurn> {
  const pendingTools = new Map<string, { name: string; inputPreview: string; outputPreview?: string }>()
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: any
    try { entry = JSON.parse(trimmed) } catch { continue }
    if (entry.type !== 'response_item' || !entry.payload) continue
    const payload = entry.payload
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0

    if (payload.type === 'message' && payload.role === 'user') {
      const texts = (payload.content ?? [])
        .filter((c: any) => c.type === 'input_text' && typeof c.text === 'string')
        .map((c: any) => c.text as string)
        .filter((t: string) => !t.startsWith('<'))
      if (texts.length > 0) yield { role: 'user', text: texts.join('\n'), timestamp: ts }
    }
    if (payload.type === 'function_call') {
      const inputStr = payload.arguments ? JSON.stringify(payload.arguments).slice(0, 200) : ''
      pendingTools.set(payload.call_id, { name: payload.name ?? 'unknown', inputPreview: inputStr })
    }
    if (payload.type === 'function_call_output') {
      const pending = pendingTools.get(payload.call_id)
      if (pending) pending.outputPreview = stripAnsi(payload.output ?? '').slice(0, 500)
    }
    if (payload.type === 'message' && payload.role === 'assistant') {
      const texts = (payload.content ?? [])
        .filter((c: any) => c.type === 'output_text' && typeof c.text === 'string')
        .map((c: any) => c.text as string)
        .filter((t: string) => t.trim().length > 0)
      const tools: ToolCallSummary[] = []
      if (pendingTools.size > 0) {
        for (const pt of pendingTools.values()) tools.push({ name: pt.name, inputPreview: pt.inputPreview, outputPreview: pt.outputPreview })
        pendingTools.clear()
      }
      if (texts.length > 0 || tools.length > 0) {
        yield { role: 'assistant', text: texts.join('\n'), toolCalls: tools.length > 0 ? tools : undefined, timestamp: ts }
      }
    }
  }
}

// OpenCode parser — tries SQLite first, falls back to JSON export
function parseOpenCodeFromExport(messagesJson: string, partsJson: string): NormalizedTurn[] {
  function parseJsonlOrJson(raw: string): any[] {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed) } catch {}
    }
    const results: any[] = []
    for (const line of trimmed.split('\n')) {
      let l = line.trim()
      if (!l || l === '[' || l === ']' || l === '[],') continue
      if (l.endsWith(',')) l = l.slice(0, -1)
      try { results.push(JSON.parse(l)) } catch {}
    }
    return results
  }

  function tryParseJson(raw: string): any | null {
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return null }
  }

  const messages: any[] = parseJsonlOrJson(messagesJson)
  const parts: any[] = parseJsonlOrJson(partsJson)
  const turns: NormalizedTurn[] = []

  for (const msg of messages) {
    const raw = msg.data ?? msg.data_preview
    let msgData: any = tryParseJson(raw)
    if (!msgData) continue
    const role = msgData.role
    if (role !== 'user' && role !== 'assistant') continue
    const msgParts = parts.filter((p: any) => p.message_id === msg.id)
    const textParts: string[] = []
    const toolCalls: ToolCallSummary[] = []
    for (const p of msgParts) {
      const praw = p.data ?? p.data_preview
      let d: any = tryParseJson(praw)
      if (!d) continue
      if (d.type === 'text' && d.text) textParts.push(d.text)
      if (d.type === 'tool' && d.tool) {
        const state = d.state ?? {}
        toolCalls.push({
          name: d.tool,
          inputPreview: state.input ? JSON.stringify(state.input).slice(0, 200) : '',
          outputPreview: typeof state.output === 'string' ? state.output.slice(0, 500) : undefined
        })
      }
    }
    if (textParts.length > 0 || toolCalls.length > 0) {
      turns.push({
        role: role as 'user' | 'assistant',
        text: textParts.join('\n'),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp: msgData.time?.created ?? msg.time_created ?? 0
      })
    }
  }
  return turns
}

// ─── Main ────────────────────────────────────────────────────────────────────

const outputDir = 'C:\\Users\\30280\\AppData\\Local\\Temp\\opencode\\full-extraction'
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_RE, '')
}

// ─── Claude Code (full session) ──────────────────────────────────────────────
const claudeSessionPath = 'C:\\Users\\30280\\.claude\\projects\\D--Data-DEV-ultra-simple-panel\\600bc887-8948-44c3-80d3-33119467cedd.jsonl'
if (existsSync(claudeSessionPath)) {
  console.log('=== Extracting Claude Code FULL session ===')
  const claudeJsonl = readFileSync(claudeSessionPath, 'utf8')
  const claudeTurns = [...parseClaudeCode(claudeJsonl)]
  const claudeText = formatFullText(claudeTurns)
  writeFileSync(join(outputDir, 'claude-code-full-session.txt'), claudeText, 'utf8')
  const userTurns = claudeTurns.filter(t => t.role === 'user').length
  const asstTurns = claudeTurns.filter(t => t.role === 'assistant').length
  console.log(`Claude Code: ${claudeTurns.length} turns (${userTurns} user, ${asstTurns} assistant), ${(claudeText.length / 1024).toFixed(1)}KB`)
  console.log(`  File: ${join(outputDir, 'claude-code-full-session.txt')}`)
} else {
  console.log(`Claude Code session not found: ${claudeSessionPath}`)
}

// ─── Codex (full session) ────────────────────────────────────────────────────
const codexSessionPath = 'C:\\Users\\30280\\.codex\\sessions\\2026\\05\\07\\rollout-2026-05-07T09-41-54-019e0019-3da7-7663-a2c7-228c6840cd72.jsonl'
if (existsSync(codexSessionPath)) {
  console.log('\n=== Extracting Codex FULL session ===')
  const codexJsonl = readFileSync(codexSessionPath, 'utf8')
  const codexTurns = [...parseCodex(codexJsonl)]
  const codexText = formatFullText(codexTurns)
  writeFileSync(join(outputDir, 'codex-full-session.txt'), codexText, 'utf8')
  const userTurns = codexTurns.filter(t => t.role === 'user').length
  const asstTurns = codexTurns.filter(t => t.role === 'assistant').length
  console.log(`Codex: ${codexTurns.length} turns (${userTurns} user, ${asstTurns} assistant), ${(codexText.length / 1024).toFixed(1)}KB`)
  console.log(`  File: ${join(outputDir, 'codex-full-session.txt')}`)
} else {
  console.log(`Codex session not found: ${codexSessionPath}`)
}

// ─── OpenCode (from JSON export if available) ────────────────────────────────
const sampleDir = 'C:\\Users\\30280\\AppData\\Local\\Temp\\opencode\\session-samples'
const ocMsgPath = join(sampleDir, 'opencode-messages.json')
const ocPartsPath = join(sampleDir, 'opencode-parts.json')
if (existsSync(ocMsgPath) && existsSync(ocPartsPath)) {
  console.log('\n=== Extracting OpenCode session (JSON export) ===')
  const opencodeMessages = readFileSync(ocMsgPath, 'utf8')
  const opencodeParts = readFileSync(ocPartsPath, 'utf8')
  const opencodeTurns = parseOpenCodeFromExport(opencodeMessages, opencodeParts)
  const opencodeText = formatFullText(opencodeTurns)
  writeFileSync(join(outputDir, 'opencode-full-session.txt'), opencodeText, 'utf8')
  console.log(`OpenCode: ${opencodeTurns.length} turns, ${(opencodeText.length / 1024).toFixed(1)}KB`)
  console.log(`  File: ${join(outputDir, 'opencode-full-session.txt')}`)
} else {
  console.log('\nOpenCode: No JSON export files found. Trying SQLite...')
  // SQLite access is handled by the production pipeline, not this standalone script
  console.log('  (SQLite extraction requires the main process — use IPC through the app)')
}

console.log(`\n=== Output directory: ${outputDir} ===`)
