import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CanonicalSessionEvent } from '@shared/project-session'
import { createTestTempDir } from '../../../testing/test-temp'
import { SessionEvidenceStore } from './session-evidence-store'

function createEvent(overrides: Partial<CanonicalSessionEvent> = {}): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'event-77',
    event_type: 'codex.Stop',
    timestamp: '2026-04-28T13:00:00.000Z',
    session_id: 'session-77',
    project_id: 'project-77',
    source: 'provider-adapter',
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'Stop',
      externalSessionId: 'provider-session-77'
    },
    evidence: {
      rawSource: {
        provider: 'codex',
        channel: 'notify',
        rawEventName: 'agent-turn-complete'
      },
      providerSessionId: 'provider-session-77',
      turnId: 'turn-77',
      inputMessages: ['Fix the memory persistence path.'],
      lastAssistantMessage: 'The snapshot is now stored under .stoa.'
    },
    ...overrides
  }
}

describe('SessionEvidenceStore', () => {
  test('writes metadata and the stoa-owned snapshot under the session and event directory', async () => {
    const projectPath = await createTestTempDir('session-evidence-store-')
    const store = new SessionEvidenceStore()
    const event = createEvent()

    const result = await store.persist({
      projectPath,
      event,
      snapshot: {
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"captured"}', 'utf8')
      }
    })

    const eventDir = join(projectPath, '.stoa', 'memory', 'evidence', 'session-77', 'event-77')
    expect(result.eventDirectoryPath).toBe(eventDir)
    expect(result.metadataPath).toBe(join(eventDir, 'metadata.json'))
    expect(result.snapshotPath).toBe(join(eventDir, 'turn-slice.json'))

    const metadata = JSON.parse(await readFile(result.metadataPath, 'utf8'))
    expect(metadata).toEqual({
      version: 1,
      eventId: 'event-77',
      eventType: 'codex.Stop',
      sessionId: 'session-77',
      projectId: 'project-77',
      timestamp: '2026-04-28T13:00:00.000Z',
      source: 'provider-adapter',
      intent: 'agent.turn_completed',
      summary: 'Stop',
      payload: {
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop',
        externalSessionId: 'provider-session-77'
      },
      provider: 'codex',
      providerSessionId: 'provider-session-77',
      turnId: 'turn-77',
      evidenceKey: 'codex:provider-session-77:turn-77',
      transcriptPointer: null,
      snapshot: {
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        sourceTranscriptPath: null
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'notify',
          rawEventName: 'agent-turn-complete'
        },
        providerSessionId: 'provider-session-77',
        turnId: 'turn-77',
        inputMessages: ['Fix the memory persistence path.'],
        lastAssistantMessage: 'The snapshot is now stored under .stoa.'
      }
    })
    expect(await readFile(result.snapshotPath, 'utf8')).toBe('{"summary":"captured"}')
  })

  test('uses a deterministic snapshot hash as the evidence-key fallback and preserves an empty provider-session segment when unavailable', async () => {
    const projectPath = await createTestTempDir('session-evidence-store-fallback-')
    const store = new SessionEvidenceStore()
    const snapshotContent = Buffer.from('{"summary":"captured"}', 'utf8')
    const expectedFallback = `snapshot-sha256-${createHash('sha256').update(snapshotContent).digest('hex')}`
    const event = createEvent({
      event_id: 'event-fallback-77',
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'notify',
          rawEventName: 'agent-turn-complete'
        },
        inputMessages: ['Summarize the failure.'],
        lastAssistantMessage: 'Captured the failure summary.'
      }
    })

    const result = await store.persist({
      projectPath,
      event,
      snapshot: {
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: snapshotContent
      }
    })

    const metadata = JSON.parse(await readFile(result.metadataPath, 'utf8'))
    expect(result.evidenceKey).toBe(`codex::${expectedFallback}`)
    expect(metadata).toMatchObject({
      provider: 'codex',
      providerSessionId: null,
      turnId: null,
      evidenceKey: `codex::${expectedFallback}`
    })
  })
})
