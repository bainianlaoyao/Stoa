import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { SessionEvidenceSnapshot } from './evolver-input-materializer'
import { materializeEvidenceSnapshotsIntoEvolverInputs } from './evolver-input-materializer'

describe('materializeEvidenceSnapshotsIntoEvolverInputs', () => {
  let rootDir: string
  let worktreeRepoRoot: string
  let memoryDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'stoa-evolver-input-materializer-'))
    worktreeRepoRoot = join(rootDir, 'worktree')
    memoryDir = join(rootDir, 'memory')
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  test('materializes grouped transcript snapshots, synthesized turn-slices, and deterministic memory notes for Evolver', async () => {
    const imported = await materializeEvidenceSnapshotsIntoEvolverInputs({
      snapshots: [
        createSnapshot({
          timestamp: '2026-04-27T11:55:00.000Z',
          provider: 'claude-code',
          providerSessionId: null,
          sessionId: 'session-internal-1',
          turnId: null,
          evidenceKey: 'claude-code::snapshot-early',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'Initial dependency install attempt.'
          },
          evidence: {
            rawSource: {
              provider: 'claude-code',
              channel: 'hook',
              rawEventName: 'Stop'
            },
            promptText: 'install the project dependencies',
            lastAssistantMessage: 'I will use pip to install them.'
          },
          snapshot: {
            kind: 'turn-slice',
            fileName: 'turn-slice.json',
            content: '{"kind":"turn-slice"}'
          }
        }),
        createSnapshot({
          timestamp: '2026-04-27T12:00:00.000Z',
          provider: 'claude-code',
          providerSessionId: 'claude-session-1',
          sessionId: 'session-internal-1',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'User corrected the workflow to use uv instead of pip.'
          },
          evidence: {
            rawSource: {
              provider: 'claude-code',
              channel: 'hook',
              rawEventName: 'Stop'
            },
            providerSessionId: 'claude-session-1',
            promptText: 'install the project dependencies',
            lastAssistantMessage: 'I will use uv from now on.',
            model: 'claude-sonnet'
          },
          snapshot: {
            kind: 'provider-transcript',
            fileName: 'transcript.jsonl',
            content: [
              JSON.stringify({
                type: 'user',
                message: {
                  role: 'user',
                  content: [{ type: 'text', text: 'install the project dependencies' }]
                }
              }),
              JSON.stringify({
                type: 'assistant',
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'I will use pip to install them.' }]
                }
              }),
              JSON.stringify({
                type: 'user',
                message: {
                  role: 'user',
                  content: [{ type: 'text', text: 'use uv instead of pip for Python environments' }]
                }
              })
            ].join('\n')
          }
        }),
        createSnapshot({
          timestamp: '2026-04-27T12:05:00.000Z',
          provider: 'claude-code',
          providerSessionId: null,
          sessionId: 'session-internal-1',
          turnId: null,
          evidenceKey: 'claude-code::snapshot-late',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'Recorded the uv policy note.'
          },
          evidence: {
            rawSource: {
              provider: 'claude-code',
              channel: 'hook',
              rawEventName: 'Stop'
            },
            promptText: 'add a note about the uv policy',
            lastAssistantMessage: 'Added the uv policy note.'
          },
          snapshot: {
            kind: 'turn-slice',
            fileName: 'turn-slice.json',
            content: '{"kind":"turn-slice"}'
          }
        }),
        createSnapshot({
          timestamp: '2026-04-27T12:15:00.000Z',
          provider: 'codex',
          providerSessionId: 'codex-thread-7',
          sessionId: 'session-internal-2',
          payload: {
            intent: 'agent.turn_completed',
            agentState: 'idle',
            hasUnseenCompletion: true,
            summary: 'Added regression coverage for the uv workflow.'
          },
          evidence: {
            rawSource: {
              provider: 'codex',
              channel: 'notify',
              rawEventName: 'agent-turn-complete'
            },
            providerSessionId: 'codex-thread-7',
            inputMessages: ['install the pytest package with uv', 'pin the version in pyproject.toml'],
            lastAssistantMessage: 'Installed pytest with uv and added coverage.',
            model: 'gpt-5-codex'
          },
          snapshot: {
            kind: 'turn-slice',
            fileName: 'turn-slice.json',
            content: '{"kind":"turn-slice"}'
          }
        })
      ],
      worktreeRepoRoot,
      memoryDir,
      now: () => new Date('2026-04-27T18:00:00.000Z')
    })

    await expect(readFile(join(worktreeRepoRoot, 'MEMORY.md'), 'utf8')).resolves.toContain(
      'User corrected the workflow to use uv instead of pip.'
    )
    await expect(readFile(join(worktreeRepoRoot, 'USER.md'), 'utf8')).resolves.toContain(
      'install the pytest package with uv'
    )
    await expect(readFile(join(memoryDir, '2026-04-27.md'), 'utf8')).resolves.toContain(
      'codex-thread-7'
    )

    const sessionDir = join(imported.runtimeHomeDir, '.openclaw', 'agents', imported.agentName, 'sessions')
    const sessionFiles = await readdir(sessionDir)
    expect(sessionFiles).toEqual([
      'claude-code-claude-session-1-session-internal-1.jsonl',
      'codex-codex-thread-7-session-internal-2.jsonl'
    ])

    const claudeSessionLog = await readFile(join(sessionDir, 'claude-code-claude-session-1-session-internal-1.jsonl'), 'utf8')
    const [claudeHeaderLine, ...claudeTranscriptLines] = claudeSessionLog.trim().split('\n')
    expect(JSON.parse(claudeHeaderLine ?? '{}')).toMatchObject({
      cwd: worktreeRepoRoot,
      source: 'stoa-memory-runtime',
      session_id: 'claude-session-1'
    })
    expect(claudeTranscriptLines.join('\n')).toContain('use uv instead of pip')
    expect(claudeTranscriptLines.join('\n')).toContain('add a note about the uv policy')

    const codexSessionLog = await readFile(join(sessionDir, 'codex-codex-thread-7-session-internal-2.jsonl'), 'utf8')
    const [codexHeaderLine, ...codexTranscriptLines] = codexSessionLog.trim().split('\n')
    expect(JSON.parse(codexHeaderLine ?? '{}')).toMatchObject({
      cwd: worktreeRepoRoot,
      source: 'stoa-memory-runtime',
      session_id: 'codex-thread-7'
    })
    expect(codexTranscriptLines.map(line => JSON.parse(line))).toEqual([
      {
        type: 'item.added',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'install the pytest package with uv' }]
        }
      },
      {
        type: 'item.added',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'pin the version in pyproject.toml' }]
        }
      },
      {
        type: 'item.completed',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Installed pytest with uv and added coverage.' }]
        }
      }
    ])
  })

  test('includes the stoa session id in session filenames so same-provider groups cannot overwrite each other', async () => {
    const imported = await materializeEvidenceSnapshotsIntoEvolverInputs({
      snapshots: [
        createSnapshot({
          sessionId: 'session-fallback-1',
          providerSessionId: 'shared-provider-session',
          evidenceKey: 'codex:shared-provider-session:turn-1',
          evidence: {
            rawSource: {
              provider: 'codex',
              channel: 'notify',
              rawEventName: 'agent-turn-complete'
            },
            providerSessionId: 'shared-provider-session',
            inputMessages: ['install ruff with uv'],
            lastAssistantMessage: 'Installed ruff with uv.'
          }
        }),
        createSnapshot({
          sessionId: 'session-fallback-2',
          providerSessionId: 'shared-provider-session',
          evidenceKey: 'codex:shared-provider-session:turn-2',
          evidence: {
            rawSource: {
              provider: 'codex',
              channel: 'notify',
              rawEventName: 'agent-turn-complete'
            },
            promptText: 'install ruff with uv',
            providerSessionId: 'shared-provider-session',
            lastAssistantMessage: 'Installed ruff with uv.'
          }
        })
      ],
      worktreeRepoRoot,
      memoryDir,
      now: () => new Date('2026-04-27T18:00:00.000Z')
    })

    const sessionFiles = await readdir(imported.sessionDir)
    expect(sessionFiles).toEqual([
      'codex-shared-provider-session-session-fallback-1.jsonl',
      'codex-shared-provider-session-session-fallback-2.jsonl'
    ])
  })
})

function createSnapshot(overrides: Partial<SessionEvidenceSnapshot> = {}): SessionEvidenceSnapshot {
  return {
    eventId: 'event-1',
    eventType: 'codex.Stop',
    sessionId: 'session-1',
    projectId: 'project-1',
    timestamp: '2026-04-27T12:00:00.000Z',
    provider: 'codex',
    providerSessionId: 'provider-session-1',
    turnId: 'turn-1',
    evidenceKey: 'codex:provider-session-1:turn-1',
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'Turn complete'
    },
    evidence: {
      rawSource: {
        provider: 'codex',
        channel: 'notify',
        rawEventName: 'agent-turn-complete'
      },
      providerSessionId: 'provider-session-1',
      turnId: 'turn-1',
      promptText: 'install the project dependencies',
      lastAssistantMessage: 'Installed dependencies successfully.'
    },
    snapshot: {
      kind: 'turn-slice',
      fileName: 'turn-slice.json',
      content: '{"kind":"turn-slice"}'
    },
    ...overrides
  }
}
