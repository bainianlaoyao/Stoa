import type {
  SessionNodeSnapshot,
  SessionSummary,
  SessionType,
  SubagentDispatchRequest,
  SubagentListItem,
  SubagentResult,
  SubagentResultRequest,
  SubagentResultSource,
  SubagentResultSummary,
  SubagentStopAggregate,
  SubagentStopErrorTarget,
  SubagentStopOverallStatus,
  SubagentStopSuccessTarget,
  SubagentWaitAggregate,
  SubagentWaitCompletedTarget,
  SubagentWaitErrorTarget,
  SubagentWaitMode,
  SubagentWaitOverallStatus,
  SubagentWaitPendingTarget
} from '@shared/project-session'
import type { CallerIdentity, SessionSupervisorDeps } from './session-supervisor'
import type { SessionVisibilityReader } from './session-visibility-service'

const DEFAULT_SHORT_NAME_POOL = ['ryu', 'andy', 'mai', 'saski', 'naruto']

export interface SubagentSupervisorDeps extends SessionSupervisorDeps {
  updateSessionFacade?(sessionId: string, facade: {
    subagentName?: string | null
    subagentInputEpoch?: number
    subagentLatestInputAt?: string | null
    subagentLatestInputStateSequence?: number
    subagentResult?: SubagentResult | null
    subagentResultSummary?: SubagentResultSummary | null
  }): Promise<SessionSummary>
  interruptSession?(sessionId: string): Promise<boolean>
  rollbackDispatchedSession?(sessionId: string): Promise<void>
}

function findRootSessionId(nodes: SessionNodeSnapshot[], sessionId: string): string | null {
  const node = nodes.find(n => n.session.id === sessionId)
  return node?.tree.rootSessionId ?? null
}

function derivePhase(session: SessionSummary): string {
  const runtimeState = session.runtimeState
  if (runtimeState === 'exited' || runtimeState === 'failed_to_start') {
    return 'complete'
  }
  if (session.lastTurnOutcome === 'completed' || session.lastTurnOutcome === 'failed'
    || session.lastTurnOutcome === 'interrupted' || session.lastTurnOutcome === 'cancelled') {
    return 'complete'
  }
  if (session.turnState === 'running') {
    return 'running'
  }
  if (session.blockingReason) {
    return 'blocked'
  }
  return 'ready'
}

function toResultSummary(result: SubagentResult | null | undefined): SubagentResultSummary | null {
  if (!result) return null
  return {
    status: result.status,
    title: result.title,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    hasBody: result.body.length > 0
  }
}

function toSubagentListItem(session: SessionSummary): SubagentListItem {
  return {
    name: session.subagentName ?? '',
    id: session.id,
    parentSessionId: session.parentSessionId!,
    type: session.type,
    title: session.title,
    phase: derivePhase(session),
    resultStatus: session.subagentResultSummary?.status ?? null,
    updatedAt: session.updatedAt
  }
}

export function allocateSubagentShortName(
  nodes: SessionNodeSnapshot[],
  rootSessionId: string,
  requestedName?: string
): string {
  const treeNodes = nodes.filter(n => n.tree.rootSessionId === rootSessionId)
  const usedNames = new Set<string>()
  for (const node of treeNodes) {
    const name = node.session.subagentName
    if (name) {
      usedNames.add(name)
    }
  }

  if (requestedName) {
    if (usedNames.has(requestedName)) {
      throw Object.assign(new Error(`Short name "${requestedName}" is already in use in this session tree.`), {
        code: 'duplicate_subagent_name' as const
      })
    }
    return requestedName
  }

  for (const poolName of DEFAULT_SHORT_NAME_POOL) {
    if (!usedNames.has(poolName)) {
      return poolName
    }
  }

  let suffix = 2
  while (suffix < 1000) {
    for (const poolName of DEFAULT_SHORT_NAME_POOL) {
      const candidate = `${poolName}${suffix}`
      if (!usedNames.has(candidate)) {
        return candidate
      }
    }
    suffix++
  }

  throw Object.assign(new Error('Short name pool exhausted.'), {
    code: 'internal_error' as const
  })
}

