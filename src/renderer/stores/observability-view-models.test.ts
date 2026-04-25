import { describe, expect, it } from 'vitest'

import type { SessionPresenceSnapshot } from '@shared/observability'
import type { SessionSummary } from '@shared/project-session'
import { buildSessionPresenceSnapshot } from '@shared/observability-projection'

import {
  toActiveSessionViewModel,
  toSessionRowViewModel
} from './observability-view-models'

const NOW_ISO = '2026-04-24T08:00:00.000Z'

function sessionFixture(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-1',
    projectId: 'project-1',
    type: 'claude-code',
    status: 'running',
    runtimeState: 'alive',
    agentState: 'working',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 1,
    blockingReason: null,
    title: 'Implement feature',
    summary: 'Working on feature',
    recoveryMode: 'resume-external',
    externalSessionId: 'external-1',
    createdAt: '2026-04-24T07:00:00.000Z',
    updatedAt: '2026-04-24T07:50:00.000Z',
    lastActivatedAt: '2026-04-24T07:55:00.000Z',
    archived: false,
    ...patch
  }
}

function presenceFixture(patch: Partial<SessionPresenceSnapshot> = {}): SessionPresenceSnapshot {
  return {
    sessionId: 'session-1',
    projectId: 'project-1',
    providerId: 'claude-code',
    providerLabel: 'Claude Code',
    modelLabel: 'Sonnet',
    phase: 'running',
    runtimeState: 'alive',
    agentState: 'working',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    confidence: 'authoritative',
    health: 'healthy',
    blockingReason: null,
    lastAssistantSnippet: 'I am working on it.',
    lastEventAt: '2026-04-24T07:59:50.000Z',
    lastEvidenceType: 'evidence.assistant_message',
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    evidenceSequence: 1,
    sourceSequence: 1,
    updatedAt: '2026-04-24T07:59:50.000Z',
    ...patch
  }
}

