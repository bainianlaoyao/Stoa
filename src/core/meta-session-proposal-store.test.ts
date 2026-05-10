import { describe, expect, test } from 'vitest'
import { MetaSessionProposalStore } from './meta-session-proposal-store'

describe('MetaSessionProposalStore', () => {
  test('creates prompt proposals and allows them to transition to approved and stale', async () => {
    const store = new MetaSessionProposalStore()
    const proposal = store.createPromptProposal({
      metaSessionId: 'meta_session_1',
      targetSessionId: 'session_1',
      text: 'Refactor and edit the code now.',
      targetSession: {
        id: 'session_1',
        projectId: 'project_1',
        type: 'codex',
        runtimeState: 'alive',
        turnState: 'idle',
        turnEpoch: 4,
        lastTurnOutcome: 'completed',
        blockingReason: null,
        failureReason: null,
        hasUnseenCompletion: true,
        runtimeExitCode: null,
        runtimeExitReason: null,
        lastStateSequence: 17,
        title: 'session one',
        summary: 'Completed but waiting for review.',
        recoveryMode: 'resume-external',
        externalSessionId: 'codex-1',
        createdAt: '2026-05-07T08:00:00.000Z',
        updatedAt: '2026-05-07T08:05:00.000Z',
        lastActivatedAt: '2026-05-07T08:05:00.000Z',
        archived: false
      }
    })

    expect(proposal.status).toBe('pending_approval')

    const approved = await store.markApproved(proposal.id)
    expect(approved?.status).toBe('approved')

    const stale = await store.markStale(proposal.id)
    expect(stale?.status).toBe('stale')
  })
})
