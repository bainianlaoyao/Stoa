import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'
import type { RendererApi, SessionSummary } from '@shared/project-session'
import { useWorkspaceStore } from './workspaces'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    getBootstrapState: vi.fn().mockResolvedValue({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }),
    createProject: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue(null),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn().mockResolvedValue(undefined),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue({
      blockedProjectCount: 0,
      failedProjectCount: 0,
      degradedProjectCount: 0,
      totalUnreadTurns: 0,
      projectsNeedingAttention: [],
      providerHealthSummary: {},
      lastGlobalEventAt: null,
      sourceSequence: 0,
      updatedAt: '2026-04-24T08:00:00.000Z'
    }),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminalFontSize: 14,
      terminalFontFamily: 'JetBrains Mono',
      providers: {},
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    getUpdateState: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    checkForUpdates: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    downloadUpdate: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    dismissUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

function sessionPresenceFixture(patch: Partial<SessionPresenceSnapshot> = {}): SessionPresenceSnapshot {
  return {
    sessionId: 'session_op_1',
    projectId: 'project_alpha',
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
    lastAssistantSnippet: null,
    lastEventAt: '2026-04-24T07:59:50.000Z',
    lastEvidenceType: null,
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    evidenceSequence: 1,
    sourceSequence: 1,
    updatedAt: '2026-04-24T07:59:50.000Z',
    ...patch
  }
}

function projectObservabilityFixture(
  patch: Partial<ProjectObservabilitySnapshot> = {}
): ProjectObservabilitySnapshot {
  return {
    projectId: 'project_alpha',
    overallHealth: 'healthy',
    activeSessionCount: 1,
    blockedSessionCount: 0,
    degradedSessionCount: 0,
    failedSessionCount: 0,
    unreadTurnCount: 0,
    latestAttentionSessionId: null,
    latestAttentionReason: null,
    lastEventAt: '2026-04-24T07:59:50.000Z',
    sourceSequence: 1,
    updatedAt: '2026-04-24T08:00:00.000Z',
    ...patch
  }
}

function appObservabilityFixture(patch: Partial<AppObservabilitySnapshot> = {}): AppObservabilitySnapshot {
  return {
    blockedProjectCount: 0,
    failedProjectCount: 0,
    degradedProjectCount: 0,
    totalUnreadTurns: 0,
    projectsNeedingAttention: [],
    providerHealthSummary: {},
    lastGlobalEventAt: null,
    sourceSequence: 1,
    updatedAt: '2026-04-24T08:00:00.000Z',
    ...patch
  }
}

function observationEventFixture(patch: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    eventId: 'event-1',
    eventVersion: 1,
    sequence: 2,
    occurredAt: '2026-04-24T08:00:01.000Z',
    ingestedAt: '2026-04-24T08:00:01.000Z',
    scope: 'session',
    projectId: 'project_alpha',
    sessionId: 'session_op_1',
    providerId: 'claude-code',
    category: 'presence',
    type: 'presence.turn_complete',
    severity: 'info',
    retention: 'operational',
    source: 'provider-adapter',
    correlationId: null,
    dedupeKey: null,
    payload: {},
    ...patch
  }
}

function sessionSummaryFixture(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_op_1',
    projectId: 'project_alpha',
    type: 'opencode',
    status: 'running',
    runtimeState: 'alive',
    agentState: 'working',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 1,
    blockingReason: null,
    title: 'Deploy',
    summary: 'running',
    recoveryMode: 'resume-external',
    externalSessionId: 'ext-1',
    createdAt: 'a',
    updatedAt: 'a',
    lastActivatedAt: 'a',
    archived: false,
    ...patch
  }
}

