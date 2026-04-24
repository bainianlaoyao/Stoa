import { describe, expect, it } from 'vitest'
import type { ObservationEvent } from '../shared/observability'
import { InMemoryObservationStore } from './observation-store'

const baseEvent = (overrides: Partial<ObservationEvent> = {}): ObservationEvent => ({
  eventId: 'event-1',
  eventVersion: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  ingestedAt: '2026-01-01T00:00:01.000Z',
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

describe('InMemoryObservationStore', () => {
  it('appends and lists events by session', () => {
    const store = new InMemoryObservationStore()
    const sessionEvent = baseEvent({ eventId: 'session-event' })
    const otherSessionEvent = baseEvent({ eventId: 'other-session-event', sessionId: 'session-2' })

    expect(store.append(sessionEvent)).toBe(true)
    expect(store.append(otherSessionEvent)).toBe(true)

    expect(store.listSessionEvents('session-1', { limit: 10 })).toEqual({
      events: [sessionEvent],
      nextCursor: null
    })
  })

  it('dedupes repeated event ids', () => {
    const store = new InMemoryObservationStore()
    const event = baseEvent()

    expect(store.append(event)).toBe(true)
    expect(store.append({ ...event, payload: { ignored: true } })).toBe(false)

    expect(store.listSessionEvents('session-1', { limit: 10 }).events).toEqual([event])
  })

  it('filters listed events by categories', () => {
    const store = new InMemoryObservationStore()
    const presenceEvent = baseEvent({ eventId: 'presence-event', category: 'presence' })
    const evidenceEvent = baseEvent({ eventId: 'evidence-event', category: 'evidence', type: 'evidence.assistant_message' })

    store.append(presenceEvent)
    store.append(evidenceEvent)

    expect(store.listSessionEvents('session-1', { limit: 10, categories: ['evidence'] })).toEqual({
      events: [evidenceEvent],
      nextCursor: null
    })
  })

  it('keeps ephemeral events out of default persisted listings and exposes them when requested', () => {
    const store = new InMemoryObservationStore()
    const persistedEvent = baseEvent({ eventId: 'persisted-event', retention: 'operational' })
    const ephemeralEvent = baseEvent({ eventId: 'ephemeral-event', retention: 'ephemeral' })

    store.append(persistedEvent)
    store.append(ephemeralEvent)

    expect(store.listSessionEvents('session-1', { limit: 10 }).events).toEqual([persistedEvent])
    expect(store.listSessionEvents('session-1', { limit: 10, includeEphemeral: true }).events).toEqual([
      persistedEvent,
      ephemeralEvent
    ])
  })

  it('dedupes ephemeral events even though they are omitted by default', () => {
    const store = new InMemoryObservationStore()
    const ephemeralEvent = baseEvent({ eventId: 'ephemeral-event', retention: 'ephemeral' })

    expect(store.append(ephemeralEvent)).toBe(true)
    expect(store.append(ephemeralEvent)).toBe(false)
    expect(store.listSessionEvents('session-1', { limit: 10, includeEphemeral: true }).events).toEqual([ephemeralEvent])
  })

  it('lists events by project', () => {
    const store = new InMemoryObservationStore()
    const projectEvent = baseEvent({ eventId: 'project-event', projectId: 'project-1', sessionId: null, scope: 'project' })
    const sessionEvent = baseEvent({ eventId: 'session-event', projectId: 'project-1', sessionId: 'session-1' })
    const otherProjectEvent = baseEvent({ eventId: 'other-project-event', projectId: 'project-2', sessionId: 'session-2' })

    store.append(projectEvent)
    store.append(sessionEvent)
    store.append(otherProjectEvent)

    expect(store.listProjectEvents('project-1', { limit: 10 }).events).toEqual([projectEvent, sessionEvent])
  })

  it('paginates with string index cursors', () => {
    const store = new InMemoryObservationStore()
    const firstEvent = baseEvent({ eventId: 'event-1' })
    const secondEvent = baseEvent({ eventId: 'event-2' })
    const thirdEvent = baseEvent({ eventId: 'event-3' })

    store.append(firstEvent)
    store.append(secondEvent)
    store.append(thirdEvent)

    const firstPage = store.listSessionEvents('session-1', { limit: 2 })

    expect(firstPage).toEqual({
      events: [firstEvent, secondEvent],
      nextCursor: '2'
    })
    expect(store.listSessionEvents('session-1', { limit: 2, cursor: firstPage.nextCursor ?? undefined })).toEqual({
      events: [thirdEvent],
      nextCursor: null
    })
  })
})
