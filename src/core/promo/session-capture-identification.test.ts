import { describe, expect, test } from 'vitest'
import { resolveNewSessionDebugSnapshot } from './session-capture-identification'

describe('session-capture-identification', () => {
  test('prefers the newly introduced session id when multiple sessions share the same title', () => {
    const beforeIds = new Set([
      'session-existing-1',
      'session-existing-2'
    ])

    const resolved = resolveNewSessionDebugSnapshot({
      beforeIds,
      title: 'claude-promo-lab',
      sessions: [
        {
          id: 'session-existing-1',
          title: 'claude-promo-lab'
        },
        {
          id: 'session-existing-2',
          title: 'claude-promo-workspace'
        },
        {
          id: 'session-new-1',
          title: 'claude-promo-lab'
        }
      ]
    })

    expect(resolved).toEqual({
      id: 'session-new-1',
      title: 'claude-promo-lab'
    })
  })

  test('falls back to title matching when no new id is present', () => {
    const resolved = resolveNewSessionDebugSnapshot({
      beforeIds: new Set(['session-existing-1']),
      title: 'codex-promo-workspace',
      sessions: [
        {
          id: 'session-existing-1',
          title: 'codex-promo-workspace'
        }
      ]
    })

    expect(resolved).toEqual({
      id: 'session-existing-1',
      title: 'codex-promo-workspace'
    })
  })
})
