/**
 * Tests for the broadcast helpers in ws/broadcast.ts.
 *
 * Covers:
 *   - createWsEvent shape (id prefix, ISO timestamp, payload pass-through)
 *   - All 12 typed helpers and their event-type mapping
 *   - Helper payload preservation for typed payload signatures
 *   - Event id uniqueness across calls
 */
import { describe, it, expect } from 'vitest'
import {
  createWsEvent,
  broadcastSessionGraph,
  broadcastTerminalData,
  broadcastStatePatch,
  broadcastPresence,
  broadcastProjectObservability,
  broadcastAppObservability,
  broadcastMetaSessionEvent,
  broadcastFsChanged,
  broadcastSettingsChanged,
  broadcastMemoryNotification,
  broadcastTitleGeneration,
  broadcastUpdateState,
} from './broadcast'
import { WS_SERVER_EVENT_TYPES } from './events'
import type { WsServerEvent, WsServerEventType } from './events'

// ---------------------------------------------------------------------------
// createWsEvent
// ---------------------------------------------------------------------------

describe('createWsEvent', () => {
  it('returns the correct envelope shape with id, type, payload, and timestamp', () => {
    const event = createWsEvent('session:graph', { hello: 'world' })
    expect(event).toMatchObject({
      type: 'session:graph',
      payload: { hello: 'world' },
    })
    expect(typeof event.id).toBe('string')
    expect(typeof event.timestamp).toBe('string')
  })

  it('id starts with "evt_"', () => {
    const event = createWsEvent('session:graph', null)
    expect(event.id.startsWith('evt_')).toBe(true)
  })

  it('id has a non-empty body after the prefix', () => {
    const event = createWsEvent('session:graph', null)
    const body = event.id.slice('evt_'.length)
    expect(body.length).toBeGreaterThan(0)
  })

  it('timestamp is a valid ISO 8601 string parseable by Date', () => {
    const event = createWsEvent('session:graph', null)
    // Date.parse returns NaN for invalid strings.
    const parsed = Date.parse(event.timestamp)
    expect(Number.isNaN(parsed)).toBe(false)
    // The parsed epoch should equal what the event string encodes — the
    // helper uses new Date().toISOString().
    expect(new Date(parsed).toISOString()).toBe(event.timestamp)
  })

  it('preserves the payload reference (pass-through, no clone)', () => {
    const payload = { foo: { bar: 1 } }
    const event = createWsEvent('session:state-patch', payload)
    expect(event.payload).toBe(payload)
  })

  it('accepts any value as payload (string, number, null, undefined, object)', () => {
    const cases: ReadonlyArray<unknown> = [
      null,
      undefined,
      0,
      'hello',
      [1, 2, 3],
      { nested: { deep: true } },
    ]
    for (const payload of cases) {
      const event = createWsEvent('session:graph', payload)
      expect(event.payload).toBe(payload)
    }
  })
})

// ---------------------------------------------------------------------------
// Typed broadcast helpers — verify event type mapping for all 12 helpers
// ---------------------------------------------------------------------------

describe('broadcast helpers — event type mapping', () => {
  // Each row: [helper, expected type]. Iterating covers all 12 helpers
  // in a data-driven table so a new helper cannot be added silently.
  const cases: ReadonlyArray<[
    (payload: unknown) => WsServerEvent,
    WsServerEventType,
  ]> = [
    [broadcastSessionGraph, 'session:graph'],
    [broadcastTerminalData as unknown as (p: unknown) => WsServerEvent, 'session:terminal-data'],
    [broadcastStatePatch, 'session:state-patch'],
    [broadcastPresence, 'observability:presence'],
    [broadcastProjectObservability, 'observability:project'],
    [broadcastAppObservability, 'observability:app'],
    [broadcastMetaSessionEvent, 'meta-session:event'],
    [broadcastFsChanged as unknown as (p: unknown) => WsServerEvent, 'fs:changed'],
    [broadcastSettingsChanged as unknown as (p: unknown) => WsServerEvent, 'settings:changed'],
    [broadcastMemoryNotification, 'notification:memory'],
    [broadcastTitleGeneration, 'notification:title-generation'],
    [broadcastUpdateState, 'update:state'],
  ]

  it('every helper produces an event whose type is in the WS_SERVER_EVENT_TYPES allowlist', () => {
    for (const [helper] of cases) {
      const event = helper(null)
      expect(WS_SERVER_EVENT_TYPES).toContain(event.type)
    }
  })

  it.each(cases)('helper produces event with type %s', (helper, expected) => {
    const event = helper(null)
    expect(event.type).toBe(expected)
  })

  it('the 12 helpers collectively cover all 12 WS_SERVER_EVENT_TYPES exactly once', () => {
    const producedTypes = cases.map(([, expected]) => expected).sort()
    const declaredTypes = [...WS_SERVER_EVENT_TYPES].sort()
    expect(producedTypes).toEqual(declaredTypes)
  })
})