export class SubagentSupervisor {
  constructor(private readonly deps: SubagentSupervisorDeps) {}

  async recordInput(
    sessionId: string,
    _text: string
  ): Promise<SessionSummary | null> {
    const node = this.deps.getSnapshot().find((candidate) => candidate.session.id === sessionId)
    if (!node || node.session.parentSessionId === null) {
      return null
    }

    const currentFacade = this.getFacadeState(node.session)
    const newEpoch = (currentFacade.subagentInputEpoch ?? 0) + 1
    const now = new Date().toISOString()

    if (!this.deps.updateSessionFacade) {
      return node.session
    }

    return await this.deps.updateSessionFacade(sessionId, {
      subagentInputEpoch: newEpoch,
      subagentLatestInputAt: now,
      subagentLatestInputStateSequence: node.session.lastStateSequence,
      subagentResult: null,
      subagentResultSummary: null
    })
  }

  // ── Short name allocation ──

  private allocateShortName(rootSessionId: string, requestedName?: string): string {
    return allocateSubagentShortName(this.deps.getSnapshot(), rootSessionId, requestedName)
  }

  // ── Target resolution ──

  private resolveTarget(
    caller: CallerIdentity,
    target: string
  ): { node: SessionNodeSnapshot; name: string } {
    const nodes = this.deps.getSnapshot()

    // Try exact session ID match first
    const exactMatch = nodes.find(n => n.session.id === target)
    if (exactMatch) {
      if (!exactMatch.session.parentSessionId) {
        throw Object.assign(
          new Error(`Session ${target} is a root/top-level session, not a subagent.`),
          { code: 'unknown_subagent' as const }
        )
      }
      // Visibility check
      if (caller.type === 'session') {
        const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
        if (!visibleIds.includes(target)) {
          throw Object.assign(
            new Error(`Unknown subagent: ${target}`),
            { code: 'unknown_subagent' as const }
          )
        }
      }
      return { node: exactMatch, name: exactMatch.session.subagentName ?? target }
    }

    // Try short name resolution in caller visibility scope
    const visibleNodes = caller.type === 'session'
      ? nodes.filter(n => {
          const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
          return visibleIds.includes(n.session.id)
        })
      : nodes

    const nameMatches = visibleNodes.filter(
      n => n.session.parentSessionId && n.session.subagentName === target
    )

    if (nameMatches.length === 0) {
      throw Object.assign(
        new Error(`Unknown subagent: ${target}`),
        { code: 'unknown_subagent' as const }
      )
    }

    if (nameMatches.length > 1) {
      throw Object.assign(
        new Error(`Ambiguous subagent name "${target}". Use the formal session ID instead.`),
        { code: 'ambiguous_subagent_name' as const }
      )
    }

    const matched = nameMatches[0]
    return { node: matched, name: matched.session.subagentName ?? target }
  }

  // ── Full result body read authority ──

  private canReadFullBody(caller: CallerIdentity, targetNode: SessionNodeSnapshot): boolean {
    // local-user: always yes
    if (caller.type === 'local-user') return true

    const callerId = caller.sessionId
    const targetId = targetNode.session.id

    // self: yes
    if (callerId === targetId) return true

    // ancestor: yes (check if target is descendant of caller)
    const nodes = this.deps.getSnapshot()
    const byId = new Map(nodes.map(n => [n.session.id, n]))
    let cursorId: string | null = targetNode.session.parentSessionId
    while (cursorId) {
      if (cursorId === callerId) return true
      const parent = byId.get(cursorId)
      if (!parent) break
      cursorId = parent.session.parentSessionId
    }

    // descendant / peer / sibling descendant: no
    return false
  }

  // ── Dispatch ──

