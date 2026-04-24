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
    phase: 'working',
    canonicalStatus: 'running',
    confidence: 'authoritative',
    health: 'healthy',
    blockingReason: null,
    lastAssistantSnippet: 'I am working on it.',
    lastEventAt: '2026-04-24T07:59:50.000Z',
    lastEvidenceType: 'evidence.assistant_message',
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
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
        canonicalStatus: 'turn_complete',
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
      tone: 'accent',
      hasUnreadTurn: false,
      needsAttention: false,
      attentionReason: null,
      updatedAgoLabel: '2m ago'
    })
  })

  it('forwards the semantic phase needed to distinguish blocked and degraded rows', () => {
    const blockedPresence = buildSessionPresenceSnapshot(
      sessionFixture({ status: 'needs_confirmation' }),
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
    const degradedViewModel = toSessionRowViewModel(
      sessionFixture({ status: 'degraded' }),
      presenceFixture({
        phase: 'degraded',
        canonicalStatus: 'degraded',
        health: 'degraded'
      }),
      NOW_ISO
    )

    expect(blockedViewModel.tone).toBe('warning')
    expect(blockedViewModel.phase).toBe('blocked')
    expect(blockedViewModel.attentionReason).toBe('resume-confirmation')
    expect(degradedViewModel.tone).toBe('warning')
    expect(degradedViewModel.phase).toBe('degraded')
    expect(degradedViewModel.attentionReason).toBe('degraded')
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
    [null, 'degraded', 'Structured provider state is partially unavailable.'],
    ['provider-error', 'failed', 'Provider reported an error.'],
    [null, 'working', null]
  ] as const)('maps blocking and degraded/failed states to the expected explanation', (blockingReason, phase, explanation) => {
    const viewModel = toActiveSessionViewModel(
      sessionFixture(),
      presenceFixture({
        blockingReason,
        phase,
        health: phase === 'failed' ? 'lost' : phase === 'degraded' ? 'degraded' : 'healthy'
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