describe('project/session renderer store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createStoaMock()
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
          runtimeState: 'alive',
          agentState: 'working',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 0,
          blockingReason: null,
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
        sessionSummaryFixture({
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
        }),
        sessionSummaryFixture({
          id: 'session_op_2',
          projectId: 'project_beta',
          type: 'opencode',
          status: 'bootstrapping',
          runtimeState: 'created',
          agentState: 'unknown',
          summary: 'waiting',
          title: 'Deploy',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-2',
          createdAt: 'b',
          updatedAt: 'b',
          lastActivatedAt: 'b',
          archived: false
        })
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
        sessionSummaryFixture({
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
        }),
        sessionSummaryFixture({
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
        })
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

    test('projectHierarchy derives archived sessions per project from canonical sessions', () => {
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
          sessionSummaryFixture({
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
          }),
          sessionSummaryFixture({
            id: 'session_archived',
            projectId: 'project_alpha',
            type: 'shell',
            status: 'exited',
            runtimeState: 'exited',
            agentState: 'idle',
            runtimeExitCode: 0,
            runtimeExitReason: 'clean',
            summary: 'done',
            title: 'Old Shell',
            recoveryMode: 'fresh-shell',
            externalSessionId: null,
            createdAt: 'a',
            updatedAt: 'a',
            lastActivatedAt: 'a',
            archived: true
          })
        ]
      })

      expect(store.projectHierarchy).toHaveLength(1)
      expect(store.projectHierarchy[0]!.sessions.map((session) => session.id)).toEqual(['session_shell_1'])
      expect(store.projectHierarchy[0]!.archivedSessions.map((session) => session.id)).toEqual(['session_archived'])
    })

    test('archiveSession moves a session from active rows to archived rows for its project', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_shell_1',
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          sessionSummaryFixture({
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
          })
        ]
      })

      store.archiveSession('session_shell_1')

      expect(store.sessions[0]!.archived).toBe(true)
      expect(store.projectHierarchy[0]!.sessions).toHaveLength(0)
      expect(store.projectHierarchy[0]!.archivedSessions[0]!.id).toBe('session_shell_1')
      expect(store.activeSessionId).toBeNull()
    })

    test('restoreSession moves a session from archived rows back to active rows for its project', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          sessionSummaryFixture({
            id: 'session_archived',
            projectId: 'project_alpha',
            type: 'shell',
            status: 'exited',
            runtimeState: 'exited',
            agentState: 'idle',
            runtimeExitCode: 0,
            runtimeExitReason: 'clean',
            summary: 'done',
            title: 'Old Shell',
            recoveryMode: 'fresh-shell',
            externalSessionId: null,
            createdAt: 'a',
            updatedAt: 'a',
            lastActivatedAt: 'a',
            archived: true
          })
        ]
      })

      store.restoreSession('session_archived')

      expect(store.sessions[0]!.archived).toBe(false)
      expect(store.projectHierarchy[0]!.archivedSessions).toHaveLength(0)
      expect(store.projectHierarchy[0]!.sessions[0]!.id).toBe('session_archived')
    })
  })

  describe('observability', () => {
    test('hydrates initial observability snapshots from the renderer bridge without changing bootstrap hydrate semantics', async () => {
      const sessionPresence = sessionPresenceFixture()
      const projectObservability = projectObservabilityFixture()
      const appObservability = appObservabilityFixture({
        totalUnreadTurns: 2,
        projectsNeedingAttention: ['project_alpha']
      })

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockResolvedValue(sessionPresence),
        getProjectObservability: vi.fn().mockResolvedValue(projectObservability),
        getAppObservability: vi.fn().mockResolvedValue(appObservability)
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          sessionSummaryFixture({
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
          })
        ]
      })

      expect(store.sessionPresenceById).toEqual({})
      expect(store.projectObservabilityById).toEqual({})
      expect(store.appObservability).toBeNull()

      await store.hydrateObservability()

      expect(window.stoa.getSessionPresence).toHaveBeenCalledWith('session_op_1')
      expect(window.stoa.getProjectObservability).toHaveBeenCalledWith('project_alpha')
      expect(window.stoa.getAppObservability).toHaveBeenCalledOnce()
      expect(store.sessionPresenceById).toEqual({ session_op_1: sessionPresence })
      expect(store.projectObservabilityById).toEqual({ project_alpha: projectObservability })
      expect(store.appObservability).toEqual(appObservability)
      expect(store.activeSessionPresence).toEqual(sessionPresence)
      expect(store.sessionPresenceMap).toEqual({ session_op_1: sessionPresence })
      expect(store.projectObservabilityMap).toEqual({ project_alpha: projectObservability })
    })

    test('applies pushed session, project, and app observability snapshots from subscriptions', async () => {
      let sessionListener: ((snapshot: SessionPresenceSnapshot) => void) | undefined
      let projectListener: ((snapshot: ProjectObservabilitySnapshot) => void) | undefined
      let appListener: ((snapshot: AppObservabilitySnapshot) => void) | undefined

      window.stoa = createStoaMock({
        onSessionPresenceChanged: vi.fn().mockImplementation((callback: (snapshot: SessionPresenceSnapshot) => void) => {
          sessionListener = callback
          return () => {}
        }),
        onProjectObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: ProjectObservabilitySnapshot) => void) => {
          projectListener = callback
          return () => {}
        }),
        onAppObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: AppObservabilitySnapshot) => void) => {
          appListener = callback
          return () => {}
        })
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          sessionSummaryFixture({
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
          })
        ]
      })

      await store.hydrateObservability()

      const sessionPresence = sessionPresenceFixture({
        phase: 'blocked',
        blockingReason: 'permission',
        health: 'degraded',
        hasUnreadTurn: true
      })
      const projectObservability = projectObservabilityFixture({
        overallHealth: 'degraded',
        blockedSessionCount: 1,
        unreadTurnCount: 1,
        latestAttentionSessionId: 'session_op_1',
        latestAttentionReason: 'permission'
      })
      const appObservability = appObservabilityFixture({
        blockedProjectCount: 1,
        totalUnreadTurns: 1,
        projectsNeedingAttention: ['project_alpha']
      })

      sessionListener?.(sessionPresence)
      projectListener?.(projectObservability)
      appListener?.(appObservability)

      expect(store.sessionPresenceById.session_op_1).toEqual(sessionPresence)
      expect(store.projectObservabilityById.project_alpha).toEqual(projectObservability)
      expect(store.appObservability).toEqual(appObservability)
      expect(store.activeSessionPresence?.blockingReason).toBe('permission')
    })

    test('uses backend presence snapshot as authoritative over fallback', async () => {
      const backendPresence = sessionPresenceFixture({
        sessionId: 'session_claude_1',
        phase: 'blocked',
        runtimeState: 'alive',
        agentState: 'blocked',
        blockingReason: 'permission',
        health: 'healthy',
        sourceSequence: 9
      })

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockResolvedValue(backendPresence)
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_claude_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: []
      })

      store.addSession(sessionSummaryFixture({
        id: 'session_claude_1',
        type: 'claude-code',
        runtimeState: 'alive',
        agentState: 'working',
        lastStateSequence: 12,
        title: 'Claude'
      }))

      expect(store.sessionPresenceById.session_claude_1).toMatchObject({
        phase: 'running',
        sourceSequence: 12
      })

      await store.hydrateObservability()

      expect(store.sessionPresenceById.session_claude_1).toEqual(backendPresence)
    })

    test('does not let lower sourceSequence fallback overwrite newer snapshot', async () => {
      const backendPresence = sessionPresenceFixture({
        phase: 'blocked',
        runtimeState: 'alive',
        agentState: 'blocked',
        blockingReason: 'resume-confirmation',
        sourceSequence: 20
      })

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockResolvedValue(backendPresence)
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
          id: 'session_op_1',
          lastStateSequence: 10,
          agentState: 'idle',
          hasUnseenCompletion: true,
          status: 'turn_complete',
          summary: 'complete'
        })]
      })

      await store.hydrateObservability()
      expect(store.sessionPresenceById.session_op_1).toEqual(backendPresence)

      store.updateSession('session_op_1', {
        status: 'running',
        runtimeState: 'alive',
        agentState: 'working',
        hasUnseenCompletion: false,
        blockingReason: null,
        lastStateSequence: 19,
        summary: 'local running fallback'
      })

      expect(store.sessionPresenceById.session_op_1).toEqual(backendPresence)
    })

    test('allows newer fallback to replace older backend snapshot', async () => {
      const backendPresence = sessionPresenceFixture({
        phase: 'blocked',
        runtimeState: 'alive',
        agentState: 'blocked',
        blockingReason: 'permission',
        sourceSequence: 9
      })

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockResolvedValue(backendPresence)
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
          id: 'session_op_1',
          lastStateSequence: 8,
          agentState: 'blocked',
          blockingReason: 'permission',
          status: 'needs_confirmation',
          summary: 'blocked'
        })]
      })

      await store.hydrateObservability()
      expect(store.sessionPresenceById.session_op_1).toEqual(backendPresence)

      store.updateSession('session_op_1', {
        status: 'running',
        runtimeState: 'alive',
        agentState: 'working',
        hasUnseenCompletion: false,
        blockingReason: null,
        lastStateSequence: 12,
        summary: 'local running fallback'
      })

      expect(store.sessionPresenceById.session_op_1).toMatchObject({
        phase: 'running',
        runtimeState: 'alive',
        agentState: 'working',
        blockingReason: null,
        sourceSequence: 12
      })
    })

    test('does not let equal sourceSequence fallback overwrite backend snapshot', async () => {
      const backendPresence = sessionPresenceFixture({
        phase: 'blocked',
        runtimeState: 'alive',
        agentState: 'blocked',
        blockingReason: 'permission',
        sourceSequence: 12,
        updatedAt: '2026-04-24T08:00:00.000Z'
      })

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockResolvedValue(backendPresence)
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
          id: 'session_op_1',
          lastStateSequence: 12,
          agentState: 'blocked',
          blockingReason: 'permission',
          status: 'needs_confirmation',
          summary: 'blocked'
        })]
      })

      await store.hydrateObservability()
      expect(store.sessionPresenceById.session_op_1).toEqual(backendPresence)

      store.updateSession('session_op_1', {
        status: 'running',
        runtimeState: 'alive',
        agentState: 'working',
        hasUnseenCompletion: false,
        blockingReason: null,
        lastStateSequence: 12,
        summary: 'same sequence fallback'
      })

      expect(store.sessionPresenceById.session_op_1).toEqual(backendPresence)
    })

    test('updates active complete session to ready after backend completion_seen patch', async () => {
      let sessionListener: ((snapshot: SessionPresenceSnapshot) => void) | undefined

      window.stoa = createStoaMock({
        onSessionPresenceChanged: vi.fn().mockImplementation((callback: (snapshot: SessionPresenceSnapshot) => void) => {
          sessionListener = callback
          return () => {}
        })
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: null,
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: []
      })
      store.addSession(sessionSummaryFixture({
        id: 'session_claude_complete',
        type: 'claude-code',
        status: 'turn_complete',
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: true,
        lastStateSequence: 12,
        title: 'Claude complete'
      }))

      store.setActiveSession('session_claude_complete')

      expect(store.activeSessionId).toBe('session_claude_complete')
      expect(store.activeSessionPresence).toMatchObject({
        phase: 'complete',
        hasUnseenCompletion: true
      })

      await store.hydrateObservability()

      const readyPresence = sessionPresenceFixture({
        sessionId: 'session_claude_complete',
        phase: 'ready',
        runtimeState: 'alive',
        agentState: 'idle',
        hasUnseenCompletion: false,
        sourceSequence: 13
      })
      sessionListener?.(readyPresence)

      expect(store.activeSessionPresence).toEqual(readyPresence)
    })

    test('keeps Claude alive unknown ready instead of running', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_claude_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: []
      })

      store.addSession(sessionSummaryFixture({
        id: 'session_claude_1',
        type: 'claude-code',
        status: 'running',
        runtimeState: 'alive',
        agentState: 'unknown',
        lastStateSequence: 4,
        title: 'Claude unknown'
      }))

      expect(store.sessionPresenceById.session_claude_1).toMatchObject({
        phase: 'ready',
        runtimeState: 'alive',
        agentState: 'unknown',
        sourceSequence: 4
      })
    })

    test('keeps newer pushed snapshots when initial observability queries resolve later', async () => {
      let sessionListener: ((snapshot: SessionPresenceSnapshot) => void) | undefined
      let projectListener: ((snapshot: ProjectObservabilitySnapshot) => void) | undefined
      let appListener: ((snapshot: AppObservabilitySnapshot) => void) | undefined

      const delayedSessionPresence = deferred<SessionPresenceSnapshot | null>()
      const delayedProjectObservability = deferred<ProjectObservabilitySnapshot | null>()
      const delayedAppObservability = deferred<AppObservabilitySnapshot | null>()

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockReturnValue(delayedSessionPresence.promise),
        getProjectObservability: vi.fn().mockReturnValue(delayedProjectObservability.promise),
        getAppObservability: vi.fn().mockReturnValue(delayedAppObservability.promise),
        onSessionPresenceChanged: vi.fn().mockImplementation((callback: (snapshot: SessionPresenceSnapshot) => void) => {
          sessionListener = callback
          return () => {}
        }),
        onProjectObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: ProjectObservabilitySnapshot) => void) => {
          projectListener = callback
          return () => {}
        }),
        onAppObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: AppObservabilitySnapshot) => void) => {
          appListener = callback
          return () => {}
        })
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [
          { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
        ],
        sessions: [
          sessionSummaryFixture({
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
          })
        ]
      })

      const hydrationPromise = store.hydrateObservability()

      const pushedSessionPresence = sessionPresenceFixture({
        updatedAt: '2026-04-24T08:00:10.000Z',
        sourceSequence: 10,
        phase: 'blocked',
        blockingReason: 'permission',
        health: 'degraded'
      })
      const pushedProjectObservability = projectObservabilityFixture({
        updatedAt: '2026-04-24T08:00:10.000Z',
        sourceSequence: 10,
        overallHealth: 'degraded',
        blockedSessionCount: 1,
        latestAttentionSessionId: 'session_op_1',
        latestAttentionReason: 'permission'
      })
      const pushedAppObservability = appObservabilityFixture({
        updatedAt: '2026-04-24T08:00:10.000Z',
        sourceSequence: 10,
        blockedProjectCount: 1,
        projectsNeedingAttention: ['project_alpha']
      })

      sessionListener?.(pushedSessionPresence)
      projectListener?.(pushedProjectObservability)
      appListener?.(pushedAppObservability)

      delayedSessionPresence.resolve(sessionPresenceFixture({ updatedAt: '2026-04-24T08:00:00.000Z', sourceSequence: 9 }))
      delayedProjectObservability.resolve(projectObservabilityFixture({ updatedAt: '2026-04-24T08:00:00.000Z', sourceSequence: 9 }))
      delayedAppObservability.resolve(appObservabilityFixture({ updatedAt: '2026-04-24T08:00:00.000Z', sourceSequence: 9 }))

      await hydrationPromise

      expect(store.sessionPresenceById.session_op_1).toEqual(pushedSessionPresence)
      expect(store.projectObservabilityById.project_alpha).toEqual(pushedProjectObservability)
      expect(store.appObservability).toEqual(pushedAppObservability)
    })

    test('keeps newer pushed snapshots when equal-sequence initial observability queries resolve later', async () => {
      let sessionListener: ((snapshot: SessionPresenceSnapshot) => void) | undefined
      let projectListener: ((snapshot: ProjectObservabilitySnapshot) => void) | undefined
      let appListener: ((snapshot: AppObservabilitySnapshot) => void) | undefined

      const delayedSessionPresence = deferred<SessionPresenceSnapshot | null>()
      const delayedProjectObservability = deferred<ProjectObservabilitySnapshot | null>()
      const delayedAppObservability = deferred<AppObservabilitySnapshot | null>()

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockReturnValue(delayedSessionPresence.promise),
        getProjectObservability: vi.fn().mockReturnValue(delayedProjectObservability.promise),
        getAppObservability: vi.fn().mockReturnValue(delayedAppObservability.promise),
        onSessionPresenceChanged: vi.fn().mockImplementation((callback: (snapshot: SessionPresenceSnapshot) => void) => {
          sessionListener = callback
          return () => {}
        }),
        onProjectObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: ProjectObservabilitySnapshot) => void) => {
          projectListener = callback
          return () => {}
        }),
        onAppObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: AppObservabilitySnapshot) => void) => {
          appListener = callback
          return () => {}
        })
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
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
        })]
      })

      const hydrationPromise = store.hydrateObservability()

      const pushedSessionPresence = sessionPresenceFixture({
        updatedAt: '2026-04-24T08:00:10.000Z',
        sourceSequence: 10,
        phase: 'blocked',
        blockingReason: 'permission',
        health: 'degraded'
      })
      const pushedProjectObservability = projectObservabilityFixture({
        updatedAt: '2026-04-24T08:00:10.000Z',
        sourceSequence: 10,
        overallHealth: 'degraded',
        blockedSessionCount: 1,
        latestAttentionSessionId: 'session_op_1',
        latestAttentionReason: 'permission'
      })
      const pushedAppObservability = appObservabilityFixture({
        updatedAt: '2026-04-24T08:00:10.000Z',
        sourceSequence: 10,
        blockedProjectCount: 1,
        projectsNeedingAttention: ['project_alpha']
      })

      sessionListener?.(pushedSessionPresence)
      projectListener?.(pushedProjectObservability)
      appListener?.(pushedAppObservability)

      delayedSessionPresence.resolve(sessionPresenceFixture({ updatedAt: '2026-04-24T08:00:00.000Z', sourceSequence: 10 }))
      delayedProjectObservability.resolve(projectObservabilityFixture({ updatedAt: '2026-04-24T08:00:00.000Z', sourceSequence: 10 }))
      delayedAppObservability.resolve(appObservabilityFixture({ updatedAt: '2026-04-24T08:00:00.000Z', sourceSequence: 10 }))

      await hydrationPromise

      expect(store.sessionPresenceById.session_op_1).toEqual(pushedSessionPresence)
      expect(store.projectObservabilityById.project_alpha).toEqual(pushedProjectObservability)
      expect(store.appObservability).toEqual(pushedAppObservability)
    })

    test('rejects stale pushed observability snapshots with lower source sequence', async () => {
      let sessionListener: ((snapshot: SessionPresenceSnapshot) => void) | undefined
      let projectListener: ((snapshot: ProjectObservabilitySnapshot) => void) | undefined
      let appListener: ((snapshot: AppObservabilitySnapshot) => void) | undefined

      window.stoa = createStoaMock({
        onSessionPresenceChanged: vi.fn().mockImplementation((callback: (snapshot: SessionPresenceSnapshot) => void) => {
          sessionListener = callback
          return () => {}
        }),
        onProjectObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: ProjectObservabilitySnapshot) => void) => {
          projectListener = callback
          return () => {}
        }),
        onAppObservabilityChanged: vi.fn().mockImplementation((callback: (snapshot: AppObservabilitySnapshot) => void) => {
          appListener = callback
          return () => {}
        })
      })

      const store = useWorkspaceStore()
      const newerSession = sessionPresenceFixture({ sourceSequence: 10, phase: 'blocked' })
      const newerProject = projectObservabilityFixture({ sourceSequence: 10, blockedSessionCount: 1 })
      const newerApp = appObservabilityFixture({ sourceSequence: 10, blockedProjectCount: 1 })

      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
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
        })]
      })
      await store.hydrateObservability()

      sessionListener?.(newerSession)
      projectListener?.(newerProject)
      appListener?.(newerApp)
      sessionListener?.(sessionPresenceFixture({ sourceSequence: 9, phase: 'running' }))
      projectListener?.(projectObservabilityFixture({ sourceSequence: 9, blockedSessionCount: 0 }))
      appListener?.(appObservabilityFixture({ sourceSequence: 9, blockedProjectCount: 0 }))

      expect(store.sessionPresenceById.session_op_1).toEqual(newerSession)
      expect(store.projectObservabilityById.project_alpha).toEqual(newerProject)
      expect(store.appObservability).toEqual(newerApp)
    })

    test('session state updates replace provisional presence derived from session creation', () => {
      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_claude_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: []
      })

      store.addSession({
        id: 'session_claude_1',
        projectId: 'project_alpha',
        type: 'claude-code',
        status: 'bootstrapping',
        runtimeState: 'created',
        agentState: 'unknown',
        hasUnseenCompletion: false,
        runtimeExitCode: null,
        runtimeExitReason: null,
        lastStateSequence: 0,
        blockingReason: null,
        title: 'Claude',
        summary: 'Waiting for session to start',
        recoveryMode: 'resume-external',
        externalSessionId: 'ext-1',
        createdAt: 'a',
        updatedAt: 'a',
        lastActivatedAt: 'a',
        archived: false
      })
      expect(store.sessionPresenceById.session_claude_1?.phase).toBe('preparing')

      store.updateSession('session_claude_1', {
        status: 'running',
        runtimeState: 'alive',
        agentState: 'working',
        lastStateSequence: 1,
        summary: 'Session running'
      })

      expect(store.sessionPresenceById.session_claude_1).toMatchObject({
        phase: 'running'
      })
    })

    test('backfills missed observability events after subscribing and refetches converged snapshots', async () => {
      const refetchedSessionPresence = sessionPresenceFixture({
        sourceSequence: 7,
        phase: 'ready'
      })
      const refetchedProjectObservability = projectObservabilityFixture({ sourceSequence: 7 })
      const refetchedAppObservability = appObservabilityFixture({ sourceSequence: 7 })

      window.stoa = createStoaMock({
        getSessionPresence: vi.fn()
          .mockResolvedValueOnce(sessionPresenceFixture({ sourceSequence: 3 }))
          .mockResolvedValueOnce(refetchedSessionPresence),
        getProjectObservability: vi.fn()
          .mockResolvedValueOnce(projectObservabilityFixture({ sourceSequence: 3 }))
          .mockResolvedValueOnce(refetchedProjectObservability),
        getAppObservability: vi.fn()
          .mockResolvedValueOnce(appObservabilityFixture({ sourceSequence: 3 }))
          .mockResolvedValueOnce(refetchedAppObservability),
        listSessionObservationEvents: vi.fn().mockResolvedValue({
          events: [observationEventFixture({ sequence: 7 })],
          nextCursor: null
        })
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
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
        })]
      })

      await store.hydrateObservability()

      expect(window.stoa.listSessionObservationEvents).toHaveBeenCalledWith('session_op_1', {
        cursor: '1',
        limit: 50
      })
      expect(store.sessionPresenceById.session_op_1).toEqual(refetchedSessionPresence)
      expect(store.projectObservabilityById.project_alpha).toEqual(refetchedProjectObservability)
      expect(store.appObservability).toEqual(refetchedAppObservability)
    })

    test('backfill uses evidence sequence when authoritative session source sequence is ahead', async () => {
      window.stoa = createStoaMock({
        getSessionPresence: vi.fn().mockResolvedValue(sessionPresenceFixture({
          sourceSequence: 20,
          evidenceSequence: 10
        })),
        getProjectObservability: vi.fn().mockResolvedValue(projectObservabilityFixture({ sourceSequence: 20 })),
        getAppObservability: vi.fn().mockResolvedValue(appObservabilityFixture({ sourceSequence: 20 })),
        listSessionObservationEvents: vi.fn().mockResolvedValue({
          events: [observationEventFixture({ sequence: 11 })],
          nextCursor: null
        })
      })

      const store = useWorkspaceStore()
      store.hydrate({
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        terminalWebhookPort: 43127,
        projects: [{ id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }],
        sessions: [sessionSummaryFixture({
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
        })]
      })

      await store.hydrateObservability()

      expect(window.stoa.listSessionObservationEvents).toHaveBeenCalledWith('session_op_1', {
        cursor: '10',
        limit: 50
      })
    })
  })
})
