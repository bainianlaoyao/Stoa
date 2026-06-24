import type {
  FailureReason,
  SessionRuntimeState,
  SessionStatePatchEvent,
  SessionSummary,
  SessionType,
  TurnOutcome,
  TurnState
} from './project-session'
import type { BlockingReason, SessionPresencePhase } from './observability'

export interface SessionPresenceInput {
  runtimeState: SessionRuntimeState
  turnState: TurnState
  turnEpoch: number
  lastTurnOutcome: TurnOutcome
  blockingReason: BlockingReason | null
  failureReason: FailureReason | null
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  provider: SessionType
}

export function derivePresencePhase(input: SessionPresenceInput): SessionPresencePhase {
  if (input.runtimeState === 'failed_to_start') {
    return 'failure'
  }

  if (input.runtimeExitReason === 'failed') {
    return 'failure'
  }

  if (input.failureReason !== null) {
    return 'failure'
  }

  if (input.runtimeState === 'created' || input.runtimeState === 'starting') {
    return 'ready'
  }

  if (input.runtimeState !== 'alive') {
    if (input.hasUnseenCompletion && input.lastTurnOutcome === 'completed') {
      return 'complete'
    }

    return 'ready'
  }

  if (input.blockingReason !== null && input.turnState === 'running') {
    return 'blocked'
  }

  if (input.hasUnseenCompletion && input.lastTurnOutcome === 'completed') {
    return 'complete'
  }

  if (input.runtimeState === 'alive' && input.turnState === 'running') {
    return 'running'
  }

  return 'ready'
}

export function reduceSessionState(
  session: SessionSummary,
  patch: SessionStatePatchEvent,
  nowIso: string
): SessionSummary {
  if (patch.sequence <= session.lastStateSequence) {
    return session
  }

  const next: SessionSummary = {
    ...session,
    lastStateSequence: patch.sequence,
    updatedAt: nowIso
  }

  switch (patch.intent) {
    case 'runtime.created':
      next.runtimeState = 'created'
      resetLaunchBoundary(next)
      break
    case 'runtime.starting':
      next.runtimeState = 'starting'
      resetLaunchBoundary(next)
      break
    case 'runtime.alive':
      next.runtimeState = 'alive'
      next.runtimeExitCode = null
      next.runtimeExitReason = null
      if (next.failureReason === 'runtime_crash' || next.failureReason === 'failed_to_start') {
        next.failureReason = null
      }
      applyExternalSessionId(next, patch)
      break
    case 'runtime.exited_clean':
      next.runtimeState = 'exited'
      next.runtimeExitReason = 'clean'
      next.runtimeExitCode = patch.runtimeExitCode ?? 0
      break
    case 'runtime.exited_failed':
      next.runtimeState = 'exited'
      next.runtimeExitReason = 'failed'
      next.runtimeExitCode = patch.runtimeExitCode ?? 1
      next.failureReason = next.failureReason ?? 'runtime_crash'
      break
    case 'runtime.failed_to_start':
      next.runtimeState = 'failed_to_start'
      next.runtimeExitReason = 'failed'
      next.runtimeExitCode = patch.runtimeExitCode ?? 1
      next.turnState = 'idle'
      next.blockingReason = null
      next.failureReason = patch.failureReason ?? 'failed_to_start'
      next.hasUnseenCompletion = false
      next.lastTurnOutcome = 'failed'
      break
    case 'agent.turn_started':
      if (!canAdvanceTurn(session, patch.turnEpoch)) {
        break
      }
      openTurn(next, patch.turnEpoch)
      applyExternalSessionId(next, patch)
      break
    case 'agent.tool_started':
      if (shouldAdvanceTurnFromProvider(session, patch.turnEpoch)) {
        openTurn(next, patch.turnEpoch)
        break
      }
      if (shouldResumeBlockedTurnFromContinuation(session, patch)) {
        next.blockingReason = null
      }
      break
    case 'agent.tool_completed':
      break
    case 'agent.permission_requested':
      if (shouldAdvanceTurnFromProvider(session, patch.turnEpoch)) {
        openTurn(next, patch.turnEpoch)
      } else if (!isCurrentRunningTurn(session, patch.turnEpoch)) {
        break
      }
      next.blockingReason = patch.blockingReason ?? session.blockingReason
      break
    case 'agent.permission_resolved':
      if (!isCurrentRunningTurn(session, patch.turnEpoch) || session.blockingReason === null) {
        break
      }
      next.blockingReason = null
      break
    case 'agent.turn_completed':
      if (isCurrentTurnTerminal(session, patch.turnEpoch)) {
        break
      }
      if (!isCurrentRunningTurn(session, patch.turnEpoch) && !shouldAdvanceTurnFromProvider(session, patch.turnEpoch)) {
        break
      }
      next.turnEpoch = patch.turnEpoch
      next.turnState = 'idle'
      next.lastTurnOutcome = 'completed'
      next.blockingReason = null
      next.failureReason = null
      next.hasUnseenCompletion = true
      break
    case 'agent.turn_interrupted':
      if (!isCurrentRunningTurn(session, patch.turnEpoch) && !shouldAdvanceTurnFromProvider(session, patch.turnEpoch)) {
        break
      }
      next.turnEpoch = patch.turnEpoch
      next.turnState = 'idle'
      next.lastTurnOutcome = 'interrupted'
      next.blockingReason = null
      next.failureReason = null
      next.hasUnseenCompletion = false
      break
    case 'agent.turn_cancelled':
      if (!isCurrentRunningTurn(session, patch.turnEpoch) && !shouldAdvanceTurnFromProvider(session, patch.turnEpoch)) {
        break
      }
      next.turnEpoch = patch.turnEpoch
      next.turnState = 'idle'
      next.lastTurnOutcome = 'cancelled'
      next.blockingReason = null
      next.failureReason = null
      next.hasUnseenCompletion = false
      break
    case 'agent.turn_failed':
      if (isCurrentTurnTerminal(session, patch.turnEpoch)) {
        break
      }
      if (!isCurrentRunningTurn(session, patch.turnEpoch) && !shouldAdvanceTurnFromProvider(session, patch.turnEpoch)) {
        break
      }
      next.turnEpoch = patch.turnEpoch
      next.turnState = 'idle'
      next.lastTurnOutcome = 'failed'
      next.blockingReason = null
      next.failureReason = patch.failureReason ?? session.failureReason ?? 'unknown'
      next.hasUnseenCompletion = false
      break
    case 'agent.completion_seen':
      next.hasUnseenCompletion = false
      break
    case 'agent.recovered':
      next.blockingReason = null
      next.failureReason = null
      if (next.turnState !== 'running') {
        next.lastTurnOutcome = 'none'
      }
      break
  }

  return next
}

