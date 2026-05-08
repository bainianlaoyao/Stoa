import { describe, expect, test, vi } from 'vitest'
import { HermesProposalStore } from './hermes-proposal-store'
import { HermesCommandDispatcher } from './hermes-command-dispatcher'

describe('HermesCommandDispatcher', () => {
  test('creates a proposal instead of directly injecting a freeform prompt when approval is required', async () => {
    const proposalStore = new HermesProposalStore()
    const send = vi.fn(async () => {})
    const dispatcher = new HermesCommandDispatcher({
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [{
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
            }]
          }
        }
      },
      sessionInput: {
        send
      },
      proposals: proposalStore
    })

    const result = await dispatcher.promptWorkSession({
      hermesSessionId: 'hermes_1',
      targetSessionId: 'session_1',
      text: 'Refactor and edit the code now.'
    })

    expect(result.kind).toBe('approval_required')
    if (result.kind !== 'approval_required') {
      throw new Error('expected approval_required result')
    }
    expect(result.proposal?.status).toBe('pending_approval')
    expect(send).not.toHaveBeenCalled()
  })

  test('treats all freeform prompt injection as approval-gated even when the text is low risk', async () => {
    const proposalStore = new HermesProposalStore()
    const send = vi.fn(async () => {})
    const dispatcher = new HermesCommandDispatcher({
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [{
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
            }]
          }
        }
      },
      sessionInput: {
        send
      },
      proposals: proposalStore
    })

    const result = await dispatcher.promptWorkSession({
      hermesSessionId: 'hermes_1',
      targetSessionId: 'session_1',
      text: 'Please summarize the current diff and test status.'
    })

    expect(result.kind).toBe('approval_required')
    expect(send).not.toHaveBeenCalled()
  })

  test('rejects proposal dispatch when the proposal has become stale', async () => {
    const proposalStore = new HermesProposalStore()
    const send = vi.fn(async () => {})
    const snapshotSource = {
      snapshot() {
        return {
          activeProjectId: 'project_1',
          activeSessionId: 'session_1',
          terminalWebhookPort: 43127,
          projects: [],
          sessions: [{
            id: 'session_1',
            projectId: 'project_1',
            type: 'codex' as const,
            runtimeState: 'alive' as const,
            turnState: 'idle' as const,
            turnEpoch: 4,
            lastTurnOutcome: 'completed' as const,
            blockingReason: null,
            failureReason: null,
            hasUnseenCompletion: true,
            runtimeExitCode: null,
            runtimeExitReason: null,
            lastStateSequence: 17,
            title: 'session one',
            summary: 'Completed but waiting for review.',
            recoveryMode: 'resume-external' as const,
            externalSessionId: 'codex-1',
            createdAt: '2026-05-07T08:00:00.000Z',
            updatedAt: '2026-05-07T08:05:00.000Z',
            lastActivatedAt: '2026-05-07T08:05:00.000Z',
            archived: false
          }]
        }
      }
    }
    const dispatcher = new HermesCommandDispatcher({
      snapshotSource,
      sessionInput: {
        send
      },
      proposals: proposalStore
    })

    const created = await dispatcher.promptWorkSession({
      hermesSessionId: 'hermes_1',
      targetSessionId: 'session_1',
      text: 'Refactor and edit the code now.'
    })

    if (created.kind !== 'approval_required') {
      throw new Error('expected approval_required result')
    }

    await proposalStore.markStale(created.proposal.id)

    await expect(dispatcher.dispatchProposal(created.proposal.id)).rejects.toThrow(/stale/i)
    expect(send).not.toHaveBeenCalled()
  })

  test('marks a proposal stale when the target session state has changed since proposal creation', async () => {
    const proposalStore = new HermesProposalStore()
    const send = vi.fn(async () => {})
    let lastStateSequence = 17
    const dispatcher = new HermesCommandDispatcher({
      snapshotSource: {
        snapshot() {
          return {
            activeProjectId: 'project_1',
            activeSessionId: 'session_1',
            terminalWebhookPort: 43127,
            projects: [],
            sessions: [{
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
              lastStateSequence,
              title: 'session one',
              summary: 'Completed but waiting for review.',
              recoveryMode: 'resume-external',
              externalSessionId: 'codex-1',
              createdAt: '2026-05-07T08:00:00.000Z',
              updatedAt: lastStateSequence === 17
                ? '2026-05-07T08:05:00.000Z'
                : '2026-05-07T08:06:00.000Z',
              lastActivatedAt: '2026-05-07T08:05:00.000Z',
              archived: false
            }]
          }
        }
      },
      sessionInput: {
        send
      },
      proposals: proposalStore
    })

    const created = await dispatcher.promptWorkSession({
      hermesSessionId: 'hermes_1',
      targetSessionId: 'session_1',
      text: 'Refactor and edit the code now.'
    })

    if (created.kind !== 'approval_required') {
      throw new Error('expected approval_required result')
    }

    lastStateSequence = 18

    await expect(dispatcher.dispatchProposal(created.proposal.id)).rejects.toThrow(/stale/i)
    expect(proposalStore.get(created.proposal.id)?.status).toBe('stale')
    expect(send).not.toHaveBeenCalled()
  })
})
