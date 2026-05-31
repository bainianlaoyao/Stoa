import { describe, expect, it } from 'vitest'

import type { SessionSummary } from './project-session'
import {
  buildActiveSessionViewModel,
  buildAppObservabilitySnapshot,
  buildProjectObservabilitySnapshot,
  buildSessionPresenceSnapshot,
  buildSessionRowViewModel,
  mapPhaseToTone,
  phaseLabel
} from './observability-projection'
import { createSessionSummaryFixture, createTitleGenerationContext } from './test-fixtures'

const NOW_ISO = '2026-05-06T08:00:00.000Z'

function sessionFixture(patch: Partial<SessionSummary> = {}): SessionSummary {
  return createSessionSummaryFixture({
    id: 'session-1',
    projectId: 'project-1',
    type: 'claude-code',
    title: 'Implement feature',
    summary: 'Working on feature',
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
    recoveryMode: 'resume-external',
    externalSessionId: 'external-1',
    createdAt: '2026-05-06T07:00:00.000Z',
    updatedAt: '2026-05-06T07:30:00.000Z',
    lastActivatedAt: '2026-05-06T07:45:00.000Z',
    archived: false,
    ...patch,
    titleGenerationContext: patch.titleGenerationContext ?? createTitleGenerationContext()
  })
}

