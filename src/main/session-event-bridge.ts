import { randomUUID } from 'node:crypto'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { CanonicalSessionEvent, SessionStatePatchEvent } from '@shared/project-session'
import type { ObservationCategory, ObservationEvent, ObservationRetention, ObservationSeverity } from '@shared/observability'

interface SessionEventApplier {
  applyProviderStatePatch: (patch: SessionStatePatchEvent) => Promise<void>
}

interface ObservabilityIngester {
  ingest: (event: ObservationEvent) => boolean
}

interface SessionEventBridgeOptions {
  nowIso?: () => string
}

export class SessionEventBridge {
  private readonly sessionSecrets = new Map<string, string>()
  private readonly providerPatchSequences = new Map<string, number>()
  private readonly sessionEventQueues = new Map<string, Promise<void>>()
  private readonly nowIso: () => string
  private server: ReturnType<typeof createLocalWebhookServer> | null = null
  private port: number | null = null

  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly controller: SessionEventApplier,
    private readonly observability?: ObservabilityIngester,
    options: SessionEventBridgeOptions = {}
  ) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async start(): Promise<number> {
    if (this.port !== null) {
      return this.port
    }

    if (!this.server) {
      this.server = createLocalWebhookServer({
        getSessionSecret: (sessionId) => {
          return this.sessionSecrets.get(sessionId) ?? null
        },
        onEvent: async (event) => {
          await this.enqueueSessionEvent(event)
        }
      })
    }

    this.port = await this.server.start()
    await this.manager.setTerminalWebhookPort(this.port)
    return this.port
  }

  private async enqueueSessionEvent(event: CanonicalSessionEvent): Promise<void> {
    const previous = this.sessionEventQueues.get(event.session_id) ?? Promise.resolve()
    const next = previous
      .catch(() => {
        // Preserve per-session ordering even if a previous event failed.
      })
      .then(async () => {
        for (const expandedEvent of this.expandSessionEvents(event)) {
          this.observability?.ingest(this.toObservationEvent(expandedEvent))
          await this.controller.applyProviderStatePatch(this.toSessionStatePatch(expandedEvent))
        }
      })

    this.sessionEventQueues.set(event.session_id, next)
    const cleanup = () => {
      if (this.sessionEventQueues.get(event.session_id) === next) {
        this.sessionEventQueues.delete(event.session_id)
      }
    }
    next.then(cleanup, cleanup)

    return await next
  }

  private expandSessionEvents(event: CanonicalSessionEvent): CanonicalSessionEvent[] {
    const inferredPermissionResolved = this.inferClaudePermissionResolved(event)
    return inferredPermissionResolved ? [inferredPermissionResolved, event] : [event]
  }

  private toObservationEvent(event: CanonicalSessionEvent): ObservationEvent {
    const mapping = mapIntentToObservation(event.payload.intent)
    const payload: Record<string, unknown> = {
      summary: event.payload.summary
    }

    if (event.payload.model !== undefined) {
      payload.model = event.payload.model
    }

    if (event.payload.snippet !== undefined) {
      payload.snippet = event.payload.snippet
    }

    if (event.payload.toolName !== undefined) {
      payload.toolName = event.payload.toolName
    }

    if (event.payload.error !== undefined) {
      payload.error = event.payload.error
    }

    if (event.payload.externalSessionId !== undefined) {
      payload.externalSessionId = event.payload.externalSessionId
    }

    return {
      eventId: event.event_id,
      eventVersion: 1,
      sequence: 0,
      occurredAt: event.timestamp,
      ingestedAt: this.nowIso(),
      scope: 'session',
      projectId: event.project_id,
      sessionId: event.session_id,
      providerId: null,
      category: mapping.category,
      type: mapping.type,
      severity: mapping.severity,
      retention: mapping.retention,
      source: event.source,
      correlationId: event.correlation_id ?? null,
      dedupeKey: null,
      payload
    }
  }

  private toSessionStatePatch(event: CanonicalSessionEvent): SessionStatePatchEvent {
    return {
      sessionId: event.session_id,
      sequence: this.allocateProviderPatchSequence(event.session_id),
      occurredAt: event.timestamp,
      intent: event.payload.intent,
      source: 'provider',
      sourceEventType: event.event_type,
      runtimeState: event.payload.runtimeState,
      agentState: event.payload.agentState,
      hasUnseenCompletion: event.payload.hasUnseenCompletion,
      runtimeExitCode: event.payload.runtimeExitCode,
      runtimeExitReason: event.payload.runtimeExitReason,
      blockingReason: event.payload.blockingReason,
      summary: event.payload.summary,
      externalSessionId: event.payload.externalSessionId
    }
  }

  private inferClaudePermissionResolved(event: CanonicalSessionEvent): CanonicalSessionEvent | null {
    if (!isClaudePermissionContinuationEvent(event)) {
      return null
    }

    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === event.session_id)
    if (!session || session.type !== 'claude-code') {
      return null
    }

    if (session.agentState !== 'blocked') {
      return null
    }

    return {
      event_version: 1,
      event_id: randomUUID(),
      event_type: 'claude-code.PermissionResolvedInferred',
      timestamp: event.timestamp,
      session_id: event.session_id,
      project_id: event.project_id,
      correlation_id: event.correlation_id,
      source: event.source,
      payload: {
        intent: 'agent.permission_resolved',
        agentState: 'working',
        summary: 'Permission resolved (inferred)',
        externalSessionId: event.payload.externalSessionId
      }
    }
  }

  private allocateProviderPatchSequence(sessionId: string): number {
    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    const lastManagerSequence = session?.lastStateSequence ?? 0
    const lastAllocatedSequence = this.providerPatchSequences.get(sessionId) ?? 0
    const nextSequence = Math.max(lastManagerSequence, lastAllocatedSequence) + 1
    this.providerPatchSequences.set(sessionId, nextSequence)
    return nextSequence
  }

  issueSessionSecret(sessionId: string): string {
    const secret = `stoa-${randomUUID()}`
    this.sessionSecrets.set(sessionId, secret)
    return secret
  }

  debugSnapshotSessionSecrets(): Record<string, string> {
    return Object.fromEntries(this.sessionSecrets)
  }

  async stop(): Promise<void> {
    await this.server?.stop()
    this.server = null
    this.sessionSecrets.clear()
    this.providerPatchSequences.clear()
    this.sessionEventQueues.clear()
    this.port = null
    await this.manager.setTerminalWebhookPort(null)
  }
}