  async dispatch(
    caller: CallerIdentity,
    request: SubagentDispatchRequest
  ): Promise<{ subagent: SubagentListItem }> {
    if (!request.text || !request.text.trim()) {
      throw Object.assign(
        new Error('Input text must not be blank.'),
        { code: 'invalid_input_source' as const }
      )
    }

    const nodes = this.deps.getSnapshot()
    let parentId: string
    let projectId: string

    if (caller.type === 'session') {
      const callerNode = nodes.find(n => n.session.id === caller.sessionId)
      if (!callerNode) {
        throw Object.assign(new Error('Unknown caller session.'), { code: 'unknown_session' as const })
      }
      parentId = caller.sessionId
      projectId = callerNode.session.projectId
    } else {
      // local-user must specify parent
      if (!request.parentId) {
        throw Object.assign(
          new Error('local-user must specify parentId for subagent dispatch.'),
          { code: 'invalid_parent_session' as const }
        )
      }
      const parentNode = nodes.find(n => n.session.id === request.parentId)
      if (!parentNode) {
        throw Object.assign(new Error(`Unknown parent session: ${request.parentId}`), { code: 'unknown_session' as const })
      }
      if (!parentNode.session.parentSessionId && !parentNode.session.parentSessionId) {
        // Root session as parent is fine for local-user
      }
      parentId = request.parentId
      projectId = parentNode.session.projectId
    }

    const parentRootId = findRootSessionId(nodes, parentId) ?? parentId

    let allocatedName: string
    try {
      allocatedName = this.allocateShortName(parentRootId, request.name)
    } catch (error: any) {
      throw error
    }

    let childSession: SessionSummary
    try {
      childSession = await this.deps.createChildSession({
        parentId,
        projectId,
        type: request.type,
        title: request.title ?? '',
        subagentName: allocatedName,
        initialCols: request.initialCols,
        initialRows: request.initialRows
      })
    } catch (error: any) {
      throw error
    }

    // Deliver initial input
    try {
      await this.deps.sessionInput.send(childSession.id, `${request.text}\r`)
    } catch (error: any) {
      // Cleanup on input delivery failure
      try {
        if (this.deps.rollbackDispatchedSession) {
          await this.deps.rollbackDispatchedSession(childSession.id)
        } else {
          await this.deps.destroySession(childSession.id)
        }
      } catch { /* best effort */ }
      throw error
    }

    // Update epoch to 1 after successful input delivery
    const now = new Date().toISOString()
    try {
      if (this.deps.updateSessionFacade) {
        childSession = await this.deps.updateSessionFacade(childSession.id, {
          subagentInputEpoch: 1,
          subagentLatestInputAt: now,
          subagentLatestInputStateSequence: childSession.lastStateSequence
        })
      }
    } catch (error: any) {
      try {
        if (this.deps.rollbackDispatchedSession) {
          await this.deps.rollbackDispatchedSession(childSession.id)
        } else {
          await this.deps.destroySession(childSession.id)
        }
      } catch { /* best effort */ }
      throw error
    }

    return {
      subagent: toSubagentListItem({ ...childSession, subagentName: childSession.subagentName ?? allocatedName })
    }
  }

  // ── Wait ──

