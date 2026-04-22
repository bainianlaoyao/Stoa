import { beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from './workspaces'

describe('project/session renderer store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('hydrates explicit projects and sessions without name+path grouping', () => {
    const store = useWorkspaceStore()

    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_op_1',
      terminalWebhookPort: 43127,
      projects: [
        {
          id: 'project_alpha',
          name: 'alpha',
          path: 'D:/alpha',
          createdAt: 'a',
          updatedAt: 'a'
        }
      ],
      sessions: [
        {
          id: 'session_op_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'running',
          title: 'Deploy',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false
        }
      ]
    })

    expect(store.activeProjectId).toBe('project_alpha')
    expect(store.activeSessionId).toBe('session_op_1')
    expect(store.projectHierarchy).toHaveLength(1)
    expect(store.projectHierarchy[0]?.sessions).toHaveLength(1)
    expect(store.projectHierarchy[0]?.sessions[0]?.active).toBe(true)
  })

  test('selecting a session also activates its parent project', () => {
    const store = useWorkspaceStore()
    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_shell_1',
      terminalWebhookPort: 43127,
      projects: [
        {
          id: 'project_alpha',
          name: 'alpha',
          path: 'D:/alpha',
          createdAt: 'a',
          updatedAt: 'a'
        },
        {
          id: 'project_beta',
          name: 'beta',
          path: 'D:/beta',
          createdAt: 'b',
          updatedAt: 'b'
        }
      ],
      sessions: [
        {
          id: 'session_shell_1',
          projectId: 'project_alpha',
          type: 'shell',
          status: 'running',
          summary: 'running',
          title: 'Shell 1',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false
        },
        {
          id: 'session_op_2',
          projectId: 'project_beta',
          type: 'opencode',
          status: 'bootstrapping',
          summary: 'waiting',
          title: 'Deploy',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-2',
          createdAt: 'b',
          updatedAt: 'b',
          lastActivatedAt: 'b',
          archived: false
        }
      ]
    })

    store.setActiveSession('session_op_2')

    expect(store.activeProjectId).toBe('project_beta')
    expect(store.activeSessionId).toBe('session_op_2')
    expect(store.activeSession?.title).toBe('Deploy')
  })

  test('derives project hierarchy from canonical project/session state without mutating truth state', () => {
    const store = useWorkspaceStore()

    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_op_2',
      terminalWebhookPort: 42017,
      projects: [
        {
          id: 'project_alpha',
          name: 'infra-control',
          path: 'D:/infra-control',
          createdAt: 'a',
          updatedAt: 'a'
        }
      ],
      sessions: [
        {
          id: 'session_op_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'running',
          title: 'deploy gateway',
          summary: 'deploy gateway',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_a1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false
        },
        {
          id: 'session_op_2',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'awaiting_input',
          title: 'need confirmation',
          summary: 'need confirmation',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_a2',
          createdAt: 'b',
          updatedAt: 'b',
          lastActivatedAt: 'b',
          archived: false
        }
      ]
    })

    expect(store.projectHierarchy).toHaveLength(1)
    expect(store.projectHierarchy[0]?.sessions).toHaveLength(2)
    expect(store.activeSession?.id).toBe('session_op_2')
    expect(store.sessions).toHaveLength(2)
    expect(store.projectHierarchy[0]?.sessions[0]?.externalSessionId).toBe('sess_a1')
  })

  describe('archive and restore', () => {
    beforeEach(() => {
      setActivePinia(createPinia())
    })

    test('projectHierarchy excludes archived sessions', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_shell_1',
        terminalWebhookPort: 43127,
        projects: [
          {
            id: 'project_alpha',
            name: 'alpha',
            path: 'D:/alpha',
            createdAt: 'a',
            updatedAt: 'a'
          }
        ],
        sessions: [
          {
            id: 'session_shell_1',
            projectId: 'project_alpha',
            type: 'shell',
            status: 'running',
            summary: 'running',
            title: 'Shell 1',
            recoveryMode: 'fresh-shell',
            externalSessionId: null,
            createdAt: 'a',
            updatedAt: 'a',
            lastActivatedAt: 'a',
            archived: false
          },
          {
            id: 'session_archived',
            projectId: 'project_alpha',
            type: 'shell',
            status: 'exited',
            summary: 'done',
            title: 'Old Shell',
            recoveryMode: 'fresh-shell',
            externalSessionId: null,
            createdAt: 'a',
            updatedAt: 'a',
            lastActivatedAt: 'a',
            archived: true
          }
        ]
      })

      expect(store.projectHierarchy).toHaveLength(1)
      expect(store.projectHierarchy[0]!.sessions).toHaveLength(1)
      expect(store.projectHierarchy[0]!.sessions[0]!.id).toBe('session_shell_1')
    })

    test('archiveSession marks session and clears activeSessionId', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_shell_1',
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          {
            id: 'session_shell_1',
            projectId: 'project_alpha',
            type: 'shell',
            status: 'running',
            summary: 'running',
            title: 'Shell 1',
            recoveryMode: 'fresh-shell',
            externalSessionId: null,
            createdAt: 'a',
            updatedAt: 'a',
            lastActivatedAt: 'a',
            archived: false
          }
        ]
      })

      store.archiveSession('session_shell_1')

      expect(store.sessions[0]!.archived).toBe(true)
      expect(store.activeSessionId).toBeNull()
    })

    test('restoreSession unarchives session', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          {
            id: 'session_archived',
            projectId: 'project_alpha',
            type: 'shell',
            status: 'exited',
            summary: 'done',
            title: 'Old Shell',
            recoveryMode: 'fresh-shell',
            externalSessionId: null,
            createdAt: 'a',
            updatedAt: 'a',
            lastActivatedAt: 'a',
            archived: true
          }
        ]
      })

      store.restoreSession('session_archived')

      expect(store.sessions[0]!.archived).toBe(false)
    })
  })
})
