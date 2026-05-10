import type { BootstrapState, SessionSummary } from '@shared/project-session'
import type { MetaSessionProposal } from './meta-session-proposal-store'
import { MetaSessionProposalStore } from './meta-session-proposal-store'

interface SnapshotSource {
  snapshot(): BootstrapState
}

interface SessionInputLike {
  send(sessionId: string, data: string): Promise<void>
}

export interface PromptDispatchInput {
  metaSessionId: string
  targetSessionId: string
  text: string
}

export type PromptDispatchResult =
  | { kind: 'dispatched' }
  | { kind: 'approval_required'; proposal: MetaSessionProposal }

export interface PresetDispatchInput {
  metaSessionId: string
  targetSessionId: string
  presetName: 'run-tests-only' | 'summarize-failures' | 'pause-and-generate-summary'
}

export type PresetDispatchResult = {
  kind: 'dispatched'
  presetName: PresetDispatchInput['presetName']
}

interface MetaSessionCommandDispatcherOptions {
  snapshotSource: SnapshotSource
  sessionInput: SessionInputLike
  proposals: MetaSessionProposalStore
}

export class MetaSessionDispatchError extends Error {
  constructor(
    readonly code: 'unknown_session' | 'unknown_proposal' | 'stale_proposal' | 'proposal_not_approved' | 'proposal_invalid' | 'unknown_preset',
    message: string
  ) {
    super(message)
    this.name = 'MetaSessionDispatchError'
  }
}

function isFreeformPrompt(text: string): boolean {
  return text.trim().length > 0
}

function proposalSnapshotMatches(
  proposal: MetaSessionProposal,
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

function resolvePresetPrompt(presetName: PresetDispatchInput['presetName']): string {
  switch (presetName) {
    case 'run-tests-only':
      return 'Continue by running the project test command only. Do not modify code. Summarize failures and likely causes.'
    case 'summarize-failures':
      return 'Do not modify code. Summarize the current failing tests, error messages, and the most likely root causes.'
    case 'pause-and-generate-summary':
      return 'Pause implementation. Generate a concise re-entry summary covering current goal, status, risks, and next recommended step.'
    default:
      throw new MetaSessionDispatchError('unknown_preset', `Unknown preset: ${presetName satisfies never}`)
  }
}

export class MetaSessionCommandDispatcher {
  constructor(private readonly options: MetaSessionCommandDispatcherOptions) {}

  async promptWorkSession(input: PromptDispatchInput): Promise<PromptDispatchResult> {
    const session = this.options.snapshotSource.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
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

  createPromptProposal(input: PromptDispatchInput): MetaSessionProposal {
    const session = this.options.snapshotSource.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }

    return this.options.proposals.createPromptProposal({
      ...input,
      targetSession: session
    })
  }

  async dispatchPreset(input: PresetDispatchInput): Promise<PresetDispatchResult> {
    const session = this.options.snapshotSource.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }

    const prompt = resolvePresetPrompt(input.presetName)
    await this.options.sessionInput.send(input.targetSessionId, `${prompt}\r`)
    return {
      kind: 'dispatched',
      presetName: input.presetName
    }
  }

  async dispatchProposal(proposalId: string): Promise<{ kind: 'dispatched' }> {
    const proposal = this.options.proposals.get(proposalId)
    if (!proposal) {
      throw new MetaSessionDispatchError('unknown_proposal', `Unknown proposal: ${proposalId}`)
    }

    if (proposal.kind !== 'prompt' || !proposal.promptText) {
      throw new MetaSessionDispatchError('proposal_invalid', `Unsupported proposal: ${proposalId}`)
    }

    if (proposal.status === 'stale') {
      throw new MetaSessionDispatchError('stale_proposal', 'Proposal is stale.')
    }

    if (proposal.status !== 'approved' && proposal.status !== 'pending_approval') {
      throw new MetaSessionDispatchError('proposal_not_approved', `Proposal is not dispatchable in status ${proposal.status}.`)
    }

    const sessions = this.options.snapshotSource.snapshot().sessions
    if (!proposalSnapshotMatches(proposal, sessions)) {
      await this.options.proposals.markStale(proposal.id, 'Proposal is stale.')
      throw new MetaSessionDispatchError('stale_proposal', 'Proposal is stale.')
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