  async wait(
    caller: CallerIdentity,
    targets: string[],
    mode: SubagentWaitMode = 'all',
    timeoutMs: number | null = null
  ): Promise<SubagentWaitAggregate> {
    const startTime = Date.now()
    const effectiveTimeout = timeoutMs ?? 300_000
    const results: Array<SubagentWaitCompletedTarget | SubagentWaitPendingTarget | SubagentWaitErrorTarget> = []
    const settledIds = new Set<string>()

    // Phase 1: Resolve all targets
    const resolvedTargets: Array<{
      target: string
      node: SessionNodeSnapshot
      name: string
    } | { target: string; error: SubagentWaitErrorTarget }> = []

    for (const t of targets) {
      try {
        const resolved = this.resolveTarget(caller, t)
        resolvedTargets.push({ target: t, ...resolved })
      } catch (error: any) {
        resolvedTargets.push({
          target: t,
          error: {
            target: t,
            state: 'error' as const,
            error: {
              code: error.code ?? 'unknown_subagent',
              message: error.message ?? String(error),
              nextSteps: error.code === 'unknown_subagent'
                ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with a visible name or formal ID.']
                : error.code === 'ambiguous_subagent_name'
                  ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with the formal session ID.']
                  : null
            }
          }
        })
      }
    }

    // Phase 2: Collect completed targets and check body read authority
    const pendingTargets: Array<{ target: string; node: SessionNodeSnapshot; name: string }> = []

    for (const entry of resolvedTargets) {
      if ('error' in entry) {
        results.push(entry.error)
        continue
      }

      const { target, node, name } = entry
      const session = node.session

      // Check if destroyed/archived - host lifecycle state
      if (session.archived) {
        results.push({
          target,
          name,
          id: session.id,
          state: 'completed',
          status: 'destroyed',
          source: 'host',
          title: session.title,
          body: 'Subagent was destroyed before submitting a current result.',
          updatedAt: session.updatedAt
        })
        settledIds.add(session.id)
        continue
      }

      // Check body read authority
      if (!this.canReadFullBody(caller, node)) {
        results.push({
          target,
          state: 'error',
          error: {
            code: 'forbidden_authority_scope',
            message: `Caller does not have full result body read authority for subagent ${name}.`,
            nextSteps: ['Only local-user, self, and ancestors can read full result bodies.']
          }
        })
        settledIds.add(session.id)
        continue
      }

      // Check for current-epoch explicit result
      const facadeState = this.getFacadeState(session)
      const inputEpoch = facadeState.subagentInputEpoch ?? 0

      if (facadeState.subagentResult && facadeState.subagentResult.inputEpoch === inputEpoch) {
        const result = facadeState.subagentResult
        results.push({
          target,
          name,
          id: session.id,
          state: 'completed',
          status: result.status,
          source: 'explicit',
          title: result.title,
          body: result.body,
          updatedAt: result.updatedAt
        })
        settledIds.add(session.id)
        continue
      }

      // Check for terminal outcome
      if (this.isTerminalSession(session)) {
        const terminalAfterInput = inputEpoch === 0
          || facadeState.subagentLatestInputStateSequence === undefined
          || session.lastStateSequence > facadeState.subagentLatestInputStateSequence

        if (terminalAfterInput) {
          const outcome = session.lastTurnOutcome
          const status = outcome === 'failed' ? 'failed'
            : outcome === 'cancelled' ? 'cancelled'
            : outcome === 'interrupted' ? 'interrupted'
            : 'completed'
          let body: string
          try {
            body = await this.deps.getTerminalReplay(session.id)
          } catch {
            body = ''
          }
          results.push({
            target,
            name,
            id: session.id,
            state: 'completed',
            status,
            source: 'terminal',
            title: session.title,
            body: body || 'No terminal output available.',
            updatedAt: session.updatedAt
          })
          settledIds.add(session.id)
          continue
        }
      }

      // Still pending
      pendingTargets.push({ target, node, name })
    }

    // Phase 3: Wait for pending targets if needed
    if (pendingTargets.length > 0) {
      const deadline = startTime + effectiveTimeout
      const completedCount = results.filter(r => r.state === 'completed').length

      const shouldWait = mode === 'all'
        || (mode === 'any' && completedCount === 0)

      if (shouldWait) {
        while (Date.now() < deadline) {
          // Re-snapshot
          const freshNodes = this.deps.getSnapshot()
          let allResolved = true

          for (const pending of pendingTargets) {
            if (settledIds.has(pending.node.session.id)) {
              continue
            }

            const freshNode = freshNodes.find(n => n.session.id === pending.node.session.id)
            if (!freshNode) {
              allResolved = false
              continue
            }

            const session = freshNode.session

            if (session.archived) {
              results.push({
                target: pending.target,
                name: pending.name,
                id: session.id,
                state: 'completed',
                status: 'destroyed',
                source: 'host',
                title: session.title,
                body: 'Subagent was destroyed before submitting a current result.',
                updatedAt: session.updatedAt
              })
              settledIds.add(session.id)
              pending.node = freshNode
              continue
            }

            const facadeState = this.getFacadeState(session)
            const inputEpoch = facadeState.subagentInputEpoch ?? 0

            if (facadeState.subagentResult && facadeState.subagentResult.inputEpoch === inputEpoch) {
              const result = facadeState.subagentResult
              results.push({
                target: pending.target,
                name: pending.name,
                id: session.id,
                state: 'completed',
                status: result.status,
                source: 'explicit',
                title: result.title,
                body: result.body,
                updatedAt: result.updatedAt
              })
              settledIds.add(session.id)
              pending.node = freshNode
              continue
            }

            if (this.isTerminalSession(session)) {
              const terminalAfterInput = inputEpoch === 0
                || facadeState.subagentLatestInputStateSequence === undefined
                || session.lastStateSequence > facadeState.subagentLatestInputStateSequence

              if (terminalAfterInput) {
                const outcome = session.lastTurnOutcome
                const status = outcome === 'failed' ? 'failed'
                  : outcome === 'cancelled' ? 'cancelled'
                  : outcome === 'interrupted' ? 'interrupted'
                  : 'completed'
                let body: string
                try {
                  body = await this.deps.getTerminalReplay(session.id)
                } catch {
                  body = ''
                }
                results.push({
                  target: pending.target,
                  name: pending.name,
                  id: session.id,
                  state: 'completed',
                  status,
                  source: 'terminal',
                  title: session.title,
                  body: body || 'No terminal output available.',
                  updatedAt: session.updatedAt
                })
                settledIds.add(session.id)
                pending.node = freshNode
                continue
              }
            }

            allResolved = false
          }

          if (allResolved) break

          const completedNow = results.filter(r => r.state === 'completed').length
          if (mode === 'any' && completedNow > completedCount) break

          if (this.deps.waitForSessionStateChange) {
            const remaining = Math.max(0, deadline - Date.now())
            if (remaining <= 0) break
            await this.deps.waitForSessionStateChange(
              pendingTargets[0].node.session.id,
              Math.min(250, remaining)
            )
          } else {
            await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
          }
        }
      }
    }

    // Add remaining pending targets
    const resolvedIds = new Set(results.map(r => 'id' in r ? r.id : undefined))
    for (const pending of pendingTargets) {
      if (!resolvedIds.has(pending.node.session.id)) {
        results.push({
          target: pending.target,
          name: pending.name,
          id: pending.node.session.id,
          state: 'pending',
          phase: derivePhase(pending.node.session)
        })
      }
    }

    const completedTargets = results.filter(r => r.state === 'completed')
    const conditionMet = mode === 'all'
      ? completedTargets.length === targets.length
      : completedTargets.length > 0

    const hasError = results.some(r => r.state === 'error')
    const hasPending = results.some(r => r.state === 'pending')

    let overallStatus: SubagentWaitOverallStatus
    if (conditionMet && !hasPending && !hasError) {
      overallStatus = 'complete'
    } else if (conditionMet && (hasPending || hasError)) {
      overallStatus = 'partial'
    } else if (hasPending) {
      overallStatus = 'timeout'
    } else {
      overallStatus = 'failed'
    }

    return {
      mode,
      conditionMet,
      overallStatus,
      timeoutMs: effectiveTimeout,
      elapsedMs: Date.now() - startTime,
      targets: results
    }
  }

