/**
 * Session Event Processor — Stoa Server side.
 *
 * Phase 3 (plan section 6.4). Extracted from
 * `src/main/session-event-bridge.ts`. Handles incoming webhook
 * `CanonicalSessionEvent`s: updates session state (turn epoch,
 * outcome, blocking), stores evidence in the `session_events` table,
 * triggers title generation on turn completion, and broadcasts WS
 * events for state changes.
 *
 * The original bridge (~797 lines) mixed webhook server setup, Express
 * app lifecycle, PTY data forwarding, and evidence/maintenance runner
 * orchestration. This module keeps only the event-processing logic that
 * belongs server-side:
 *
 *   1. Accept canonical session events (from webhook routes).
 *   2. Convert them to `SessionStatePatchEvent`s.
 *   3. Apply the patch via `ProjectSessionManager`.
 *   4. Persist the raw event in `session_events` (SQLite).
 *   5. Broadcast WS events on state change.
 *   6. Trigger title generation when a turn completes.
 *
 * PTY data forwarding and webhook server lifecycle remain in Electron.
 */
import { randomUUID } from 'node:crypto'
import type { CanonicalSessionEvent, SessionStatePatchEvent } from 'stoa-shared'
import type { StoaDb } from '../db/connection'
import type { ProjectSessionManager } from '../services/project-session-manager'
import type { WsHubLike } from '../services/project-session-manager'
import { sessionEvents } from '../db/schema'
import type { RuntimeBridgeHandler } from '../ws/runtime-bridge-handler'
import type { RuntimeBridgeHooks } from '../ws/runtime-bridge-handler'

// ---------------------------------------------------------------------------
// Observation category mapping (mirrors session-event-bridge.ts lines 763-797)
// ---------------------------------------------------------------------------

type ObservationCategory = 'presence' | 'lifecycle'
type ObservationSeverity = 'info' | 'attention' | 'error'
type ObservationRetention = 'operational' | 'critical' | 'ephemeral'

interface ObservationMapping {
  category: ObservationCategory
  type: string
  severity: ObservationSeverity
  retention: ObservationRetention
}

function mapIntentToObservation(intent: string): ObservationMapping {
  switch (intent) {
    case 'agent.turn_started':
    case 'agent.tool_started':
    case 'agent.tool_completed':
      return { category: 'presence', type: 'presence.running', severity: 'info', retention: 'operational' }
    case 'agent.turn_completed':
      return { category: 'presence', type: 'presence.complete', severity: 'attention', retention: 'critical' }
    case 'agent.permission_requested':
      return { category: 'presence', type: 'presence.blocked', severity: 'attention', retention: 'critical' }
    case 'agent.permission_resolved':
    case 'agent.recovered':
    case 'agent.turn_interrupted':
    case 'agent.turn_cancelled':
      return { category: 'presence', type: 'presence.ready', severity: 'info', retention: 'operational' }
    case 'agent.turn_failed':
      return { category: 'presence', type: 'presence.failure', severity: 'error', retention: 'critical' }
    case 'runtime.exited_clean':
      return { category: 'lifecycle', type: 'lifecycle.session_exited', severity: 'info', retention: 'operational' }
    case 'runtime.exited_failed':
      return { category: 'presence', type: 'presence.failure', severity: 'error', retention: 'critical' }
    case 'runtime.created':
      return { category: 'lifecycle', type: 'lifecycle.session_created', severity: 'info', retention: 'ephemeral' }
    case 'runtime.failed_to_start':
      return { category: 'presence', type: 'presence.failure', severity: 'error', retention: 'critical' }
    case 'runtime.starting':
    case 'runtime.alive':
    case 'agent.completion_seen':
      return { category: 'lifecycle', type: 'lifecycle.session_starting', severity: 'info', retention: 'ephemeral' }
    default:
      return { category: 'lifecycle', type: 'lifecycle.unknown', severity: 'info', retention: 'ephemeral' }
  }
}

// ---------------------------------------------------------------------------
// Event sequence allocation
// ---------------------------------------------------------------------------

