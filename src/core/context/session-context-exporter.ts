import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { NormalizedTurn, FullTextExportOptions, FullTextExportResult } from './types'
import { formatFullText } from './full-text-formatter'
import { stripAnsi } from './ansi-stripper'
import { parseClaudeCodeSession } from './parsers/claude-code-parser'
import { parseCodexSession } from './parsers/codex-parser'
import { parseOpenCodeSession } from './parsers/opencode-parser'
import {
  discoverClaudeCodeTranscript,
  discoverCodexTranscript,
  getOpenCodeDbPath
} from './parsers/index'
import type { SessionType } from '@shared/project-session'

export interface SessionInfo {
  sessionId: string
  type: SessionType
  projectPath: string
  externalSessionId: string | null
  createdAt: string
  terminalReplay?: string
}

export class SessionContextExporter {
  async exportFullText(
    session: SessionInfo,
    options: FullTextExportOptions
  ): Promise<FullTextExportResult> {
    if (session.type === 'shell') {
      throw new Error('Full text context export is not supported for shell sessions.')
    }

    const turns: NormalizedTurn[] = []

    const providerTurns = await this.parseProviderTranscript(session, options)
    turns.push(...providerTurns)

    if (session.terminalReplay) {
      const plainReplay = stripAnsi(session.terminalReplay)
      if (plainReplay.trim()) {
        turns.push({
          role: 'assistant',
          text: `[Terminal Output]\n${plainReplay}`,
          timestamp: Date.now()
        })
      }
    }

    turns.sort((a, b) => a.timestamp - b.timestamp)

    return formatFullText(turns, options)
  }

  private async parseProviderTranscript(
    session: SessionInfo,
    options: FullTextExportOptions
  ): Promise<NormalizedTurn[]> {
    switch (session.type) {
      case 'claude-code': return this.parseClaudeCode(session, options)
      case 'codex': return this.parseCodex(session, options)
      case 'opencode': return this.parseOpenCode(session, options)
      default: return []
    }
  }

  private async readTranscript(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  }

  private async parseClaudeCode(session: SessionInfo, options: FullTextExportOptions): Promise<NormalizedTurn[]> {
    if (!session.externalSessionId) return []
    const transcriptPath = discoverClaudeCodeTranscript(session.projectPath, session.externalSessionId)
    if (!transcriptPath) return []
    const content = await this.readTranscript(transcriptPath)
    if (!content) return []
    return [...parseClaudeCodeSession(content, { includeThinking: options.includeThinking })]
  }

  private async parseCodex(session: SessionInfo, options: FullTextExportOptions): Promise<NormalizedTurn[]> {
    if (!session.externalSessionId) return []
    const transcriptPath = discoverCodexTranscript(session.projectPath, session.externalSessionId, session.createdAt)
    if (!transcriptPath) return []
    const content = await this.readTranscript(transcriptPath)
    if (!content) return []
    return [...parseCodexSession(content, { includeThinking: options.includeThinking })]
  }

  private async parseOpenCode(session: SessionInfo, options: FullTextExportOptions): Promise<NormalizedTurn[]> {
    if (!session.externalSessionId) return []
    const dbPath = getOpenCodeDbPath()
    if (!existsSync(dbPath)) return []
    const Database = (await import('better-sqlite3')).default
    const db: InstanceType<typeof Database> = new Database(dbPath, { readonly: true })
    try {
      return [...parseOpenCodeSession(db, session.externalSessionId, { includeThinking: options.includeThinking })]
    } finally {
      db.close()
    }
  }
}