// ---------------------------------------------------------------------------
// Payload preservation for typed payload signatures
// ---------------------------------------------------------------------------

describe('broadcast helpers — payload preservation', () => {
  it('broadcastTerminalData preserves the { sessionId, data } payload', () => {
    const data = new Uint8Array([1, 2, 3, 4])
    const event = broadcastTerminalData({ sessionId: 'sess-1', data })
    expect(event.type).toBe('session:terminal-data')
    expect(event.payload).toEqual({ sessionId: 'sess-1', data })
    // The Uint8Array reference should be preserved.
    expect((event.payload as { data: Uint8Array }).data).toBe(data)
  })

  it('broadcastFsChanged preserves { projectId, path, kind } fields', () => {
    const event = broadcastFsChanged({
      projectId: 'proj-1',
      path: '/tmp/foo.txt',
      kind: 'modified',
    })
    expect(event.type).toBe('fs:changed')
    expect(event.payload).toEqual({
      projectId: 'proj-1',
      path: '/tmp/foo.txt',
      kind: 'modified',
    })
  })

  it('broadcastSettingsChanged preserves { key, value } fields', () => {
    const event = broadcastSettingsChanged({ key: 'theme', value: 'dark' })
    expect(event.type).toBe('settings:changed')
    expect(event.payload).toEqual({ key: 'theme', value: 'dark' })
  })

  it('broadcastSettingsChanged preserves complex value types (object, array, null)', () => {
    const cases: ReadonlyArray<{ key: string; value: unknown }> = [
      { key: 'terminal', value: { fontSize: 14 } },
      { key: 'shortcuts', value: ['cmd+s', 'cmd+shift+p'] },
      { key: 'feature', value: null },
    ]
    for (const payload of cases) {
      const event = broadcastSettingsChanged(payload)
      expect(event.payload).toEqual(payload)
    }
  })
})

// ---------------------------------------------------------------------------
// Event id uniqueness
// ---------------------------------------------------------------------------

describe('broadcast helpers — unique event ids', () => {
  it('each call to createWsEvent generates a unique id', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const id = createWsEvent('session:graph', null).id
      expect(seen.has(id), `duplicate id ${id}`).toBe(false)
      seen.add(id)
    }
    expect(seen.size).toBe(100)
  })

  it('each broadcast helper call generates a unique id', () => {
    const helpers: ReadonlyArray<[(payload: unknown) => WsServerEvent, unknown]> = [
      [broadcastSessionGraph, { x: 1 }],
      [broadcastTerminalData as unknown as (p: unknown) => WsServerEvent, {
        sessionId: 's',
        data: new Uint8Array([0]),
      }],
      [broadcastStatePatch, { y: 2 }],
      [broadcastPresence, { z: 3 }],
      [broadcastProjectObservability, { p: 4 }],
      [broadcastAppObservability, { q: 5 }],
      [broadcastMetaSessionEvent, { m: 6 }],
      [broadcastFsChanged as unknown as (p: unknown) => WsServerEvent, {
        projectId: 'p',
        path: '/x',
        kind: 'created',
      }],
      [broadcastSettingsChanged as unknown as (p: unknown) => WsServerEvent, {
        key: 'k',
        value: 'v',
      }],
      [broadcastMemoryNotification, { n: 7 }],
      [broadcastTitleGeneration, { t: 8 }],
      [broadcastUpdateState, { u: 9 }],
    ]

    for (const [helper, payload] of helpers) {
      const id1 = helper(payload).id
      const id2 = helper(payload).id
      expect(id1).not.toBe(id2)
    }
  })
})
