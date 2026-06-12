/**
 * MetaSessionCommandDispatcher — execution of proposals and presets.
 *
 * Extracted from `src/core/meta-session-command-dispatcher.ts` to stoa-server.
 * `ProjectSessionManager` is supplied via constructor injection (its
 * `snapshot()` method is the only thing the dispatcher needs from it).
 */
import type { BootstrapState, SessionSummary } from 'stoa-shared'
import type { MetaSessionProposal } from 'stoa-shared'
import { MetaSessionProposalStore } from './meta-session-proposal'

// ---------------------------------------------------------------------------
// ProjectSessionManager dependency — minimal surface area: a `snapshot()` getter.
// ---------------------------------------------------------------------------

export interface IProjectSessionLike {
  snapshot(): BootstrapState
}

// ---------------------------------------------------------------------------
// Input/Output types — preserve the original contract
// ---------------------------------------------------------------------------

interface SessionInputLike {
  send(sessionId: string, data: string): Promise<void>
}

export interface PromptDispatchInput {
  metaSessionId: string
  targetSessionId: string
  text: string
}

export interface SendKeysDispatchInput {
  metaSessionId: string
  targetSessionId: string
  data: string
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

export type DirectWorkSessionDispatchResult = {
  kind: 'dispatched'
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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
      throw new MetaSessionDispatchError('unknown_preset', `Unknown preset: ${String(presetName)}`)
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface MetaSessionDispatcherDeps {
  sessionManager: IProjectSessionLike
  sessionInput: SessionInputLike
  proposals: MetaSessionProposalStore
}

export class MetaSessionCommandDispatcher {
  constructor(private readonly deps: MetaSessionDispatcherDeps) {}

  async sendKeysToWorkSession(input: SendKeysDispatchInput): Promise<DirectWorkSessionDispatchResult> {
    const session = this.deps.sessionManager.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }
    await this.deps.sessionInput.send(input.targetSessionId, input.data)
    return { kind: 'dispatched' }
  }

  async promptWorkSession(input: PromptDispatchInput): Promise<PromptDispatchResult> {
    const session = this.deps.sessionManager.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }

    if (isFreeformPrompt(input.text)) {
      return {
        kind: 'approval_required',
        proposal: await this.deps.proposals.createPromptProposal({
          ...input,
          targetSession: session
        })
      }
    }

    await this.deps.sessionInput.send(input.targetSessionId, `${input.text}\r`)
    return { kind: 'dispatched' }
  }

  async createPromptProposal(input: PromptDispatchInput): Promise<MetaSessionProposal> {
    const session = this.deps.sessionManager.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }

    return await this.deps.proposals.createPromptProposal({
      ...input,
      targetSession: session
    })
  }

  async dispatchPreset(input: PresetDispatchInput): Promise<PresetDispatchResult> {
    const session = this.deps.sessionManager.snapshot().sessions.find((candidate) => candidate.id === input.targetSessionId)
    if (!session) {
      throw new MetaSessionDispatchError('unknown_session', `Unknown session: ${input.targetSessionId}`)
    }

    const prompt = resolvePresetPrompt(input.presetName)
    await this.deps.sessionInput.send(input.targetSessionId, `${prompt}\r`)
    return {
      kind: 'dispatched',
      presetName: input.presetName
    }
  }

  async dispatchProposal(proposalId: string): Promise<{ kind: 'dispatched' }> {
    const proposal = this.deps.proposals.get(proposalId)
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

    const sessions = this.deps.sessionManager.snapshot().sessions
    if (!proposalSnapshotMatches(proposal, sessions)) {
      await this.deps.proposals.markStale(proposal.id, 'Proposal is stale.')
      throw new MetaSessionDispatchError('stale_proposal', 'Proposal is stale.')
    }

    await this.deps.proposals.markApproved(proposal.id)
    await this.deps.proposals.markExecuting(proposal.id)

    try {
      const targetSessionId = proposal.targetSessionIds[0]!
      await this.deps.sessionInput.send(targetSessionId, `${proposal.promptText}\r`)
      await this.deps.proposals.markCompleted(proposal.id, 'Prompt dispatched to target session.')
      return { kind: 'dispatched' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.proposals.markFailed(proposal.id, message)
      throw error
    }
  }
}