function resetLaunchBoundary(next: SessionSummary): void {
  next.turnState = 'idle'
  next.blockingReason = null
  next.failureReason = null
  next.hasUnseenCompletion = false
  next.runtimeExitCode = null
  next.runtimeExitReason = null
  next.lastTurnOutcome = 'none'
}

function applyExternalSessionId(next: SessionSummary, patch: SessionStatePatchEvent): void {
  if (patch.externalSessionId !== undefined) {
    next.externalSessionId = patch.externalSessionId
  }
}

function openTurn(next: SessionSummary, turnEpoch: number): void {
  next.turnState = 'running'
  next.turnEpoch = turnEpoch
  next.lastTurnOutcome = 'none'
  next.blockingReason = null
  next.failureReason = null
  next.hasUnseenCompletion = false
}

function canAdvanceTurn(session: SessionSummary, turnEpoch: number | undefined): turnEpoch is number {
  return session.runtimeState === 'alive'
    && typeof turnEpoch === 'number'
    && turnEpoch > session.turnEpoch
}

function shouldAdvanceTurnFromProvider(session: SessionSummary, turnEpoch: number | undefined): turnEpoch is number {
  return canAdvanceTurn(session, turnEpoch)
    && session.turnState !== 'running'
}

function isCurrentRunningTurn(session: SessionSummary, turnEpoch: number | undefined): turnEpoch is number {
  return session.runtimeState === 'alive'
    && session.turnState === 'running'
    && typeof turnEpoch === 'number'
    && turnEpoch === session.turnEpoch
}

function isCurrentTurnTerminal(session: SessionSummary, turnEpoch: number | undefined): boolean {
  return typeof turnEpoch === 'number'
    && turnEpoch === session.turnEpoch
    && isTerminalOutcome(session.lastTurnOutcome)
}

function shouldResumeBlockedTurnFromContinuation(
  session: SessionSummary,
  patch: SessionStatePatchEvent
): boolean {
  return isCurrentRunningTurn(session, patch.turnEpoch)
    && session.blockingReason !== null
    && patch.sourceEventType === 'claude-code.PreToolUse'
}

function isTerminalOutcome(outcome: TurnOutcome): boolean {
  return outcome === 'interrupted' || outcome === 'cancelled' || outcome === 'failed'
}
