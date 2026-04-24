import type {
  SessionAgentState,
  SessionRuntimeState,
  SessionStatePatchEvent,
  SessionSummary,
  SessionType
} from './project-session'
import type { SessionPresencePhase } from './observability'

export interface SessionPresenceInput {
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  provider: SessionType
}

export function derivePresencePhase(input: SessionPresenceInput): SessionPresencePhase {
  if (input.runtimeState === 'failed_to_start') {
    return 'failed'
  }

  if (input.runtimeState === 'exited' && input.runtimeExitReason === 'failed') {
    return 'failed'
  }

  if (input.agentState === 'error') {
    return 'failed'
  }

  if (input.runtimeState === 'created' || input.runtimeState === 'starting') {
    return 'preparing'
  }

  if (input.agentState === 'blocked') {
    return 'blocked'
  }

  if (input.agentState === 'idle' && input.hasUnseenCompletion) {
    return 'complete'
  }

  if (input.runtimeState === 'exited' && input.runtimeExitReason === 'clean') {
    return 'exited'
  }

  if (input.agentState === 'working') {
    return 'running'
  }

  if (input.agentState === 'idle') {
    return 'ready'
  }

  if (input.runtimeState === 'alive' && input.agentState === 'unknown' && input.provider === 'shell') {
    return 'running'
  }

  if (input.runtimeState === 'alive' && input.agentState === 'unknown' && input.provider !== 'shell') {
    return 'ready'
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
      resetStartingState(next)
      break
    case 'runtime.starting':
      next.runtimeState = 'starting'
      resetStartingState(next)
      break
    case 'runtime.alive':
      next.runtimeState = 'alive'
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
      break
    case 'runtime.failed_to_start':
      next.runtimeState = 'failed_to_start'
      next.runtimeExitReason = 'failed'
      next.runtimeExitCode = patch.runtimeExitCode ?? 1
      next.agentState = 'error'
      next.blockingReason = null
      break
    case 'agent.turn_started':
      markAgentWorkingIfRuntimeAlive(session, next)
      break
    case 'agent.tool_started':
      if (patch.sourceEventType === 'post_permission_continuation') {
        markAgentWorkingIfRuntimeAlive(session, next)
      } else if (session.agentState !== 'blocked') {
        markAgentWorkingIfRuntimeAlive(session, next)
      }
      break
    case 'agent.turn_completed':
      if (session.agentState === 'unknown' || session.agentState === 'working') {
        next.agentState = 'idle'
        next.hasUnseenCompletion = true
      }
      break
    case 'agent.completion_seen':
      next.hasUnseenCompletion = false
      break
    case 'agent.permission_requested':
      next.agentState = 'blocked'
      next.blockingReason = patch.blockingReason ?? null
      break
    case 'agent.permission_resolved':
      if (session.agentState === 'blocked') {
        next.agentState = 'working'
        next.blockingReason = null
      }
      break
    case 'agent.turn_failed':
      next.agentState = 'error'
      next.blockingReason = null
      break
    case 'agent.recovered':
      next.agentState = 'idle'
      next.hasUnseenCompletion = false
      next.blockingReason = null
      break
  }

  return next
}

function resetStartingState(next: SessionSummary): void {
  next.agentState = 'unknown'
  next.hasUnseenCompletion = false
  next.blockingReason = null
  next.runtimeExitCode = null
  next.runtimeExitReason = null
}

function applyExternalSessionId(next: SessionSummary, patch: SessionStatePatchEvent): void {
  if (patch.externalSessionId !== undefined) {
    next.externalSessionId = patch.externalSessionId
  }
}

function markAgentWorkingIfRuntimeAlive(current: SessionSummary, next: SessionSummary): void {
  if (current.runtimeState !== 'alive') {
    return
  }

  next.agentState = 'working'
  next.hasUnseenCompletion = false
  next.blockingReason = null
}
