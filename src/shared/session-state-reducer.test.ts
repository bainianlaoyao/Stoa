import { describe, expect, it } from 'vitest'
import type {
  FailureReason,
  SessionStatePatchEvent,
  SessionSummary,
  TurnOutcome,
  TurnState
} from './project-session'
import { derivePresencePhase, reduceSessionState } from './session-state-reducer'

const NOW = '2026-05-06T00:00:00.000Z'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'codex',
    runtimeState: 'alive',
    turnState: 'idle',
    turnEpoch: 0,
    lastTurnOutcome: 'none',
    blockingReason: null,
    failureReason: null,
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 1,
    title: 'Session 1',
    summary: 'ready',
    recoveryMode: 'resume-external',
    externalSessionId: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    lastActivatedAt: null,
    archived: false,
    ...overrides
  }
}

function patch(overrides: Partial<SessionStatePatchEvent> = {}): SessionStatePatchEvent {
  return {
    sessionId: 'session_1',
    sequence: 2,
    occurredAt: NOW,
    intent: 'agent.turn_started',
    source: 'provider',
    turnEpoch: 1,
    sourceTurnId: 'provider-turn-1',
    summary: 'event',
    ...overrides
  }
}

function derive(sessionState: SessionSummary) {
  return derivePresencePhase({
    runtimeState: sessionState.runtimeState,
    turnState: sessionState.turnState,
    turnEpoch: sessionState.turnEpoch,
    lastTurnOutcome: sessionState.lastTurnOutcome,
    blockingReason: sessionState.blockingReason,
    failureReason: sessionState.failureReason,
    hasUnseenCompletion: sessionState.hasUnseenCompletion,
    runtimeExitCode: sessionState.runtimeExitCode,
    runtimeExitReason: sessionState.runtimeExitReason,
    provider: sessionState.type
  })
}

