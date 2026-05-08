import { describe, expect, test } from 'vitest'
import type { ObservationEvent, SessionPresenceSnapshot } from '@shared/observability'
import type { SessionSummary } from '@shared/project-session'
import { HermesContextAssembler } from './hermes-context-assembler'

function createSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'codex',
    runtimeState: 'alive',
    turnState: 'running',
    turnEpoch: 3,
    lastTurnOutcome: 'none',
    blockingReason: null,
    failureReason: null,
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 12,
    title: 'Implement session recovery',
    summary: 'Working through the failing test loop.',
    recoveryMode: 'resume-external',
    externalSessionId: 'codex-external-1',
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:10:00.000Z',
    lastActivatedAt: '2026-05-07T08:10:00.000Z',
    archived: false,
    ...overrides
  }
}

function createPresence(overrides: Partial<SessionPresenceSnapshot> = {}): SessionPresenceSnapshot {
  return {
    sessionId: 'session_1',
    projectId: 'project_1',
    providerId: 'codex',
    providerLabel: 'Codex',
    modelLabel: 'gpt-5-codex',
    phase: 'running',
    runtimeState: 'alive',
    turnState: 'running',
    turnEpoch: 3,
    lastTurnOutcome: 'none',
    blockingReason: null,
    failureReason: null,
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    confidence: 'authoritative',
    health: 'healthy',
    lastAssistantSnippet: 'The failing assertion comes from recovery.spec.ts.',
    lastEventAt: '2026-05-07T08:10:00.000Z',
    lastEvidenceType: 'evidence.assistant_message',
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    evidenceSequence: 12,
    sourceSequence: 12,
    updatedAt: '2026-05-07T08:10:00.000Z',
    ...overrides
  }
}

function createEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    eventId: 'event_1',
    eventVersion: 1,
    sequence: 1,
    occurredAt: '2026-05-07T08:01:00.000Z',
    ingestedAt: '2026-05-07T08:01:01.000Z',
    scope: 'session',
    projectId: 'project_1',
    sessionId: 'session_1',
    providerId: 'codex',
    category: 'evidence',
    type: 'evidence.assistant_message',
    severity: 'info',
    retention: 'operational',
    source: 'provider-adapter',
    correlationId: null,
    dedupeKey: null,
    payload: {
      summary: 'Assistant message',
      evidence: {
        promptText: 'Please inspect the failing recovery test before changing code.',
        lastAssistantMessage: 'The failure happens after resume because the old pointer is reused.',
        toolInput: {
          command: 'npm test'
        }
      },
      toolName: 'run-tests'
    },
    ...overrides
  }
}

describe('HermesContextAssembler', () => {
  test('returns full context as large human-readable text with terminal replay merged in and tool payloads excluded', async () => {
    const assembler = new HermesContextAssembler({
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [createSession()]
          }
        }
      },
      getSessionPresence(sessionId) {
        return sessionId === 'session_1' ? createPresence() : null
      },
      listSessionEvents(sessionId) {
        return sessionId === 'session_1'
          ? {
              events: [
                createEvent(),
                createEvent({
                  eventId: 'event_2',
                  sequence: 2,
                  payload: {
                    summary: 'Permission requested',
                    evidence: {
                      promptText: 'Need permission to run npm test.'
                    }
                  }
                })
              ],
              nextCursor: null
            }
          : { events: [], nextCursor: null }
      },
      async getTerminalReplay(sessionId) {
        return sessionId === 'session_1'
          ? '\u001b[32m$ npm test\u001b[0m\r\nFAIL recovery.spec.ts\r\n'
          : ''
      }
    })

    const result = await assembler.getFullContext('session_1', { maxChars: 100_000 })

    expect(result.text).toContain('[User]')
    expect(result.text).toContain('[Assistant]')
    expect(result.text).toContain('[Terminal]')
    expect(result.text).toContain('npm test')
    expect(result.text).toContain('FAIL recovery.spec.ts')
    expect(result.text).not.toContain('"toolName":')
    expect(result.text).not.toContain('"toolInput":')
    expect(result.truncated).toBe(false)
  })
})
