import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RendererApi } from '@shared/project-session'
import type {
  CreateMetaSessionRequest,
  MetaSessionBootstrapState,
  MetaSessionEvent,
  MetaSessionProposal,
  MetaSessionSummary
} from '@shared/meta-session'
import { createRendererApiMock } from '@shared/test-fixtures'
import { useMetaSessionStore } from './meta-session'

function makeSession(patch: Partial<MetaSessionSummary> = {}): MetaSessionSummary {
  return {
    id: 'meta_session_1',
    title: 'global-triage',
    status: 'running',
    backendSessionType: 'claude-code',
    capabilityLevel: 2,
    pendingProposalCount: 1,
    activeTargetCount: 3,
    lastSummary: 'Collecting blocked sessions.',
    lastRisk: 'Two sessions are editing the same module.',
    backendSessionId: 'backend-session-1',
    createdAt: '2026-05-07T08:00:00.000Z',
    updatedAt: '2026-05-07T08:05:00.000Z',
    lastActivatedAt: '2026-05-07T08:05:00.000Z',
    archived: false,
    ...patch
  }
}

function makeBootstrapState(): MetaSessionBootstrapState {
  return {
    activeMetaSessionId: 'meta_session_1',
    sessions: [makeSession()],
    inspectorTarget: {
      kind: 'app'
    }
  }
}

