import { describe, expect, test } from 'vitest'
import type { HermesSessionSummary } from '@shared/hermes'
import type { SessionStatePatchEvent } from '@shared/project-session'
import { deriveHermesProviderSessionPatch } from './hermes-provider-patch'

function createSession(): HermesSessionSummary {
  return {
    id: 'hermes_1',
    title: 'global-triage',
    status: 'created',
    backendSessionType: 'claude-code',
    capabilityLevel: 3,
    pendingProposalCount: 0,
    activeTargetCount: 0,
    lastSummary: 'Waiting for Hermes to start',
    lastRisk: null,
    resumeSessionId: 'resume-hermes-1',
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:00:00.000Z',
    lastActivatedAt: null
  }
}

function createPatch(overrides: Partial<SessionStatePatchEvent> = {}): SessionStatePatchEvent {
  return {
    sessionId: 'hermes_1',
    sequence: 1,
    occurredAt: '2026-05-07T08:00:01.000Z',
    intent: 'runtime.alive',
    source: 'provider',
    summary: 'SessionStart',
    ...overrides
  }
}

describe('deriveHermesProviderSessionPatch', () => {
  test('maps running provider events to running Hermes state', () => {
    const next = deriveHermesProviderSessionPatch(createSession(), createPatch({
      intent: 'agent.turn_started'
    }))

    expect(next).toMatchObject({
      status: 'running',
      lastSummary: 'Hermes is working.',
      lastRisk: null
    })
  })

  test('maps permission requests to waiting_approval with a readable risk', () => {
    const next = deriveHermesProviderSessionPatch(createSession(), createPatch({
      intent: 'agent.permission_requested',
      blockingReason: 'permission'
    }))

    expect(next).toMatchObject({
      status: 'waiting_approval',
      lastSummary: 'Hermes is waiting for approval.',
      lastRisk: 'Provider requested approval.'
    })
  })

  test('maps failed provider events to failed Hermes state', () => {
    const next = deriveHermesProviderSessionPatch(createSession(), createPatch({
      intent: 'agent.turn_failed',
      failureReason: 'provider_error'
    }))

    expect(next).toMatchObject({
      status: 'failed',
      lastSummary: 'Hermes turn failed.',
      lastRisk: 'Provider reported an internal error.'
    })
  })

  test('updates resume session id when provider patch carries one', () => {
    const next = deriveHermesProviderSessionPatch(createSession(), createPatch({
      intent: 'runtime.alive',
      externalSessionId: 'resume-hermes-2'
    }))

    expect(next.resumeSessionId).toBe('resume-hermes-2')
  })
})
