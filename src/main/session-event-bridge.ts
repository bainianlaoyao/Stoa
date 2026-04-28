import { randomUUID } from 'node:crypto'
import { RuntimeStateStore } from '@core/memory/runtime-state-store'
import { SessionEvidenceStore } from '@core/memory/session-evidence-store'
import { createTranscriptSnapshot } from '@core/memory/transcript-snapshot'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { EvolverClient, ProcessTurnOptions, RecallOptions, WarmStartOptions } from '@core/memory/evolver-client'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { CanonicalSessionEvent, SessionStatePatchEvent, SessionType } from '@shared/project-session'
import type { DeliveryEnvelope, EvidenceRef, RuntimeJobRecord } from '@shared/memory-runtime'
import type { ObservationCategory, ObservationEvent, ObservationRetention, ObservationSeverity } from '@shared/observability'

interface SessionEventApplier {
  applyProviderStatePatch: (patch: SessionStatePatchEvent) => Promise<void>
}

interface ObservabilityIngester {
  ingest: (event: ObservationEvent) => boolean
}

interface EvidenceStoreLike {
  persist: SessionEvidenceStore['persist']
  sealTurn?: SessionEvidenceStore['sealTurn']
  listEvidenceRefsForTurn?: SessionEvidenceStore['listEvidenceRefsForTurn']
}

interface EvolverBridgeLike {
  warmStart: (options: WarmStartOptions) => Promise<DeliveryEnvelope | null>
  recall: (options: RecallOptions) => Promise<DeliveryEnvelope | null>
  observeWrite: EvolverClient['observeWrite']
  processTurn: (options: ProcessTurnOptions) => Promise<{ jobId: string }>
}

interface RuntimeStateStoreLike {
  recordSealedTurn: RuntimeStateStore['recordSealedTurn']
  upsertJob: RuntimeStateStore['upsertJob']
}

interface SessionEventBridgeHookResponse {
  agent_message?: string
  additionalContext?: string
  additional_context?: string
  systemMessage?: string
  hookSpecificOutput?: {
    additionalContext?: string
    systemMessage?: string
  }
}

interface SessionEventBridgeOptions {
  nowIso?: () => string
  evidenceStore?: EvidenceStoreLike
  transcriptSnapshotter?: (event: CanonicalSessionEvent) => Promise<Awaited<ReturnType<typeof createTranscriptSnapshot>>>
  evolverBridge?: EvolverBridgeLike
  createRuntimeStateStore?: (projectPath: string) => RuntimeStateStoreLike
}