  // ── Input ──

  async input(
    caller: CallerIdentity,
    target: string,
    text: string
  ): Promise<{ delivered: true; subagent: SubagentListItem; updatedAt: string }> {
    if (!text || !text.trim()) {
      throw Object.assign(
        new Error('Input text must not be blank.'),
        { code: 'invalid_input_source' as const }
      )
    }

    const resolved = this.resolveTarget(caller, target)
    const session = resolved.node.session

    // Authority check for session callers
    if (caller.type === 'session') {
      const authResult = this.deps.visibilityService.checkAuthority(
        caller.sessionId, session.id, 'subagentInput'
      )
      if (!authResult.allowed) {
        throw Object.assign(
          new Error(`Not allowed to send input to subagent ${resolved.name}.`),
          { code: authResult.reason === 'unknown_session' ? 'unknown_subagent' as const : 'forbidden_authority_scope' as const }
        )
      }
    }

    await this.deps.sessionInput.send(session.id, `${text}\r`)
    const now = new Date().toISOString()
    const updatedSession = await this.recordInput(session.id, text) ?? session

    return {
      delivered: true,
      subagent: toSubagentListItem(updatedSession),
      updatedAt: now
    }
  }

  // ── Result (child-only self-report) ──

  async result(
    caller: CallerIdentity,
    request: SubagentResultRequest
  ): Promise<SubagentResultSummary> {
    if (!request.text || !request.text.trim()) {
      throw Object.assign(
        new Error('Result text must not be blank.'),
        { code: 'invalid_input_source' as const }
      )
    }

    const validStatuses: ReadonlySet<string> = new Set(['completed', 'failed', 'blocked', 'cancelled'])
    if (!validStatuses.has(request.status)) {
      throw Object.assign(
        new Error(`Invalid result status: ${request.status}. Must be completed, failed, blocked, or cancelled.`),
        { code: 'invalid_result_status' as const }
      )
    }

    // Only child/subagent sessions can submit result
    if (caller.type === 'local-user') {
      throw Object.assign(
        new Error('local-user cannot submit subagent results. Only child/subagent sessions can report their own results.'),
        { code: 'subagent_result_forbidden' as const }
      )
    }

    const nodes = this.deps.getSnapshot()
    const callerNode = nodes.find(n => n.session.id === caller.sessionId)
    if (!callerNode) {
      throw Object.assign(new Error('Unknown caller session.'), { code: 'unknown_session' as const })
    }

    if (!callerNode.session.parentSessionId) {
      throw Object.assign(
        new Error('Root/top-level sessions cannot submit subagent results. Only child/subagent sessions can report their own results.'),
        { code: 'subagent_result_forbidden' as const }
      )
    }

    const session = callerNode.session
    const facadeState = this.getFacadeState(session)
    const inputEpoch = facadeState.subagentInputEpoch ?? 0
    const now = new Date().toISOString()
    const parentSessionId = session.parentSessionId
    if (!parentSessionId) {
      throw Object.assign(
        new Error('Root/top-level sessions cannot submit subagent results. Only child/subagent sessions can report their own results.'),
        { code: 'subagent_result_forbidden' as const }
      )
    }

    const newResult: SubagentResult = {
      sessionId: session.id,
      parentSessionId,
      inputEpoch,
      status: request.status as SubagentResult['status'],
      title: request.title ?? null,
      body: request.text,
      createdAt: facadeState.subagentResult?.createdAt ?? now,
      updatedAt: now
    }

    const summary = toResultSummary(newResult)!

    if (this.deps.updateSessionFacade) {
      await this.deps.updateSessionFacade(session.id, {
        subagentResult: newResult,
        subagentResultSummary: summary
      })
    }

    return summary
  }

