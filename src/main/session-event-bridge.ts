import { randomUUID } from 'node:crypto'
import { RuntimeStateStore } from '@core/memory/runtime-state-store'
import { SessionEvidenceStore } from '@core/memory/session-evidence-store'
import { TurnMaintenancePhaseError, TurnMaintenanceRunner } from '@core/memory/turn-maintenance-runner'
import { createTranscriptSnapshot } from '@core/memory/transcript-snapshot'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { Express } from 'express'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type {
  CanonicalSessionEvent,
  MemoryNotificationEvent,
  SessionStatePatchEvent
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
  sealTurn?: SessionEvidenceStore['sealTurn']
  listEvidenceRefsForTurn?: SessionEvidenceStore['listEvidenceRefsForTurn']
}

interface RuntimeStateStoreLike {
  recordSealedTurn: RuntimeStateStore['recordSealedTurn']
  upsertJob: RuntimeStateStore['upsertJob']
  replaceJob: RuntimeStateStore['replaceJob']
}

interface SessionEventBridgeOptions {
  nowIso?: () => string
  evidenceStore?: EvidenceStoreLike
  transcriptSnapshotter?: (event: CanonicalSessionEvent) => Promise<Awaited<ReturnType<typeof createTranscriptSnapshot>>>
  onMemoryNotification?: (event: MemoryNotificationEvent) => void
  turnMaintenanceRunner?: TurnMaintenanceRunner
  createRuntimeStateStore?: (projectPath: string) => RuntimeStateStoreLike
  captureEvidence?: boolean
  configureServerApp?: (app: Express) => void
}

