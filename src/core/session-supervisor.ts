import { derivePresencePhase } from '@shared/session-state-reducer'
import {
  sanitizeSessionNodeSnapshotForGenericProjection,
  type SessionCompletionReport,
  type SessionNodeSnapshot,
  type SessionOutputResult,
  type SessionStatusSnapshot,
  type SessionSummary,
  type SessionType,
  type SessionWaitOptions,
  type SessionWaitResult,
  type SubagentCommandErrorCode
} from '@shared/project-session'
import type { SessionVisibilityReader } from './session-visibility-service'

const SESSION_WAIT_STATE_CHANGE_SLICE_MS = 250

export type CallerIdentity =
  | { type: 'local-user' }
  | { type: 'session'; sessionId: string }

export interface SessionInputLike {
  send(sessionId: string, data: string): Promise<void>
}

export interface CreateChildSessionRequest {
  parentId: string
  projectId: string
  type: SessionType
  title: string
  subagentName?: string | null
  externalSessionId?: string | null
  initialCols?: number
  initialRows?: number
}

export interface SessionSupervisorDeps {
  getSnapshot(): SessionNodeSnapshot[]
  visibilityService: SessionVisibilityReader
  sessionInput: SessionInputLike
  createChildSession(request: CreateChildSessionRequest): Promise<SessionSummary>
  destroySession(sessionId: string): Promise<void>
  getTerminalReplay(sessionId: string): Promise<string>
  waitForSessionStateChange?(sessionId: string, timeoutMs: number): Promise<'updated' | 'timeout'>
  recordSubagentInput?(
    sessionId: string,
    text: string
  ): Promise<SessionSummary | null>
}

export class SessionControlError extends Error {
  constructor(
    readonly code:
      | 'unknown_session'
      | 'forbidden_authority_scope'
      | 'wait_timeout'
      | 'no_completion_yet'
      | 'unknown_subagent'
      | 'ambiguous_subagent_name'
      | 'duplicate_subagent_name'
      | 'subagent_result_forbidden'
      | 'invalid_input_source'
      | 'invalid_result_status'
      | 'interrupt_unsupported',
    message: string
  ) {
    super(message)
    this.name = 'SessionControlError'
  }
}

export class SessionSupervisor {
  constructor(private readonly deps: SessionSupervisorDeps) {}

  listSessions(caller: CallerIdentity): SessionNodeSnapshot[] {
    const all = this.deps.getSnapshot()
    if (caller.type === 'local-user') {
      return all.map(sanitizeSessionNodeSnapshotForGenericProjection)
    }
    const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
    return all
      .filter((n) => visibleIds.includes(n.session.id))
      .map(sanitizeSessionNodeSnapshotForGenericProjection)
  }

  inspectSession(caller: CallerIdentity, targetId: string): SessionNodeSnapshot | null {
    const all = this.deps.getSnapshot()
    const target = all.find((n) => n.session.id === targetId)
    if (!target) {
      return null
    }
    if (caller.type === 'local-user') {
      return sanitizeSessionNodeSnapshotForGenericProjection(target)
    }
    const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
    if (!visibleIds.includes(targetId)) {
      return null
    }
    return sanitizeSessionNodeSnapshotForGenericProjection(target)
  }

  async inputSession(caller: CallerIdentity, targetId: string, text: string): Promise<{ kind: 'dispatched' }> {
    this.requireKnownSession(targetId)
    if (caller.type === 'session') {
      this.assertAuthority(caller.sessionId, targetId, 'input')
    }
    await this.deps.sessionInput.send(targetId, `${text}\r`)
    await this.deps.recordSubagentInput?.(targetId, text)
    return { kind: 'dispatched' }
  }

  async createChildSession(caller: CallerIdentity, request: CreateChildSessionRequest): Promise<SessionSummary> {
    if (caller.type === 'session') {
      this.requireKnownSession(caller.sessionId)
      this.assertAuthority(caller.sessionId, caller.sessionId, 'create')
      return this.deps.createChildSession({
        ...request,
        parentId: caller.sessionId
      })
    }
    if (request.parentId) {
      this.requireKnownSession(request.parentId)
    }
    return this.deps.createChildSession(request)
  }

  async destroySession(caller: CallerIdentity, targetId: string): Promise<void> {
    this.requireKnownSession(targetId)
    if (caller.type === 'session') {
      this.assertAuthority(caller.sessionId, targetId, 'destroy')
    }
    return this.deps.destroySession(targetId)
  }