/**
 * Allocate the next per-session event sequence number. Uses a simple
 * in-memory counter seeded from the session's `lastStateSequence`.
 */
export class EventSequenceAllocator {
  private sequences: Map<string, number> = new Map()

  allocate(sessionId: string, lastKnownSequence: number): number {
    const current = Math.max(this.sequences.get(sessionId) ?? 0, lastKnownSequence)
    const next = current + 1
    this.sequences.set(sessionId, next)
    return next
  }

  reset(sessionId: string): void {
    this.sequences.delete(sessionId)
  }
}

// ---------------------------------------------------------------------------
// Title generation trigger
// ---------------------------------------------------------------------------

export interface TitleGenerationTrigger {
  /** Called when a turn completes, providing context for title generation. */
  onTurnCompleted?(payload: {
    sessionId: string
    projectId: string
    turnEpoch: number
    intent: string
    summary: string
    promptText: string | null
    assistantSnippet: string | null
  }): void
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface SessionEventProcessorDeps {
  /** In-memory session state manager. */
  manager: ProjectSessionManager
  /** SQLite database for persisting session events. */
  db: StoaDb
  /** WS hub for broadcasting state changes. */
  wsHub: WsHubLike
  /** Optional runtime bridge handler — receives terminal data hooks. */
  runtimeBridge?: RuntimeBridgeHandler
  /** Optional title generation trigger. */
  titleGenerator?: TitleGenerationTrigger
  /** Override for `Date.now()` in tests. */
  nowIso?: () => string
}

// ---------------------------------------------------------------------------
// SessionEventProcessor
// ---------------------------------------------------------------------------

export class SessionEventProcessor {
  private readonly manager: ProjectSessionManager
  private readonly db: StoaDb
  private readonly wsHub: WsHubLike
  private readonly runtimeBridge?: RuntimeBridgeHandler
  private readonly titleGenerator?: TitleGenerationTrigger
  private readonly nowIso: () => string
  private readonly sequenceAllocator: EventSequenceAllocator
  private readonly activeTurnEpochs: Map<string, number> = new Map()

  /**
   * Per-session serialized event processing queue — mirrors the
   * `sessionEventQueues` pattern from session-event-bridge.ts so
   * events for the same session are never processed concurrently.
   */
  private readonly queues: Map<string, Promise<void>> = new Map()

  constructor(deps: SessionEventProcessorDeps) {
    this.manager = deps.manager
    this.db = deps.db
    this.wsHub = deps.wsHub
    this.runtimeBridge = deps.runtimeBridge
    this.titleGenerator = deps.titleGenerator
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
    this.sequenceAllocator = new EventSequenceAllocator()

    // If a runtime bridge was provided, wire the terminal-data hook
    // so PTY output is forwarded to WS subscribers.
    if (this.runtimeBridge) {
      this.runtimeBridge.setHooks(this.buildBridgeHooks())
    }
  }

  /**
   * Enqueue a canonical session event for processing. Events are
   * serialized per-session to guarantee ordering.
   */
  async processEvent(event: CanonicalSessionEvent): Promise<void> {
    await this.enqueueSessionMutation(event.session_id, async () => {
      await this.doProcessEvent(event)
    })
  }

