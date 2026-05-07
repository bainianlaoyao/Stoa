import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

export { parseClaudeCodeSession } from './claude-code-parser'
export { parseCodexSession } from './codex-parser'
export { parseOpenCodeSession } from './opencode-parser'

/**
 * Discover the transcript file path for a Claude Code session.
 * Claude Code stores sessions at ~/.claude/projects/<path-hash>/<session-id>.jsonl
 * where <path-hash> is the project path with / \ : replaced by -.
 */
export function discoverClaudeCodeTranscript(
  projectPath: string,
  externalSessionId: string
): string | null {
  if (!projectPath || !externalSessionId) return null
  const normalized = projectPath.replace(/[/\\:]/g, '-')
  const dir = join(homedir(), '.claude', 'projects', normalized)
  const file = join(dir, `${externalSessionId}.jsonl`)
  return existsSync(file) ? file : null
}

/**
 * Discover the transcript file path for a Codex session.
 * Codex stores sessions at ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * Scans by date proximity and matches by externalSessionId in file content.
 */
export function discoverCodexTranscript(
  _projectPath: string,
  externalSessionId: string,
  createdAt: string
): string | null {
  if (!externalSessionId || !createdAt) return null
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime())) return null

  const y = date.getFullYear().toString()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const dayDir = join(homedir(), '.codex', 'sessions', y, m, d)

  if (!existsSync(dayDir)) return null

  const files = readdirSync(dayDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse()

  for (const f of files) {
    const fullPath = join(dayDir, f)
    const content = readFileSync(fullPath, 'utf8')
    if (content.includes(externalSessionId)) {
      return fullPath
    }
  }

  return files.length > 0 ? join(dayDir, files[0]) : null
}

export function getOpenCodeDbPath(): string {
  return join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
}