describe('observability projection', () => {
  it('labels running turns as Running', () => {
    const running = sessionFixture({ turnState: 'running', turnEpoch: 1 })
    const snapshot = buildSessionPresenceSnapshot(running, {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO
    })

    expect(snapshot.phase).toBe('running')
    expect(phaseLabel(snapshot.phase)).toBe('Running')
    expect(buildSessionRowViewModel(running, snapshot, NOW_ISO).primaryLabel).toBe('Running')
  })

  it('labels completed unseen turns as Complete', () => {
    const completed = sessionFixture({
      turnState: 'idle',
      turnEpoch: 2,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })
    const snapshot = buildSessionPresenceSnapshot(completed, {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO
    })

    expect(snapshot.phase).toBe('complete')
    expect(phaseLabel(snapshot.phase)).toBe('Complete')
  })

  it('uses danger tone for failure before complete and blocked', () => {
    const failedSnapshot = buildSessionPresenceSnapshot(
      sessionFixture({
        turnState: 'idle',
        turnEpoch: 2,
        lastTurnOutcome: 'failed',
        failureReason: 'provider_error',
        hasUnseenCompletion: true,
        blockingReason: 'permission'
      }),
      {
        activeSessionId: 'session-1',
        nowIso: NOW_ISO
      }
    )

    expect(failedSnapshot.phase).toBe('failure')
    expect(mapPhaseToTone(failedSnapshot.phase)).toBe('danger')
  })

  it('uses warning tone for complete and blocked', () => {
    expect(mapPhaseToTone('complete')).toBe('warning')
    expect(mapPhaseToTone('blocked')).toBe('warning')
  })

  it('uses neutral tone for ready', () => {
    expect(mapPhaseToTone('ready')).toBe('neutral')
  })

  it('builds a session presence snapshot with the approved contract', () => {
    const session = sessionFixture({
      turnState: 'idle',
      turnEpoch: 2,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })
    const snapshot = buildSessionPresenceSnapshot(session, {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO,
      modelLabel: 'Sonnet',
      lastAssistantSnippet: 'I finished the implementation.',
      lastEvidenceType: 'evidence.assistant_message',
      lastEventAt: '2026-05-06T07:59:00.000Z',
      evidenceSequence: 17,
      sourceSequence: 42
    })

    expect(snapshot).toEqual({
      sessionId: 'session-1',
      projectId: 'project-1',
      providerId: 'claude-code',
      providerLabel: 'Claude Code',
      modelLabel: 'Sonnet',
      phase: 'complete',
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 2,
      lastTurnOutcome: 'completed',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: true,
      runtimeExitCode: null,
      runtimeExitReason: null,
      confidence: 'authoritative',
      health: 'healthy',
      lastAssistantSnippet: 'I finished the implementation.',
      lastEventAt: '2026-05-06T07:59:00.000Z',
      lastEvidenceType: 'evidence.assistant_message',
      hasUnreadTurn: false,
      recoveryPointerState: 'trusted',
      evidenceSequence: 17,
      sourceSequence: 42,
      updatedAt: NOW_ISO
    })
  })

  it('builds session row view models with approved labels and attention state', () => {
    const session = sessionFixture({
      turnState: 'running',
      turnEpoch: 3,
      blockingReason: 'elicitation'
    })
    const snapshot = buildSessionPresenceSnapshot(session, {
      activeSessionId: 'other-session',
      nowIso: NOW_ISO,
      modelLabel: 'Sonnet',
      lastAssistantSnippet: 'Answer this question.',
      lastEvidenceType: 'evidence.assistant_message'
    })

    const viewModel = buildSessionRowViewModel(session, snapshot, NOW_ISO)

    expect(viewModel).toEqual({
      sessionId: 'session-1',
      title: 'Implement feature',
      phase: 'blocked',
      primaryLabel: 'Blocked',
      secondaryLabel: 'Sonnet',
      tone: 'warning',
      hasUnreadTurn: true,
      needsAttention: true,
      attentionReason: 'elicitation',
      updatedAgoLabel: 'Just now'
    })
  })

  it('builds active session view models with descriptor labels', () => {
    const session = sessionFixture({
      turnState: 'idle',
      turnEpoch: 4,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })
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
      phaseLabel: 'Complete',
      confidenceLabel: 'Authoritative',
      tone: 'warning',
      lastUpdatedLabel: 'Just now',
      snippet: 'Done.',
      explanation: 'Working on feature'
    })
  })

  it('builds project attention with failure first then complete and blocked', () => {
    const blockedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'blocked',
        turnState: 'running',
        turnEpoch: 1,
        blockingReason: 'permission'
      }),
      {
        activeSessionId: 'active-session',
        nowIso: NOW_ISO,
        lastAssistantSnippet: 'Approve me.',
        lastEventAt: '2026-05-06T07:58:00.000Z'
      }
    )
    const completeSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'complete',
        turnState: 'idle',
        turnEpoch: 2,
        lastTurnOutcome: 'completed',
        hasUnseenCompletion: true
      }),
      {
        activeSessionId: 'active-session',
        nowIso: NOW_ISO,
        lastEventAt: '2026-05-06T07:59:00.000Z'
      }
    )
    const failedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'failed',
        turnState: 'idle',
        turnEpoch: 3,
        lastTurnOutcome: 'failed',
        failureReason: 'provider_error'
      }),
      {
        activeSessionId: 'active-session',
        nowIso: NOW_ISO,
        lastEventAt: '2026-05-06T07:40:00.000Z'
      }
    )
    const completeBeforeBlocked = buildProjectObservabilitySnapshot('project-1', [blockedSession, completeSession], NOW_ISO)
    const failedBeforeCompleteAndBlocked = buildProjectObservabilitySnapshot(
      'project-1',
      [blockedSession, completeSession, failedSession],
      NOW_ISO
    )

    expect(completeBeforeBlocked).toMatchObject({
      latestAttentionSessionId: 'complete',
      latestAttentionReason: 'turn-complete'
    })
    expect(failedBeforeCompleteAndBlocked).toEqual({
      projectId: 'project-1',
      overallHealth: 'lost',
      activeSessionCount: 3,
      blockedSessionCount: 1,
      failedSessionCount: 1,
      unreadTurnCount: 1,
      latestAttentionSessionId: 'failed',
      latestAttentionReason: 'provider_error',
      lastEventAt: '2026-05-06T07:59:00.000Z',
      sourceSequence: 0,
      updatedAt: NOW_ISO
    })
  })

  it('aggregates provider health, attention projects, and unread turns into the app snapshot', () => {
    const blockedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'blocked-session',
        projectId: 'project-blocked',
        turnState: 'running',
        turnEpoch: 1,
        blockingReason: 'permission'
      }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO, lastAssistantSnippet: 'Please approve this action.' }
    )
    const failedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'failed-session',
        projectId: 'project-failed',
        type: 'codex',
        turnState: 'idle',
        turnEpoch: 1,
        lastTurnOutcome: 'failed',
        failureReason: 'provider_error'
      }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO }
    )
    const projects = [
      buildProjectObservabilitySnapshot('project-blocked', [blockedSession], NOW_ISO),
      buildProjectObservabilitySnapshot('project-failed', [failedSession], NOW_ISO)
    ]

    const app = buildAppObservabilitySnapshot(projects, [blockedSession, failedSession], NOW_ISO)

    expect(app).toEqual({
      blockedProjectCount: 1,
      failedProjectCount: 1,
      totalUnreadTurns: 1,
      projectsNeedingAttention: ['project-blocked', 'project-failed'],
      providerHealthSummary: {
        'claude-code': 'healthy',
        codex: 'lost'
      },
      lastGlobalEventAt: NOW_ISO,
      sourceSequence: 0,
      updatedAt: NOW_ISO
    })
  })
})
