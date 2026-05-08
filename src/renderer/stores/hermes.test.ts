import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RendererApi } from '@shared/project-session'
import type {
  CreateHermesSessionRequest,
  HermesBootstrapState,
  HermesProposal,
  HermesSessionEvent,
  HermesSessionSummary
} from '@shared/hermes'
import { useHermesStore } from './hermes'

function makeSession(patch: Partial<HermesSessionSummary> = {}): HermesSessionSummary {
  return {
    id: 'hermes_1',
    title: 'global-triage',
    status: 'running',
    capabilityLevel: 2,
    pendingProposalCount: 1,
    activeTargetCount: 3,
    lastSummary: 'Collecting blocked sessions.',
    lastRisk: 'Two sessions are editing the same module.',
    resumeSessionId: 'resume-hermes-1',
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:05:00.000Z',
    lastActivatedAt: '2026-05-07T08:05:00.000Z',
    ...patch
  }
}

function makeBootstrapState(): HermesBootstrapState {
  return {
    activeHermesSessionId: 'hermes_1',
    sessions: [makeSession()],
    inspectorTarget: {
      kind: 'app'
    }
  }
}

function makeProposal(patch: Partial<HermesProposal> = {}): HermesProposal {
  return {
    id: 'proposal_1',
    hermesSessionId: 'hermes_1',
    kind: 'prompt',
    targetSessionIds: ['session_1'],
    riskLevel: 3,
    status: 'pending_approval',
    summary: 'Prompt injection for session_1',
    reason: 'Freeform prompt injection requires explicit approval.',
    promptText: 'Refactor and edit the code now.',
    presetName: null,
    snapshot: {
      sessions: [{
        sessionId: 'session_1',
        lastStateSequence: 17,
        turnEpoch: 4,
        updatedAt: '2026-05-07T08:05:00.000Z'
      }]
    },
    createdAt: '2026-05-07T08:05:00.000Z',
    updatedAt: '2026-05-07T08:05:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    executionResult: null,
    ...patch
  }
}

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    windowsBuildNumber: undefined,
    getBootstrapState: vi.fn().mockResolvedValue({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }),
    createProject: vi.fn().mockResolvedValue(null),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(null),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn(),
    sendSessionBinaryInput: vi.fn(),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onMemoryNotification: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue(null),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminal: {},
      providers: {},
      evolverInferenceProvider: 'claude-code',
      evolverExecutionMode: 'workspace-shell',
      workspaceIde: { id: 'vscode', executablePath: '' },
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
    detectVscode: vi.fn().mockResolvedValue(null),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
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
    uninstallSidecars: vi.fn().mockResolvedValue(undefined),
    getHermesBootstrapState: vi.fn().mockResolvedValue(makeBootstrapState()),
    createHermesSession: vi.fn().mockImplementation(async (request: CreateHermesSessionRequest) => {
      return makeSession({
        id: 'hermes_2',
        title: request.title,
        capabilityLevel: request.capabilityLevel
      })
    }),
    setActiveHermesSession: vi.fn().mockResolvedValue(undefined),
    closeHermesSession: vi.fn().mockResolvedValue(undefined),
    setHermesInspectorTarget: vi.fn().mockResolvedValue(undefined),
    listHermesProposals: vi.fn().mockResolvedValue([makeProposal()]),
    getHermesProposal: vi.fn().mockImplementation(async (proposalId: string) => {
      return makeProposal({ id: proposalId })
    }),
    approveHermesProposal: vi.fn().mockImplementation(async (proposalId: string) => {
      return makeProposal({
        id: proposalId,
        status: 'approved',
        approvedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z'
      })
    }),
    rejectHermesProposal: vi.fn().mockImplementation(async (proposalId: string, reason?: string) => {
      return makeProposal({
        id: proposalId,
        status: 'rejected',
        rejectedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z',
        executionResult: reason ?? 'Proposal rejected.'
      })
    }),
    dispatchHermesProposal: vi.fn().mockImplementation(async (proposalId: string) => {
      return makeProposal({
        id: proposalId,
        status: 'completed',
        approvedAt: '2026-05-07T08:06:00.000Z',
        executedAt: '2026-05-07T08:06:05.000Z',
        updatedAt: '2026-05-07T08:06:05.000Z',
        executionResult: 'Prompt dispatched to target session.'
      })
    }),
    onHermesSessionEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