export class SessionEventBridge {
  private readonly sessionSecrets = new Map<string, string>()
  private readonly providerPatchSequences = new Map<string, number>()
  private readonly sessionEventQueues = new Map<string, Promise<SessionEventBridgeHookResponse | null>>()
  private readonly turnEvidenceIds = new Map<string, Set<string>>()
  private readonly activeTurnIds = new Map<string, string>()
  private readonly nowIso: () => string
  private readonly evidenceStore: EvidenceStoreLike
  private readonly transcriptSnapshotter: (event: CanonicalSessionEvent) => Promise<Awaited<ReturnType<typeof createTranscriptSnapshot>>>
  private readonly evolverBridge?: EvolverBridgeLike
  private readonly createRuntimeStateStore: (projectPath: string) => RuntimeStateStoreLike
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
      persist: options.evidenceStore?.persist ?? defaultEvidenceStore.persist.bind(defaultEvidenceStore),
      sealTurn: options.evidenceStore?.sealTurn ?? defaultEvidenceStore.sealTurn.bind(defaultEvidenceStore),
      listEvidenceRefsForTurn:
        options.evidenceStore?.listEvidenceRefsForTurn
        ?? defaultEvidenceStore.listEvidenceRefsForTurn.bind(defaultEvidenceStore)
    }
    this.transcriptSnapshotter = options.transcriptSnapshotter ?? createTranscriptSnapshot
    this.evolverBridge = options.evolverBridge
    this.createRuntimeStateStore = options.createRuntimeStateStore ?? ((projectPath) => new RuntimeStateStore(projectPath))
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
        }
      })
    }

    this.port = await this.server.start()
    await this.manager.setTerminalWebhookPort(this.port)
    return this.port
  }

  private async enqueueSessionEvent(event: CanonicalSessionEvent): Promise<SessionEventBridgeHookResponse | null> {
    const previous = this.sessionEventQueues.get(event.session_id) ?? Promise.resolve(null)
    const next = previous
      .catch(() => null)
      .then(async () => {
        let delivery: SessionEventBridgeHookResponse | null = null

        const normalized = this.attachResolvedTurnId(event)
        for (const expandedEvent of this.expandSessionEvents(normalized)) {
          const evidenceRef = await this.persistEvidenceIfPresent(expandedEvent)
          this.trackTurnEvidence(expandedEvent, evidenceRef)
          this.observability?.ingest(this.toObservationEvent(expandedEvent))
          await this.controller.applyProviderStatePatch(this.toSessionStatePatch(expandedEvent))
          const lifecycleDelivery = await this.handleLifecycle(expandedEvent, evidenceRef)
          if (lifecycleDelivery) {
            delivery = lifecycleDelivery
          }
        }

        return delivery
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

  private attachResolvedTurnId(event: CanonicalSessionEvent): CanonicalSessionEvent {
    if (!event.evidence || event.evidence.turnId || event.evidence.rawSource.provider !== 'claude-code') {
      return event
    }

    const hookEventName = event.evidence.hookEventName
    if (!hookEventName || hookEventName === 'SessionStart') {
      return event
    }

    const sessionTurnId = this.activeTurnIds.get(event.session_id)
    let turnId = sessionTurnId ?? null

    if (hookEventName === 'UserPromptSubmit') {
      turnId = randomUUID()
      this.activeTurnIds.set(event.session_id, turnId)
    } else if (!turnId) {
      turnId = randomUUID()
      this.activeTurnIds.set(event.session_id, turnId)
    }

    return {
      ...event,
      evidence: {
        ...event.evidence,
        turnId
      }
    }
  }

  private expandSessionEvents(event: CanonicalSessionEvent): CanonicalSessionEvent[] {
    const inferredPermissionResolved = this.inferClaudePermissionResolved(event)
    return inferredPermissionResolved ? [inferredPermissionResolved, event] : [event]
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

  private inferClaudePermissionResolved(event: CanonicalSessionEvent): CanonicalSessionEvent | null {
    if (!isClaudePermissionContinuationEvent(event)) {
      return null
    }

    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === event.session_id)
    if (!session || session.type !== 'claude-code') {
      return null
    }

    if (session.agentState !== 'blocked' || session.blockingReason !== 'permission') {
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

  private trackTurnEvidence(event: CanonicalSessionEvent, evidenceRef: EvidenceRef | null): void {
    if (!evidenceRef?.turnId) {
      return
    }

    const turnKey = this.formatTurnKey(event.project_id, event.session_id, evidenceRef.turnId)
    const existing = this.turnEvidenceIds.get(turnKey) ?? new Set<string>()
    existing.add(evidenceRef.evidenceId)
    this.turnEvidenceIds.set(turnKey, existing)
  }

  private async handleLifecycle(
    event: CanonicalSessionEvent,
    evidenceRef: EvidenceRef | null
  ): Promise<SessionEventBridgeHookResponse | null> {
    if (!event.evidence || !this.evolverBridge) {
      return null
    }

    const projectPath = this.resolveProjectPath(event)
    const session = this.manager.snapshot().sessions.find(candidate => candidate.id === event.session_id)
    if (!projectPath || !session) {
      return null
    }

    const consumer = toMemoryConsumer(session.type)
    if (!consumer) {
      return null
    }

    const hookEventName = event.evidence.hookEventName
    if (!hookEventName) {
      return null
    }

    switch (hookEventName) {
      case 'SessionStart': {
        const delivery = await this.evolverBridge.warmStart({
          projectRoot: projectPath,
          consumer,
          stoaSessionId: event.session_id,
          providerSessionId: event.evidence.providerSessionId
        })
        return toHookResponse(delivery)
      }
      case 'UserPromptSubmit': {
        const taskText = event.evidence.promptText?.trim()
        if (!taskText) {
          return null
        }

        const delivery = await this.evolverBridge.recall({
          projectRoot: projectPath,
          consumer,
          stoaSessionId: event.session_id,
          providerSessionId: event.evidence.providerSessionId,
          taskText
        })
        return toHookResponse(delivery)
      }
      case 'PostToolUse': {
        if (event.evidence.toolName !== 'Write' || !evidenceRef) {
          return null
        }

        await this.evolverBridge.observeWrite({
          projectRoot: projectPath,
          stoaSessionId: event.session_id,
          providerSessionId: event.evidence.providerSessionId,
          turnId: evidenceRef.turnId ?? undefined,
          evidenceRefs: [evidenceRef]
        })
        return null
      }
      case 'Stop':
      case 'StopFailure': {
        await this.finalizeTurn(projectPath, event, evidenceRef)
        this.activeTurnIds.delete(event.session_id)
        return null
      }
      default:
        return null
    }
  }

  private async finalizeTurn(
    projectPath: string,
    event: CanonicalSessionEvent,
    evidenceRef: EvidenceRef | null
  ): Promise<void> {
    const turnId = evidenceRef?.turnId ?? event.evidence?.turnId ?? null
    if (!turnId) {
      return
    }

    const turnKey = this.formatTurnKey(event.project_id, event.session_id, turnId)
    const evidenceIds = Array.from(this.turnEvidenceIds.get(turnKey) ?? new Set<string>())
    if (evidenceRef) {
      evidenceIds.push(evidenceRef.evidenceId)
    }
    const uniqueEvidenceIds = Array.from(new Set(evidenceIds))
    if (uniqueEvidenceIds.length === 0) {
      return
    }

    await this.evidenceStore.sealTurn?.(
      projectPath,
      event.session_id,
      turnId,
      uniqueEvidenceIds
    )

    const sessionKey = this.formatSessionKey(event.project_id, event.session_id)
    const runtimeStateStore = this.createRuntimeStateStore(projectPath)
    await runtimeStateStore.recordSealedTurn({
      sessionKey,
      projectId: event.project_id,
      stoaSessionId: event.session_id,
      turnId,
      evidenceIds: uniqueEvidenceIds,
      sealedAt: event.timestamp
    })

    const queuedJobId = `job_${turnId}`
    await runtimeStateStore.upsertJob({
      jobId: queuedJobId,
      sessionKey,
      turnId,
      state: 'queued',
      updatedAt: this.nowIso()
    })

    this.turnEvidenceIds.delete(turnKey)

    void this.runProcessTurnJob({
      projectPath,
      projectId: event.project_id,
      stoaSessionId: event.session_id,
      providerSessionId: event.evidence?.providerSessionId ?? undefined,
      turnId,
      sessionKey,
      queuedJobId
    })
  }

  private async runProcessTurnJob(input: {
    projectPath: string
    projectId: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    sessionKey: string
    queuedJobId: string
  }): Promise<void> {
    if (!this.evolverBridge) {
      return
    }

    const runtimeStateStore = this.createRuntimeStateStore(input.projectPath)
    const updateJob = async (record: RuntimeJobRecord) => {
      await runtimeStateStore.upsertJob(record)
    }

    await updateJob({
      jobId: input.queuedJobId,
      sessionKey: input.sessionKey,
      turnId: input.turnId,
      state: 'running',
      updatedAt: this.nowIso()
    })

    try {
      const evidenceRefs = await this.evidenceStore.listEvidenceRefsForTurn?.(
        input.projectPath,
        input.stoaSessionId,
        input.turnId
      ) ?? []
      const result = await this.evolverBridge.processTurn({
        projectRoot: input.projectPath,
        stoaSessionId: input.stoaSessionId,
        providerSessionId: input.providerSessionId,
        turnId: input.turnId,
        evidenceRefs,
        jobId: input.queuedJobId
      })

      await updateJob({
        jobId: result.jobId || input.queuedJobId,
        sessionKey: input.sessionKey,
        turnId: input.turnId,
        state: 'done',
        updatedAt: this.nowIso()
      })
    } catch (error) {
      await updateJob({
        jobId: input.queuedJobId,
        sessionKey: input.sessionKey,
        turnId: input.turnId,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: this.nowIso()
      })
      console.error(
        `[session-event-bridge] processTurn failed for session ${input.stoaSessionId} turn ${input.turnId}:`,
        error
      )
    }
  }

  private resolveProjectPath(event: CanonicalSessionEvent): string | null {
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find(candidate => candidate.id === event.session_id)
    const resolvedProjectId = session?.projectId ?? event.project_id
    const project = snapshot.projects.find(candidate => candidate.id === resolvedProjectId)

    return project?.path ?? null
  }

  private formatSessionKey(projectId: string, sessionId: string): string {
    return `${projectId}\n${sessionId}`
  }

  private formatTurnKey(projectId: string, sessionId: string, turnId: string): string {
    return `${projectId}\n${sessionId}\n${turnId}`
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
    this.turnEvidenceIds.clear()
    this.activeTurnIds.clear()
    this.port = null
    await this.manager.setTerminalWebhookPort(null)
  }
}

function toMemoryConsumer(sessionType: SessionType): WarmStartOptions['consumer'] | null {
  switch (sessionType) {
    case 'claude-code':
    case 'codex':
    case 'opencode':
      return sessionType
    default:
      return null
  }
}

function toHookResponse(delivery: DeliveryEnvelope | null): SessionEventBridgeHookResponse | null {
  if (!delivery?.content) {
    return null
  }

  return {
    agent_message: delivery.content,
    additionalContext: delivery.content,
    additional_context: delivery.content,
    systemMessage: delivery.content,
    hookSpecificOutput: {
      additionalContext: delivery.content,
      systemMessage: delivery.content
    }
  }
}

function isClaudePermissionContinuationEvent(event: CanonicalSessionEvent): boolean {
  return event.event_type === 'claude-code.PreToolUse' || event.event_type === 'claude-code.Stop'
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
      return { category: 'presence', type: 'presence.running', severity: 'info', retention: 'operational' }
    case 'agent.turn_completed':
      return { category: 'presence', type: 'presence.complete', severity: 'attention', retention: 'critical' }
    case 'agent.permission_requested':
      return { category: 'presence', type: 'presence.blocked', severity: 'attention', retention: 'critical' }
    case 'agent.permission_resolved':
    case 'agent.recovered':
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
