import { describe, expect, it } from 'vitest'
import type {
  PersistedAppStateV2,
  ProjectSummary,
  SessionSummary,
  SessionType
} from './project-session'
import { getProviderDescriptorBySessionType, listProviderDescriptors } from './provider-descriptors'

describe('project/session shared contracts', () => {
  it('models canonical project -> session hierarchy', () => {
    const project: ProjectSummary = {
      id: 'project_alpha',
      name: 'alpha',
      path: 'D:/alpha',
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z'
    }

    const session: SessionSummary = {
      id: 'session_shell_1',
      projectId: 'project_alpha',
      type: 'shell' satisfies SessionType,
      status: 'running',
      title: 'Shell 1',
      summary: 'attached',
      recoveryMode: 'fresh-shell',
      externalSessionId: null,
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      lastActivatedAt: '2026-04-19T00:00:00.000Z',
      archived: false
    }

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
          last_known_status: session.status,
          last_summary: session.summary,
          external_session_id: null,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          last_activated_at: session.lastActivatedAt,
          recovery_mode: session.recoveryMode,
          archived: session.archived
        }
      ]
    }

    expect(state.projects[0]?.path).toBe('D:/alpha')
    expect(state.sessions[0]?.project_id).toBe('project_alpha')
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
})