describe('renderer observability view models', () => {
  it('builds session row labels from the shared projection semantics', () => {
    const viewModel = toSessionRowViewModel(
      sessionFixture({ status: 'turn_complete' }),
      presenceFixture({
        phase: 'ready',
        updatedAt: '2026-04-24T07:58:00.000Z'
      }),
      NOW_ISO
    )

    expect(viewModel).toEqual({
      sessionId: 'session-1',
      title: 'Implement feature',
      phase: 'ready',
      primaryLabel: 'Ready',
      secondaryLabel: 'Claude Code / Sonnet',
      tone: 'neutral',
      hasUnreadTurn: false,
      needsAttention: false,
      attentionReason: null,
      updatedAgoLabel: '2m ago'
    })
  })

  it('labels running Claude sessions as Running in the session row', () => {
    const viewModel = toSessionRowViewModel(
      sessionFixture({ type: 'claude-code', status: 'running' }),
      presenceFixture({
        providerId: 'claude-code',
        providerLabel: 'Claude Code',
        phase: 'running'
      }),
      NOW_ISO
    )

    expect(viewModel.phase).toBe('running')
    expect(viewModel.tone).toBe('success')
    expect(viewModel.primaryLabel).toBe('Running')
    expect(viewModel.secondaryLabel).toBe('Claude Code / Sonnet')
  })

  it('maps ready rows to neutral tone', () => {
    const viewModel = toSessionRowViewModel(
      sessionFixture(),
      presenceFixture({ phase: 'ready' }),
      NOW_ISO
    )

    expect(viewModel.tone).toBe('neutral')
    expect(viewModel.needsAttention).toBe(false)
  })

  it('maps running rows to success tone', () => {
    const viewModel = toSessionRowViewModel(
      sessionFixture(),
      presenceFixture({ phase: 'running' }),
      NOW_ISO
    )

    expect(viewModel.tone).toBe('success')
    expect(viewModel.needsAttention).toBe(false)
  })

  it('maps complete rows to warning attention', () => {
    const viewModel = toSessionRowViewModel(
      sessionFixture({ status: 'turn_complete', agentState: 'idle', hasUnseenCompletion: true }),
      presenceFixture({
        phase: 'complete',
        agentState: 'idle',
        hasUnseenCompletion: true
      }),
      NOW_ISO
    )

    expect(viewModel.tone).toBe('warning')
    expect(viewModel.needsAttention).toBe(true)
    expect(viewModel.attentionReason).toBe('turn-complete')
  })

  it('maps blocked rows to warning attention', () => {
    const blockedPresence = buildSessionPresenceSnapshot(
      sessionFixture({
        status: 'needs_confirmation',
        agentState: 'blocked',
        blockingReason: 'resume-confirmation'
      }),
      {
        activeSessionId: 'session-1',
        nowIso: NOW_ISO,
        modelLabel: 'Sonnet'
      }
    )
    const blockedViewModel = toSessionRowViewModel(
      sessionFixture({ status: 'needs_confirmation' }),
      blockedPresence,
      NOW_ISO
    )

    expect(blockedViewModel.tone).toBe('warning')
    expect(blockedViewModel.needsAttention).toBe(true)
    expect(blockedViewModel.phase).toBe('blocked')
    expect(blockedViewModel.attentionReason).toBe('resume-confirmation')
  })

  it('maps failed rows to danger attention before complete or blocked attention', () => {
    const viewModel = toSessionRowViewModel(
      sessionFixture({ status: 'error', agentState: 'error', hasUnseenCompletion: true }),
      presenceFixture({
        phase: 'failed',
        agentState: 'error',
        hasUnseenCompletion: true,
        health: 'lost'
      }),
      NOW_ISO
    )

    expect(viewModel.tone).toBe('danger')
    expect(viewModel.needsAttention).toBe(true)
    expect(viewModel.attentionReason).toBe('provider-error')
    expect(viewModel.attentionReason).not.toBe('turn-complete')
    expect(viewModel.attentionReason).not.toBe('blocked')
  })

  it.each([
    ['authoritative', 'Live'],
    ['provisional', 'Provisional'],
    ['stale', 'Stale']
  ] as const)('maps %s confidence to %s in the active view model', (confidence, confidenceLabel) => {
    const viewModel = toActiveSessionViewModel(
      sessionFixture(),
      presenceFixture({ confidence }),
      NOW_ISO
    )

    expect(viewModel.confidenceLabel).toBe(confidenceLabel)
  })

  it.each([
    ['permission', 'blocked', 'Provider is waiting for permission.'],
    ['resume-confirmation', 'blocked', 'Provider is waiting for confirmation.'],
    ['provider-error', 'failed', 'Provider reported an error.'],
    [null, 'running', null]
  ] as const)('maps blocking and failed states to the expected explanation', (blockingReason, phase, explanation) => {
    const viewModel = toActiveSessionViewModel(
      sessionFixture(),
      presenceFixture({
        blockingReason,
        phase,
        health: phase === 'failed' ? 'lost' : 'healthy'
      }),
      NOW_ISO
    )

    expect(viewModel.explanation).toBe(explanation)
  })

  it('uses the assistant snippet and relative age in seconds for a fresh active session', () => {
    const viewModel = toActiveSessionViewModel(
      sessionFixture(),
      presenceFixture({
        lastAssistantSnippet: 'Patch applied.',
        updatedAt: '2026-04-24T07:59:50.000Z'
      }),
      NOW_ISO
    )

    expect(viewModel.snippet).toBe('Patch applied.')
    expect(viewModel.lastUpdatedLabel).toBe('10s ago')
  })

  it('uses the assistant snippet and relative age in minutes for older sessions', () => {
    const viewModel = toActiveSessionViewModel(
      sessionFixture(),
      presenceFixture({
        updatedAt: '2026-04-24T07:57:01.000Z'
      }),
      NOW_ISO
    )

    expect(viewModel.lastUpdatedLabel).toBe('2m ago')
  })
})
