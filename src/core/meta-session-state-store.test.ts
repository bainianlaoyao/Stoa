import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestTempDir } from '../../testing/test-temp'
import {
  DEFAULT_META_SESSION_STATE,
  readMetaSessionState,
  resolveMetaSessionStateFilePath,
  writeMetaSessionState
} from './meta-session-state-store'

const tempDirs: string[] = []

async function createTempMetaSessionStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-meta-session-state-')
  tempDirs.push(dir)
  return join(dir, 'meta-session.json')
}

describe('meta-session-state-store', () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempDirs.splice(0).map(async (dir) =>
        import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
      )
    )
  })

  test('returns the v1 default meta session state when no file exists', async () => {
    const metaSessionStatePath = await createTempMetaSessionStatePath()

    await expect(readMetaSessionState(metaSessionStatePath)).resolves.toEqual(DEFAULT_META_SESSION_STATE)
    expect(DEFAULT_META_SESSION_STATE.version).toBe(1)
    expect(DEFAULT_META_SESSION_STATE.sessions).toEqual([])
    expect(DEFAULT_META_SESSION_STATE.proposals).toEqual([])
    expect(DEFAULT_META_SESSION_STATE.action_logs).toEqual([])
    expect(DEFAULT_META_SESSION_STATE.inspector_target).toEqual({ kind: 'app' })
  })

  test('writes and re-reads persisted meta session state', async () => {
    const metaSessionStatePath = await createTempMetaSessionStatePath()
    const state = {
      version: 1 as const,
      active_meta_session_id: 'meta_session_1',
      proposals: [
        {
          proposal_id: 'proposal_1',
          meta_session_id: 'meta_session_1',
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
          meta_session_id: 'meta_session_1',
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
          session_id: 'meta_session_1',
          title: 'global-triage',
          status: 'running' as const,
          backend_session_type: 'claude-code' as const,
          capability_level: 2 as const,
          pending_proposal_count: 1,
          active_target_count: 3,
          last_summary: 'Collecting blocked sessions.',
          last_risk: 'Two sessions are editing the same module.',
          backend_session_id: 'backend-session-1',
          created_at: '2026-05-07T08:00:00.000Z',
          updated_at: '2026-05-07T08:05:00.000Z',
          last_activated_at: '2026-05-07T08:05:00.000Z'
        }
      ]
    }

    await writeMetaSessionState(state, metaSessionStatePath)

    await expect(readMetaSessionState(metaSessionStatePath)).resolves.toEqual(state)
  })

  test('normalizes legacy meta session state files, preserves sessions, and keeps a backup copy', async () => {
    const metaSessionStatePath = await createTempMetaSessionStatePath()
    const legacyPayload = JSON.stringify({
      version: 1,
      active_meta_session_id: 'meta_session_1',
      sessions: [
        {
          session_id: 'meta_session_1',
          title: 'legacy-meta-session',
          status: 'idle',
          backend_session_type: 'claude-code',
          capability_level: 3,
          pending_proposal_count: 0,
          active_target_count: 0,
          last_summary: 'legacy payload',
          last_risk: null,
          backend_session_id: 'backend-session-1',
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
      active_meta_session_id: 'meta_session_1',
      sessions: [
        {
          session_id: 'meta_session_1',
          title: 'legacy-meta-session',
          status: 'idle' as const,
          backend_session_type: 'claude-code' as const,
          capability_level: 3 as const,
          pending_proposal_count: 0,
          active_target_count: 0,
          last_summary: 'legacy payload',
          last_risk: null,
          backend_session_id: 'backend-session-1',
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

    await writeFile(metaSessionStatePath, legacyPayload, 'utf-8')

    await expect(readMetaSessionState(metaSessionStatePath)).resolves.toEqual(expectedNormalizedState)
    await expect(readFile(metaSessionStatePath, 'utf-8')).resolves.toBe(JSON.stringify(expectedNormalizedState, null, 2))

    const siblingNames = await readdir(dirname(metaSessionStatePath))
    const backupName = siblingNames.find((name) => {
      return name.startsWith('meta-session.json.invalid.') && name.endsWith('.bak')
    })

    expect(backupName).toBeDefined()
    await expect(readFile(join(dirname(metaSessionStatePath), backupName!), 'utf-8')).resolves.toBe(legacyPayload)
  })

  test('resets unrecoverable meta session state files to the default state and preserves a backup copy', async () => {
    const metaSessionStatePath = await createTempMetaSessionStatePath()
    const corruptPayload = '{not-json'
    const { readFile, readdir, writeFile } = await import('node:fs/promises')

    await writeFile(metaSessionStatePath, corruptPayload, 'utf-8')

    await expect(readMetaSessionState(metaSessionStatePath)).resolves.toEqual(DEFAULT_META_SESSION_STATE)
    await expect(readFile(metaSessionStatePath, 'utf-8')).resolves.toBe(JSON.stringify(DEFAULT_META_SESSION_STATE, null, 2))

    const siblingNames = await readdir(dirname(metaSessionStatePath))
    const backupName = siblingNames.find((name) => {
      return name.startsWith('meta-session.json.invalid.') && name.endsWith('.bak')
    })

    expect(backupName).toBeDefined()
    await expect(readFile(join(dirname(metaSessionStatePath), backupName!), 'utf-8')).resolves.toBe(corruptPayload)
  })

  test('resolves meta session state next to the overridden global state path when Stoa uses a custom state directory', async () => {
    const globalStatePath = join(await createTestTempDir('stoa-global-state-'), 'global.json')
    tempDirs.push(dirname(globalStatePath))

    expect(resolveMetaSessionStateFilePath(globalStatePath)).toBe(join(dirname(globalStatePath), 'meta-session.json'))
  })
})
