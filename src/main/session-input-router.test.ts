import { describe, expect, test } from 'vitest'
import { SessionInputRouter } from './session-input-router'

describe('SessionInputRouter', () => {
  test('passes through non-codex input unchanged', async () => {
    const writes: Array<{ sessionId: string; data: string }> = []
    const router = new SessionInputRouter(
      {
        getSessionType(sessionId) {
          return sessionId === 'shell-1' ? 'shell' : null
        }
      },
      {
        write(sessionId, data) {
          writes.push({ sessionId, data })
        }
      }
    )

    await router.send('shell-1', 'echo ok\r')

    expect(writes).toEqual([{ sessionId: 'shell-1', data: 'echo ok\r' }])
  })

  test('splits codex plain-text chunks into ordered frames', async () => {
    let now = 0
    const writes: string[] = []
    const sleeps: number[] = []

    const router = new SessionInputRouter(
      {
        getSessionType() {
          return 'codex'
        }
      },
      {
        write(_sessionId, data) {
          writes.push(data)
        }
      },
      {
        codexPlainInputMinIntervalMs: 35,
        codexSubmitInputMinIntervalMs: 120,
        nowMs: () => now,
        sleep: async (ms) => {
          sleeps.push(ms)
          now += ms
        }
      }
    )

    await router.send('codex-1', 'OK\r')

    expect(writes).toEqual(['O', 'K', '\r'])
    expect(sleeps).toEqual([35, 120])
  })

  test('does not split codex control sequences containing escape', async () => {
    const writes: string[] = []
    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(_sessionId, data) {
          writes.push(data)
        }
      }
    )

    await router.send('codex-1', '\u001b[A')

    expect(writes).toEqual(['\u001b[A'])
  })

  test('applies minimum spacing across separate codex sends', async () => {
    let now = 0
    const writes: string[] = []
    const sleeps: number[] = []

    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(_sessionId, data) {
          writes.push(data)
        }
      },
      {
        codexPlainInputMinIntervalMs: 35,
        codexSubmitInputMinIntervalMs: 120,
        nowMs: () => now,
        sleep: async (ms) => {
          sleeps.push(ms)
          now += ms
        }
      }
    )

    await router.send('codex-1', 'A')
    await router.send('codex-1', 'B')

    expect(writes).toEqual(['A', 'B'])
    expect(sleeps).toEqual([35])
  })

  test('resetSession cancels queued stale codex frames', async () => {
    let releaseSleep: (() => void) | undefined
    const writes: string[] = []

    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(_sessionId, data) {
          writes.push(data)
        }
      },
      {
        codexPlainInputMinIntervalMs: 35,
        nowMs: () => 0,
        sleep: () =>
          new Promise<void>((resolve) => {
            releaseSleep = resolve
          })
      }
    )

    const pending = router.send('codex-1', 'AB')
    await Promise.resolve()
    await Promise.resolve()
    expect(writes).toEqual(['A'])

    router.resetSession('codex-1')
    if (releaseSleep) {
      releaseSleep()
    }
    await pending

    expect(writes).toEqual(['A'])
  })
})