function makeProposal(patch: Partial<MetaSessionProposal> = {}): MetaSessionProposal {
  return {
    id: 'proposal_1',
    metaSessionId: 'meta_session_1',
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
  return Object.assign(createRendererApiMock({
    getBootstrapState: vi.fn().mockResolvedValue({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }),
    getAppObservability: vi.fn().mockResolvedValue(null),
    getMetaSessionBootstrapState: vi.fn().mockResolvedValue(makeBootstrapState()),
    createMetaSession: vi.fn().mockImplementation(async (request: CreateMetaSessionRequest) => {
      return makeSession({
        id: 'meta_session_2',
        title: request.title,
        backendSessionType: request.backendSessionType,
        capabilityLevel: request.capabilityLevel
      })
    }),
    setActiveMetaSession: vi.fn().mockResolvedValue(undefined),
    archiveMetaSession: vi.fn().mockResolvedValue(undefined),
    restoreMetaSession: vi.fn().mockResolvedValue(undefined),
    setMetaSessionInspectorTarget: vi.fn().mockResolvedValue(undefined),
    listMetaSessionProposals: vi.fn().mockResolvedValue([makeProposal()]),
    getMetaSessionProposal: vi.fn().mockImplementation(async (proposalId: string) => {
      return makeProposal({ id: proposalId })
    }),
    approveMetaSessionProposal: vi.fn().mockImplementation(async (proposalId: string) => {
      return makeProposal({
        id: proposalId,
        status: 'approved',
        approvedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z'
      })
    }),
    rejectMetaSessionProposal: vi.fn().mockImplementation(async (proposalId: string, reason?: string) => {
      return makeProposal({
        id: proposalId,
        status: 'rejected',
        rejectedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z',
        executionResult: reason ?? 'Proposal rejected.'
      })
    }),
    dispatchMetaSessionProposal: vi.fn().mockImplementation(async (proposalId: string) => {
      return makeProposal({
        id: proposalId,
        status: 'completed',
        approvedAt: '2026-05-07T08:06:00.000Z',
        executedAt: '2026-05-07T08:06:05.000Z',
        updatedAt: '2026-05-07T08:06:05.000Z',
        executionResult: 'Prompt dispatched to target session.'
      })
    }),
    onMetaSessionEvent: vi.fn().mockReturnValue(() => {}),
  }), overrides)
}

describe('meta session renderer store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.stoa = createStoaMock()
  })

  test('hydrates meta sessions separately from work-session hierarchy and tracks the active inspector target', () => {
    const store = useMetaSessionStore()

    store.hydrate(makeBootstrapState())

    expect(store.activeMetaSession?.id).toBe('meta_session_1')
    expect(store.inspectorTarget?.kind).toBe('app')
    expect(store.sessions).toHaveLength(1)
  })

  test('loads bootstrap state from the renderer bridge and subscribes to meta session events', async () => {
    let eventListener: ((event: MetaSessionEvent) => void) | undefined
    const onMetaSessionEvent = vi.fn().mockImplementation((callback: (event: MetaSessionEvent) => void) => {
      eventListener = callback
      return () => {}
    })
    window.stoa = createStoaMock({ onMetaSessionEvent })

    const store = useMetaSessionStore()
    const unsubscribe = await store.bootstrapFromBridge()

    expect(window.stoa.getMetaSessionBootstrapState).toHaveBeenCalledOnce()
    expect(onMetaSessionEvent).toHaveBeenCalledOnce()
    expect(store.activeMetaSession?.id).toBe('meta_session_1')

    eventListener?.({
      session: makeSession({
        id: 'meta_session_2',
        title: 'risk-review',
        status: 'waiting_approval'
      })
    })

    expect(store.sessions.map((session) => session.id)).toContain('meta_session_2')
    unsubscribe()
  })

  test('loads proposal queue from the renderer bridge and derives pending proposal counts for meta sessions', async () => {
    const listMetaSessionProposals = vi.fn().mockResolvedValue([
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
    window.stoa = createStoaMock({ listMetaSessionProposals })

    const store = useMetaSessionStore()
    await store.bootstrapFromBridge()

    expect(listMetaSessionProposals).toHaveBeenCalledOnce()
    expect(store.proposals).toHaveLength(3)
    expect(store.activeMetaSession?.pendingProposalCount).toBe(2)
  })

  test('creates, activates, archives, and restores meta sessions through the renderer bridge', async () => {
    const store = useMetaSessionStore()
    await store.bootstrapFromBridge()

    const created = await store.createSession({
      title: 'review-debt',
      backendSessionType: 'codex',
      capabilityLevel: 3
    })
    await store.setActiveSession(created.id)
    await store.archiveSession(created.id)

    expect(store.sessions.find((session) => session.id === created.id)?.archived).toBe(true)
    expect(store.activeMetaSessionId).toBe('meta_session_1')

    await store.restoreSession(created.id)

    expect(window.stoa.createMetaSession).toHaveBeenCalledWith({
      title: 'review-debt',
      backendSessionType: 'codex',
      capabilityLevel: 3
    })
    expect(window.stoa.setActiveMetaSession).toHaveBeenCalledWith(created.id)
    expect(window.stoa.archiveMetaSession).toHaveBeenCalledWith(created.id)
    expect(window.stoa.restoreMetaSession).toHaveBeenCalledWith(created.id)
    expect(store.sessions.find((session) => session.id === created.id)?.archived).toBe(false)
    expect(store.activeMetaSessionId).toBe(created.id)
  })

  test('approves rejects and dispatches proposals through the native renderer bridge and persists inspector target', async () => {
    const proposals = [makeProposal()]
    const listMetaSessionProposals = vi.fn().mockImplementation(async () => proposals.map((proposal) => ({ ...proposal })))
    const approveMetaSessionProposal = vi.fn().mockImplementation(async (proposalId: string) => {
      proposals[0] = makeProposal({
        id: proposalId,
        status: 'approved',
        approvedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z'
      })
      return proposals[0]
    })
    const rejectMetaSessionProposal = vi.fn().mockImplementation(async (proposalId: string, reason?: string) => {
      proposals[0] = makeProposal({
        id: proposalId,
        status: 'rejected',
        rejectedAt: '2026-05-07T08:06:00.000Z',
        updatedAt: '2026-05-07T08:06:00.000Z',
        executionResult: reason ?? 'Proposal rejected.'
      })
      return proposals[0]
    })
    const dispatchMetaSessionProposal = vi.fn().mockImplementation(async (proposalId: string) => {
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
    const setMetaSessionInspectorTarget = vi.fn().mockResolvedValue(undefined)
    window.stoa = createStoaMock({
      listMetaSessionProposals,
      approveMetaSessionProposal,
      rejectMetaSessionProposal,
      dispatchMetaSessionProposal,
      setMetaSessionInspectorTarget
    })

    const store = useMetaSessionStore()
    await store.bootstrapFromBridge()

    await store.setInspector({
      kind: 'proposal',
      proposalId: 'proposal_1'
    })
    expect(store.selectedProposal?.id).toBe('proposal_1')
    expect(setMetaSessionInspectorTarget).toHaveBeenCalledWith({
      kind: 'proposal',
      proposalId: 'proposal_1'
    })

    await store.approveProposal('proposal_1')
    expect(approveMetaSessionProposal).toHaveBeenCalledWith('proposal_1')
    expect(store.selectedProposal?.status).toBe('approved')

    await store.rejectProposal('proposal_1', 'Unsafe dispatch.')
    expect(rejectMetaSessionProposal).toHaveBeenCalledWith('proposal_1', 'Unsafe dispatch.')
    expect(store.selectedProposal?.status).toBe('rejected')

    proposals[0] = makeProposal()
    await store.refreshProposals()
    await store.approveAndDispatchProposal('proposal_1')
    expect(dispatchMetaSessionProposal).toHaveBeenCalledWith('proposal_1')
    expect(store.selectedProposal?.status).toBe('completed')
  })
})
