import { describe, expect, test } from 'vitest'
import type { MetaSessionSummary } from '@shared/meta-session'
import type { SessionStatePatchEvent } from '@shared/project-session'
import { deriveMetaSessionProviderSessionPatch } from './meta-session-provider-patch'

function createSession(): MetaSessionSummary {
  return {
    id: 'meta_session_1',
    title: 'global-triage',
    status: 'created',
    backendSessionType: 'claude-code',
    capabilityLevel: 3,
    pendingProposalCount: 0,
    activeTargetCount: 0,
    lastSummary: 'Waiting for meta session backend to start',
    lastRisk: null,
    backendSessionId: 'meta-backend-1',
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:00:00.000Z',
    lastActivatedAt: null,
    archived: false
  }
}

function createPatch(overrides: Partial<SessionStatePatchEvent> = {}): SessionStatePatchEvent {
  return {
    sessionId: 'meta_session_1',
    sequence: 1,
    occurredAt: '2026-05-07T08:00:01.000Z',
    intent: 'runtime.alive',
    source: 'provider',
    summary: 'SessionStart',
    ...overrides
  }
}

describe('deriveMetaSessionProviderSessionPatch', () => {
  test('maps running provider events to running meta-session state', () => {
    const next = deriveMetaSessionProviderSessionPatch(createSession(), createPatch({
      intent: 'agent.turn_started'
    }))

    expect(next).toMatchObject({
      status: 'running',
      lastSummary: 'Meta session is working.',
      lastRisk: null
    })
  })

  test('maps permission requests to waiting_approval with a readable risk', () => {
    const next = deriveMetaSessionProviderSessionPatch(createSession(), createPatch({
      intent: 'agent.permission_requested',
      blockingReason: 'permission'
    }))

    expect(next).toMatchObject({
      status: 'waiting_approval',
      lastSummary: 'Meta session is waiting for approval.',
      lastRisk: 'Provider requested approval.'
    })
  })

  test('maps failed provider events to failed meta-session state', () => {
    const next = deriveMetaSessionProviderSessionPatch(createSession(), createPatch({
      intent: 'agent.turn_failed',
      failureReason: 'provider_error'
    }))

    expect(next).toMatchObject({
      status: 'failed',
      lastSummary: 'Meta session turn failed.',
      lastRisk: 'Provider reported an internal error.'
    })
  })

  test('updates backend session id when provider patch carries one', () => {
    const next = deriveMetaSessionProviderSessionPatch(createSession(), createPatch({
      intent: 'runtime.alive',
      externalSessionId: 'meta-backend-2'
    }))

    expect(next.backendSessionId).toBe('meta-backend-2')
  })
})
