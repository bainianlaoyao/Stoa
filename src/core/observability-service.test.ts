import { describe, expect, it } from 'vitest'
import type { ObservationEvent } from '../shared/observability'
import type { SessionSummary } from '../shared/project-session'
import { InMemoryObservationStore } from './observation-store'
import { ObservabilityService } from './observability-service'

const nowValues = (...values: string[]): (() => string) => {
  let index = 0

  return () => values[Math.min(index++, values.length - 1)]
}

const session = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'session-1',
  projectId: 'project-1',
  type: 'codex',
  status: 'running',
  title: 'Codex session',
  summary: 'Working',
  runtimeState: 'alive',
  agentState: 'working',
  hasUnseenCompletion: false,
  runtimeExitCode: null,
  runtimeExitReason: null,
  lastStateSequence: 0,
  blockingReason: null,
  recoveryMode: 'resume-external',
  externalSessionId: 'external-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastActivatedAt: null,
  archived: false,
  ...overrides
})

const event = (overrides: Partial<ObservationEvent> = {}): ObservationEvent => ({
  eventId: 'event-1',
  eventVersion: 1,
  sequence: 0,
  occurredAt: '2026-01-01T00:00:01.000Z',
  ingestedAt: '2026-01-01T00:00:02.000Z',
  scope: 'session',
  projectId: 'project-1',
  sessionId: 'session-1',
  providerId: 'codex',
  category: 'presence',
  type: 'presence.running',
  severity: 'info',
  retention: 'operational',
  source: 'runtime-controller',
  correlationId: null,
  dedupeKey: null,
  payload: {},
  ...overrides
})

