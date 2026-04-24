import { describe, expect, it } from 'vitest'

import type { SessionSummary } from './project-session'
import {
  buildActiveSessionViewModel,
  buildAppObservabilitySnapshot,
  buildProjectObservabilitySnapshot,
  buildSessionPresenceSnapshot,
  buildSessionRowViewModel,
  mapPhaseToTone,
  mapStatusToPresencePhase
} from './observability-projection'
import type { ObservabilityTone, SessionPresencePhase } from './observability'
import type { SessionStatus } from './project-session'

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
    updatedAt: '2026-04-24T07:30:00.000Z',
    lastActivatedAt: '2026-04-24T07:45:00.000Z',
    archived: false,
    ...patch
  }
}

const statusPhaseCases: Array<{
  status: SessionStatus
  phase: SessionPresencePhase
}> = [
  { status: 'bootstrapping', phase: 'preparing' },
  { status: 'starting', phase: 'preparing' },
  { status: 'running', phase: 'working' },
  { status: 'turn_complete', phase: 'ready' },
  { status: 'awaiting_input', phase: 'ready' },
  { status: 'needs_confirmation', phase: 'blocked' },
  { status: 'degraded', phase: 'degraded' },
  { status: 'error', phase: 'failed' },
  { status: 'exited', phase: 'exited' }
]

const phaseToneCases: Array<{
  phase: SessionPresencePhase
  tone: ObservabilityTone
}> = [
  { phase: 'preparing', tone: 'neutral' },
  { phase: 'working', tone: 'success' },
  { phase: 'ready', tone: 'accent' },
  { phase: 'blocked', tone: 'warning' },
  { phase: 'degraded', tone: 'warning' },
  { phase: 'failed', tone: 'danger' },
  { phase: 'exited', tone: 'neutral' }
]