  private async enqueueSessionMutation(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    this.queues.set(sessionId, next)
    const cleanup = () => {
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId)
      }
    }
    next.then(cleanup, cleanup)
    await next
  }

  private enqueueBridgeMutation(sessionId: string, label: string, task: () => Promise<void>): void {
    void this.enqueueSessionMutation(sessionId, task).catch((error) => {
      console.warn(`[session-event-processor] Failed to ${label}`, error)
    })
  }

  /**
   * Build the bridge hooks that forward terminal data from the runtime
   * provider to WS subscribers, and handle provider lifecycle events.
   */
  private buildBridgeHooks(): RuntimeBridgeHooks {
    return {
      onTerminalData: (payload) => {
        try {
          this.wsHub.broadcast('session:terminal-data', {
            sessionId: payload.sessionId,
            data: payload.data
          })
        } catch (error) {
          console.warn('[session-event-processor] Failed to broadcast terminal data', error)
        }
      },
      onProviderDisconnected: (payload) => {
        for (const sessionId of payload.orphanedSessionIds) {
          this.enqueueBridgeMutation(sessionId, 'apply provider disconnect state', async () => {
            await this.manager.markRuntimeExited(sessionId, null, 'Runtime provider disconnected')
          })
        }
      },
      onProviderReady: (payload) => {
        for (const entry of payload.ptyStates) {
          if (entry.state.alive) {
            this.enqueueBridgeMutation(entry.sessionId, 'apply provider ready alive state', async () => {
              if (this.isArchivedSession(entry.sessionId)) {
                return
              }
              await this.manager.markRuntimeAlive(entry.sessionId, this.getCurrentExternalSessionId(entry.sessionId))
            })
            continue
          }
          this.applyPtyExitedState(entry.sessionId, entry.state, 'Runtime provider state sync reported exit')
        }
      },
      onPtyState: (payload) => {
        if (payload.state.alive) {
          this.enqueueBridgeMutation(payload.sessionId, 'apply PTY alive state', async () => {
            if (this.isArchivedSession(payload.sessionId)) {
              return
            }
            await this.manager.markRuntimeAlive(payload.sessionId, this.getCurrentExternalSessionId(payload.sessionId))
          })
          return
        }
        this.applyPtyExitedState(payload.sessionId, payload.state)
      }
    }
  }

  private isArchivedSession(sessionId: string): boolean {
    return this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)?.archived === true
  }

  private getCurrentExternalSessionId(sessionId: string): string | null {
    return this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)?.externalSessionId ?? null
  }

  private applyPtyExitedState(
    sessionId: string,
    state: { exitCode?: number | null; exitReason?: 'clean' | 'failed' | null },
    fallbackSummary?: string
  ): void {
    const exitCode = state.exitCode ?? null
    const summary = fallbackSummary
      ?? (state.exitReason === 'failed'
        ? `Runtime exited with code ${exitCode ?? 'unknown'}`
        : `Runtime exited (${exitCode ?? 0})`)

    this.enqueueBridgeMutation(sessionId, 'apply PTY exit state', async () => {
      await this.manager.markRuntimeExited(sessionId, exitCode, summary)
    })
  }

  // -------------------------------------------------------------------------
  // Internal processing
  // -------------------------------------------------------------------------

  private async doProcessEvent(event: CanonicalSessionEvent): Promise<void> {
    // 1. Look up session to get baseline state
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find((s) => s.id === event.session_id)

    // 2. Build and apply state patch
    const patch = this.toSessionStatePatch(event, session)
    await this.manager.applySessionStatePatch(patch)

    // 3. Persist the raw event to session_events table
    await this.persistEvent(event, patch.sequence)

    // 4. Broadcast WS state-patch event
    try {
      this.wsHub.broadcast('session:state-patch', {
        sessionId: event.session_id,
        patch
      })
    } catch (error) {
      console.warn('[session-event-processor] Failed to broadcast state patch', error)
    }

    // 5. Broadcast observability presence update
    const observation = mapIntentToObservation(patch.intent)
    if (observation.category === 'presence') {
      try {
        this.wsHub.broadcast('observability:presence', {
          sessionId: event.session_id,
          projectId: event.project_id,
          phase: observation.type.split('.')[1] ?? 'unknown',
          intent: patch.intent,
          timestamp: this.nowIso()
        })
      } catch (error) {
        console.warn('[session-event-processor] Failed to broadcast presence', error)
      }
    }

    // 6. Title generation on turn completion
    if (patch.intent === 'agent.turn_completed' && this.titleGenerator?.onTurnCompleted) {
      const promptText = event.evidence?.promptText ?? session?.titleGenerationContext?.prompt ?? null
      const assistantSnippet = event.evidence?.lastAssistantMessage ?? session?.titleGenerationContext?.assistantSnippet ?? null
      this.titleGenerator.onTurnCompleted({
        sessionId: event.session_id,
        projectId: event.project_id,
        turnEpoch: patch.turnEpoch ?? session?.turnEpoch ?? 0,
        intent: patch.intent,
        summary: event.payload.summary ?? '',
        promptText: promptText ?? null,
        assistantSnippet: assistantSnippet ?? null
      })
    }
  }

  /**
   * Convert a CanonicalSessionEvent to a SessionStatePatchEvent.
   * Mirrors the reduction logic from session-event-bridge.ts
   * `toSessionStatePatch()`.
   */
  private toSessionStatePatch(
    event: CanonicalSessionEvent,
    session: { lastStateSequence: number; turnEpoch: number; turnState?: string } | undefined
  ): SessionStatePatchEvent {
    const lastSeq = session?.lastStateSequence ?? 0
    const sequence = this.sequenceAllocator.allocate(event.session_id, lastSeq)
    const turnEpoch = this.resolveTurnEpoch(event, session)
    const intent = this.resolveIntent(event, session, turnEpoch)

    return {
      sessionId: event.session_id,
      sequence,
      occurredAt: event.timestamp,
      intent,
      source: 'provider',
      sourceEventType: event.event_type,
      turnEpoch,
      sourceTurnId: event.payload.sourceTurnId,
      runtimeExitCode: event.payload.runtimeExitCode,
      runtimeExitReason: event.payload.runtimeExitReason,
      blockingReason: event.payload.blockingReason,
      failureReason: event.payload.failureReason,
      summary: event.payload.summary,
      externalSessionId: event.payload.externalSessionId
    }
  }

  /**
   * Resolve the turn epoch for an event. Agent events advance the
   * epoch; runtime events preserve whatever the session already has.
   */
  private resolveTurnEpoch(
    event: CanonicalSessionEvent,
    session: { turnEpoch: number; turnState?: string } | undefined
  ): number | undefined {
    const explicitEpoch = event.payload.turnEpoch
    if (typeof explicitEpoch === 'number') {
      this.activeTurnEpochs.set(event.session_id, explicitEpoch)
      return explicitEpoch
    }

    if (!event.payload.intent.startsWith('agent.')) {
      return undefined
    }

    const activeEpoch = this.activeTurnEpochs.get(event.session_id)
    if (activeEpoch !== undefined) {
      return activeEpoch
    }

    const currentEpoch = session?.turnEpoch ?? 0
    if (
      event.payload.intent === 'agent.turn_started'
      || event.payload.intent === 'agent.tool_started'
      || event.payload.intent === 'agent.permission_requested'
    ) {
      const nextEpoch = currentEpoch + 1
      this.activeTurnEpochs.set(event.session_id, nextEpoch)
      return nextEpoch
    }

    return currentEpoch
  }

  private resolveIntent(
    event: CanonicalSessionEvent,
    session: { turnState?: string } | undefined,
    turnEpoch: number | undefined
  ): CanonicalSessionEvent['payload']['intent'] {
    if (event.payload.intent !== 'agent.turn_completed') {
      return event.payload.intent
    }

    const hasActiveTurn = this.activeTurnEpochs.get(event.session_id) === turnEpoch
    if (!hasActiveTurn && session?.turnState !== 'running') {
      return 'agent.recovered'
    }

    this.activeTurnEpochs.delete(event.session_id)
    return event.payload.intent
  }

  /**
   * Persist a canonical session event to the `session_events` SQLite table.
   */
  private async persistEvent(event: CanonicalSessionEvent, sequence: number): Promise<void> {
    try {
      this.db.insert(sessionEvents).values({
        sessionId: event.session_id,
        sequence,
        eventVersion: String(event.event_version),
        eventId: event.event_id,
        eventType: event.event_type,
        intent: event.payload.intent,
        source: event.source,
        projectId: event.project_id,
        correlationId: event.correlation_id ?? null,
        turnEpoch: event.payload.turnEpoch ?? null,
        payload: JSON.stringify(event.payload),
        evidence: event.evidence ? JSON.stringify(event.evidence) : null
      }).run()
    } catch (error) {
      console.error(
        `[session-event-processor] Failed to persist event ${event.event_id} for session ${event.session_id}:`,
        error
      )
    }
  }
}
