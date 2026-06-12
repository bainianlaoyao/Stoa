/**
 * MetaSessionProposalStore — proposal lifecycle, approval/rejection, staleness tracking.
 *
 * Extracted from `src/core/meta-session-proposal-store.ts` to stoa-server.
 * Replaces JSON state store with Drizzle queries against the
 * `meta_session_proposals` and `meta_session_action_logs` tables.
 */
import { randomUUID } from 'node:crypto'
import { eq, asc } from 'drizzle-orm'
import type {
  MetaSessionActionLog,
  MetaSessionActionLogAction,
  MetaSessionProposal,
  MetaSessionProposalSnapshotSession,
  MetaSessionProposalStatus
} from 'stoa-shared'
import type { SessionSummary } from 'stoa-shared'
import {
  metaSessionProposals,
  metaSessionActionLogs
} from '../db/schema'
import type { StoaDb } from '../db/connection'

export type { MetaSessionProposal } from 'stoa-shared'

export interface CreatePromptProposalInput {
  metaSessionId: string
  targetSessionId: string
  text: string
  targetSession: SessionSummary
}

// ---------------------------------------------------------------------------
// Row <-> DTO mapping
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string
  metaSessionId: string
  workSessionId: string
  kind: string
  presetName: string | null
  promptText: string | null
  status: string
  snapshot: string
  riskLevel: string | null
  riskReason: string | null
  executionResult: string | null
  stalenessReason: string | null
  approvedAt: string | null
  rejectedAt: string | null
  executedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ProposalSnapshotSessionRow {
  session_id: string
  last_state_sequence: number
  turn_epoch: number
  updated_at: string
}

function toSnapshotSession(row: ProposalSnapshotSessionRow): MetaSessionProposalSnapshotSession {
  return {
    sessionId: row.session_id,
    lastStateSequence: row.last_state_sequence,
    turnEpoch: row.turn_epoch,
    updatedAt: row.updated_at
  }
}

