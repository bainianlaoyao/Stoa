import type {
  SessionAgentState,
  SessionRuntimeState,
  SessionStatePatchEvent
} from './project-session'
import type { BlockingReason, SessionPresencePhase } from './observability'

export interface SessionStateFields {
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  lastStateSequence: number
  blockingReason: BlockingReason | null
}

export interface SessionPresenceInput extends SessionStateFields {
  providerId?: string | null
}

export function createInitialSessionState(): SessionStateFields {
  return {
    runtimeState: 'created',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 0,
    blockingReason: null
  }
}

export function reduceSessionState(current: SessionStateFields, event: SessionStatePatchEvent): SessionStateFields {
  if (event.sequence <= current.lastStateSequence) {
    return current
  }

  const next: SessionStateFields = {
    ...current,
    lastStateSequence: event.sequence
  }

  switch (event.intent) {
    case 'runtime.created':
      next.runtimeState = 'created'
      resetLaunchBoundaryFields(next)
      break
    case 'runtime.starting':
      next.runtimeState = 'starting'
      resetLaunchBoundaryFields(next)
      break
    case 'runtime.alive':
      next.runtimeState = 'alive'
      break
    case 'runtime.exited_clean':
      next.runtimeState = 'exited'
      next.runtimeExitReason = 'clean'
      next.runtimeExitCode = event.runtimeExitCode ?? 0
      break
    case 'runtime.exited_failed':
      next.runtimeState = 'exited'
      next.runtimeExitReason = 'failed'
      next.runtimeExitCode = event.runtimeExitCode ?? 1
      next.agentState = 'error'
      break
    case 'runtime.failed_to_start':
      next.runtimeState = 'failed_to_start'
      next.runtimeExitReason = 'failed'
      next.runtimeExitCode = event.runtimeExitCode ?? 1
      next.agentState = 'error'
      break
    case 'agent.turn_started':
    case 'agent.tool_started':
      if (current.runtimeState === 'alive') {
        next.agentState = 'working'
        next.hasUnseenCompletion = false
        next.blockingReason = null
      }
      break
    case 'agent.turn_completed':
      if (current.agentState === 'unknown' || current.agentState === 'working') {
        next.agentState = 'idle'
        next.hasUnseenCompletion = true
      }
      break
    case 'agent.completion_seen':
      next.hasUnseenCompletion = false
      break
    case 'agent.permission_requested':
      next.agentState = 'blocked'
      next.blockingReason = event.blockingReason ?? null
      break
    case 'agent.permission_resolved':
      if (current.agentState === 'blocked') {
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
      next.blockingReason = null
      break
  }

  return next
}

export function derivePresencePhase(input: SessionPresenceInput): SessionPresencePhase {
  if (input.runtimeState === 'failed_to_start' || input.runtimeExitReason === 'failed' || input.agentState === 'error') {
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

  if (input.runtimeState === 'exited') {
    return 'exited'
  }

  if (input.runtimeState === 'alive' && input.agentState === 'working') {
    return 'running'
  }

  if (input.runtimeState === 'alive' && input.agentState === 'unknown' && input.providerId === 'shell') {
    return 'running'
  }

  if (input.runtimeState === 'alive' && input.agentState === 'unknown' && input.providerId !== 'shell') {
    return 'ready'
  }

  if (input.runtimeState === 'alive' && input.agentState === 'idle') {
    return 'ready'
  }

  return 'ready'
}

function resetLaunchBoundaryFields(next: SessionStateFields): void {
  next.agentState = 'unknown'
  next.hasUnseenCompletion = false
  next.runtimeExitCode = null
  next.runtimeExitReason = null
  next.blockingReason = null
}