  getSessionStatus(caller: CallerIdentity, targetId: string): SessionStatusSnapshot {
    const target = this.requireVisibleSession(caller, targetId, 'status')
    return this.toStatusSnapshot(target.session)
  }

  async getSessionOutput(caller: CallerIdentity, targetId: string): Promise<SessionOutputResult> {
    const target = this.requireVisibleSession(caller, targetId, 'read-output')
    this.assertSubagentBodyAuthority(caller, target)
    this.assertReadableCurrentSubagentTerminal(target.session)
    return {
      sessionId: targetId,
      text: await this.deps.getTerminalReplay(targetId)
    }
  }

  async getCompletionReport(caller: CallerIdentity, targetId: string): Promise<SessionCompletionReport> {
    const target = this.requireVisibleSession(caller, targetId, 'report')
    this.assertSubagentBodyAuthority(caller, target)
    this.assertReadableCurrentSubagentTerminal(target.session)
    const report = this.toCompletionReport(target.session)
    if (!report) {
      throw new SessionControlError('no_completion_yet', 'no_completion_yet')
    }
    return report
  }

  async waitForSession(
    caller: CallerIdentity,
    targetId: string,
    options: SessionWaitOptions = {}
  ): Promise<SessionWaitResult> {
    const initialTarget = this.requireVisibleSession(caller, targetId, 'wait')
    this.assertSubagentBodyAuthority(caller, initialTarget)
    const timeoutMs = Math.max(0, options.timeoutMs ?? 300_000)

    if (!this.hasReadableTerminalResult(targetId)) {
      const waitResult = await this.waitUntilTerminal(targetId, timeoutMs)
      if (waitResult === 'timeout') {
        throw new SessionControlError('wait_timeout', 'wait_timeout')
      }
    }

    const node = this.requireVisibleSession(caller, targetId, 'wait')
    this.assertSubagentBodyAuthority(caller, node)
    this.assertReadableCurrentSubagentTerminal(node.session)
    const output = await this.getSessionOutput(caller, targetId)
    const report = this.toCompletionReport(node.session)
    return {
      session: sanitizeSessionNodeSnapshotForGenericProjection(node),
      status: this.toStatusSnapshot(node.session),
      output,
      report
    }
  }

  private assertAuthority(
    viewerId: string,
    targetId: string,
    action: 'inspect' | 'status' | 'report' | 'prompt' | 'input' | 'create' | 'destroy' | 'wait' | 'read-output'
      | 'subagentInput' | 'subagentWait' | 'subagentInterrupt' | 'subagentDestroy' | 'submitOwnResult'
  ): void {
    const result = this.deps.visibilityService.checkAuthority(viewerId, targetId, action)
    if (!result.allowed) {
      throw new SessionControlError(
        this.normalizeDeniedReason(result.reason),
        result.reason ?? 'forbidden_authority_scope'
      )
    }
  }

  private requireKnownSession(sessionId: string): SessionNodeSnapshot {
    const session = this.deps.getSnapshot().find((node) => node.session.id === sessionId)
    if (!session) {
      throw new SessionControlError('unknown_session', 'unknown_session')
    }
    return session
  }

  private requireVisibleSession(
    caller: CallerIdentity,
    targetId: string,
    action: 'inspect' | 'status' | 'report' | 'prompt' | 'input' | 'create' | 'destroy' | 'wait' | 'read-output'
      | 'subagentInput' | 'subagentWait' | 'subagentInterrupt' | 'subagentDestroy' | 'submitOwnResult'
  ): SessionNodeSnapshot {
    const target = this.requireKnownSession(targetId)
    if (caller.type === 'session') {
      this.assertAuthority(caller.sessionId, targetId, action)
    }
    return target
  }

  private normalizeDeniedReason(reason: string | undefined): 'unknown_session' | 'forbidden_authority_scope' {
    if (reason === 'unknown_session') {
      return 'unknown_session'
    }
    return 'forbidden_authority_scope'
  }

  private toStatusSnapshot(session: SessionSummary): SessionStatusSnapshot {
    return {
      sessionId: session.id,
      runtimeState: session.runtimeState,
      turnState: session.turnState,
      turnEpoch: session.turnEpoch,
      lastTurnOutcome: session.lastTurnOutcome,
      blockingReason: session.blockingReason,
      failureReason: session.failureReason,
      runtimeExitCode: session.runtimeExitCode,
      runtimeExitReason: session.runtimeExitReason,
      phase: derivePresencePhase({
        runtimeState: session.runtimeState,
        turnState: session.turnState,
        turnEpoch: session.turnEpoch,
        lastTurnOutcome: session.lastTurnOutcome,
        blockingReason: session.blockingReason,
        failureReason: session.failureReason,
        hasUnseenCompletion: session.hasUnseenCompletion,
        runtimeExitCode: session.runtimeExitCode,
        runtimeExitReason: session.runtimeExitReason,
        provider: session.type
      }),
      hasCompletionReport: this.toCompletionReport(session) !== null
    }
  }

