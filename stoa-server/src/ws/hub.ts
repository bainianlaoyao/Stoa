import { randomUUID } from 'node:crypto'
import type {
  WsServerEvent,
  WsServerEventType,
  WsSubscriptionFilter,
  WsSubscription,
} from './events'

// Minimal WebSocket interface — actual WS integration comes in Phase 2b.
export interface WsLike {
  send(data: string): void
  close?(): void
}

export interface WsClient {
  id: string
  ws: WsLike
  subscriptions: Map<WsServerEventType, WsSubscriptionFilter>
}

const MAX_EVENT_HISTORY = 1000

export class WsHub {
  private clients: Map<string, WsClient> = new Map()
  private eventHistory: WsServerEvent[] = []

  /**
   * Register a new WebSocket client.
   * `token` is accepted for future auth validation (Phase 2b).
   */
  addClient(ws: WsLike, token?: string): WsClient {
    const client: WsClient = {
      id: randomUUID(),
      ws,
      subscriptions: new Map(),
    }
    this.clients.set(client.id, client)

    // Keep token reference for future auth middleware
    void token

    return client
  }

  /**
   * Remove a client and clean up.
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId)
  }

  /**
   * Broadcast an event to all subscribed clients.
   * Stores the event in history for reconnection replay.
   */
  broadcast(type: WsServerEventType, payload: unknown): void {
    const event: WsServerEvent = {
      id: `evt_${randomUUID()}`,
      type,
      payload,
      timestamp: new Date().toISOString(),
    }

    this.eventHistory.push(event)
    if (this.eventHistory.length > MAX_EVENT_HISTORY) {
      this.eventHistory.shift()
    }

    const serialized = JSON.stringify(event)

    for (const client of this.clients.values()) {
      const filter = client.subscriptions.get(type)
      if (!filter) {
        // Not subscribed to this event type — skip
        continue
      }

      // Apply session filter if present
      if (filter.sessionId) {
        const p = event.payload as Record<string, unknown> | null
        if (!p || p.sessionId !== filter.sessionId) {
          continue
        }
      }

      try {
        client.ws.send(serialized)
      } catch {
        // Send failure — client may be disconnected.
        // Actual cleanup happens when the WS close event fires.
      }
    }
  }

  /**
   * Subscribe a client to one or more event types with optional filter.
   */
  handleSubscribe(
    clientId: string,
    eventTypes: WsServerEventType[],
    filter?: WsSubscriptionFilter,
  ): void {
    const client = this.clients.get(clientId)
    if (!client) return

    for (const eventType of eventTypes) {
      client.subscriptions.set(eventType, filter ?? {})
    }
  }

  /**
   * Unsubscribe a client from one or more event types.
   */
  handleUnsubscribe(clientId: string, eventTypes: WsServerEventType[]): void {
    const client = this.clients.get(clientId)
    if (!client) return

    for (const eventType of eventTypes) {
      client.subscriptions.delete(eventType)
    }
  }

  /**
   * Return events that occurred after the given event ID.
   * Used for reconnection state reconciliation (plan section 7.5).
   */
  getMissedEvents(lastEventId: string): WsServerEvent[] {
    const index = this.eventHistory.findIndex((e) => e.id === lastEventId)
    if (index === -1) {
      // Event ID not found in history — gap too large or stale.
      // Caller should request a full state snapshot instead.
      return []
    }
    return this.eventHistory.slice(index + 1)
  }

  /**
   * Number of currently connected clients (useful for diagnostics).
   */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * Access the event history length (useful for diagnostics).
   */
  get historyLength(): number {
    return this.eventHistory.length
  }
}
