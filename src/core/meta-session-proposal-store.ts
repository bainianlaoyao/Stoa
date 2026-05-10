import { randomUUID } from 'node:crypto'
import type {
  MetaSessionActionLog,
  MetaSessionProposal,
  MetaSessionProposalSnapshotSession,
  PersistedMetaSessionActionLog,
  PersistedMetaSessionProposal,
  PersistedMetaSessionProposalSnapshotSession
} from '@shared/meta-session'
import type { SessionSummary } from '@shared/project-session'
import { readMetaSessionState, updateMetaSessionState } from './meta-session-state-store'

export type { MetaSessionProposal } from '@shared/meta-session'

export interface CreatePromptProposalInput {
  metaSessionId: string
  targetSessionId: string
  text: string
  targetSession: SessionSummary
}

interface MetaSessionProposalStoreOptions {
  statePath?: string
}

function cloneSnapshotSession(session: MetaSessionProposalSnapshotSession): MetaSessionProposalSnapshotSession {
  return { ...session }
}

function cloneProposal(proposal: MetaSessionProposal): MetaSessionProposal {
  return {
    ...proposal,
    targetSessionIds: [...proposal.targetSessionIds],
    snapshot: {
      sessions: proposal.snapshot.sessions.map(cloneSnapshotSession)
    }
  }
}

function toSnapshotSession(session: PersistedMetaSessionProposalSnapshotSession): MetaSessionProposalSnapshotSession {
  return {
    sessionId: session.session_id,
    lastStateSequence: session.last_state_sequence,
    turnEpoch: session.turn_epoch,
    updatedAt: session.updated_at
  }
}

function toProposal(proposal: PersistedMetaSessionProposal): MetaSessionProposal {
  return {
    id: proposal.proposal_id,
    metaSessionId: proposal.meta_session_id,
    kind: proposal.kind,
    targetSessionIds: [...proposal.target_session_ids],
    riskLevel: proposal.risk_level,
    status: proposal.status,
    summary: proposal.summary,
    reason: proposal.reason,
    promptText: proposal.prompt_text,
    presetName: proposal.preset_name,
    snapshot: {
      sessions: proposal.snapshot.sessions.map(toSnapshotSession)
    },
    createdAt: proposal.created_at,
    updatedAt: proposal.updated_at,
    approvedAt: proposal.approved_at,
    rejectedAt: proposal.rejected_at,
    executedAt: proposal.executed_at,
    executionResult: proposal.execution_result
  }
}

function toPersistedSnapshotSession(session: MetaSessionProposalSnapshotSession): PersistedMetaSessionProposalSnapshotSession {
  return {
    session_id: session.sessionId,
    last_state_sequence: session.lastStateSequence,
    turn_epoch: session.turnEpoch,
    updated_at: session.updatedAt
  }
}

function toPersistedProposal(proposal: MetaSessionProposal): PersistedMetaSessionProposal {
  return {
    proposal_id: proposal.id,
    meta_session_id: proposal.metaSessionId,
    kind: proposal.kind,
    target_session_ids: [...proposal.targetSessionIds],
    risk_level: proposal.riskLevel,
    status: proposal.status,
    summary: proposal.summary,
    reason: proposal.reason,
    prompt_text: proposal.promptText,
    preset_name: proposal.presetName,
    snapshot: {
      sessions: proposal.snapshot.sessions.map(toPersistedSnapshotSession)
    },
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    approved_at: proposal.approvedAt,
    rejected_at: proposal.rejectedAt,
    executed_at: proposal.executedAt,
    execution_result: proposal.executionResult
  }
}

function toActionLog(log: PersistedMetaSessionActionLog): MetaSessionActionLog {
  return {
    id: log.action_id,
    metaSessionId: log.meta_session_id,
    proposalId: log.proposal_id,
    action: log.action,
    detail: log.detail,
    createdAt: log.created_at
  }
}

function toPersistedActionLog(log: MetaSessionActionLog): PersistedMetaSessionActionLog {
  return {
    action_id: log.id,
    meta_session_id: log.metaSessionId,
    proposal_id: log.proposalId,
    action: log.action,
    detail: log.detail,
    created_at: log.createdAt
  }
}

export class MetaSessionProposalStore {
  private readonly proposals = new Map<string, MetaSessionProposal>()
  private readonly actionLogs: MetaSessionActionLog[] = []
  private readonly persistent: boolean

  constructor(private readonly options: MetaSessionProposalStoreOptions = {}) {
    this.persistent = typeof options.statePath === 'string' && options.statePath.trim().length > 0
  }

  static async create(options: MetaSessionProposalStoreOptions = {}): Promise<MetaSessionProposalStore> {
    const store = new MetaSessionProposalStore(options)
    if (store.persistent) {
      await store.load()
    }
    return store
  }

