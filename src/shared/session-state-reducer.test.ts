import { describe, expect, it } from 'vitest'
import type { SessionStatePatchEvent, SessionSummary } from './project-session'
import { derivePresencePhase, reduceSessionState } from './session-state-reducer'

const NOW = '2026-04-24T00:00:00.000Z'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'codex',
    status: 'running',
    runtimeState: 'alive',
    agentState: 'idle',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 1,
    blockingReason: null,
    title: 'Session 1',
    summary: 'ready',
    recoveryMode: 'resume-external',
    externalSessionId: null,
    createdAt: '2026-04-23T00:00:00.000Z',
    updatedAt: '2026-04-23T00:00:00.000Z',
    lastActivatedAt: null,
    archived: false,
    ...overrides
  }
}

function patch(overrides: Partial<SessionStatePatchEvent> = {}): SessionStatePatchEvent {
  return {
    sessionId: 'session_1',
    sequence: 2,
    occurredAt: '2026-04-24T00:00:00.000Z',
    intent: 'agent.turn_started',
    source: 'provider',
    summary: 'event',
    ...overrides
  }
}

describe('session state reducer', () => {
  it('derives preparing for created and starting before stale agent state', () => {
    expect(
      derivePresencePhase({
        runtimeState: 'created',
        agentState: 'working',
        hasUnseenCompletion: true,
        runtimeExitCode: null,
        runtimeExitReason: null,
        provider: 'codex'
      })
    ).toBe('preparing')
    expect(
      derivePresencePhase({
        runtimeState: 'starting',
        agentState: 'idle',
        hasUnseenCompletion: true,
        runtimeExitCode: null,
        runtimeExitReason: null,
        provider: 'codex'
      })
    ).toBe('preparing')
  })

  it('derives failed before blocked complete running and ready', () => {
    for (const input of [
      {
        runtimeState: 'failed_to_start' as const,
        agentState: 'blocked' as const,
        hasUnseenCompletion: true,
        runtimeExitCode: null,
        runtimeExitReason: null
      },
      {
        runtimeState: 'exited' as const,
        agentState: 'working' as const,
        hasUnseenCompletion: false,
        runtimeExitCode: 1,
        runtimeExitReason: 'failed' as const
      },
      {
        runtimeState: 'alive' as const,
        agentState: 'error' as const,
        hasUnseenCompletion: true,
        runtimeExitCode: null,
        runtimeExitReason: null
      }
    ]) {
      expect(derivePresencePhase({ ...input, provider: 'codex' })).toBe('failed')
    }
  })

  it('derives complete from idle plus unseen completion before clean exited', () => {
    expect(
      derivePresencePhase({
        runtimeState: 'exited',
        agentState: 'idle',
        hasUnseenCompletion: true,
        runtimeExitCode: 0,
        runtimeExitReason: 'clean',
        provider: 'codex'
      })
    ).toBe('complete')
  })

  it('derives shell alive unknown as running', () => {
    expect(
      derivePresencePhase({
        runtimeState: 'alive',
        agentState: 'unknown',
        hasUnseenCompletion: false,
        runtimeExitCode: null,
        runtimeExitReason: null,
        provider: 'shell'
      })
    ).toBe('running')
  })

  it('derives agent provider alive unknown as ready', () => {
    expect(
      derivePresencePhase({
        runtimeState: 'alive',
        agentState: 'unknown',
        hasUnseenCompletion: false,
        runtimeExitCode: null,
        runtimeExitReason: null,
        provider: 'codex'
      })
    ).toBe('ready')
  })

  it('runtime alive never changes agent state to working', () => {
    const next = reduceSessionState(
      session({ runtimeState: 'starting', agentState: 'unknown' }),
      patch({ intent: 'runtime.alive', externalSessionId: 'external_1' }),
      NOW
    )

    expect(next).toMatchObject({
      runtimeState: 'alive',
      agentState: 'unknown',
      externalSessionId: 'external_1',
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('runtime starting resets agent unseen blocking and exit metadata', () => {
    const next = reduceSessionState(
      session({
        runtimeState: 'exited',
        agentState: 'blocked',
        hasUnseenCompletion: true,
        runtimeExitCode: 42,
        runtimeExitReason: 'failed',
        blockingReason: 'permission'
      }),
      patch({ intent: 'runtime.starting' }),
      NOW
    )

    expect(next).toMatchObject({
      runtimeState: 'starting',
      agentState: 'unknown',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      blockingReason: null,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('turn completed sets agent idle and unseen completion', () => {
    const next = reduceSessionState(
      session({ agentState: 'working', hasUnseenCompletion: false }),
      patch({ intent: 'agent.turn_completed' }),
      NOW
    )

    expect(next).toMatchObject({
      agentState: 'idle',
      hasUnseenCompletion: true,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('completion seen clears unseen completion without changing agent idle', () => {
    const next = reduceSessionState(
      session({ agentState: 'idle', hasUnseenCompletion: true }),
      patch({ intent: 'agent.completion_seen', source: 'ui' }),
      NOW
    )

    expect(next).toMatchObject({
      agentState: 'idle',
      hasUnseenCompletion: false,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('blocked cannot be cleared by ordinary stale tool started', () => {
    const next = reduceSessionState(
      session({ agentState: 'blocked', blockingReason: 'permission', hasUnseenCompletion: true }),
      patch({ intent: 'agent.tool_started' }),
      NOW
    )

    expect(next).toMatchObject({
      agentState: 'blocked',
      blockingReason: 'permission',
      hasUnseenCompletion: true,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('post permission continuation clears blocked to working when runtime is alive', () => {
    const next = reduceSessionState(
      session({ agentState: 'blocked', blockingReason: 'permission', hasUnseenCompletion: true }),
      patch({ intent: 'agent.tool_started', sourceEventType: 'post_permission_continuation' }),
      NOW
    )

    expect(next).toMatchObject({
      agentState: 'working',
      blockingReason: null,
      hasUnseenCompletion: false,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('permission events do not change agent fields when runtime is not alive', () => {
    const requested = reduceSessionState(
      session({
        runtimeState: 'exited',
        agentState: 'idle',
        blockingReason: null,
        hasUnseenCompletion: true
      }),
      patch({ intent: 'agent.permission_requested', blockingReason: 'permission' }),
      NOW
    )
    const resolved = reduceSessionState(
      session({
        runtimeState: 'failed_to_start',
        agentState: 'blocked',
        blockingReason: 'permission',
        hasUnseenCompletion: true
      }),
      patch({ intent: 'agent.permission_resolved' }),
      NOW
    )

    expect(requested).toMatchObject({
      runtimeState: 'exited',
      agentState: 'idle',
      blockingReason: null,
      hasUnseenCompletion: true,
      lastStateSequence: 2,
      updatedAt: NOW
    })
    expect(resolved).toMatchObject({
      runtimeState: 'failed_to_start',
      agentState: 'blocked',
      blockingReason: 'permission',
      hasUnseenCompletion: true,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('permission resolved can move blocked to working', () => {
    const next = reduceSessionState(
      session({ agentState: 'blocked', blockingReason: 'permission' }),
      patch({ intent: 'agent.permission_resolved' }),
      NOW
    )

    expect(next).toMatchObject({
      agentState: 'working',
      blockingReason: null,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })

  it('stale sequence patches are ignored', () => {
    const current = session({ lastStateSequence: 10 })

    expect(reduceSessionState(current, patch({ sequence: 10 }), NOW)).toBe(current)
    expect(reduceSessionState(current, patch({ sequence: 9 }), NOW)).toBe(current)
  })

  it('duplicate same-sequence patches do not mutate state twice', () => {
    const first = reduceSessionState(
      session({ lastStateSequence: 1, agentState: 'working' }),
      patch({ sequence: 2, intent: 'agent.turn_completed' }),
      NOW
    )
    const second = reduceSessionState(
      first,
      patch({ sequence: 2, intent: 'agent.completion_seen', source: 'ui' }),
      '2026-04-24T00:01:00.000Z'
    )

    expect(second).toBe(first)
    expect(second).toMatchObject({
      agentState: 'idle',
      hasUnseenCompletion: true,
      lastStateSequence: 2,
      updatedAt: NOW
    })
  })
})