describe('session state reducer', () => {
  it('derives ready from created starting and clean exited states', () => {
    expect(derive(session({ runtimeState: 'created', turnState: 'running', blockingReason: 'permission' }))).toBe('ready')
    expect(derive(session({ runtimeState: 'starting', turnState: 'running', blockingReason: 'permission' }))).toBe('ready')
    expect(
      derive(session({
        runtimeState: 'exited',
        runtimeExitReason: 'clean',
        turnState: 'idle',
        lastTurnOutcome: 'completed',
        hasUnseenCompletion: false
      }))
    ).toBe('ready')
  })

  it('derives running only from alive plus running turn state', () => {
    expect(derive(session({ runtimeState: 'alive', turnState: 'running', blockingReason: null }))).toBe('running')
    expect(derive(session({ runtimeState: 'alive', turnState: 'idle', blockingReason: null }))).toBe('ready')
    expect(derive(session({ runtimeState: 'exited', turnState: 'running', blockingReason: null }))).toBe('ready')
  })

  it('derives blocked only when blockingReason exists on current running turn', () => {
    expect(derive(session({ turnState: 'running', turnEpoch: 2, blockingReason: 'permission' }))).toBe('blocked')
    expect(derive(session({ turnState: 'idle', turnEpoch: 2, blockingReason: 'permission' }))).toBe('ready')
  })

  it('derives failure before blocked complete running and ready', () => {
    expect(
      derive(session({ runtimeState: 'failed_to_start', turnState: 'running', blockingReason: 'permission' }))
    ).toBe('failure')
    expect(
      derive(session({ runtimeState: 'exited', runtimeExitReason: 'failed', turnState: 'running' }))
    ).toBe('failure')
    expect(
      derive(session({ failureReason: 'provider_error', blockingReason: 'permission', hasUnseenCompletion: true }))
    ).toBe('failure')
  })

  it('keeps complete until completion_seen and keeps clean exit folded into ready', () => {
    const complete = session({
      turnState: 'idle',
      turnEpoch: 3,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })

    expect(derive(complete)).toBe('complete')

    const seen = reduceSessionState(
      complete,
      patch({
        sequence: complete.lastStateSequence + 1,
        intent: 'agent.completion_seen',
        source: 'ui',
        turnEpoch: complete.turnEpoch,
        summary: 'completion seen'
      }),
      NOW
    )

    expect(seen.hasUnseenCompletion).toBe(false)
    expect(derive(seen)).toBe('ready')

    const exited = reduceSessionState(
      complete,
      patch({
        sequence: complete.lastStateSequence + 1,
        intent: 'runtime.exited_clean',
        source: 'runtime',
        turnEpoch: undefined,
        sourceTurnId: null,
        runtimeExitCode: 0,
        runtimeExitReason: 'clean',
        summary: 'clean exit'
      }),
      NOW
    )

    expect(derive(exited)).toBe('complete')
  })

  it('runtime starting resets turn block failure and completion metadata', () => {
    const next = reduceSessionState(
      session({
        runtimeState: 'exited',
        turnState: 'running',
        turnEpoch: 9,
        lastTurnOutcome: 'failed',
        blockingReason: 'permission',
        failureReason: 'runtime_crash',
        hasUnseenCompletion: true,
        runtimeExitCode: 42,
        runtimeExitReason: 'failed'
      }),
      patch({
        intent: 'runtime.starting',
        source: 'runtime',
        turnEpoch: undefined,
        sourceTurnId: null,
        summary: 'starting'
      }),
      NOW
    )

    expect(next).toMatchObject({
      runtimeState: 'starting',
      turnState: 'idle',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null
    })
  })

  it('turn started opens a new running turn and clears previous outcome state', () => {
    const next = reduceSessionState(
      session({
        turnState: 'idle',
        turnEpoch: 4,
        lastTurnOutcome: 'interrupted',
        blockingReason: 'permission',
        failureReason: 'unknown',
        hasUnseenCompletion: true
      }),
      patch({
        intent: 'agent.turn_started',
        turnEpoch: 5,
        summary: 'turn started'
      }),
      NOW
    )

    expect(next).toMatchObject({
      turnState: 'running',
      turnEpoch: 5,
      lastTurnOutcome: 'none',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: false
    })
    expect(derive(next)).toBe('running')
  })

  it('does not clear blocked on tool_started or tool_completed alone', () => {
    const blocked = session({
      turnState: 'running',
      turnEpoch: 3,
      blockingReason: 'permission'
    })

    const toolStarted = reduceSessionState(
      blocked,
      patch({
        sequence: blocked.lastStateSequence + 1,
        intent: 'agent.tool_started',
        turnEpoch: 3,
        summary: 'tool started'
      }),
      NOW
    )

    const toolCompleted = reduceSessionState(
      blocked,
      patch({
        sequence: blocked.lastStateSequence + 1,
        intent: 'agent.tool_completed',
        turnEpoch: 3,
        summary: 'tool completed'
      }),
      NOW
    )

    expect(toolStarted.blockingReason).toBe('permission')
    expect(toolCompleted.blockingReason).toBe('permission')
    expect(derive(toolStarted)).toBe('blocked')
    expect(derive(toolCompleted)).toBe('blocked')
  })

  it('uses claude PreToolUse as explicit continuation evidence to clear blocked on the same turn', () => {
    const blocked = session({
      type: 'claude-code',
      turnState: 'running',
      turnEpoch: 3,
      blockingReason: 'permission'
    })

    const resumed = reduceSessionState(
      blocked,
      patch({
        sequence: blocked.lastStateSequence + 1,
        intent: 'agent.tool_started',
        sourceEventType: 'claude-code.PreToolUse',
        turnEpoch: 3,
        summary: 'PreToolUse'
      }),
      NOW
    )

    expect(resumed.blockingReason).toBe(null)
    expect(resumed.turnState).toBe('running')
    expect(derive(resumed)).toBe('running')
  })

  it('returns to running on explicit permission_resolved for the same blocked turn', () => {
    const blocked = session({
      turnState: 'running',
      turnEpoch: 7,
      blockingReason: 'permission'
    })

    const next = reduceSessionState(
      blocked,
      patch({
        sequence: blocked.lastStateSequence + 1,
        intent: 'agent.permission_resolved',
        turnEpoch: 7,
        summary: 'permission resolved'
      }),
      NOW
    )

    expect(next.blockingReason).toBe(null)
    expect(next.turnState).toBe('running')
    expect(derive(next)).toBe('running')
  })

  it('ignores permission resolution from a stale turnEpoch', () => {
    const blocked = session({
      turnState: 'running',
      turnEpoch: 7,
      blockingReason: 'permission'
    })

    const next = reduceSessionState(
      blocked,
      patch({
        sequence: blocked.lastStateSequence + 1,
        intent: 'agent.permission_resolved',
        turnEpoch: 6,
        summary: 'stale permission resolved'
      }),
      NOW
    )

    expect(next.blockingReason).toBe('permission')
    expect(derive(next)).toBe('blocked')
  })

  it('turn completed marks unseen completion on the current turn only', () => {
    const next = reduceSessionState(
      session({
        turnState: 'running',
        turnEpoch: 2
      }),
      patch({
        intent: 'agent.turn_completed',
        turnEpoch: 2,
        summary: 'turn completed'
      }),
      NOW
    )

    expect(next).toMatchObject({
      turnState: 'idle',
      turnEpoch: 2,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true,
      blockingReason: null
    })
    expect(derive(next)).toBe('complete')
  })

  it('permission requested can open a blocked turn when provider turn start evidence is missing', () => {
    const next = reduceSessionState(
      session({
        turnState: 'idle',
        turnEpoch: 2,
        lastTurnOutcome: 'completed',
        hasUnseenCompletion: true
      }),
      patch({
        intent: 'agent.permission_requested',
        turnEpoch: 3,
        blockingReason: 'permission',
        summary: 'permission requested'
      }),
      NOW
    )

    expect(next).toMatchObject({
      turnState: 'running',
      turnEpoch: 3,
      lastTurnOutcome: 'none',
      blockingReason: 'permission',
      failureReason: null,
      hasUnseenCompletion: false
    })
    expect(derive(next)).toBe('blocked')
  })

  it('tool started can reopen a running turn when prompt-start evidence is missing', () => {
    const next = reduceSessionState(
      session({
        turnState: 'idle',
        turnEpoch: 2,
        lastTurnOutcome: 'interrupted'
      }),
      patch({
        intent: 'agent.tool_started',
        turnEpoch: 3,
        summary: 'tool started'
      }),
      NOW
    )

    expect(next).toMatchObject({
      turnState: 'running',
      turnEpoch: 3,
      lastTurnOutcome: 'none',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: false
    })
    expect(derive(next)).toBe('running')
  })

  it('direct terminal events can advance from ready when the provider missed turn-start evidence', () => {
    const completed = reduceSessionState(
      session({
        turnState: 'idle',
        turnEpoch: 3,
        lastTurnOutcome: 'interrupted'
      }),
      patch({
        intent: 'agent.turn_completed',
        turnEpoch: 4,
        summary: 'turn completed'
      }),
      NOW
    )

    expect(completed).toMatchObject({
      turnState: 'idle',
      turnEpoch: 4,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true,
      blockingReason: null,
      failureReason: null
    })
    expect(derive(completed)).toBe('complete')

    const failed = reduceSessionState(
      session({
        turnState: 'idle',
        turnEpoch: 4,
        lastTurnOutcome: 'completed',
        hasUnseenCompletion: false
      }),
      patch({
        intent: 'agent.turn_failed',
        turnEpoch: 5,
        failureReason: 'provider_error',
        summary: 'turn failed'
      }),
      NOW
    )

    expect(failed).toMatchObject({
      turnState: 'idle',
      turnEpoch: 5,
      lastTurnOutcome: 'failed',
      failureReason: 'provider_error',
      hasUnseenCompletion: false
    })
    expect(derive(failed)).toBe('failure')
  })

  it('preserves interrupted outcomes against late completion events', () => {
    const interrupted = reduceSessionState(
      session({
        turnState: 'running',
        turnEpoch: 4
      }),
      patch({
        intent: 'agent.turn_interrupted',
        source: 'ui',
        turnEpoch: 4,
        summary: 'interrupted'
      }),
      NOW
    )

    expect(interrupted.turnState).toBe('idle')
    expect(interrupted.lastTurnOutcome).toBe('interrupted')
    expect(derive(interrupted)).toBe('ready')

    const lateCompletion = reduceSessionState(
      interrupted,
      patch({
        sequence: interrupted.lastStateSequence + 1,
        intent: 'agent.turn_completed',
        turnEpoch: 4,
        summary: 'late completion'
      }),
      NOW
    )

    expect(lateCompletion.lastTurnOutcome).toBe('interrupted')
    expect(lateCompletion.hasUnseenCompletion).toBe(false)
    expect(derive(lateCompletion)).toBe('ready')
  })

  it('preserves failed outcomes against late completion events', () => {
    const failed = reduceSessionState(
      session({
        turnState: 'running',
        turnEpoch: 4
      }),
      patch({
        intent: 'agent.turn_failed',
        turnEpoch: 4,
        failureReason: 'provider_error',
        summary: 'failed'
      }),
      NOW
    )

    expect(failed.turnState).toBe('idle')
    expect(failed.lastTurnOutcome).toBe('failed')
    expect(failed.failureReason).toBe('provider_error')
    expect(derive(failed)).toBe('failure')

    const lateCompletion = reduceSessionState(
      failed,
      patch({
        sequence: failed.lastStateSequence + 1,
        intent: 'agent.turn_completed',
        turnEpoch: 4,
        summary: 'late completion'
      }),
      NOW
    )

    expect(lateCompletion.lastTurnOutcome).toBe('failed')
    expect(lateCompletion.failureReason).toBe('provider_error')
    expect(derive(lateCompletion)).toBe('failure')
  })

  it('ignores old turn events after a newer turn has started', () => {
    const current = session({
      turnState: 'running',
      turnEpoch: 5
    })

    const next = reduceSessionState(
      current,
      patch({
        sequence: current.lastStateSequence + 1,
        intent: 'agent.turn_completed',
        turnEpoch: 4,
        summary: 'old turn completion'
      }),
      NOW
    )

    expect(next.turnState).toBe('running')
    expect(next.turnEpoch).toBe(5)
    expect(next.hasUnseenCompletion).toBe(false)
    expect(derive(next)).toBe('running')
  })

  it('runtime alive never forces the turn into running', () => {
    const next = reduceSessionState(
      session({
        runtimeState: 'starting',
        turnState: 'idle',
        turnEpoch: 0
      }),
      patch({
        intent: 'runtime.alive',
        source: 'runtime',
        turnEpoch: undefined,
        sourceTurnId: null,
        externalSessionId: 'external_1',
        summary: 'alive'
      }),
      NOW
    )

    expect(next.runtimeState).toBe('alive')
    expect(next.turnState).toBe('idle')
    expect(next.externalSessionId).toBe('external_1')
    expect(derive(next)).toBe('ready')
  })

  it('stale sequence patches are ignored', () => {
    const current = session({ lastStateSequence: 10 })

    expect(reduceSessionState(current, patch({ sequence: 10 }), NOW)).toBe(current)
    expect(reduceSessionState(current, patch({ sequence: 9 }), NOW)).toBe(current)
  })

  it('duplicate same-sequence patches do not mutate state twice', () => {
    const first = reduceSessionState(
      session({ turnState: 'running', turnEpoch: 1, lastStateSequence: 1 }),
      patch({ sequence: 2, intent: 'agent.turn_completed', turnEpoch: 1 }),
      NOW
    )
    const second = reduceSessionState(
      first,
      patch({ sequence: 2, intent: 'agent.completion_seen', source: 'ui', turnEpoch: 1 }),
      '2026-05-06T00:01:00.000Z'
    )

    expect(second).toBe(first)
    expect(second).toMatchObject({
      turnState: 'idle',
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })
})