describe('ObservabilityService', () => {
  it('registration creates baseline session, project, and app snapshots', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:03.000Z'
    })

    service.registerSession(session(), 'session-1')

    expect(service.getSessionPresence('session-1')).toMatchObject({
      sessionId: 'session-1',
      projectId: 'project-1',
      phase: 'running',
      sourceSequence: 0,
      hasUnreadTurn: false,
      updatedAt: '2026-01-01T00:00:03.000Z'
    })
    expect(service.getProjectObservability('project-1')).toMatchObject({
      projectId: 'project-1',
      overallHealth: 'healthy',
      activeSessionCount: 1,
      blockedSessionCount: 0,
      unreadTurnCount: 0
    })
    expect(service.getAppObservability()).toMatchObject({
      blockedProjectCount: 0,
      failedProjectCount: 0,
      degradedProjectCount: 0,
      totalUnreadTurns: 0
    })
  })

  it('setActiveSession recalculates unread turn state without compatibility migration', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues(
        '2026-01-01T00:00:03.000Z',
        '2026-01-01T00:00:04.000Z',
        '2026-01-01T00:00:05.000Z'
      )
    })

    service.registerSession(session(), 'other-session')
    service.ingest(
      event({
        eventId: 'assistant-evidence',
        category: 'evidence',
        type: 'evidence.assistant_message',
        payload: {
          summary: 'Answer ready'
        }
      })
    )
    expect(service.getSessionPresence('session-1')?.hasUnreadTurn).toBe(true)

    service.setActiveSession('session-1')

    expect(service.getSessionPresence('session-1')?.hasUnreadTurn).toBe(false)
  })

  it('syncSessions excludes archived sessions and rebuilds aggregates from retained sessions only', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:03.000Z'
    })

    service.syncSessions(
      [
        session({ id: 'active-session', projectId: 'project-1', archived: false }),
        session({ id: 'archived-session', projectId: 'project-1', archived: true }),
        session({ id: 'project-2-session', projectId: 'project-2', archived: false })
      ],
      'project-2-session'
    )

    expect(service.getSessionPresence('active-session')).not.toBeNull()
    expect(service.getSessionPresence('archived-session')).toBeNull()
    expect(service.getProjectObservability('project-1')).toMatchObject({
      projectId: 'project-1',
      activeSessionCount: 1
    })
    expect(service.getProjectObservability('project-2')).toMatchObject({
      projectId: 'project-2',
      activeSessionCount: 1
    })
    expect(service.getAppObservability()).toMatchObject({
      blockedProjectCount: 0,
      failedProjectCount: 0,
      degradedProjectCount: 0,
      totalUnreadTurns: 0
    })
  })

  it('presence events update evidence only and keep phase derived from session state', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues('2026-01-01T00:00:03.000Z', '2026-01-01T00:00:04.000Z')
    })

    service.registerSession(session({
      agentState: 'working',
      lastStateSequence: 7
    }), 'session-1')
    expect(service.ingest(event({
      eventId: 'turn-complete',
      sequence: 3,
      type: 'presence.turn_complete',
      payload: { snippet: 'Turn complete evidence.' }
    }))).toBe(true)

    expect(service.getSessionPresence('session-1')).toMatchObject({
      phase: 'running',
      lastAssistantSnippet: 'Turn complete evidence.',
      sourceSequence: 7,
      updatedAt: '2026-01-01T00:00:04.000Z'
    })
  })

  it('uses max of authoritative session state sequence and evidence sequence in snapshots', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues(
        '2026-01-01T00:00:03.000Z',
        '2026-01-01T00:00:04.000Z',
        '2026-01-01T00:00:05.000Z',
        '2026-01-01T00:00:06.000Z'
      )
    })

    service.registerSession(session({
      agentState: 'idle',
      hasUnseenCompletion: true,
      lastStateSequence: 20
    }), 'session-1')
    service.ingest(event({
      eventId: 'ready-event',
      sequence: 10,
      type: 'presence.turn_complete',
      occurredAt: '2026-01-01T00:00:10.000Z'
    }))
    service.ingest(event({
      eventId: 'newer-evidence-event',
      sequence: 30,
      type: 'presence.running',
      occurredAt: '2026-01-01T00:00:11.000Z'
    }))

    expect(service.getSessionPresence('session-1')).toMatchObject({
      phase: 'complete',
      sourceSequence: 30,
      lastEventAt: '2026-01-01T00:00:11.000Z'
    })
    expect(service.getProjectObservability('project-1')?.sourceSequence).toBe(30)
    expect(service.getAppObservability().sourceSequence).toBe(30)
  })

  it('assistant evidence snippet on inactive session creates an unread turn and preserves evidence across later presence events', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues(
        '2026-01-01T00:00:03.000Z',
        '2026-01-01T00:00:04.000Z',
        '2026-01-01T00:00:05.000Z'
      )
    })

    service.registerSession(session(), 'active-session')
    service.ingest(
      event({
        eventId: 'assistant-evidence',
        occurredAt: '2026-01-01T00:00:10.000Z',
        category: 'evidence',
        type: 'evidence.assistant_message',
        payload: { model: 'gpt-5-codex', snippet: 'I found the failing contract.' }
      })
    )
    service.ingest(
      event({
        eventId: 'awaiting-input',
        occurredAt: '2026-01-01T00:00:20.000Z',
        type: 'presence.awaiting_input',
        payload: {}
      })
    )

    expect(service.getSessionPresence('session-1')).toMatchObject({
      phase: 'running',
      modelLabel: 'gpt-5-codex',
      lastAssistantSnippet: 'I found the failing contract.',
      lastEvidenceType: 'evidence.assistant_message',
      lastEventAt: '2026-01-01T00:00:20.000Z',
      hasUnreadTurn: true
    })
  })

  it('syncSessions preserves evidence for retained sessions and updates confidence from manager state', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues(
        '2026-01-01T00:00:03.000Z',
        '2026-01-01T00:00:04.000Z',
        '2026-01-01T00:00:05.000Z'
      )
    })

    service.registerSession(session({ externalSessionId: null }), 'other-session')
    service.ingest(
      event({
        eventId: 'assistant-evidence',
        category: 'evidence',
        type: 'evidence.assistant_message',
        payload: {
          model: 'gpt-5-codex',
          snippet: 'Resume point found.'
        }
      })
    )

    service.syncSessions(
      [session({ externalSessionId: 'external-2', updatedAt: '2026-01-01T00:00:04.500Z' })],
      'other-session'
    )

    expect(service.getSessionPresence('session-1')).toMatchObject({
      modelLabel: 'gpt-5-codex',
      lastAssistantSnippet: 'Resume point found.',
      confidence: 'authoritative',
      recoveryPointerState: 'trusted',
      updatedAt: '2026-01-01T00:00:05.000Z'
    })
  })

  it('duplicate events are stored once and not reprojected', () => {
    const store = new InMemoryObservationStore()
    const service = new ObservabilityService(store, {
      nowIso: nowValues('2026-01-01T00:00:03.000Z', '2026-01-01T00:00:04.000Z', '2026-01-01T00:00:05.000Z')
    })
    const duplicate = event({
      eventId: 'same-event',
      type: 'presence.needs_confirmation',
      payload: { snippet: 'Approval required.' }
    })

    service.registerSession(session(), 'active-session')
    expect(service.ingest(duplicate)).toBe(true)
    const afterFirstIngest = service.getSessionPresence('session-1')

    expect(service.ingest({ ...duplicate, type: 'presence.error', payload: { snippet: 'Should not project.' } })).toBe(false)

    expect(service.getSessionPresence('session-1')).toEqual(afterFirstIngest)
    expect(store.listSessionEvents('session-1', { limit: 10 }).events).toEqual([{ ...duplicate, sequence: 1 }])
  })

  it('unknown session event is stored but does not create a presence snapshot', () => {
    const store = new InMemoryObservationStore()
    const service = new ObservabilityService(store, {
      nowIso: () => '2026-01-01T00:00:03.000Z'
    })
    const unknownSessionEvent = event({ eventId: 'unknown-session-event', sessionId: 'missing-session' })

    expect(service.ingest(unknownSessionEvent)).toBe(true)

    expect(service.getSessionPresence('missing-session')).toBeNull()
    expect(store.listSessionEvents('missing-session', { limit: 10 }).events).toEqual([{ ...unknownSessionEvent, sequence: 1 }])
  })

  it('syncSessions removes snapshots and evidence for archived or removed sessions', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues(
        '2026-01-01T00:00:03.000Z',
        '2026-01-01T00:00:04.000Z',
        '2026-01-01T00:00:05.000Z',
        '2026-01-01T00:00:06.000Z',
        '2026-01-01T00:00:07.000Z'
      )
    })

    service.syncSessions(
      [
        session({ id: 'kept-session', projectId: 'project-1' }),
        session({ id: 'removed-session', projectId: 'project-2' })
      ],
      'kept-session'
    )
    service.ingest(
      event({
        eventId: 'removed-evidence',
        sessionId: 'removed-session',
        projectId: 'project-2',
        category: 'evidence',
        type: 'evidence.assistant_message',
        payload: { snippet: 'To be removed.' }
      })
    )
    expect(service.getSessionPresence('removed-session')?.lastAssistantSnippet).toBe('To be removed.')

    service.syncSessions(
      [
        session({ id: 'kept-session', projectId: 'project-1' }),
        session({ id: 'archived-session', projectId: 'project-2', archived: true })
      ],
      'kept-session'
    )

    expect(service.getSessionPresence('removed-session')).toBeNull()
    expect(service.getSessionPresence('archived-session')).toBeNull()
    expect(service.getProjectObservability('project-2')).toBeNull()
    expect(service.getAppObservability()).toMatchObject({
      projectsNeedingAttention: []
    })
  })

  it('project and app aggregates report blocked, failed, and unread state', () => {
    const service = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: nowValues(
        '2026-01-01T00:00:03.000Z',
        '2026-01-01T00:00:04.000Z',
        '2026-01-01T00:00:05.000Z',
        '2026-01-01T00:00:06.000Z',
        '2026-01-01T00:00:07.000Z'
      )
    })

    service.registerSession(session({
      id: 'blocked-session',
      agentState: 'blocked',
      blockingReason: 'permission'
    }), 'active-session')
    service.registerSession(session({
      id: 'failed-session',
      agentState: 'error'
    }), 'active-session')
    service.ingest(
      event({
        eventId: 'unread-event',
        sessionId: 'blocked-session',
        category: 'evidence',
        type: 'evidence.assistant_message',
        payload: { snippet: 'Please approve the command.' }
      })
    )

    expect(service.getProjectObservability('project-1')).toMatchObject({
      overallHealth: 'lost',
      activeSessionCount: 2,
      blockedSessionCount: 1,
      failedSessionCount: 1,
      unreadTurnCount: 1
    })
    expect(service.getAppObservability()).toMatchObject({
      blockedProjectCount: 1,
      failedProjectCount: 1,
      degradedProjectCount: 0,
      totalUnreadTurns: 1
    })
  })
})
