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
          backend_session_type: 'claude-code' as const,
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

  test('normalizes legacy Hermes state files, preserves sessions, and keeps a backup copy', async () => {
    const hermesStatePath = await createTempHermesStatePath()
    const legacyPayload = JSON.stringify({
      version: 1,
      active_hermes_session_id: 'hermes_session_1',
      sessions: [
        {
          session_id: 'hermes_session_1',
          title: 'legacy-hermes',
          status: 'idle',
          backend_session_type: 'claude-code',
          capability_level: 3,
          pending_proposal_count: 0,
          active_target_count: 0,
          last_summary: 'legacy payload',
          last_risk: null,
          resume_session_id: 'resume-hermes-1',
          created_at: '2026-05-07T08:00:00.000Z',
          updated_at: '2026-05-07T08:05:00.000Z',
          last_activated_at: null
        }
      ],
      inspector_target: {
        kind: 'app'
      }
    }, null, 2)
    const { readFile, readdir, writeFile } = await import('node:fs/promises')
    const expectedNormalizedState = {
      version: 1 as const,
      active_hermes_session_id: 'hermes_session_1',
      sessions: [
        {
          session_id: 'hermes_session_1',
          title: 'legacy-hermes',
          status: 'idle' as const,
          backend_session_type: 'claude-code' as const,
          capability_level: 3 as const,
          pending_proposal_count: 0,
          active_target_count: 0,
          last_summary: 'legacy payload',
          last_risk: null,
          resume_session_id: 'resume-hermes-1',
          created_at: '2026-05-07T08:00:00.000Z',
          updated_at: '2026-05-07T08:05:00.000Z',
          last_activated_at: null
        }
      ],
      proposals: [],
      action_logs: [],
      inspector_target: {
        kind: 'app' as const
      }
    }

    await writeFile(hermesStatePath, legacyPayload, 'utf-8')

    await expect(readHermesState(hermesStatePath)).resolves.toEqual(expectedNormalizedState)
    await expect(readFile(hermesStatePath, 'utf-8')).resolves.toBe(JSON.stringify(expectedNormalizedState, null, 2))

    const siblingNames = await readdir(dirname(hermesStatePath))
    const backupName = siblingNames.find((name) => {
      return name.startsWith('hermes.json.invalid.') && name.endsWith('.bak')
    })

    expect(backupName).toBeDefined()
    await expect(readFile(join(dirname(hermesStatePath), backupName!), 'utf-8')).resolves.toBe(legacyPayload)
  })

  test('resets unrecoverable Hermes state files to the default state and preserves a backup copy', async () => {
    const hermesStatePath = await createTempHermesStatePath()
    const corruptPayload = '{not-json'
    const { readFile, readdir, writeFile } = await import('node:fs/promises')

    await writeFile(hermesStatePath, corruptPayload, 'utf-8')

    await expect(readHermesState(hermesStatePath)).resolves.toEqual(DEFAULT_HERMES_STATE)
    await expect(readFile(hermesStatePath, 'utf-8')).resolves.toBe(JSON.stringify(DEFAULT_HERMES_STATE, null, 2))

    const siblingNames = await readdir(dirname(hermesStatePath))
    const backupName = siblingNames.find((name) => {
      return name.startsWith('hermes.json.invalid.') && name.endsWith('.bak')
    })

    expect(backupName).toBeDefined()
    await expect(readFile(join(dirname(hermesStatePath), backupName!), 'utf-8')).resolves.toBe(corruptPayload)
  })

  test('resolves Hermes state next to the overridden global state path when Stoa uses a custom state directory', async () => {
    const globalStatePath = join(await createTestTempDir('stoa-global-state-'), 'global.json')
    tempDirs.push(dirname(globalStatePath))

    expect(resolveHermesStateFilePath(globalStatePath)).toBe(join(dirname(globalStatePath), 'hermes.json'))
  })
})