describe('hermes renderer store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createStoaMock()
  })

  test('hydrates Hermes sessions separately from work-session hierarchy and tracks the active inspector target', () => {
    const store = useHermesStore()

    store.hydrate(makeBootstrapState())

    expect(store.activeHermesSession?.id).toBe('hermes_1')
    expect(store.inspectorTarget?.kind).toBe('app')
    expect(store.sessions).toHaveLength(1)
  })

  test('loads bootstrap state from the renderer bridge and subscribes to Hermes session events', async () => {
    let eventListener: ((event: HermesSessionEvent) => void) | undefined
    const onHermesSessionEvent = vi.fn().mockImplementation((callback: (event: HermesSessionEvent) => void) => {
      eventListener = callback
      return () => {}
    })
    window.stoa = createStoaMock({ onHermesSessionEvent })

    const store = useHermesStore()
    const unsubscribe = await store.bootstrapFromBridge()

    expect(window.stoa.getHermesBootstrapState).toHaveBeenCalledOnce()
    expect(onHermesSessionEvent).toHaveBeenCalledOnce()
    expect(store.activeHermesSession?.id).toBe('hermes_1')

    eventListener?.({
      session: makeSession({
        id: 'hermes_2',
        title: 'risk-review',
        status: 'waiting_approval'
      })
    })

    expect(store.sessions.map((session) => session.id)).toContain('hermes_2')
    unsubscribe()
  })

  test('loads proposal queue from the renderer bridge and derives pending proposal counts for Hermes sessions', async () => {
    const listHermesProposals = vi.fn().mockResolvedValue([
      makeProposal(),
      makeProposal({
        id: 'proposal_2',
        targetSessionIds: ['session_2']
      }),
      makeProposal({
        id: 'proposal_3',
        status: 'approved',
        approvedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z'
      })
    ])
    window.stoa = createStoaMock({ listHermesProposals })

    const store = useHermesStore()
    await store.bootstrapFromBridge()

    expect(listHermesProposals).toHaveBeenCalledOnce()
    expect(store.proposals).toHaveLength(3)
    expect(store.activeHermesSession?.pendingProposalCount).toBe(2)
  })

  test('creates, activates, and closes Hermes sessions through the renderer bridge', async () => {
    const store = useHermesStore()
    await store.bootstrapFromBridge()

    const created = await store.createSession({
      title: 'review-debt',
      capabilityLevel: 3
    })
    await store.setActiveSession(created.id)
    await store.closeSession(created.id)

    expect(window.stoa.createHermesSession).toHaveBeenCalledWith({
      title: 'review-debt',
      capabilityLevel: 3
    })
    expect(window.stoa.setActiveHermesSession).toHaveBeenCalledWith(created.id)
    expect(window.stoa.closeHermesSession).toHaveBeenCalledWith(created.id)
  })

  test('approves rejects and dispatches proposals through the native renderer bridge and persists inspector target', async () => {
    const proposals = [makeProposal()]
    const listHermesProposals = vi.fn().mockImplementation(async () => proposals.map((proposal) => ({ ...proposal })))
    const approveHermesProposal = vi.fn().mockImplementation(async (proposalId: string) => {
      proposals[0] = makeProposal({
        id: proposalId,
        status: 'approved',
        approvedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z'
      })
      return proposals[0]
    })
    const rejectHermesProposal = vi.fn().mockImplementation(async (proposalId: string, reason?: string) => {
      proposals[0] = makeProposal({
        id: proposalId,
        status: 'rejected',
        rejectedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z',
        executionResult: reason ?? 'Proposal rejected.'
      })
      return proposals[0]
    })
    const dispatchHermesProposal = vi.fn().mockImplementation(async (proposalId: string) => {
      proposals[0] = makeProposal({
        id: proposalId,
        status: 'completed',
        approvedAt: '2026-05-07T08:06:00.000Z',
        executedAt: '2026-05-07T08:06:05.000Z',
        updatedAt: '2026-05-07T08:06:05.000Z',
        executionResult: 'Prompt dispatched to target session.'
      })
      return proposals[0]
    })
    const setHermesInspectorTarget = vi.fn().mockResolvedValue(undefined)
    window.stoa = createStoaMock({
      listHermesProposals,
      approveHermesProposal,
      rejectHermesProposal,
      dispatchHermesProposal,
      setHermesInspectorTarget
    })

    const store = useHermesStore()
    await store.bootstrapFromBridge()

    await store.setInspector({
      kind: 'proposal',
      proposalId: 'proposal_1'
    })
    expect(store.selectedProposal?.id).toBe('proposal_1')
    expect(setHermesInspectorTarget).toHaveBeenCalledWith({
      kind: 'proposal',
      proposalId: 'proposal_1'
    })

    await store.approveProposal('proposal_1')
    expect(approveHermesProposal).toHaveBeenCalledWith('proposal_1')
    expect(store.selectedProposal?.status).toBe('approved')

    await store.rejectProposal('proposal_1', 'Unsafe dispatch.')
    expect(rejectHermesProposal).toHaveBeenCalledWith('proposal_1', 'Unsafe dispatch.')
    expect(store.selectedProposal?.status).toBe('rejected')

    proposals[0] = makeProposal()
    await store.refreshProposals()
    await store.approveAndDispatchProposal('proposal_1')
    expect(dispatchHermesProposal).toHaveBeenCalledWith('proposal_1')
    expect(store.selectedProposal?.status).toBe('completed')
  })
})
