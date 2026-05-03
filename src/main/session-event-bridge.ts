import { randomUUID } from 'node:crypto'
import { SessionEvidenceStore } from '@core/memory/session-evidence-store'
import { createTranscriptSnapshot } from '@core/memory/transcript-snapshot'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type {
  CanonicalSessionEvent,
  MemoryNotificationEvent,
  SessionStatePatchEvent,
} from '@shared/project-session'
import type { EvidenceRef } from '@shared/memory-runtime'
import type { ObservationCategory, ObservationEvent, ObservationRetention, ObservationSeverity } from '@shared/observability'

interface SessionEventApplier {
  applyProviderStatePatch: (patch: SessionStatePatchEvent) => Promise<void>
}

interface ObservabilityIngester {
  ingest: (event: ObservationEvent) => boolean
}

interface EvidenceStoreLike {
  persist: SessionEvidenceStore['persist']
}

interface SessionEventBridgeOptions {
  nowIso?: () => string
  evidenceStore?: EvidenceStoreLike
  transcriptSnapshotter?: (event: CanonicalSessionEvent) => Promise<Awaited<ReturnType<typeof createTranscriptSnapshot>>>
  onMemoryNotification?: (event: MemoryNotificationEvent) => void
}

export class SessionEventBridge {
  private readonly sessionSecrets = new Map<string, string>()
  private readonly providerPatchSequences = new Map<string, number>()
  private readonly sessionEventQueues = new Map<string, Promise<null>>()
  private readonly nowIso: () => string
  private readonly evidenceStore: EvidenceStoreLike
  private readonly transcriptSnapshotter: (event: CanonicalSessionEvent) => Promise<Awaited<ReturnType<typeof createTranscriptSnapshot>>>
  private readonly onMemoryNotification?: (event: MemoryNotificationEvent) => void
  private server: ReturnType<typeof createLocalWebhookServer> | null = null
  private port: number | null = null

  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly controller: SessionEventApplier,
    private readonly observability?: ObservabilityIngester,
    options: SessionEventBridgeOptions = {}
  ) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    const defaultEvidenceStore = new SessionEvidenceStore()
    this.evidenceStore = {
      persist: options.evidenceStore?.persist ?? defaultEvidenceStore.persist.bind(defaultEvidenceStore)
    }
    this.transcriptSnapshotter = options.transcriptSnapshotter ?? createTranscriptSnapshot
    this.onMemoryNotification = options.onMemoryNotification
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
          return await this.enqueueSessionEvent(event)
        },
        onMemoryNotification: async (notification) => {
          this.onMemoryNotification?.({
            id: randomUUID(),
            projectId: notification.projectId,
            sessionId: notification.sessionId,
            kind: notification.kind,
            status: notification.status,
            title: notification.title,
            message: notification.message,
            createdAt: this.nowIso()
          })
          return null
        }
      })
    }

    this.port = await this.server.start()
    await this.manager.setTerminalWebhookPort(this.port)
    return this.port
  }

  private async enqueueSessionEvent(event: CanonicalSessionEvent): Promise<null> {
    const previous = this.sessionEventQueues.get(event.session_id) ?? Promise.resolve(null)
    const next = previous
      .catch(() => null)
      .then(async () => {
        await this.persistEvidenceIfPresent(event)
        this.observability?.ingest(this.toObservationEvent(event))
        await this.controller.applyProviderStatePatch(this.toSessionStatePatch(event))
        return null
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

  private toObservationEvent(event: CanonicalSessionEvent): ObservationEvent {
    const mapping = mapIntentToObservation(event.payload.intent)
    const model = event.evidence?.model ?? event.payload.model
    const snippet = event.evidence?.lastAssistantMessage ?? event.payload.snippet
    const toolName = event.evidence?.toolName ?? event.payload.toolName
    const payload: Record<string, unknown> = {
      summary: event.payload.summary
    }

    if (model !== undefined) {
      payload.model = model
    }

    if (snippet !== undefined) {
      payload.snippet = snippet
    }

    if (toolName !== undefined) {
      payload.toolName = toolName
    }

    if (event.payload.error !== undefined) {
      payload.error = event.payload.error
    }

    if (event.payload.externalSessionId !== undefined) {
      payload.externalSessionId = event.payload.externalSessionId
    }

    if (event.evidence !== undefined) {
      payload.evidence = event.evidence
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

  private allocateProviderPatchSequence(sessionId: string): number {
    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    const lastManagerSequence = session?.lastStateSequence ?? 0
    const lastAllocatedSequence = this.providerPatchSequences.get(sessionId) ?? 0
    const nextSequence = Math.max(lastManagerSequence, lastAllocatedSequence) + 1
    this.providerPatchSequences.set(sessionId, nextSequence)
    return nextSequence
  }

  private async persistEvidenceIfPresent(event: CanonicalSessionEvent): Promise<EvidenceRef | null> {
    if (!event.evidence) {
      return null
    }

    const projectPath = this.resolveProjectPath(event)
    if (!projectPath) {
      return null
    }

    const snapshot = await this.transcriptSnapshotter(event)
    try {
      const persisted = await this.evidenceStore.persist({
        projectPath,
        event,
        snapshot
      })
      return persisted.evidenceRef
    } catch (error) {
      console.error(
        `[session-event-bridge] Failed to persist evidence for session ${event.session_id} event ${event.event_id}:`,
        error
      )
      return null
    }
  }

  private resolveProjectPath(event: CanonicalSessionEvent): string | null {
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find(candidate => candidate.id === event.session_id)
    const resolvedProjectId = session?.projectId ?? event.project_id
    const project = snapshot.projects.find(candidate => candidate.id === resolvedProjectId)

    return project?.path ?? null
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