  // ── Stop ──

  async stop(
    caller: CallerIdentity,
    targets: string[],
    mode: 'interrupt' | 'destroy' = 'interrupt'
  ): Promise<SubagentStopAggregate> {
    const results: Array<SubagentStopSuccessTarget | SubagentStopErrorTarget> = []

    for (const t of targets) {
      try {
        const resolved = this.resolveTarget(caller, t)
        const session = resolved.node.session

        // Authority check
        if (caller.type === 'session') {
          const action = mode === 'interrupt' ? 'subagentInterrupt' : 'subagentDestroy'
          const authResult = this.deps.visibilityService.checkAuthority(
            caller.sessionId, session.id, action
          )
          if (!authResult.allowed) {
            results.push({
              target: t,
              mode,
              state: 'error',
              error: {
                code: authResult.reason === 'unknown_session' ? 'unknown_subagent' : 'forbidden_authority_scope',
                message: `Not allowed to ${mode} subagent ${resolved.name}.`,
                nextSteps: mode === 'interrupt'
                  ? ['Use `subagent stop --mode destroy` if cleanup is required.']
                  : null
              }
            })
            continue
          }
        }

        if (mode === 'interrupt') {
          if (this.deps.interruptSession) {
            const interrupted = await this.deps.interruptSession(session.id)
            if (!interrupted) {
              results.push({
                target: t,
                mode,
                state: 'error',
                error: {
                  code: 'interrupt_unsupported',
                  message: `Interrupt is not supported for subagent ${resolved.name}.`,
                  nextSteps: ['Use `subagent stop --mode destroy` if cleanup is required.']
                }
              })
              continue
            }
          } else {
            results.push({
              target: t,
              mode,
              state: 'error',
              error: {
                code: 'interrupt_unsupported',
                message: `Interrupt is not supported for subagent ${resolved.name}.`,
                nextSteps: ['Use `subagent stop --mode destroy` if cleanup is required.']
              }
            })
            continue
          }
          const now = new Date().toISOString()
          results.push({
            target: t,
            name: resolved.name,
            id: session.id,
            mode,
            state: 'interrupt_requested',
            updatedAt: now
          })
        } else {
          await this.deps.destroySession(session.id)
          const now = new Date().toISOString()
          results.push({
            target: t,
            name: resolved.name,
            id: session.id,
            mode,
            state: 'destroyed',
            updatedAt: now
          })
        }
      } catch (error: any) {
        results.push({
          target: t,
          mode,
          state: 'error',
          error: {
            code: error.code ?? 'unknown_subagent',
            message: error.message ?? String(error),
            nextSteps: error.code === 'unknown_subagent'
              ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with a visible name or formal ID.']
              : null
          }
        })
      }
    }

    const successCount = results.filter(r => r.state !== 'error').length
    const errorCount = results.filter(r => r.state === 'error').length

    let overallStatus: SubagentStopOverallStatus
    if (errorCount === 0) {
      overallStatus = 'complete'
    } else if (successCount > 0) {
      overallStatus = 'partial'
    } else {
      overallStatus = 'failed'
    }

    return { mode, overallStatus, targets: results }
  }