  private toCompletionReport(session: SessionSummary): SessionCompletionReport | null {
    const isCompleted = session.lastTurnOutcome === 'completed'
    const isFailed = session.lastTurnOutcome === 'failed'
    const isInterrupted = session.lastTurnOutcome === 'interrupted'
    const isCancelled = session.lastTurnOutcome === 'cancelled'

    if (!isCompleted && !isFailed && !isInterrupted && !isCancelled) {
      return null
    }

    return {
      sessionId: session.id,
      parentSessionId: session.parentSessionId,
      createdBySessionId: session.createdBySessionId,
      turnEpoch: session.turnEpoch,
      outcome: session.lastTurnOutcome,
      summary: session.summary,
      title: session.title,
      blockingReason: session.blockingReason,
      failureReason: session.failureReason,
      runtimeExitCode: session.runtimeExitCode,
      runtimeExitReason: session.runtimeExitReason,
      hasUnseenCompletion: session.hasUnseenCompletion,
      updatedAt: session.updatedAt
    }
  }

  private assertSubagentBodyAuthority(caller: CallerIdentity, target: SessionNodeSnapshot): void {
    if (target.session.parentSessionId === null) {
      return
    }

    if (!this.canReadSubagentFullBody(caller, target)) {
      throw new SessionControlError('forbidden_authority_scope', 'forbidden_authority_scope')
    }
  }

  private assertReadableCurrentSubagentTerminal(session: SessionSummary): void {
    if (session.parentSessionId === null) {
      return
    }

    if (!this.hasCurrentSubagentTerminalResult(session)) {
      throw new SessionControlError('no_completion_yet', 'no_completion_yet')
    }
  }

  private canReadSubagentFullBody(caller: CallerIdentity, target: SessionNodeSnapshot): boolean {
    if (caller.type === 'local-user') {
      return true
    }

    const callerId = caller.sessionId
    const targetId = target.session.id
    if (callerId === targetId) {
      return true
    }

    const byId = new Map(this.deps.getSnapshot().map((node) => [node.session.id, node]))
    let cursorId: string | null = target.session.parentSessionId
    while (cursorId) {
      if (cursorId === callerId) {
        return true
      }
      const parent = byId.get(cursorId)
      if (!parent) {
        break
      }
      cursorId = parent.session.parentSessionId
    }

    return false
  }

  private hasReadableTerminalResult(sessionId: string): boolean {
    const node = this.deps.getSnapshot().find((candidate) => candidate.session.id === sessionId)
    return !!node && this.hasCurrentTerminalResult(node.session)
  }

  private hasCurrentTerminalResult(session: SessionSummary): boolean {
    if (this.toCompletionReport(session) === null) {
      return false
    }

    if (session.parentSessionId === null) {
      return true
    }

    return this.hasCurrentSubagentTerminalResult(session)
  }

  private hasCurrentSubagentTerminalResult(session: SessionSummary): boolean {
    if (session.archived) {
      return false
    }

    const inputEpoch = session.subagentInputEpoch ?? 0
    if (inputEpoch === 0) {
      return true
    }

    if (session.subagentLatestInputStateSequence === undefined) {
      return true
    }

    return session.lastStateSequence > session.subagentLatestInputStateSequence
  }

  private async waitUntilTerminal(sessionId: string, timeoutMs: number): Promise<'updated' | 'timeout'> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() <= deadline) {
      if (this.hasReadableTerminalResult(sessionId)) {
        return 'updated'
      }

      if (this.deps.waitForSessionStateChange) {
        const remaining = Math.max(0, deadline - Date.now())
        const result = await this.deps.waitForSessionStateChange(
          sessionId,
          Math.min(SESSION_WAIT_STATE_CHANGE_SLICE_MS, remaining)
        )
        if (result === 'timeout') {
          if (this.hasReadableTerminalResult(sessionId)) {
            return 'updated'
          }
          if (Date.now() >= deadline) {
            return 'timeout'
          }
          continue
        }
        continue
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))))
    }

    return this.hasReadableTerminalResult(sessionId) ? 'updated' : 'timeout'
  }
}
