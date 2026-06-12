import { randomUUID } from 'node:crypto'
import type { WsServerEvent, WsServerEventType } from './events'

/**
 * Create a typed WsServerEvent envelope.
 */
export function createWsEvent(type: WsServerEventType, payload: unknown): WsServerEvent {
  return {
    id: `evt_${randomUUID()}`,
    type,
    payload,
    timestamp: new Date().toISOString(),
  }
}

// Convenience helpers for each server event type.
// These are thin wrappers so callers never need to pass the type string manually.

export function broadcastSessionGraph(payload: unknown): WsServerEvent {
  return createWsEvent('session:graph', payload)
}

export function broadcastTerminalData(payload: { sessionId: string; data: Uint8Array }): WsServerEvent {
  return createWsEvent('session:terminal-data', payload)
}

export function broadcastStatePatch(payload: unknown): WsServerEvent {
  return createWsEvent('session:state-patch', payload)
}

export function broadcastPresence(payload: unknown): WsServerEvent {
  return createWsEvent('observability:presence', payload)
}

export function broadcastProjectObservability(payload: unknown): WsServerEvent {
  return createWsEvent('observability:project', payload)
}

export function broadcastAppObservability(payload: unknown): WsServerEvent {
  return createWsEvent('observability:app', payload)
}

export function broadcastMetaSessionEvent(payload: unknown): WsServerEvent {
  return createWsEvent('meta-session:event', payload)
}

export function broadcastFsChanged(payload: { projectId: string; path: string; kind: string }): WsServerEvent {
  return createWsEvent('fs:changed', payload)
}

export function broadcastSettingsChanged(payload: { key: string; value: unknown }): WsServerEvent {
  return createWsEvent('settings:changed', payload)
}

export function broadcastMemoryNotification(payload: unknown): WsServerEvent {
  return createWsEvent('notification:memory', payload)
}

export function broadcastTitleGeneration(payload: unknown): WsServerEvent {
  return createWsEvent('notification:title-generation', payload)
}

export function broadcastUpdateState(payload: unknown): WsServerEvent {
  return createWsEvent('update:state', payload)
}