function isClaudePermissionContinuationEvent(event: CanonicalSessionEvent): boolean {
  return event.event_type === 'claude-code.PreToolUse'
    || event.event_type === 'claude-code.PostToolUse'
    || event.event_type === 'claude-code.Stop'
}

function mapIntentToObservation(intent: CanonicalSessionEvent['payload']['intent']): {
  category: ObservationCategory
  type: string
  severity: ObservationSeverity
  retention: ObservationRetention
} {
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
      return { category: 'presence', type: 'presence.ready', severity: 'info', retention: 'operational' }
    case 'agent.turn_failed':
      return { category: 'presence', type: 'presence.failed', severity: 'error', retention: 'critical' }
    case 'runtime.exited_clean':
    case 'runtime.exited_failed':
      return { category: 'lifecycle', type: 'lifecycle.session_exited', severity: 'info', retention: 'operational' }
    case 'runtime.created':
      return { category: 'lifecycle', type: 'lifecycle.session_created', severity: 'info', retention: 'ephemeral' }
    case 'runtime.starting':
    case 'runtime.alive':
    case 'runtime.failed_to_start':
    case 'agent.completion_seen':
      return { category: 'lifecycle', type: 'lifecycle.session_starting', severity: 'info', retention: 'ephemeral' }
  }
}
