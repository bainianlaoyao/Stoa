import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WsHub } from './hub'
import type { WsLike, WsClient } from './hub'
import type { WsServerEventType, WsServerEvent } from './events'

function createMockWs(): WsLike {
  return {
    send: vi.fn(),
    close: vi.fn(),
  }
}

describe('WsHub', () => {
  let hub: WsHub

  beforeEach(() => {
    hub = new WsHub()
  })

  // ---------------------------------------------------------------------------
  // addClient
  // ---------------------------------------------------------------------------

  describe('addClient', () => {
    it('returns a client with a unique ID and empty subscriptions', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)

      expect(client.id).toBeTruthy()
      expect(typeof client.id).toBe('string')
      expect(client.id.length).toBeGreaterThan(0)
      expect(client.subscriptions.size).toBe(0)
      expect(client.ws).toBe(ws)
    })

    it('assigns unique IDs to different clients', () => {
      const ws1 = createMockWs()
      const ws2 = createMockWs()
      const client1 = hub.addClient(ws1)
      const client2 = hub.addClient(ws2)

      expect(client1.id).not.toBe(client2.id)
    })

    it('increments clientCount', () => {
      expect(hub.clientCount).toBe(0)

      hub.addClient(createMockWs())
      expect(hub.clientCount).toBe(1)

      hub.addClient(createMockWs())
      expect(hub.clientCount).toBe(2)
    })

    it('accepts optional token parameter', () => {
      const client = hub.addClient(createMockWs(), 'some-token')
      expect(client.id).toBeTruthy()
    })
  })

  // ---------------------------------------------------------------------------
  // removeClient
  // ---------------------------------------------------------------------------

  describe('removeClient', () => {
    it('decrements clientCount', () => {
      const client = hub.addClient(createMockWs())
      expect(hub.clientCount).toBe(1)

      hub.removeClient(client.id)
      expect(hub.clientCount).toBe(0)
    })

    it('removes the correct client when multiple exist', () => {
      const client1 = hub.addClient(createMockWs())
      const client2 = hub.addClient(createMockWs())

      hub.removeClient(client1.id)
      expect(hub.clientCount).toBe(1)

      // client2 should still be present — broadcast should still reach it
      hub.handleSubscribe(client2.id, ['session:graph'])
      hub.broadcast('session:graph', { test: true })
      expect(client2.ws.send).toHaveBeenCalledTimes(1)
    })

    it('with unknown ID is a no-op', () => {
      hub.addClient(createMockWs())
      expect(hub.clientCount).toBe(1)

      hub.removeClient('nonexistent-id')
      expect(hub.clientCount).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // broadcast
  // ---------------------------------------------------------------------------

  describe('broadcast', () => {
    it('stores event in history', () => {
      hub.broadcast('session:graph', { nodes: [] })

      expect(hub.historyLength).toBe(1)
    })

    it('stores multiple events in order', () => {
      hub.broadcast('session:graph', { idx: 1 })
      hub.broadcast('session:state-patch', { idx: 2 })

      expect(hub.historyLength).toBe(2)
    })

    it('sends to subscribed clients only', () => {
      const wsSubscribed = createMockWs()
      const wsUnsubscribed = createMockWs()

      const clientSub = hub.addClient(wsSubscribed)
      const clientUnsub = hub.addClient(wsUnsubscribed)

      hub.handleSubscribe(clientSub.id, ['session:graph'])

      hub.broadcast('session:graph', { test: true })

      expect(wsSubscribed.send).toHaveBeenCalledTimes(1)
      expect(wsUnsubscribed.send).not.toHaveBeenCalled()
    })

    it('sends correctly formatted JSON event', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)
      hub.handleSubscribe(client.id, ['session:graph'])

      hub.broadcast('session:graph', { hello: 'world' })

      const sentData = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(sentData) as WsServerEvent
      expect(parsed.id).toMatch(/^evt_/)
      expect(parsed.type).toBe('session:graph')
      expect(parsed.payload).toEqual({ hello: 'world' })
      expect(typeof parsed.timestamp).toBe('string')
    })

    it('with sessionId filter only sends to matching session', () => {
      const wsMatching = createMockWs()
      const wsNonMatching = createMockWs()

      const clientMatch = hub.addClient(wsMatching)
      const clientNoMatch = hub.addClient(wsNonMatching)

      hub.handleSubscribe(clientMatch.id, ['session:state-patch'], { sessionId: 'sess-A' })
      hub.handleSubscribe(clientNoMatch.id, ['session:state-patch'], { sessionId: 'sess-B' })

      hub.broadcast('session:state-patch', { sessionId: 'sess-A', data: 'x' })

      expect(wsMatching.send).toHaveBeenCalledTimes(1)
      expect(wsNonMatching.send).not.toHaveBeenCalled()
    })

    it('does not send to clients subscribed with a different sessionId filter', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)

      hub.handleSubscribe(client.id, ['session:state-patch'], { sessionId: 'sess-A' })
      hub.broadcast('session:state-patch', { sessionId: 'sess-B', data: 'y' })

      expect(ws.send).not.toHaveBeenCalled()
    })

    it('does not send when payload lacks sessionId but filter requires one', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)

      hub.handleSubscribe(client.id, ['session:state-patch'], { sessionId: 'sess-A' })
      hub.broadcast('session:state-patch', { noSessionId: true })

      expect(ws.send).not.toHaveBeenCalled()
    })

    it('does not send to unsubscribed clients', () => {
      const ws = createMockWs()
      hub.addClient(ws)

      hub.broadcast('session:graph', { test: true })

      expect(ws.send).not.toHaveBeenCalled()
    })

    it('handles send error gracefully', () => {
      const wsError: WsLike = {
        send: vi.fn(() => { throw new Error('socket closed') }),
      }
      const wsOk = createMockWs()

      const clientError = hub.addClient(wsError)
      const clientOk = hub.addClient(wsOk)

      hub.handleSubscribe(clientError.id, ['session:graph'])
      hub.handleSubscribe(clientOk.id, ['session:graph'])

      // Should not throw despite one client failing
      expect(() => hub.broadcast('session:graph', { test: true })).not.toThrow()

      // The healthy client should still receive the event
      expect(wsOk.send).toHaveBeenCalledTimes(1)
    })

    it('only sends to clients subscribed to the specific event type', () => {
      const wsGraph = createMockWs()
      const wsState = createMockWs()

      const clientGraph = hub.addClient(wsGraph)
      const clientState = hub.addClient(wsState)

      hub.handleSubscribe(clientGraph.id, ['session:graph'])
      hub.handleSubscribe(clientState.id, ['session:state-patch'])

      hub.broadcast('session:graph', { test: true })

      expect(wsGraph.send).toHaveBeenCalledTimes(1)
      expect(wsState.send).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // handleSubscribe
  // ---------------------------------------------------------------------------

  describe('handleSubscribe', () => {
    it('adds subscription to client', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)

      hub.handleSubscribe(client.id, ['session:graph', 'session:state-patch'])

      expect(client.subscriptions.size).toBe(2)
      expect(client.subscriptions.has('session:graph')).toBe(true)
      expect(client.subscriptions.has('session:state-patch')).toBe(true)
    })

    it('adds subscription with filter', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)

      hub.handleSubscribe(client.id, ['session:state-patch'], { sessionId: 'sess-123' })

      const filter = client.subscriptions.get('session:state-patch')
      expect(filter).toBeDefined()
      expect(filter!.sessionId).toBe('sess-123')
    })

    it('for unknown client is a no-op', () => {
      expect(() => hub.handleSubscribe('nonexistent-id', ['session:graph'])).not.toThrow()
      expect(hub.clientCount).toBe(0)
    })

    it('allows subscribing to all 12 event types', () => {
      const allTypes: WsServerEventType[] = [
        'session:graph',
        'session:terminal-data',
        'session:state-patch',
        'observability:presence',
        'observability:project',
        'observability:app',
        'meta-session:event',
        'fs:changed',
        'settings:changed',
        'notification:memory',
        'notification:title-generation',
        'update:state',
      ]
      const client = hub.addClient(createMockWs())
      hub.handleSubscribe(client.id, allTypes)

      expect(client.subscriptions.size).toBe(12)
      for (const type of allTypes) {
        expect(client.subscriptions.has(type)).toBe(true)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // handleUnsubscribe
  // ---------------------------------------------------------------------------

  describe('handleUnsubscribe', () => {
    it('removes subscription', () => {
      const client = hub.addClient(createMockWs())
      hub.handleSubscribe(client.id, ['session:graph', 'session:state-patch'])
      expect(client.subscriptions.size).toBe(2)

      hub.handleUnsubscribe(client.id, ['session:graph'])
      expect(client.subscriptions.size).toBe(1)
      expect(client.subscriptions.has('session:graph')).toBe(false)
      expect(client.subscriptions.has('session:state-patch')).toBe(true)
    })

    it('for unknown client is a no-op', () => {
      expect(() => hub.handleUnsubscribe('nonexistent-id', ['session:graph'])).not.toThrow()
    })

    it('removing a non-existent subscription is a no-op', () => {
      const client = hub.addClient(createMockWs())
      expect(() => hub.handleUnsubscribe(client.id, ['session:graph'])).not.toThrow()
      expect(client.subscriptions.size).toBe(0)
    })

    it('prevents broadcast from reaching unsubscribed client', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)

      hub.handleSubscribe(client.id, ['session:graph'])
      hub.handleUnsubscribe(client.id, ['session:graph'])

      hub.broadcast('session:graph', { test: true })
      expect(ws.send).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // getMissedEvents
  // ---------------------------------------------------------------------------

  describe('getMissedEvents', () => {
    it('returns events after given ID', () => {
      hub.broadcast('session:graph', { idx: 1 })
      hub.broadcast('session:graph', { idx: 2 })
      hub.broadcast('session:graph', { idx: 3 })

      // We need to get the event IDs from history, but the hub doesn't
      // expose history directly. We'll capture them via a subscribed client.
      const ws = createMockWs()
      const client = hub.addClient(ws)
      hub.handleSubscribe(client.id, ['session:graph'])

      // Broadcast two more events to capture their IDs
      hub.broadcast('session:graph', { idx: 4 })
      hub.broadcast('session:graph', { idx: 5 })

      // Get the first event's ID from the send calls
      const firstSend = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as WsServerEvent
      const secondSend = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[1][0] as string) as WsServerEvent

      // getMissedEvents after first event should return second event onwards
      const missed = hub.getMissedEvents(firstSend.id)
      expect(missed.length).toBe(1)
      expect(missed[0].id).toBe(secondSend.id)
      expect((missed[0].payload as Record<string, unknown>).idx).toBe(5)
    })

    it('returns empty array when ID not found', () => {
      hub.broadcast('session:graph', { idx: 1 })

      const missed = hub.getMissedEvents('evt_nonexistent')
      expect(missed).toEqual([])
    })

    it('returns empty array when history is empty', () => {
      const missed = hub.getMissedEvents('evt_anything')
      expect(missed).toEqual([])
    })

    it('returns empty array when ID is the last event', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)
      hub.handleSubscribe(client.id, ['session:graph'])

      hub.broadcast('session:graph', { idx: 1 })
      const lastEvent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as WsServerEvent

      const missed = hub.getMissedEvents(lastEvent.id)
      expect(missed).toEqual([])
    })

    it('returns multiple events after the given ID', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)
      hub.handleSubscribe(client.id, ['session:graph'])

      hub.broadcast('session:graph', { idx: 1 })
      hub.broadcast('session:graph', { idx: 2 })
      hub.broadcast('session:graph', { idx: 3 })

      const firstEvent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as WsServerEvent

      const missed = hub.getMissedEvents(firstEvent.id)
      expect(missed.length).toBe(2)
      expect((missed[0].payload as Record<string, unknown>).idx).toBe(2)
      expect((missed[1].payload as Record<string, unknown>).idx).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // historyLength
  // ---------------------------------------------------------------------------

  describe('historyLength', () => {
    it('starts at zero', () => {
      expect(hub.historyLength).toBe(0)
    })

    it('tracks correctly after broadcasts', () => {
      hub.broadcast('session:graph', { a: 1 })
      expect(hub.historyLength).toBe(1)

      hub.broadcast('session:state-patch', { b: 2 })
      expect(hub.historyLength).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // History cap at MAX_EVENT_HISTORY (1000)
  // ---------------------------------------------------------------------------

  describe('history cap', () => {
    it('caps history at 1000 events, dropping the oldest', () => {
      const ws = createMockWs()
      const client = hub.addClient(ws)
      hub.handleSubscribe(client.id, ['session:graph'])

      // Broadcast 1001 events
      for (let i = 0; i < 1001; i++) {
        hub.broadcast('session:graph', { index: i })
      }

      expect(hub.historyLength).toBe(1000)

      // The first event sent was index 0 — it should have been dropped
      // Get the ID of the first surviving event (index 1)
      const firstSent = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as WsServerEvent
      // The first event captured via ws.send was index 0, but the hub's
      // history shifted. Let's verify by checking getMissedEvents.
      // The event for index=1 should still be in history.
      // Instead, let's verify by checking that getMissedEvents can't find
      // the very first event ID (index 0).

      // We need to capture the first event's ID.
      // Clear mock and re-send approach: let's capture the first event ID differently.
      // Re-create a hub and capture the first event ID explicitly.

      const hub2 = new WsHub()
      const ws2 = createMockWs()
      const client2 = hub2.addClient(ws2)
      hub2.handleSubscribe(client2.id, ['session:graph'])

      // Broadcast one event and capture its ID
      hub2.broadcast('session:graph', { index: 0 })
      const firstEventId = (JSON.parse((ws2.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as WsServerEvent).id

      // Now broadcast 1000 more events to push the first one out
      for (let i = 1; i <= 1000; i++) {
        hub2.broadcast('session:graph', { index: i })
      }

      expect(hub2.historyLength).toBe(1000)

      // The first event should no longer be in history
      const missed = hub2.getMissedEvents(firstEventId)
      // Since the event was dropped, findIndex returns -1, so getMissedEvents returns []
      expect(missed).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple clients with different subscriptions
  // ---------------------------------------------------------------------------

  describe('multiple clients', () => {
    it('multiple clients can subscribe to different event types independently', () => {
      const wsGraph = createMockWs()
      const wsTerminal = createMockWs()
      const wsBoth = createMockWs()

      const clientGraph = hub.addClient(wsGraph)
      const clientTerminal = hub.addClient(wsTerminal)
      const clientBoth = hub.addClient(wsBoth)

      hub.handleSubscribe(clientGraph.id, ['session:graph'])
      hub.handleSubscribe(clientTerminal.id, ['session:terminal-data'])
      hub.handleSubscribe(clientBoth.id, ['session:graph', 'session:terminal-data'])

      // Broadcast session:graph — should reach clientGraph and clientBoth
      hub.broadcast('session:graph', { nodes: [] })
      expect(wsGraph.send).toHaveBeenCalledTimes(1)
      expect(wsTerminal.send).not.toHaveBeenCalled()
      expect(wsBoth.send).toHaveBeenCalledTimes(1)

      // Broadcast session:terminal-data — should reach clientTerminal and clientBoth
      hub.broadcast('session:terminal-data', { bytes: 'abc' })
      expect(wsGraph.send).toHaveBeenCalledTimes(1) // still 1
      expect(wsTerminal.send).toHaveBeenCalledTimes(1)
      expect(wsBoth.send).toHaveBeenCalledTimes(2)
    })

    it('clients with sessionId filters receive only their session events', () => {
      const wsA = createMockWs()
      const wsB = createMockWs()

      const clientA = hub.addClient(wsA)
      const clientB = hub.addClient(wsB)

      hub.handleSubscribe(clientA.id, ['session:state-patch'], { sessionId: 'sess-A' })
      hub.handleSubscribe(clientB.id, ['session:state-patch'], { sessionId: 'sess-B' })

      hub.broadcast('session:state-patch', { sessionId: 'sess-A', patch: 1 })
      expect(wsA.send).toHaveBeenCalledTimes(1)
      expect(wsB.send).not.toHaveBeenCalled()

      hub.broadcast('session:state-patch', { sessionId: 'sess-B', patch: 2 })
      expect(wsA.send).toHaveBeenCalledTimes(1) // still 1
      expect(wsB.send).toHaveBeenCalledTimes(1)
    })

    it('removing one client does not affect broadcasts to others', () => {
      const ws1 = createMockWs()
      const ws2 = createMockWs()

      const client1 = hub.addClient(ws1)
      const client2 = hub.addClient(ws2)

      hub.handleSubscribe(client1.id, ['session:graph'])
      hub.handleSubscribe(client2.id, ['session:graph'])

      hub.removeClient(client1.id)

      hub.broadcast('session:graph', { test: true })
      expect(ws1.send).not.toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalledTimes(1)
    })
  })
})
