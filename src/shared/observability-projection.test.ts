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

const NOW_ISO = '2026-04-24T08:00:00.000Z'

function sessionFixture(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-1',
    projectId: 'project-1',
    type: 'claude-code',
    status: 'running',
    title: 'Implement feature',
    summary: 'Working on feature',
    runtimeState: 'alive',
    agentState: 'idle',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 1,
    blockingReason: null,
    recoveryMode: 'resume-external',
    externalSessionId: 'external-1',
    createdAt: '2026-04-24T07:00:00.000Z',
    updatedAt: '2026-04-24T07:30:00.000Z',
    lastActivatedAt: '2026-04-24T07:45:00.000Z',
    archived: false,
    ...patch
  }
}

describe('observability projection', () => {
  it('labels working agent phase as Running', () => {
    const snapshot = buildSessionPresenceSnapshot(sessionFixture({ agentState: 'working' }), {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO
    })

    expect(snapshot.phase).toBe('running')
    expect(phaseLabel(snapshot.phase)).toBe('Running')
    expect(buildSessionRowViewModel(sessionFixture({ agentState: 'working' }), snapshot, NOW_ISO).primaryLabel).toBe('Running')
  })

  it('labels idle unseen completion as Complete', () => {
    const snapshot = buildSessionPresenceSnapshot(sessionFixture({
      agentState: 'idle',
      hasUnseenCompletion: true
    }), {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO
    })

    expect(snapshot.phase).toBe('complete')
    expect(phaseLabel(snapshot.phase)).toBe('Complete')
  })

  it('uses danger tone for failed before complete and blocked', () => {
    const failedSnapshot = buildSessionPresenceSnapshot(sessionFixture({
      agentState: 'error',
      hasUnseenCompletion: true,
      blockingReason: 'permission'
    }), {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO
    })

    expect(failedSnapshot.phase).toBe('failed')
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
    const snapshot = buildSessionPresenceSnapshot(sessionFixture({
      status: 'turn_complete',
      agentState: 'idle',
      hasUnseenCompletion: true
    }), {
      activeSessionId: 'session-1',
      nowIso: NOW_ISO,
      modelLabel: 'Sonnet',
      lastAssistantSnippet: 'I finished the implementation.',
      lastEvidenceType: 'evidence.assistant_message',
      lastEventAt: '2026-04-24T07:59:00.000Z',
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
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: null,
      runtimeExitReason: null,
      confidence: 'authoritative',
      health: 'healthy',
      blockingReason: null,
      lastAssistantSnippet: 'I finished the implementation.',
      lastEventAt: '2026-04-24T07:59:00.000Z',
      lastEvidenceType: 'evidence.assistant_message',
      hasUnreadTurn: false,
      recoveryPointerState: 'trusted',
      sourceSequence: 42,
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
    const session = sessionFixture({
      status: 'needs_confirmation',
      agentState: 'blocked',
      blockingReason: 'resume-confirmation'
    })
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
    const session = sessionFixture({
      status: 'turn_complete',
      agentState: 'idle',
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

  it('uses canonical shell provider descriptor for snapshot and row label', () => {
    const session = sessionFixture({
      id: 'shell-session',
      type: 'shell',
      status: 'turn_complete',
      agentState: 'idle',
      hasUnseenCompletion: true,
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

  it('builds project attention with failed first then complete and blocked', () => {
    const blockedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'blocked',
        agentState: 'blocked',
        blockingReason: 'resume-confirmation',
        updatedAt: '2026-04-24T07:59:00.000Z'
      }),
      {
        activeSessionId: 'active-session',
        nowIso: NOW_ISO,
        lastAssistantSnippet: 'Approve me.',
        lastEventAt: '2026-04-24T07:58:00.000Z'
      }
    )
    const completeSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'complete',
        agentState: 'idle',
        hasUnseenCompletion: true,
        updatedAt: '2026-04-24T07:58:00.000Z'
      }),
      {
        activeSessionId: 'active-session',
        nowIso: NOW_ISO,
        lastEventAt: '2026-04-24T07:59:00.000Z'
      }
    )
    const failedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'failed',
        agentState: 'error',
        updatedAt: '2026-04-24T07:40:00.000Z'
      }),
      {
        activeSessionId: 'active-session',
        nowIso: NOW_ISO,
        lastEventAt: '2026-04-24T07:40:00.000Z'
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
      degradedSessionCount: 0,
      failedSessionCount: 1,
      unreadTurnCount: 1,
      latestAttentionSessionId: 'failed',
      latestAttentionReason: 'provider-error',
      lastEventAt: '2026-04-24T07:59:00.000Z',
      sourceSequence: 0,
      updatedAt: NOW_ISO
    })
  })

  it('aggregates provider health, attention projects, and unread turns into the app snapshot', () => {
    const blockedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'blocked-session',
        projectId: 'project-blocked',
        status: 'needs_confirmation',
        agentState: 'blocked',
        blockingReason: 'resume-confirmation'
      }),
      { activeSessionId: 'active-session', nowIso: NOW_ISO, lastAssistantSnippet: 'Please approve this action.' }
    )
    const failedSession = buildSessionPresenceSnapshot(
      sessionFixture({
        id: 'failed-session',
        projectId: 'project-failed',
        status: 'error',
        type: 'codex',
        agentState: 'error'
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
      degradedProjectCount: 0,
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
