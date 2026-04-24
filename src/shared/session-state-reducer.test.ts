import { describe, expect, it } from 'vitest'
import type { SessionStatePatchEvent } from './project-session'
import {
  createInitialSessionState,
  derivePresencePhase,
  reduceSessionState,
  type SessionPresenceInput,
  type SessionStateFields
} from './session-state-reducer'

const BASE_OCCURRED_AT = '2026-04-24T00:00:00.000Z'

function event(
  patch: Omit<SessionStatePatchEvent, 'sessionId' | 'occurredAt' | 'source' | 'summary'> &
    Partial<Pick<SessionStatePatchEvent, 'source'>>
): SessionStatePatchEvent {
  return {
    sessionId: 'session_1',
    occurredAt: BASE_OCCURRED_AT,
    source: 'runtime',
    summary: patch.intent,
    ...patch
  }
}

function state(patch: Partial<SessionStateFields> = {}): SessionStateFields {
  return {
    ...createInitialSessionState(),
    ...patch
  }
}

function presenceInput(patch: Partial<SessionPresenceInput> = {}): SessionPresenceInput {
  return {
    ...createInitialSessionState(),
    ...patch
  }
}

describe('session state reducer', () => {
  it('derives preparing for created and starting before stale agent state', () => {
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'created',
          agentState: 'working',
          hasUnseenCompletion: true
        })
      )
    ).toBe('preparing')
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'starting',
          agentState: 'blocked',
          blockingReason: 'permission'
        })
      )
    ).toBe('preparing')
  })

  it('derives failed before blocked complete running and ready', () => {
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'alive',
          agentState: 'error',
          hasUnseenCompletion: true,
          blockingReason: 'permission'
        })
      )
    ).toBe('failed')
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'failed_to_start',
          agentState: 'blocked',
          blockingReason: 'permission'
        })
      )
    ).toBe('failed')
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'alive',
          agentState: 'working',
          runtimeExitReason: 'failed'
        })
      )
    ).toBe('failed')
  })

  it('derives complete from idle plus unseen completion before clean exited', () => {
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'exited',
          agentState: 'idle',
          hasUnseenCompletion: true,
          runtimeExitReason: 'clean',
          runtimeExitCode: 0
        })
      )
    ).toBe('complete')
  })

  it('derives shell alive unknown as running', () => {
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'alive',
          agentState: 'unknown',
          providerId: 'shell'
        })
      )
    ).toBe('running')
  })

  it('derives agent provider alive unknown as ready', () => {
    expect(
      derivePresencePhase(
        presenceInput({
          runtimeState: 'alive',
          agentState: 'unknown',
          providerId: 'codex'
        })
      )
    ).toBe('ready')
  })

  it('runtime alive never changes agent state to working', () => {
    const next = reduceSessionState(
      state({ runtimeState: 'starting', agentState: 'unknown', lastStateSequence: 1 }),
      event({ sequence: 2, intent: 'runtime.alive' })
    )

    expect(next).toMatchObject({
      runtimeState: 'alive',
      agentState: 'unknown',
      hasUnseenCompletion: false,
      lastStateSequence: 2
    })
  })

  it('runtime starting resets agent unseen blocking and exit metadata', () => {
    const next = reduceSessionState(
      state({
        runtimeState: 'exited',
        agentState: 'blocked',
        hasUnseenCompletion: true,
        runtimeExitCode: 42,
        runtimeExitReason: 'failed',
        blockingReason: 'permission',
        lastStateSequence: 4
      }),
      event({ sequence: 5, intent: 'runtime.starting' })
    )

    expect(next).toEqual({
      runtimeState: 'starting',
      agentState: 'unknown',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      blockingReason: null,
      lastStateSequence: 5
    })
  })

  it('turn completed marks unknown or working as idle with unseen completion', () => {
    expect(
      reduceSessionState(
        state({ runtimeState: 'alive', agentState: 'unknown', lastStateSequence: 1 }),
        event({ sequence: 2, intent: 'agent.turn_completed', source: 'provider' })
      )
    ).toMatchObject({
      agentState: 'idle',
      hasUnseenCompletion: true,
      lastStateSequence: 2
    })
    expect(
      reduceSessionState(
        state({ runtimeState: 'alive', agentState: 'working', lastStateSequence: 2 }),
        event({ sequence: 3, intent: 'agent.turn_completed', source: 'provider' })
      )
    ).toMatchObject({
      agentState: 'idle',
      hasUnseenCompletion: true,
      lastStateSequence: 3
    })
  })

  it('turn completed does not clear blocked or error', () => {
    expect(
      reduceSessionState(
        state({
          runtimeState: 'alive',
          agentState: 'blocked',
          blockingReason: 'permission',
          hasUnseenCompletion: false,
          lastStateSequence: 1
        }),
        event({ sequence: 2, intent: 'agent.turn_completed', source: 'provider' })
      )
    ).toMatchObject({
      agentState: 'blocked',
      blockingReason: 'permission',
      hasUnseenCompletion: false,
      lastStateSequence: 2
    })
    expect(
      reduceSessionState(
        state({ runtimeState: 'alive', agentState: 'error', hasUnseenCompletion: false, lastStateSequence: 2 }),
        event({ sequence: 3, intent: 'agent.turn_completed', source: 'provider' })
      )
    ).toMatchObject({
      agentState: 'error',
      hasUnseenCompletion: false,
      lastStateSequence: 3
    })
  })

  it('completion seen only clears unseen completion', () => {
    const next = reduceSessionState(
      state({
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: true,
        blockingReason: 'permission',
        runtimeExitCode: 7,
        runtimeExitReason: 'clean',
        lastStateSequence: 1
      }),
      event({ sequence: 2, intent: 'agent.completion_seen', source: 'ui' })
    )

    expect(next).toEqual({
      runtimeState: 'alive',
      agentState: 'idle',
      hasUnseenCompletion: false,
      runtimeExitCode: 7,
      runtimeExitReason: 'clean',
      blockingReason: 'permission',
      lastStateSequence: 2
    })
  })

  it('stale sequences are ignored', () => {
    const current = state({ runtimeState: 'alive', agentState: 'idle', lastStateSequence: 10 })

    expect(
      reduceSessionState(current, event({ sequence: 10, intent: 'agent.turn_started', source: 'provider' }))
    ).toBe(current)
    expect(
      reduceSessionState(current, event({ sequence: 9, intent: 'runtime.exited_failed', runtimeExitCode: 1 }))
    ).toBe(current)
  })

  it('newer sequences are applied', () => {
    expect(
      reduceSessionState(
        state({ runtimeState: 'alive', agentState: 'idle', lastStateSequence: 10 }),
        event({ sequence: 11, intent: 'agent.turn_started', source: 'provider' })
      )
    ).toEqual({
      runtimeState: 'alive',
      agentState: 'working',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      blockingReason: null,
      lastStateSequence: 11
    })
  })
})