function toProposal(row: ProposalRow): MetaSessionProposal {
  const parsedSnapshot = JSON.parse(row.snapshot) as { sessions: ProposalSnapshotSessionRow[] }
  return {
    id: row.id,
    metaSessionId: row.metaSessionId,
    kind: row.kind as MetaSessionProposal['kind'],
    targetSessionIds: [row.workSessionId],
    riskLevel: row.riskLevel ? Number(row.riskLevel) as MetaSessionProposal['riskLevel'] : 0,
    status: row.status as MetaSessionProposalStatus,
    summary: row.riskReason ?? '',
    reason: row.stalenessReason ?? '',
    promptText: row.promptText,
    presetName: row.presetName,
    snapshot: {
      sessions: parsedSnapshot.sessions.map(toSnapshotSession)
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    executedAt: row.executedAt,
    executionResult: row.executionResult
  }
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

interface ActionLogRow {
  id: number
  metaSessionId: string
  proposalId: string | null
  action: string
  detail: string | null
  createdAt: string
}

function toActionLog(row: ActionLogRow): MetaSessionActionLog {
  return {
    id: `action_${row.id}`,
    metaSessionId: row.metaSessionId,
    proposalId: row.proposalId,
    action: row.action as MetaSessionActionLogAction,
    detail: row.detail ?? '',
    createdAt: row.createdAt
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class MetaSessionProposalStore {
  private readonly db: StoaDb

  constructor(db: StoaDb) {
    this.db = db
  }

  async createPromptProposal(input: CreatePromptProposalInput): Promise<MetaSessionProposal> {
    const nowIso = new Date().toISOString()
    const id = `proposal_${randomUUID()}`
    const snapshot = {
      sessions: [
        {
          session_id: input.targetSession.id,
          last_state_sequence: input.targetSession.lastStateSequence,
          turn_epoch: input.targetSession.turnEpoch,
          updated_at: input.targetSession.updatedAt
        }
      ]
    }

    this.db.insert(metaSessionProposals).values({
      id,
      metaSessionId: input.metaSessionId,
      workSessionId: input.targetSessionId,
      kind: 'prompt',
      presetName: null,
      promptText: input.text,
      status: 'pending_approval',
      snapshot: JSON.stringify(snapshot),
      riskLevel: '3',
      riskReason: 'Freeform prompt injection requires explicit approval.',
      executionResult: null,
      stalenessReason: null,
      approvedAt: null,
      rejectedAt: null,
      executedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso
    }).run()

    this.appendActionLog(input.metaSessionId, id, 'proposal.created', 'Created approval-gated prompt proposal.')

    return this.get(id) as MetaSessionProposal
  }

  list(): MetaSessionProposal[] {
    return this.db
      .select()
      .from(metaSessionProposals)
      .orderBy(asc(metaSessionProposals.createdAt))
      .all()
      .map(toProposal)
      .map(cloneProposal)
  }

  get(id: string): MetaSessionProposal | null {
    const row = this.db
      .select()
      .from(metaSessionProposals)
      .where(eq(metaSessionProposals.id, id))
      .get()
    return row ? cloneProposal(toProposal(row)) : null
  }

  async markApproved(id: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (nowIso) => {
      this.db.update(metaSessionProposals)
        .set({ status: 'approved', updatedAt: nowIso, approvedAt: nowIso })
        .where(eq(metaSessionProposals.id, id))
        .run()
      this.appendActionLogByProposalId(id, 'proposal.approved', 'Proposal approved.')
    })
  }

  async markRejected(id: string, reason = 'Proposal rejected.'): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (nowIso) => {
      this.db.update(metaSessionProposals)
        .set({ status: 'rejected', updatedAt: nowIso, rejectedAt: nowIso, executionResult: reason })
        .where(eq(metaSessionProposals.id, id))
        .run()
      this.appendActionLogByProposalId(id, 'proposal.rejected', reason)
    })
  }

  async markExecuting(id: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (nowIso) => {
      this.db.update(metaSessionProposals)
        .set({ status: 'executing', updatedAt: nowIso })
        .where(eq(metaSessionProposals.id, id))
        .run()
      this.appendActionLogByProposalId(id, 'proposal.executing', 'Dispatch execution started.')
    })
  }

  async markCompleted(id: string, executionResult: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (nowIso) => {
      this.db.update(metaSessionProposals)
        .set({ status: 'completed', updatedAt: nowIso, executedAt: nowIso, executionResult })
        .where(eq(metaSessionProposals.id, id))
        .run()
      this.appendActionLogByProposalId(id, 'proposal.completed', executionResult)
    })
  }

  async markFailed(id: string, executionResult: string): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (nowIso) => {
      this.db.update(metaSessionProposals)
        .set({ status: 'failed', updatedAt: nowIso, executedAt: nowIso, executionResult })
        .where(eq(metaSessionProposals.id, id))
        .run()
      this.appendActionLogByProposalId(id, 'proposal.failed', executionResult)
    })
  }

  async markStale(id: string, reason = 'Proposal is stale.'): Promise<MetaSessionProposal | null> {
    return await this.mutate(id, (nowIso) => {
      this.db.update(metaSessionProposals)
        .set({ status: 'stale', updatedAt: nowIso, executionResult: reason })
        .where(eq(metaSessionProposals.id, id))
        .run()
      this.appendActionLogByProposalId(id, 'proposal.stale', reason)
    })
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async mutate(
    id: string,
    mutate: (nowIso: string) => void
  ): Promise<MetaSessionProposal | null> {
    const existing = this.get(id)
    if (!existing) {
      return null
    }
    const nowIso = new Date().toISOString()
    mutate(nowIso)
    return this.get(id)
  }

  private appendActionLog(
    metaSessionId: string,
    proposalId: string,
    action: MetaSessionActionLogAction,
    detail: string
  ): void {
    const nowIso = new Date().toISOString()
    this.db.insert(metaSessionActionLogs).values({
      metaSessionId,
      proposalId,
      action,
      detail,
      createdAt: nowIso
    }).run()
  }

  private appendActionLogByProposalId(
    proposalId: string,
    action: MetaSessionActionLogAction,
    detail: string
  ): void {
    const row = this.db
      .select({ metaSessionId: metaSessionProposals.metaSessionId })
      .from(metaSessionProposals)
      .where(eq(metaSessionProposals.id, proposalId))
      .get()
    if (!row) {
      return
    }
    this.appendActionLog(row.metaSessionId, proposalId, action, detail)
  }
}
