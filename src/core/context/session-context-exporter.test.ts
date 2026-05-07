import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionContextExporter } from './session-context-exporter'
import type { FullTextExportOptions } from './types'

vi.mock('./parsers/claude-code-parser', () => ({
  parseClaudeCodeSession: vi.fn(function*() {
    yield { role: 'user', text: 'Hello from test', timestamp: 1000 }
    yield { role: 'assistant', text: 'Hi there', timestamp: 5000 }
  })
}))

vi.mock('./parsers/codex-parser', () => ({
  parseCodexSession: vi.fn(function*() {})
}))

vi.mock('./parsers/opencode-parser', () => ({
  parseOpenCodeSession: vi.fn(function*() {})
}))

vi.mock('./parsers/index', () => ({
  discoverClaudeCodeTranscript: vi.fn(() => '/fake/transcript.jsonl'),
  discoverCodexTranscript: vi.fn(() => '/fake/rollout.jsonl'),
  getOpenCodeDbPath: vi.fn(() => '/fake/opencode.db')
}))

vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => [])
    })),
    close: vi.fn()
  }
  return { default: vi.fn(() => mockDb) }
})

describe('SessionContextExporter', () => {
  let exporter: SessionContextExporter
  let readTranscriptSpy: ReturnType<typeof vi.spyOn>

  const defaultOptions: FullTextExportOptions = {
    includeThinking: false,
    includeToolDetails: false
  }

  beforeEach(() => {
    exporter = new SessionContextExporter()
    readTranscriptSpy = vi.spyOn(exporter as any, 'readTranscript').mockResolvedValue('fake-content')
  })

  it('exports full text for claude-code sessions', async () => {
    const result = await exporter.exportFullText(
      {
        sessionId: 'ses-1',
        type: 'claude-code',
        projectPath: '/project',
        externalSessionId: 'ext-1',
        createdAt: '2026-05-07T10:00:00.000Z'
      },
      defaultOptions
    )
    expect(result.text).toContain('[User]')
    expect(result.text).toContain('Hello from test')
    expect(result.text).toContain('[Assistant]')
    expect(result.text).toContain('Hi there')
    expect(result.totalTurns).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('exports full text for codex sessions', async () => {
    const result = await exporter.exportFullText(
      {
        sessionId: 'ses-2',
        type: 'codex',
        projectPath: '/project',
        externalSessionId: 'ext-2',
        createdAt: '2026-05-07T10:00:00.000Z'
      },
      defaultOptions
    )
    expect(result).toBeDefined()
    expect(result.text).toBeDefined()
  })

  it('throws for shell sessions (no transcript)', async () => {
    await expect(
      exporter.exportFullText(
        {
          sessionId: 'ses-shell',
          type: 'shell',
          projectPath: '/project',
          externalSessionId: null,
          createdAt: '2026-05-07T10:00:00.000Z'
        },
        defaultOptions
      )
    ).rejects.toThrow('not supported')
  })

  it('merges terminal replay into output', async () => {
    const result = await exporter.exportFullText(
      {
        sessionId: 'ses-1',
        type: 'claude-code',
        projectPath: '/project',
        externalSessionId: 'ext-1',
        createdAt: '2026-05-07T10:00:00.000Z',
        terminalReplay: 'npm install\nInstalling packages...\x1b[32mDone\x1b[0m'
      },
      defaultOptions
    )
    expect(result.text).toContain('[Terminal Output]')
    expect(result.text).toContain('Done')
    expect(result.text).not.toContain('\x1b[')
  })

  it('returns empty result when no transcript found', async () => {
    readTranscriptSpy.mockResolvedValue(null)

    const result = await exporter.exportFullText(
      {
        sessionId: 'ses-3',
        type: 'claude-code',
        projectPath: '/project',
        externalSessionId: 'ext-missing',
        createdAt: '2026-05-07T10:00:00.000Z'
      },
      defaultOptions
    )
    expect(result.text).toBe('')
    expect(result.totalTurns).toBe(0)
  })
})
