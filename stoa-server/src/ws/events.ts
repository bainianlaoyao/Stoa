// WS event types for Stoa Server — Phase 2a
// Server -> Client events
export const WS_SERVER_EVENT_TYPES = [
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
] as const

export type WsServerEventType = (typeof WS_SERVER_EVENT_TYPES)[number]

// Client -> Server message types
export const WS_CLIENT_MESSAGE_TYPES = [
  'session:binary-input',
  'subscribe',
  'unsubscribe',
  'runtime:response',
] as const

export type WsClientMessageType = (typeof WS_CLIENT_MESSAGE_TYPES)[number]

// Wire format: Server -> Client
export interface WsServerEvent {
  id: string
  type: WsServerEventType
  payload: unknown
  timestamp: string
}

// Wire format: Client -> Server
export interface WsClientMessage {
  type: WsClientMessageType
  payload: unknown
  requestId?: string
}

// Subscription filter applied per event type
export interface WsSubscriptionFilter {
  sessionId?: string
}

// Internal subscription record held per client
export interface WsSubscription {
  eventTypes: Set<WsServerEventType>
  filter: WsSubscriptionFilter
}

// Reconnection envelope: initial state snapshot
export interface WsInitialState {
  type: 'ws:initial-state'
  payload: {
    bootstrap: unknown
    activeProjectId: string | null
    activeSessionId: string | null
    settings: unknown
    sidebarState: unknown
    metaSessionBootstrap: unknown
  }
}

// Reconnection envelope: replay missed events
export interface WsMissedEvents {
  type: 'ws:missed-events'
  payload: { events: WsServerEvent[] }
}

// Type guard for server event types
export function isWsServerEventType(type: string): type is WsServerEventType {
  return (WS_SERVER_EVENT_TYPES as readonly string[]).includes(type)
}

// Type guard for client message types
export function isWsClientMessageType(type: string): type is WsClientMessageType {
  return (WS_CLIENT_MESSAGE_TYPES as readonly string[]).includes(type)
}
