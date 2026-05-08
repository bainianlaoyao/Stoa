import type { BootstrapState, SessionSummary } from '@shared/project-session'
import type { HermesProposal } from './hermes-proposal-store'
import { HermesProposalStore } from './hermes-proposal-store'

interface SnapshotSource {
  snapshot(): BootstrapState
}

interface SessionInputLike {
  send(sessionId: string, data: string): Promise<void>
}

export interface PromptDispatchInput {
  hermesSessionId: string
  targetSessionId: string
  text: string
}

export type PromptDispatchResult =
  | { kind: 'dispatched' }
  | { kind: 'approval_required'; proposal: HermesProposal }

interface HermesCommandDispatcherOptions {
  snapshotSource: SnapshotSource
  sessionInput: SessionInputLike
  proposals: HermesProposalStore
}

export class HermesDispatchError extends Error {
  constructor(
    readonly code: 'unknown_session' | 'unknown_proposal' | 'stale_proposal' | 'proposal_not_approved' | 'proposal_invalid',
    message: string
  ) {
    super(message)
    this.name = 'HermesDispatchError'
  }
}

function isFreeformPrompt(text: string): boolean {
  return text.trim().length > 0
}

function proposalSnapshotMatches(
  proposal: HermesProposal,
  sessions: SessionSummary[]
): boolean {
  return proposal.snapshot.sessions.every((snapshotSession) => {
    const current = sessions.find((candidate) => candidate.id === snapshotSession.sessionId)
    if (!current) {
      return false
    }

    return current.lastStateSequence === snapshotSession.lastStateSequence
      && current.turnEpoch === snapshotSession.turnEpoch
      && current.updatedAt === snapshotSession.updatedAt
  })
}

export class HermesCommandDispatcher {
  constructor(private readonly options: HermesCommandDispatcherOptions) {}

  async promptWorkSession(input: PromptDispatchInput): Promise<PromptDispatchResult> {
    const session = this.options.snapshotSource.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new HermesDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }

    if (isFreeformPrompt(input.text)) {
      return {
        kind: 'approval_required',
        proposal: this.options.proposals.createPromptProposal({
          ...input,
          targetSession: session
        })
      }
    }

    await this.options.sessionInput.send(input.targetSessionId, `${input.text}\r`)
    return { kind: 'dispatched' }
  }

  async dispatchProposal(proposalId: string): Promise<{ kind: 'dispatched' }> {
    const proposal = this.options.proposals.get(proposalId)
    if (!proposal) {
      throw new HermesDispatchError('unknown_proposal', `Unknown proposal: ${proposalId}`)
    }

    if (proposal.kind !== 'prompt' || !proposal.promptText) {
      throw new HermesDispatchError('proposal_invalid', `Unsupported proposal: ${proposalId}`)
    }

    if (proposal.status === 'stale') {
      throw new HermesDispatchError('stale_proposal', 'Proposal is stale.')
    }

    if (proposal.status !== 'approved' && proposal.status !== 'pending_approval') {
      throw new HermesDispatchError('proposal_not_approved', `Proposal is not dispatchable in status ${proposal.status}.`)
    }

    const sessions = this.options.snapshotSource.snapshot().sessions
    if (!proposalSnapshotMatches(proposal, sessions)) {
      await this.options.proposals.markStale(proposal.id, 'Proposal is stale.')
      throw new HermesDispatchError('stale_proposal', 'Proposal is stale.')
    }

    await this.options.proposals.markApproved(proposal.id)
    await this.options.proposals.markExecuting(proposal.id)

    try {
      await this.options.sessionInput.send(proposal.targetSessionIds[0]!, `${proposal.promptText}\r`)
      await this.options.proposals.markCompleted(proposal.id, 'Prompt dispatched to target session.')
      return { kind: 'dispatched' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.options.proposals.markFailed(proposal.id, message)
      throw error
    }
  }
}