describe('observability projection', () => {
  it.each(statusPhaseCases)('maps $status to $phase presence phase', ({ status, phase }) => {
    expect(mapStatusToPresencePhase(status)).toBe(phase)
  })

  it.each(phaseToneCases)('maps $phase phase to $tone tone', ({ phase, tone }) => {
    expect(mapPhaseToTone(phase)).toBe(tone)
  })

  it('builds a session presence snapshot with the approved contract', () => {
    const snapshot = buildSessionPresenceSnapshot(sessionFixture({ status: 'turn_complete' }), {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO,
      modelLabel: 'Sonnet',
      lastAssistantSnippet: 'I finished the implementation.',
      lastEvidenceType: 'evidence.assistant_message',
      lastEventAt: '2026-04-24T07:59:00.000Z'
    })

    expect(snapshot).toEqual({
      sessionId: 'session-1',
      projectId: 'project-1',
      providerId: 'claude-code',
      providerLabel: 'Claude Code',
      modelLabel: 'Sonnet',
      phase: 'ready',
      canonicalStatus: 'turn_complete',
      confidence: 'authoritative',
      health: 'healthy',
      blockingReason: null,
      lastAssistantSnippet: 'I finished the implementation.',
      lastEventAt: '2026-04-24T07:59:00.000Z',
      lastEvidenceType: 'evidence.assistant_message',
      hasUnreadTurn: false,
      recoveryPointerState: 'trusted',
      updatedAt: NOW_ISO
    })
  })

  it('marks inactive assistant snippets as unread turns', () => {
    const snapshot = buildSessionPresenceSnapshot(sessionFixture({ id: 'session-2' }), {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO,
      lastAssistantSnippet: 'Review is ready.',
      lastEvidenceType: 'evidence.assistant_message'
    })

    expect(snapshot.hasUnreadTurn).toBe(true)
  })

  it('builds session row view models with approved labels and attention state', () => {
    const session = sessionFixture({ status: 'needs_confirmation' })
    const snapshot = buildSessionPresenceSnapshot(session, {
      activeSessionId: 'other-session',
      nowIso: NOW_ISO,
      modelLabel: 'Sonnet',
      lastAssistantSnippet: 'Approve the command.',
      lastEvidenceType: 'evidence.assistant_message'
    })

    const viewModel = buildSessionRowViewModel(session, snapshot, NOW_ISO)

    expect(viewModel).toEqual({
      sessionId: 'session-1',
      title: 'Implement feature',
      phase: 'blocked',
      primaryLabel: 'Blocked',
      secondaryLabel: 'Claude Code / Sonnet',
      tone: 'warning',
      hasUnreadTurn: true,
      needsAttention: true,
      attentionReason: 'resume-confirmation',
      updatedAgoLabel: 'Just now'
    })
  })

  it('builds active session view models with descriptor labels', () => {
    const session = sessionFixture({ status: 'turn_complete' })
    const snapshot = buildSessionPresenceSnapshot(session, {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO,
      modelLabel: 'Sonnet',
      lastAssistantSnippet: 'Done.'
    })

    const viewModel = buildActiveSessionViewModel(session, snapshot, NOW_ISO)

    expect(viewModel).toEqual({
      sessionId: 'session-1',
      title: 'Implement feature',
      providerLabel: 'Claude Code',
      modelLabel: 'Sonnet',
      phaseLabel: 'Ready',
      confidenceLabel: 'Authoritative',
      tone: 'accent',
      lastUpdatedLabel: 'Just now',
      snippet: 'Done.',
      explanation: 'Working on feature'
    })
  })

  it('uses canonical shell provider descriptor for snapshot and row label', () => {
    const session = sessionFixture({
      id: 'shell-session',
      type: 'shell',
      status: 'turn_complete',
      externalSessionId: null
    })
    const snapshot = buildSessionPresenceSnapshot(session, {
      activeSessionId: 'shell-session',
      nowIso: NOW_ISO
    })

    const viewModel = buildSessionRowViewModel(session, snapshot, NOW_ISO)

    expect(snapshot.providerId).toBe('local-shell')
    expect(snapshot.providerLabel).toBe('Shell')
    expect(snapshot.recoveryPointerState).toBe('missing')
    expect(viewModel.secondaryLabel).toBe('Shell')
  })

  it('builds project observability snapshots with health and latest attention', () => {
    const blockedSession = buildSessionPresenceSnapshot(
      sessionFixture({ id: 'blocked', status: 'needs_confirmation', updatedAt: '2026-04-24T07:40:00.000Z' }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO, lastAssistantSnippet: 'Approve me.' }
    )
    const failedSession = buildSessionPresenceSnapshot(
      sessionFixture({ id: 'failed', status: 'error', updatedAt: '2026-04-24T07:50:00.000Z' }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO }
    )
    const project = buildProjectObservabilitySnapshot('project-1', [blockedSession, failedSession], NOW_ISO)

    expect(project).toEqual({
      projectId: 'project-1',
      overallHealth: 'lost',
      activeSessionCount: 2,
      blockedSessionCount: 1,
      degradedSessionCount: 0,
      failedSessionCount: 1,
      unreadTurnCount: 1,
      latestAttentionSessionId: 'failed',
      latestAttentionReason: 'provider-error',
      lastEventAt: NOW_ISO,
      updatedAt: NOW_ISO
    })
  })

  it('aggregates provider health, attention projects, and unread turns into the app snapshot', () => {
    const blockedSession = buildSessionPresenceSnapshot(
      sessionFixture({ id: 'blocked-session', projectId: 'project-blocked', status: 'needs_confirmation' }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO, lastAssistantSnippet: 'Please approve this action.' }
    )
    const failedSession = buildSessionPresenceSnapshot(
      sessionFixture({ id: 'failed-session', projectId: 'project-failed', status: 'error', type: 'codex' }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO }
    )
    const degradedSession = buildSessionPresenceSnapshot(
      sessionFixture({ id: 'degraded-session', projectId: 'project-degraded', status: 'degraded', type: 'shell' }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO }
    )
    const projects = [
      buildProjectObservabilitySnapshot('project-blocked', [blockedSession], NOW_ISO),
      buildProjectObservabilitySnapshot('project-failed', [failedSession], NOW_ISO),
      buildProjectObservabilitySnapshot('project-degraded', [degradedSession], NOW_ISO)
    ]

    const app = buildAppObservabilitySnapshot(projects, [blockedSession, failedSession, degradedSession], NOW_ISO)

    expect(app).toEqual({
      blockedProjectCount: 1,
      failedProjectCount: 1,
      degradedProjectCount: 1,
      totalUnreadTurns: 1,
      projectsNeedingAttention: ['project-blocked', 'project-failed', 'project-degraded'],
      providerHealthSummary: {
        'claude-code': 'degraded',
        codex: 'lost',
        'local-shell': 'degraded'
      },
      lastGlobalEventAt: NOW_ISO,
      updatedAt: NOW_ISO
    })
  })
})
