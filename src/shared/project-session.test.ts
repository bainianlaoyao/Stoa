import { describe, expect, it } from 'vitest'
import type {
  BootstrapState,
  PersistedAppStateV2,
  PersistedProjectSessions,
  ProjectSummary,
  SessionRuntimeState,
  SessionGraphEvent,
  SessionNodeSnapshot,
  SessionSummary,
  SessionType
} from './project-session'
import {
  sanitizeBootstrapStateForGenericProjection,
  sanitizeSessionGraphEventForGenericProjection,
  sanitizeSessionNodeSnapshotForGenericProjection,
  sanitizeSessionSummaryForGenericProjection
} from './project-session'
import { getProviderDescriptorBySessionType, listProviderDescriptors } from './provider-descriptors'
import { createSessionSummaryFixture } from './test-fixtures'

describe('project/session shared contracts', () => {
  it('models canonical project -> session hierarchy', () => {
    const project: ProjectSummary = {
      id: 'project_alpha',
      name: 'alpha',
      path: 'D:/alpha',
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z'
    }

    const session: SessionSummary = createSessionSummaryFixture({
      id: 'session_shell_1',
      projectId: 'project_alpha',
      type: 'shell' satisfies SessionType,
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 0,
      lastTurnOutcome: 'none',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      lastStateSequence: 0,
      title: 'Shell 1',
      summary: 'attached',
      recoveryMode: 'fresh-shell',
      externalSessionId: null,
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      lastActivatedAt: '2026-04-19T00:00:00.000Z',
      archived: false
    })

    const state: PersistedAppStateV2 = {
      version: 2,
      active_project_id: 'project_alpha',
      active_session_id: 'session_shell_1',
      projects: [
        {
          project_id: project.id,
          name: project.name,
          path: project.path,
          created_at: project.createdAt,
          updated_at: project.updatedAt
        }
      ],
      sessions: [
        {
          session_id: session.id,
          project_id: session.projectId,
          type: session.type,
          title: session.title,
          runtime_state: session.runtimeState,
          turn_state: session.turnState,
          turn_epoch: session.turnEpoch,
          last_turn_outcome: session.lastTurnOutcome,
          blocking_reason: session.blockingReason,
          failure_reason: session.failureReason,
          has_unseen_completion: session.hasUnseenCompletion,
          runtime_exit_code: session.runtimeExitCode,
          runtime_exit_reason: session.runtimeExitReason,
          last_state_sequence: session.lastStateSequence,
          last_summary: session.summary,
          external_session_id: null,
          title_generation: session.titleGenerationContext,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          last_activated_at: session.lastActivatedAt,
          recovery_mode: session.recoveryMode,
          archived: session.archived,
          parent_session_id: session.parentSessionId,
          created_by_session_id: session.createdBySessionId
        }
      ]
    }

    expect(state.projects[0]?.path).toBe('D:/alpha')
    expect(state.sessions[0]?.project_id).toBe('project_alpha')

    const projectSessions: PersistedProjectSessions = {
      version: 7,
      project_id: project.id,
      sessions: [
        {
          session_id: session.id,
          project_id: session.projectId,
          type: session.type,
          title: session.title,
          runtime_state: session.runtimeState,
          turn_state: session.turnState,
          turn_epoch: session.turnEpoch,
          last_turn_outcome: session.lastTurnOutcome,
          blocking_reason: session.blockingReason,
          failure_reason: session.failureReason,
          has_unseen_completion: session.hasUnseenCompletion,
          runtime_exit_code: session.runtimeExitCode,
          runtime_exit_reason: session.runtimeExitReason,
          last_state_sequence: session.lastStateSequence,
          last_summary: session.summary,
          external_session_id: null,
          title_generation: session.titleGenerationContext,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          last_activated_at: session.lastActivatedAt,
          recovery_mode: session.recoveryMode,
          archived: session.archived,
          parent_session_id: session.parentSessionId,
          created_by_session_id: session.createdBySessionId
        }
      ]
    }

    expect(projectSessions.version).toBe(7)
    expect(projectSessions.sessions[0]?.runtime_state).toBe('alive')
    expect(projectSessions.sessions[0]?.turn_state).toBe('idle')
  })

  it('supports shell, opencode, codex, and claude-code session types', () => {
    const sessionTypes: SessionType[] = ['shell', 'opencode', 'codex', 'claude-code']

    expect(sessionTypes).toEqual(['shell', 'opencode', 'codex', 'claude-code'])
    expect(getProviderDescriptorBySessionType('claude-code')).toMatchObject({
      providerId: 'claude-code',
      executableName: 'claude',
      titlePrefix: 'claude',
      seedsExternalSessionId: true
    })
    expect(getProviderDescriptorBySessionType('codex')).toMatchObject({
      providerId: 'codex',
      executableName: 'codex',
      supportsResume: true
    })
    expect(listProviderDescriptors().map((descriptor) => descriptor.sessionType)).toEqual([
      'opencode',
      'codex',
      'claude-code',
      'shell'
    ])
  })

  it('supports runtime and turn session states', () => {
    const runtimeState: SessionRuntimeState = 'alive'
    const turnState = 'idle' as const

    expect(runtimeState).toBe('alive')
    expect(turnState).toBe('idle')
  })

  it('sanitizes generic session projections to remove full subagent result bodies', () => {
    const session = createSessionSummaryFixture({
      id: 'session_child_1',
      projectId: 'project_alpha',
      parentSessionId: 'session_root_1',
      createdBySessionId: 'session_root_1',
      subagentResultSummary: {
        status: 'completed',
        title: 'done',
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:01.000Z',
        hasBody: true
      },
      subagentResult: {
        sessionId: 'session_child_1',
        parentSessionId: 'session_root_1',
        inputEpoch: 1,
        status: 'completed',
        title: 'done',
        body: 'secret body',
        createdAt: '2026-06-11T00:00:00.000Z',
        updatedAt: '2026-06-11T00:00:01.000Z'
      }
    })
    const node: SessionNodeSnapshot = {
      session,
      tree: {
        rootSessionId: 'session_root_1',
        depth: 1,
        childCount: 0,
        descendantCount: 0
      }
    }
    const bootstrap: BootstrapState = {
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_root_1',
      terminalWebhookPort: null,
      projects: [{
        id: 'project_alpha',
        name: 'alpha',
        path: 'D:/alpha',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z'
      }],
      sessions: [session]
    }
    const event: SessionGraphEvent = {
      kind: 'updated',
      graphVersion: 1,
      origin: 'system',
      initiatorSessionId: null,
      node
    }

    expect(sanitizeSessionSummaryForGenericProjection(session).subagentResult).toBeUndefined()
    expect(sanitizeSessionNodeSnapshotForGenericProjection(node).session.subagentResult).toBeUndefined()
    expect(sanitizeBootstrapStateForGenericProjection(bootstrap).sessions[0]?.subagentResult).toBeUndefined()
    expect(sanitizeSessionGraphEventForGenericProjection(event).node.session.subagentResult).toBeUndefined()
  })
})
