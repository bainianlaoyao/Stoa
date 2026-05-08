import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { NormalizedTurn, FullTextExportOptions, FullTextExportResult } from './types'
import { formatFullText } from './full-text-formatter'
import { formatSlimText } from './slim-text-formatter'
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

export interface ContextExportOptions {
  includeThinking?: boolean
  includeToolDetails?: boolean
  maxChars?: number
  cursor?: string
}

export interface SlimExportOptions {
  maxChars?: number
  cursor?: string
}

export type SlimExportContext = Pick<ContextExportContext, 'projectSessionManager'>

export interface ContextExportContext {
  projectSessionManager: {
    snapshot: () => {
      sessions: Array<{ id: string; projectId: string; type: SessionType; externalSessionId: string | null; createdAt: string }>
      projects: Array<{ id: string; path: string }>
    }
  }
  runtimeController: {
    getTerminalReplay: (id: string) => Promise<string | null>
  }
}

export async function handleContextExportFullText(
  sessionId: string,
  options: ContextExportOptions,
  context: ContextExportContext
): Promise<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }> {
  const snapshot = context.projectSessionManager.snapshot()
  const session = snapshot.sessions.find(s => s.id === sessionId)
  if (!session) {
    return { text: '', truncated: false, totalTurns: 0 }
  }

  const project = snapshot.projects.find(p => p.id === session.projectId)
  if (!project) {
    return { text: '', truncated: false, totalTurns: 0 }
  }

  const terminalReplay = await context.runtimeController.getTerminalReplay(sessionId)

  const exporter = new SessionContextExporter()
  return exporter.exportFullText(
    {
      sessionId: session.id,
      type: session.type,
      projectPath: project.path,
      externalSessionId: session.externalSessionId,
      createdAt: session.createdAt,
      terminalReplay: terminalReplay || undefined
    },
    {
      includeThinking: options.includeThinking ?? false,
      includeToolDetails: options.includeToolDetails ?? false,
      maxChars: options.maxChars,
      cursor: options.cursor
    }
  )
}

export async function handleContextExportSlimText(
  sessionId: string,
  options: SlimExportOptions,
  context: SlimExportContext
): Promise<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }> {
  const snapshot = context.projectSessionManager.snapshot()
  const session = snapshot.sessions.find(s => s.id === sessionId)
  if (!session) {
    return { text: '', truncated: false, totalTurns: 0 }
  }

  const project = snapshot.projects.find(p => p.id === session.projectId)
  if (!project) {
    return { text: '', truncated: false, totalTurns: 0 }
  }

  const exporter = new SessionContextExporter()
  return exporter.exportSlimText(
    {
      sessionId: session.id,
      type: session.type,
      projectPath: project.path,
      externalSessionId: session.externalSessionId,
      createdAt: session.createdAt
    },
    {
      maxChars: options.maxChars,
      cursor: options.cursor
    }
  )
}

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

  async exportSlimText(
    session: SessionInfo,
    options: SlimExportOptions
  ): Promise<FullTextExportResult> {
    if (session.type === 'shell') {
      throw new Error('Slim text context export is not supported for shell sessions.')
    }

    const turns: NormalizedTurn[] = []

    const providerTurns = await this.parseProviderTranscript(session, {
      includeThinking: false,
      includeToolDetails: false,
      maxChars: options.maxChars,
      cursor: options.cursor
    })
    turns.push(...providerTurns)

    turns.sort((a, b) => a.timestamp - b.timestamp)

    return formatSlimText(turns, options)
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
