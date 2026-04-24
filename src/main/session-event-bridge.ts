import { randomUUID } from 'node:crypto'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { CanonicalSessionEvent, SessionStatus } from '@shared/project-session'
import type { ObservationCategory, ObservationEvent, ObservationRetention, ObservationSeverity } from '@shared/observability'

interface SessionEventApplier {
  applySessionEvent: (event: {
    sessionId: string
    status: SessionStatus
    summary: string
    externalSessionId?: string | null
  }) => Promise<void>
}

interface ObservabilityIngester {
  ingest: (event: ObservationEvent) => boolean
}

interface SessionEventBridgeOptions {
  nowIso?: () => string
}

export class SessionEventBridge {
  private readonly sessionSecrets = new Map<string, string>()
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
          this.observability?.ingest(this.toObservationEvent(event))
          await this.controller.applySessionEvent({
            sessionId: event.session_id,
            status: event.payload.status ?? 'running',
            summary: event.payload.summary ?? event.event_type,
            externalSessionId: event.payload.externalSessionId
          })
        }
      })
    }

    this.port = await this.server.start()
    await this.manager.setTerminalWebhookPort(this.port)
    return this.port
  }

  private toObservationEvent(event: CanonicalSessionEvent): ObservationEvent {
    const status = event.payload.status ?? 'running'
    const mapping = mapStatusToObservation(status)
    const payload: Record<string, unknown> = {}

    if (event.payload.summary !== undefined) {
      payload.summary = event.payload.summary
    }

    if (event.payload.externalSessionId !== undefined) {
      payload.externalSessionId = event.payload.externalSessionId
    }

    return {
      eventId: event.event_id,
      eventVersion: 1,
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
    this.port = null
    await this.manager.setTerminalWebhookPort(null)
  }
}

function mapStatusToObservation(status: SessionStatus): {
  category: ObservationCategory
  type: string
  severity: ObservationSeverity
  retention: ObservationRetention
} {
  switch (status) {
    case 'running':
      return { category: 'presence', type: 'presence.running', severity: 'info', retention: 'operational' }
    case 'turn_complete':
      return { category: 'presence', type: 'presence.turn_complete', severity: 'info', retention: 'operational' }
    case 'awaiting_input':
      return { category: 'presence', type: 'presence.awaiting_input', severity: 'attention', retention: 'operational' }
    case 'needs_confirmation':
      return { category: 'presence', type: 'presence.needs_confirmation', severity: 'attention', retention: 'critical' }
    case 'degraded':
      return { category: 'presence', type: 'presence.degraded', severity: 'warning', retention: 'critical' }
    case 'error':
      return { category: 'presence', type: 'presence.error', severity: 'error', retention: 'critical' }
    case 'exited':
      return { category: 'lifecycle', type: 'lifecycle.session_exited', severity: 'info', retention: 'operational' }
    case 'bootstrapping':
      return { category: 'lifecycle', type: 'lifecycle.session_bootstrapping', severity: 'info', retention: 'ephemeral' }
    case 'starting':
      return { category: 'lifecycle', type: 'lifecycle.session_starting', severity: 'info', retention: 'ephemeral' }
  }
}
