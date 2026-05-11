import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CreateMetaSessionRequest,
  MetaSessionBootstrapState,
  MetaSessionInspectorTarget,
  MetaSessionProposal,
  MetaSessionEvent,
  MetaSessionSummary
} from '@shared/meta-session'

function cloneSession(session: MetaSessionSummary): MetaSessionSummary {
  return { ...session }
}

function cloneProposal(proposal: MetaSessionProposal): MetaSessionProposal {
  return {
    ...proposal,
    targetSessionIds: [...proposal.targetSessionIds],
    snapshot: {
      sessions: proposal.snapshot.sessions.map((session) => ({ ...session }))
    }
  }
}

function cloneBootstrapState(state: MetaSessionBootstrapState): MetaSessionBootstrapState {
  return {
    activeMetaSessionId: state.activeMetaSessionId,
    sessions: state.sessions.map(cloneSession),
    inspectorTarget: state.inspectorTarget ? { ...state.inspectorTarget } : null
  }
}

export const useMetaSessionStore = defineStore('meta-session', () => {
  const sessions = ref<MetaSessionSummary[]>([])
  const activeMetaSessionId = ref<string | null>(null)
  const inspectorTarget = ref<MetaSessionInspectorTarget | null>(null)
  const proposals = ref<MetaSessionProposal[]>([])
  const unsubscribeEventStream = ref<(() => void) | null>(null)

  const activeMetaSession = computed(() => {
    if (!activeMetaSessionId.value) {
      return null
    }

    return sessions.value.find((session) => session.id === activeMetaSessionId.value) ?? null
  })

  const selectedProposal = computed(() => {
    const target = inspectorTarget.value
    if (!target || target.kind !== 'proposal') {
      return null
    }

    return proposals.value.find((proposal) => proposal.id === target.proposalId) ?? null
  })

  const pendingProposals = computed(() => {
    return proposals.value.filter((proposal) => proposal.status === 'pending_approval')
  })

  const activeSessionProposals = computed(() => {
    if (!activeMetaSessionId.value) {
      return []
    }

    return proposals.value.filter((proposal) => proposal.metaSessionId === activeMetaSessionId.value)
  })

  const activeSessionPendingProposals = computed(() => {
    return activeSessionProposals.value.filter((proposal) => proposal.status === 'pending_approval')
  })

  function hydrate(state: MetaSessionBootstrapState): void {
    const next = cloneBootstrapState(state)
    sessions.value = next.sessions
    activeMetaSessionId.value = next.activeMetaSessionId
    inspectorTarget.value = next.inspectorTarget
  }

  function syncSessionProposalCounts(): void {
    const pendingCounts = new Map<string, number>()
    for (const proposal of proposals.value) {
      if (proposal.status !== 'pending_approval') {
        continue
      }
      pendingCounts.set(
        proposal.metaSessionId,
        (pendingCounts.get(proposal.metaSessionId) ?? 0) + 1
      )
    }

    sessions.value = sessions.value.map((session) => ({
      ...session,
      pendingProposalCount: pendingCounts.get(session.id) ?? 0
    }))
  }

  function hydrateProposals(nextProposals: MetaSessionProposal[]): void {
    proposals.value = nextProposals.map(cloneProposal)
    syncSessionProposalCounts()
  }

  function upsertSession(session: MetaSessionSummary): void {
    const index = sessions.value.findIndex((candidate) => candidate.id === session.id)
    if (index === -1) {
      sessions.value = [...sessions.value, cloneSession(session)]
      syncSessionProposalCounts()
      return
    }

    const next = sessions.value.slice()
    next[index] = cloneSession(session)
    sessions.value = next
    syncSessionProposalCounts()
  }

  function upsertProposal(proposal: MetaSessionProposal): void {
    const index = proposals.value.findIndex((candidate) => candidate.id === proposal.id)
    if (index === -1) {
      proposals.value = [...proposals.value, cloneProposal(proposal)]
      syncSessionProposalCounts()
      return
    }

    const next = proposals.value.slice()
    next[index] = cloneProposal(proposal)
    proposals.value = next
    syncSessionProposalCounts()
  }

  function applySessionEvent(event: MetaSessionEvent): void {
    upsertSession(event.session)
  }

  async function bootstrapFromBridge(): Promise<() => void> {
    const stoa = window.stoa
    if (!stoa.getMetaSessionBootstrapState || !stoa.onMetaSessionEvent) {
      return () => {}
    }

    unsubscribe()
    hydrate(await stoa.getMetaSessionBootstrapState())
    if (stoa.listMetaSessionProposals) {
      hydrateProposals(await stoa.listMetaSessionProposals())
    } else {
      hydrateProposals([])
    }
    unsubscribeEventStream.value = stoa.onMetaSessionEvent((event) => {
      applySessionEvent(event)
    })
    return unsubscribe
  }

  async function createSession(request: CreateMetaSessionRequest): Promise<MetaSessionSummary> {
    const stoa = window.stoa
    if (!stoa.createMetaSession) {
      throw new Error('Meta session creation is unavailable in this build.')
    }

    const created = await stoa.createMetaSession(request)
    upsertSession(created)
    activeMetaSessionId.value = created.id
    return created
  }

  async function setActiveSession(sessionId: string): Promise<void> {
    activeMetaSessionId.value = sessionId
    await window.stoa.setActiveMetaSession?.(sessionId)
  }

  async function closeSession(sessionId: string): Promise<void> {
    await window.stoa.closeMetaSession?.(sessionId)
    sessions.value = sessions.value.filter((session) => session.id !== sessionId)
    if (activeMetaSessionId.value === sessionId) {
      activeMetaSessionId.value = sessions.value[0]?.id ?? null
    }
  }

  async function archiveSession(sessionId: string): Promise<void> {
    await window.stoa.archiveMetaSession?.(sessionId)
    sessions.value = sessions.value.map((session) =>
      session.id === sessionId ? { ...session, archived: true } : session
    )
    if (activeMetaSessionId.value === sessionId) {
      activeMetaSessionId.value = sessions.value.find((s) => !s.archived)?.id ?? null
    }
  }

  async function restoreSession(sessionId: string): Promise<void> {
    await window.stoa.restoreMetaSession?.(sessionId)
    sessions.value = sessions.value.map((session) =>
      session.id === sessionId ? { ...session, archived: false } : session
    )
  }

  async function refreshProposals(): Promise<void> {
    const next = await window.stoa.listMetaSessionProposals?.()
    hydrateProposals(next ?? [])
  }

  async function refreshProposal(proposalId: string): Promise<MetaSessionProposal | null> {
    const proposal = await window.stoa.getMetaSessionProposal?.(proposalId)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function approveProposal(proposalId: string): Promise<MetaSessionProposal | null> {
    const proposal = await window.stoa.approveMetaSessionProposal?.(proposalId)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function rejectProposal(proposalId: string, reason?: string): Promise<MetaSessionProposal | null> {
    const proposal = await window.stoa.rejectMetaSessionProposal?.(proposalId, reason)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function approveAndDispatchProposal(proposalId: string): Promise<MetaSessionProposal | null> {
    const proposal = await window.stoa.dispatchMetaSessionProposal?.(proposalId)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function setInspector(nextTarget: MetaSessionInspectorTarget | null): Promise<void> {
    inspectorTarget.value = nextTarget ? { ...nextTarget } : null
    await window.stoa.setMetaSessionInspectorTarget?.(nextTarget ? { ...nextTarget } : null)
    if (nextTarget?.kind === 'proposal') {
      await refreshProposal(nextTarget.proposalId)
    }
  }

  function unsubscribe(): void {
    unsubscribeEventStream.value?.()
    unsubscribeEventStream.value = null
  }

  return {
    sessions,
    activeMetaSessionId,
    inspectorTarget,
    proposals,
    activeMetaSession,
    selectedProposal,
    pendingProposals,
    activeSessionProposals,
    activeSessionPendingProposals,
    hydrate,
    hydrateProposals,
    bootstrapFromBridge,
    createSession,
    setActiveSession,
    closeSession,
    archiveSession,
    restoreSession,
    applySessionEvent,
    refreshProposals,
    refreshProposal,
    approveProposal,
    rejectProposal,
    approveAndDispatchProposal,
    setInspector,
    unsubscribe
  }
})
