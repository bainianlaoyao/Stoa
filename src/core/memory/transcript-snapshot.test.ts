import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { CanonicalSessionEvent } from '@shared/project-session'
import { createTestTempDir } from '../../../testing/test-temp'
import { createTranscriptSnapshot } from './transcript-snapshot'

function createEvent(overrides: Partial<CanonicalSessionEvent> = {}): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'event-1',
    event_type: 'codex.Stop',
    timestamp: '2026-04-28T12:00:00.000Z',
    session_id: 'session-1',
    project_id: 'project-1',
    source: 'provider-adapter',
    payload: {
      intent: 'agent.turn_completed',
      agentState: 'idle',
      hasUnseenCompletion: true,
      summary: 'Stop',
      externalSessionId: 'provider-session-1'
    },
    evidence: {
      rawSource: {
        provider: 'codex',
        channel: 'hook',
        rawEventName: 'Stop'
      },
      providerSessionId: 'provider-session-1',
      turnId: 'turn-1',
      lastAssistantMessage: 'Implemented the fix.'
    },
    ...overrides
  }
}

describe('createTranscriptSnapshot', () => {
  test('copies provider transcript content when the transcript file is readable', async () => {
    const tempDir = await createTestTempDir('transcript-snapshot-copy-')
    const transcriptPath = join(tempDir, 'provider', 'transcript.jsonl')
    await mkdir(join(tempDir, 'provider'), { recursive: true })
    await writeFile(transcriptPath, '{"role":"user","content":"Investigate the failure"}\n', 'utf8')

    const snapshot = await createTranscriptSnapshot(createEvent({
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        providerSessionId: 'provider-session-1',
        turnId: 'turn-1',
        transcriptPath,
        lastAssistantMessage: 'Implemented the fix.'
      }
    }))

    expect(snapshot.kind).toBe('provider-transcript')
    expect(snapshot.fileName).toBe('transcript.jsonl')
    expect(snapshot.sourceTranscriptPath).toBe(transcriptPath)
    expect(snapshot.content.toString('utf8')).toBe('{"role":"user","content":"Investigate the failure"}\n')
  })

  test('creates an extracted turn slice when the provider transcript file is unavailable', async () => {
    const snapshot = await createTranscriptSnapshot(createEvent({
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'notify',
          rawEventName: 'agent-turn-complete'
        },
        providerSessionId: 'provider-session-1',
        turnId: 'turn-7',
        promptText: 'Fix the race in session sequencing.',
        inputMessages: ['Fix the race in session sequencing.', 'Preserve ordering guarantees.'],
        lastAssistantMessage: 'Applied the sequencing fix and added coverage.',
        toolName: 'run_tests',
        toolUseId: 'tool-7',
        cwd: '/repo/app',
        model: 'gpt-5-codex'
      }
    }))

    expect(snapshot.kind).toBe('turn-slice')
    expect(snapshot.fileName).toBe('turn-slice.json')
    expect(JSON.parse(snapshot.content.toString('utf8'))).toEqual({
      version: 1,
      eventId: 'event-1',
      eventType: 'codex.Stop',
      sessionId: 'session-1',
      projectId: 'project-1',
      timestamp: '2026-04-28T12:00:00.000Z',
      intent: 'agent.turn_completed',
      summary: 'Stop',
      payload: {
        intent: 'agent.turn_completed',
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop',
        externalSessionId: 'provider-session-1'
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'notify',
          rawEventName: 'agent-turn-complete'
        },
        providerSessionId: 'provider-session-1',
        turnId: 'turn-7',
        promptText: 'Fix the race in session sequencing.',
        inputMessages: ['Fix the race in session sequencing.', 'Preserve ordering guarantees.'],
        lastAssistantMessage: 'Applied the sequencing fix and added coverage.',
        toolName: 'run_tests',
        toolUseId: 'tool-7',
        cwd: '/repo/app',
        model: 'gpt-5-codex'
      }
    })
  })

})
