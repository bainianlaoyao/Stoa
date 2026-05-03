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
        write(sessionId: string, data: string) {
          writes.push({ sessionId, data })
        },
        writeBinary() {
          throw new Error('binary path not expected in text test')
        }
      } as never
    )

    await router.send('shell-1', 'echo ok\r')

    expect(writes).toEqual([{ sessionId: 'shell-1', data: 'echo ok\r' }])
  })

  test('passes codex plain-text input through as a single frame', async () => {
    const writes: Array<{ sessionId: string; data: string }> = []
    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(sessionId: string, data: string) {
          writes.push({ sessionId, data })
        },
        writeBinary() {
          throw new Error('binary path not expected in text test')
        }
      } as never
    )

    await router.send('codex-1', 'OK\r')

    expect(writes).toEqual([{ sessionId: 'codex-1', data: 'OK\r' }])
  })

  test('passes multiline codex paste through as a single frame', async () => {
    const writes: Array<{ sessionId: string; data: string }> = []
    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(sessionId: string, data: string) {
          writes.push({ sessionId, data })
        },
        writeBinary() {
          throw new Error('binary path not expected in text test')
        }
      } as never
    )

    await router.send('codex-1', 'line1\rline2\rline3')

    expect(writes).toEqual([{ sessionId: 'codex-1', data: 'line1\rline2\rline3' }])
  })

  test('passes bracketed paste sequences through unchanged', async () => {
    const writes: Array<{ sessionId: string; data: string }> = []
    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(sessionId: string, data: string) {
          writes.push({ sessionId, data })
        },
        writeBinary() {
          throw new Error('binary path not expected in text test')
        }
      } as never
    )

    const pasteFrame = '\u001b[200~line1\rline2\u001b[201~'
    await router.send('codex-1', pasteFrame)

    expect(writes).toEqual([{ sessionId: 'codex-1', data: pasteFrame }])
  })

  test('resetSession prevents queued stale writes after a transport stall', async () => {
    let releaseWrite: (() => void) | undefined
    const writes: string[] = []

    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(_sessionId: string, data: string) {
          writes.push(data)
          return new Promise<void>((resolve) => {
            releaseWrite = resolve
          })
        },
        writeBinary() {
          throw new Error('binary path not expected in text test')
        }
      } as never
    )

    const pendingFirst = router.send('codex-1', 'first')
    await Promise.resolve()

    const pendingSecond = router.send('codex-1', 'second')
    router.resetSession('codex-1')
    releaseWrite?.()
    await pendingFirst
    await pendingSecond

    expect(writes).toEqual(['first'])
  })

  test('ctrl+c writes through unchanged and reports interruption for agent sessions', async () => {
    const writes: string[] = []
    const interruptions: Array<{ sessionId: string; sessionType: string }> = []

    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write(_sessionId: string, data: string) {
          writes.push(data)
        },
        writeBinary() {
          throw new Error('binary path not expected in text test')
        }
      } as never,
      {
        onUserInterrupt(sessionId, sessionType) {
          interruptions.push({ sessionId, sessionType })
        }
      }
    )

    await router.send('codex-1', '\u0003')

    expect(writes).toEqual(['\u0003'])
    expect(interruptions).toEqual([{ sessionId: 'codex-1', sessionType: 'codex' }])
  })

  test('sendBinary forwards binary input through the binary transport', async () => {
    const writes: Uint8Array[] = []
    const router = new SessionInputRouter(
      { getSessionType: () => 'codex' },
      {
        write() {
          throw new Error('text path not expected in binary test')
        },
        writeBinary(_sessionId: string, data: Uint8Array) {
          writes.push(data)
        }
      } as never
    )

    const payload = Uint8Array.from([0x1b, 0x5b, 0x4d])
    await router.sendBinary('codex-1', payload)

    expect(writes).toEqual([payload])
  })
})