  private async load(): Promise<void> {
    const persisted = await readMetaSessionState(this.options.statePath)
    this.proposals.clear()
    for (const proposal of persisted.proposals.map(toProposal)) {
      this.proposals.set(proposal.id, proposal)
    }
    this.actionLogs.splice(0, this.actionLogs.length, ...persisted.action_logs.map(toActionLog))
  }

  private async persist(): Promise<void> {
    if (!this.persistent) {
      return
    }

    await updateMetaSessionState((current) => ({
      version: 1,
      active_meta_session_id: current.active_meta_session_id,
      sessions: current.sessions,
      proposals: this.list().map(toPersistedProposal),
      action_logs: this.actionLogs.map(toPersistedActionLog),
      inspector_target: current.inspector_target
    }), this.options.statePath)
  }

  private appendActionLog(proposal: MetaSessionProposal, action: MetaSessionActionLog['action'], detail: string): void {
    this.actionLogs.push({
      id: `action_${randomUUID()}`,
      metaSessionId: proposal.metaSessionId,
      proposalId: proposal.id,
      action,
      detail,
      createdAt: new Date().toISOString()
    })
  }

  private async mutate(
    proposalId: string,
    mutateProposal: (proposal: MetaSessionProposal, nowIso: string) => MetaSessionProposal
  ): Promise<MetaSessionProposal | null> {
    const current = this.proposals.get(proposalId)
    if (!current) {
      return null
    }

    const next = mutateProposal(current, new Date().toISOString())
    this.proposals.set(proposalId, next)
    await this.persist()
    return cloneProposal(next)
  }

  createPromptProposal(input: CreatePromptProposalInput): MetaSessionProposal {
    const nowIso = new Date().toISOString()
    const proposal: MetaSessionProposal = {
      id: `proposal_${randomUUID()}`,
      metaSessionId: input.metaSessionId,
      kind: 'prompt',
      targetSessionIds: [input.targetSessionId],
      riskLevel: 3,
      status: 'pending_approval',
      summary: `Prompt injection for ${input.targetSessionId}`,
      reason: 'Freeform prompt injection requires explicit approval.',
      promptText: input.text,
      presetName: null,
      snapshot: {
        sessions: [
          {
            sessionId: input.targetSession.id,
            lastStateSequence: input.targetSession.lastStateSequence,
            turnEpoch: input.targetSession.turnEpoch,
            updatedAt: input.targetSession.updatedAt
          }
        ]
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      approvedAt: null,
      rejectedAt: null,
      executedAt: null,
      executionResult: null
    }

    this.proposals.set(proposal.id, proposal)
    this.appendActionLog(proposal, 'proposal.created', 'Created approval-gated prompt proposal.')
    void this.persist()
    return cloneProposal(proposal)
  }

  list(): MetaSessionProposal[] {
    return [...this.proposals.values()].map(cloneProposal)
  }

  get(id: string): MetaSessionProposal | null {
    const proposal = this.proposals.get(id)
    return proposal ? cloneProposal(proposal) : null
  }

  async markApproved(id: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (proposal, nowIso) => {
      const next: MetaSessionProposal = {
        ...proposal,
        status: 'approved',
        updatedAt: nowIso,
        approvedAt: nowIso
      }
      this.appendActionLog(next, 'proposal.approved', 'Proposal approved.')
      return next
    })
  }

  async markRejected(id: string, reason = 'Proposal rejected.'): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (proposal, nowIso) => {
      const next: MetaSessionProposal = {
        ...proposal,
        status: 'rejected',
        updatedAt: nowIso,
        rejectedAt: nowIso,
        executionResult: reason
      }
      this.appendActionLog(next, 'proposal.rejected', reason)
      return next
    })
  }

  async markExecuting(id: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (proposal, nowIso) => {
      const next: MetaSessionProposal = {
        ...proposal,
        status: 'executing',
        updatedAt: nowIso
      }
      this.appendActionLog(next, 'proposal.executing', 'Dispatch execution started.')
      return next
    })
  }

  async markCompleted(id: string, executionResult: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (proposal, nowIso) => {
      const next: MetaSessionProposal = {
        ...proposal,
        status: 'completed',
        updatedAt: nowIso,
        executedAt: nowIso,
        executionResult
      }
      this.appendActionLog(next, 'proposal.completed', executionResult)
      return next
    })
  }

  async markFailed(id: string, executionResult: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (proposal, nowIso) => {
      const next: MetaSessionProposal = {
        ...proposal,
        status: 'failed',
        updatedAt: nowIso,
        executedAt: nowIso,
        executionResult
      }
      this.appendActionLog(next, 'proposal.failed', executionResult)
      return next
    })
  }

  async markStale(id: string, reason = 'Proposal is stale.'): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (proposal, nowIso) => {
      const next: MetaSessionProposal = {
        ...proposal,
        status: 'stale',
        updatedAt: nowIso,
        executionResult: reason
      }
      this.appendActionLog(next, 'proposal.stale', reason)
      return next
    })
  }
}