  // ── List ──

  list(caller: CallerIdentity): SubagentListItem[] {
    const nodes = this.deps.getSnapshot()

    let visibleNodes: SessionNodeSnapshot[]
    if (caller.type === 'local-user') {
      visibleNodes = nodes
    } else {
      const visibleIds = this.deps.visibilityService.visibleSessionIds(caller.sessionId)
      visibleNodes = nodes.filter(n => visibleIds.includes(n.session.id))
    }

    // Only sessions with parentSessionId != null are subagents
    return visibleNodes
      .filter(n => n.session.parentSessionId !== null && !n.session.archived)
      .map(n => toSubagentListItem(n.session))
  }

  // ── Helpers ──

  private getFacadeState(session: SessionSummary): {
    subagentInputEpoch?: number
    subagentLatestInputAt?: string
    subagentLatestInputStateSequence?: number
    subagentResult?: SubagentResult | null
  } {
    return {
      subagentInputEpoch: session.subagentInputEpoch,
      subagentLatestInputAt: session.subagentLatestInputAt,
      subagentLatestInputStateSequence: session.subagentLatestInputStateSequence,
      subagentResult: session.subagentResult
    }
  }

  private isTerminalSession(session: SessionSummary): boolean {
    if (session.runtimeState === 'exited' || session.runtimeState === 'failed_to_start') {
      return true
    }
    const isCompleted = session.lastTurnOutcome === 'completed'
    const isFailed = session.lastTurnOutcome === 'failed'
    const isInterrupted = session.lastTurnOutcome === 'interrupted'
    const isCancelled = session.lastTurnOutcome === 'cancelled'
    return isCompleted || isFailed || isInterrupted || isCancelled
  }
}
