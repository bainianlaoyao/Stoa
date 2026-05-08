import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../testing/test-temp'
import {
  DEFAULT_HERMES_STATE,
  readHermesState,
  resolveHermesStateFilePath,
  writeHermesState
} from './hermes-state-store'

const tempDirs: string[] = []

async function createTempHermesStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-hermes-state-')
  tempDirs.push(dir)
  return join(dir, 'hermes.json')
}

describe('hermes-state-store', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) =>
        import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
      )
    )
  })

  test('returns the v1 default Hermes state when no file exists', async () => {
    const hermesStatePath = await createTempHermesStatePath()

    await expect(readHermesState(hermesStatePath)).resolves.toEqual(DEFAULT_HERMES_STATE)
    expect(DEFAULT_HERMES_STATE.version).toBe(1)
    expect(DEFAULT_HERMES_STATE.sessions).toEqual([])
    expect(DEFAULT_HERMES_STATE.proposals).toEqual([])
    expect(DEFAULT_HERMES_STATE.action_logs).toEqual([])
    expect(DEFAULT_HERMES_STATE.inspector_target).toEqual({ kind: 'app' })
  })

  test('writes and re-reads persisted Hermes state', async () => {
    const hermesStatePath = await createTempHermesStatePath()
    const state = {
      version: 1 as const,
      active_hermes_session_id: 'hermes_session_1',
      proposals: [
        {
          proposal_id: 'proposal_1',
          hermes_session_id: 'hermes_session_1',
          kind: 'prompt' as const,
          target_session_ids: ['session_1'],
          risk_level: 3 as const,
          status: 'pending_approval' as const,
          summary: 'Prompt injection for session_1',
          reason: 'Freeform prompt injection requires explicit approval.',
          prompt_text: 'Please review the diff.',
          preset_name: null,
          snapshot: {
            sessions: [
              {
                session_id: 'session_1',
                last_state_sequence: 17,
                turn_epoch: 4,
                updated_at: '2026-05-07T08:05:00.000Z'
              }
            ]
          },
          created_at: '2026-05-07T08:05:00.000Z',
          updated_at: '2026-05-07T08:05:00.000Z',
          approved_at: null,
          rejected_at: null,
          executed_at: null,
          execution_result: null
        }
      ],
      action_logs: [
        {
          action_id: 'action_1',
          hermes_session_id: 'hermes_session_1',
          proposal_id: 'proposal_1',
          action: 'proposal.created' as const,
          detail: 'Created approval-gated prompt proposal.',
          created_at: '2026-05-07T08:05:00.000Z'
        }
      ],
      inspector_target: {
        kind: 'app' as const
      },
      sessions: [
        {
          session_id: 'hermes_session_1',
          title: 'global-triage',
          status: 'running' as const,
          capability_level: 2 as const,
          pending_proposal_count: 1,
          active_target_count: 3,
          last_summary: 'Collecting blocked sessions.',
          last_risk: 'Two sessions are editing the same module.',
          resume_session_id: 'resume-hermes-1',
          created_at: '2026-05-07T08:00:00.000Z',
          updated_at: '2026-05-07T08:05:00.000Z',
          last_activated_at: '2026-05-07T08:05:00.000Z'
        }
      ]
    }

    await writeHermesState(state, hermesStatePath)

    await expect(readHermesState(hermesStatePath)).resolves.toEqual(state)
  })

  test('resolves Hermes state next to the overridden global state path when Stoa uses a custom state directory', async () => {
    const globalStatePath = join(await createTestTempDir('stoa-global-state-'), 'global.json')
    tempDirs.push(dirname(globalStatePath))

    expect(resolveHermesStateFilePath(globalStatePath)).toBe(join(dirname(globalStatePath), 'hermes.json'))
  })
})