export class SessionEventBridge {
  private readonly sessionSecrets = new Map<string, string>()
  private readonly providerPatchSequences = new Map<string, number>()
  private readonly sessionEventQueues = new Map<string, Promise<null>>()
  private readonly turnEvidenceIds = new Map<string, Set<string>>()
  private readonly activeTurnIds = new Map<string, string>()
  private readonly activeTurnEpochs = new Map<string, number>()
  private readonly sourceTurnEpochs = new Map<string, Map<string, number>>()
  private readonly nowIso: () => string
  private readonly evidenceStore: EvidenceStoreLike
  private readonly transcriptSnapshotter: (event: CanonicalSessionEvent) => Promise<Awaited<ReturnType<typeof createTranscriptSnapshot>>>
  private readonly onMemoryNotification?: (event: MemoryNotificationEvent) => void
  private readonly turnMaintenanceRunner?: TurnMaintenanceRunner
  private readonly createRuntimeStateStore: (projectPath: string) => RuntimeStateStoreLike
  private readonly captureEvidence: boolean
  private readonly configureServerApp?: (app: Express) => void
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
    this.onMemoryNotification = options.onMemoryNotification
    this.turnMaintenanceRunner = options.turnMaintenanceRunner
    this.createRuntimeStateStore = options.createRuntimeStateStore ?? ((projectPath) => new RuntimeStateStore(projectPath))
    this.captureEvidence = options.captureEvidence !== false
    this.configureServerApp = options.configureServerApp
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
        },
        configureApp: this.configureServerApp
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
        const normalized = this.attachResolvedTurnId(event)
        const evidenceRef = await this.persistEvidenceIfPresent(normalized)
        this.trackTurnEvidence(normalized, evidenceRef)
        this.observability?.ingest(this.toObservationEvent(normalized))
        await this.controller.applyProviderStatePatch(this.toSessionStatePatch(normalized))
        await this.handleLifecycle(normalized, evidenceRef)

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
    const turnEpoch = this.resolveTurnEpoch(event)
    return {
      sessionId: event.session_id,
      sequence: this.allocateProviderPatchSequence(event.session_id),
      occurredAt: event.timestamp,
      intent: event.payload.intent,
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

  private allocateProviderPatchSequence(sessionId: string): number {
    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    const lastManagerSequence = session?.lastStateSequence ?? 0
    const lastAllocatedSequence = this.providerPatchSequences.get(sessionId) ?? 0
    const nextSequence = Math.max(lastManagerSequence, lastAllocatedSequence) + 1
    this.providerPatchSequences.set(sessionId, nextSequence)
    return nextSequence
  }

  private resolveTurnEpoch(event: CanonicalSessionEvent): number | undefined {
    if (!event.payload.intent.startsWith('agent.')) {
      return event.payload.turnEpoch
    }

    const explicitEpoch = event.payload.turnEpoch
    if (typeof explicitEpoch === 'number') {
      this.recordResolvedTurnEpoch(event.session_id, event.payload.sourceTurnId, explicitEpoch)
      return explicitEpoch
    }

    const sourceTurnId = event.payload.sourceTurnId ?? event.evidence?.turnId ?? null
    if (sourceTurnId) {
      return this.resolveSourceTurnEpoch(event.session_id, sourceTurnId, event.payload.intent)
    }

    return this.resolveSyntheticTurnEpoch(event.session_id, event.payload.intent)
  }

  private resolveSourceTurnEpoch(sessionId: string, sourceTurnId: string, intent: CanonicalSessionEvent['payload']['intent']): number {
    const mapping = this.sourceTurnEpochs.get(sessionId) ?? new Map<string, number>()
    const existing = mapping.get(sourceTurnId)
    if (existing !== undefined) {
      this.activeTurnEpochs.set(sessionId, existing)
      return existing
    }

    const nextEpoch = this.shouldAllocateSourceTurnEpoch(sessionId, intent)
      ? this.allocateNextTurnEpoch(sessionId)
      : this.lastKnownTurnEpoch(sessionId)

    mapping.set(sourceTurnId, nextEpoch)
    this.sourceTurnEpochs.set(sessionId, mapping)
    this.activeTurnEpochs.set(sessionId, nextEpoch)
    return nextEpoch
  }

  private resolveSyntheticTurnEpoch(sessionId: string, intent: CanonicalSessionEvent['payload']['intent']): number {
    const nextEpoch = this.shouldOpenSyntheticTurn(sessionId, intent)
      ? this.allocateNextTurnEpoch(sessionId)
      : this.currentTurnEpoch(sessionId)
    this.activeTurnEpochs.set(sessionId, nextEpoch)
    return nextEpoch
  }

  private recordResolvedTurnEpoch(sessionId: string, sourceTurnId: string | null | undefined, turnEpoch: number): void {
    this.activeTurnEpochs.set(sessionId, turnEpoch)
    if (!sourceTurnId) {
      return
    }

    const mapping = this.sourceTurnEpochs.get(sessionId) ?? new Map<string, number>()
    mapping.set(sourceTurnId, turnEpoch)
    this.sourceTurnEpochs.set(sessionId, mapping)
  }

  private allocateNextTurnEpoch(sessionId: string): number {
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
    const baseline = Math.max(
      session?.turnEpoch ?? 0,
      this.activeTurnEpochs.get(sessionId) ?? 0
    )
    return baseline + 1
  }

  private currentTurnEpoch(sessionId: string): number {
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
    return Math.max(
      session?.turnEpoch ?? 0,
      this.activeTurnEpochs.get(sessionId) ?? 0,
      1
    )
  }

  private lastKnownTurnEpoch(sessionId: string): number {
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
    return Math.max(
      session?.turnEpoch ?? 0,
      this.activeTurnEpochs.get(sessionId) ?? 0
    )
  }

  private intentStartsTurn(intent: CanonicalSessionEvent['payload']['intent']): boolean {
    return intent === 'agent.turn_started'
  }

  private intentCanOpenTurnWithoutExistingMapping(intent: CanonicalSessionEvent['payload']['intent']): boolean {
    return intent === 'agent.turn_started'
      || intent === 'agent.tool_started'
      || intent === 'agent.permission_requested'
  }

  private shouldAllocateSourceTurnEpoch(
    sessionId: string,
    intent: CanonicalSessionEvent['payload']['intent']
  ): boolean {
    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (session?.turnState === 'running') {
      return false
    }

    return this.intentCanOpenTurnWithoutExistingMapping(intent)
  }

  private shouldOpenSyntheticTurn(sessionId: string, intent: CanonicalSessionEvent['payload']['intent']): boolean {
    if (this.intentStartsTurn(intent)) {
      return true
    }

    const snapshot = this.manager.snapshot()
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return true
    }

    if (session.turnState === 'running') {
      return false
    }

    return intent !== 'agent.permission_resolved'
  }

  private async persistEvidenceIfPresent(event: CanonicalSessionEvent): Promise<EvidenceRef | null> {
    if (!this.captureEvidence) {
      return null
    }

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
  ): Promise<void> {
    if (!this.captureEvidence) {
      return
    }

    if (!event.evidence) {
      return
    }

    const hookEventName = event.evidence.hookEventName
    if (hookEventName !== 'Stop') {
      return
    }

    const projectPath = this.resolveProjectPath(event)
    if (!projectPath) {
      return
    }

    await this.finalizeTurn(projectPath, event, evidenceRef)
    this.activeTurnIds.delete(event.session_id)
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

    this.turnEvidenceIds.delete(turnKey)

    const evidenceRefs = await this.evidenceStore.listEvidenceRefsForTurn?.(
      projectPath,
      event.session_id,
      turnId
    ) ?? []

    if (!this.turnMaintenanceRunner) {
      return
    }

    const queuedJobId = `job_${turnId}`
    await runtimeStateStore.upsertJob({
      jobId: queuedJobId,
      sessionKey,
      turnId,
      state: 'queued',
      updatedAt: this.nowIso()
    })

    void this.runTurnMaintenanceJob({
      projectId: event.project_id,
      projectPath,
      stoaSessionId: event.session_id,
      providerSessionId: event.evidence?.providerSessionId ?? undefined,
      turnId,
      sessionKey,
      queuedJobId,
      evidenceRefs
    })
  }

  private async runTurnMaintenanceJob(input: {
    projectId: string
    projectPath: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    sessionKey: string
    queuedJobId: string
    evidenceRefs: EvidenceRef[]
  }): Promise<void> {
    if (!this.turnMaintenanceRunner) {
      return
    }

    const runtimeStateStore = this.createRuntimeStateStore(input.projectPath)
    const updateJob = async (record: {
      jobId: string
      sessionKey: string
      turnId: string
      state: 'queued' | 'running' | 'done' | 'failed'
      error?: string
      updatedAt: string
    }, previousJobId?: string) => {
      if (previousJobId && previousJobId !== record.jobId) {
        await runtimeStateStore.replaceJob(previousJobId, record)
        return
      }
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
      const result = await this.turnMaintenanceRunner.run({
        projectId: input.projectId,
        projectRoot: input.projectPath,
        stoaSessionId: input.stoaSessionId,
        providerSessionId: input.providerSessionId,
        turnId: input.turnId,
        evidenceRefs: input.evidenceRefs
      })

      await updateJob({
        jobId: result.jobId || input.queuedJobId,
        sessionKey: input.sessionKey,
        turnId: input.turnId,
        state: 'done',
        updatedAt: this.nowIso()
      }, input.queuedJobId)
    } catch (error) {
      const failedJobId = error instanceof TurnMaintenancePhaseError ? error.jobId : input.queuedJobId
      await updateJob({
        jobId: failedJobId,
        sessionKey: input.sessionKey,
        turnId: input.turnId,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: this.nowIso()
      }, input.queuedJobId)
      console.error(
        `[session-event-bridge] turn maintenance failed for session ${input.stoaSessionId} turn ${input.turnId}:`,
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
    this.activeTurnEpochs.clear()
    this.sourceTurnEpochs.clear()
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
    case 'agent.turn_cancelled':
      return { category: 'presence', type: 'presence.ready', severity: 'info', retention: 'operational' }
    case 'agent.turn_failed':
      return { category: 'presence', type: 'presence.failure', severity: 'error', retention: 'critical' }
    case 'runtime.exited_clean':
    case 'runtime.exited_failed':
      return { category: 'lifecycle', type: 'lifecycle.session_exited', severity: 'info', retention: 'operational' }
    case 'runtime.created':
      return { category: 'lifecycle', type: 'lifecycle.session_created', severity: 'info', retention: 'ephemeral' }
    case 'runtime.failed_to_start':
      return { category: 'presence', type: 'presence.failure', severity: 'error', retention: 'critical' }
    case 'runtime.starting':
    case 'runtime.alive':
    case 'agent.completion_seen':
      return { category: 'lifecycle', type: 'lifecycle.session_starting', severity: 'info', retention: 'ephemeral' }
  }
}
