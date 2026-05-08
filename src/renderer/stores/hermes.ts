import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  CreateHermesSessionRequest,
  HermesBootstrapState,
  HermesInspectorTarget,
  HermesProposal,
  HermesSessionEvent,
  HermesSessionSummary
} from '@shared/hermes'

function cloneSession(session: HermesSessionSummary): HermesSessionSummary {
  return { ...session }
}

function cloneProposal(proposal: HermesProposal): HermesProposal {
  return {
    ...proposal,
    targetSessionIds: [...proposal.targetSessionIds],
    snapshot: {
      sessions: proposal.snapshot.sessions.map((session) => ({ ...session }))
    }
  }
}

function cloneBootstrapState(state: HermesBootstrapState): HermesBootstrapState {
  return {
    activeHermesSessionId: state.activeHermesSessionId,
    sessions: state.sessions.map(cloneSession),
    inspectorTarget: state.inspectorTarget ? { ...state.inspectorTarget } : null
  }
}

export const useHermesStore = defineStore('hermes', () => {
  const sessions = ref<HermesSessionSummary[]>([])
  const activeHermesSessionId = ref<string | null>(null)
  const inspectorTarget = ref<HermesInspectorTarget | null>(null)
  const proposals = ref<HermesProposal[]>([])
  const unsubscribeEventStream = ref<(() => void) | null>(null)

  const activeHermesSession = computed(() => {
    if (!activeHermesSessionId.value) {
      return null
    }

    return sessions.value.find((session) => session.id === activeHermesSessionId.value) ?? null
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
    if (!activeHermesSessionId.value) {
      return []
    }

    return proposals.value.filter((proposal) => proposal.hermesSessionId === activeHermesSessionId.value)
  })

  const activeSessionPendingProposals = computed(() => {
    return activeSessionProposals.value.filter((proposal) => proposal.status === 'pending_approval')
  })

  function hydrate(state: HermesBootstrapState): void {
    const next = cloneBootstrapState(state)
    sessions.value = next.sessions
    activeHermesSessionId.value = next.activeHermesSessionId
    inspectorTarget.value = next.inspectorTarget
  }

  function syncSessionProposalCounts(): void {
    const pendingCounts = new Map<string, number>()
    for (const proposal of proposals.value) {
      if (proposal.status !== 'pending_approval') {
        continue
      }
      pendingCounts.set(
        proposal.hermesSessionId,
        (pendingCounts.get(proposal.hermesSessionId) ?? 0) + 1
      )
    }

    sessions.value = sessions.value.map((session) => ({
      ...session,
      pendingProposalCount: pendingCounts.get(session.id) ?? 0
    }))
  }

  function hydrateProposals(nextProposals: HermesProposal[]): void {
    proposals.value = nextProposals.map(cloneProposal)
    syncSessionProposalCounts()
  }

  function upsertSession(session: HermesSessionSummary): void {
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

  function upsertProposal(proposal: HermesProposal): void {
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

  function applySessionEvent(event: HermesSessionEvent): void {
    upsertSession(event.session)
  }

  async function bootstrapFromBridge(): Promise<() => void> {
    const stoa = window.stoa
    if (!stoa.getHermesBootstrapState || !stoa.onHermesSessionEvent) {
      return () => {}
    }

    unsubscribe()
    hydrate(await stoa.getHermesBootstrapState())
    if (stoa.listHermesProposals) {
      hydrateProposals(await stoa.listHermesProposals())
    } else {
      hydrateProposals([])
    }
    unsubscribeEventStream.value = stoa.onHermesSessionEvent((event) => {
      applySessionEvent(event)
    })
    return unsubscribe
  }

  async function createSession(request: CreateHermesSessionRequest): Promise<HermesSessionSummary> {
    const stoa = window.stoa
    if (!stoa.createHermesSession) {
      throw new Error('Hermes session creation is unavailable in this build.')
    }

    const created = await stoa.createHermesSession(request)
    upsertSession(created)
    activeHermesSessionId.value = created.id
    return created
  }

  async function setActiveSession(sessionId: string): Promise<void> {
    activeHermesSessionId.value = sessionId
    await window.stoa.setActiveHermesSession?.(sessionId)
  }

  async function closeSession(sessionId: string): Promise<void> {
    await window.stoa.closeHermesSession?.(sessionId)
    sessions.value = sessions.value.filter((session) => session.id !== sessionId)
    if (activeHermesSessionId.value === sessionId) {
      activeHermesSessionId.value = sessions.value[0]?.id ?? null
    }
  }

  async function refreshProposals(): Promise<void> {
    const next = await window.stoa.listHermesProposals?.()
    hydrateProposals(next ?? [])
  }

  async function refreshProposal(proposalId: string): Promise<HermesProposal | null> {
    const proposal = await window.stoa.getHermesProposal?.(proposalId)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function approveProposal(proposalId: string): Promise<HermesProposal | null> {
    const proposal = await window.stoa.approveHermesProposal?.(proposalId)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function rejectProposal(proposalId: string, reason?: string): Promise<HermesProposal | null> {
    const proposal = await window.stoa.rejectHermesProposal?.(proposalId, reason)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function approveAndDispatchProposal(proposalId: string): Promise<HermesProposal | null> {
    const proposal = await window.stoa.dispatchHermesProposal?.(proposalId)
    if (!proposal) {
      return null
    }

    upsertProposal(proposal)
    return proposal
  }

  async function setInspector(nextTarget: HermesInspectorTarget | null): Promise<void> {
    inspectorTarget.value = nextTarget ? { ...nextTarget } : null
    await window.stoa.setHermesInspectorTarget?.(nextTarget ? { ...nextTarget } : null)
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
    activeHermesSessionId,
    inspectorTarget,
    proposals,
    activeHermesSession,
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
