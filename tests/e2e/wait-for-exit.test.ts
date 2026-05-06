import { afterEach, describe, expect, test, vi } from 'vitest'
import { waitForExit } from './wait-for-exit'

describe('waitForExit', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('clears the timeout when the signal resolves before the deadline', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    let resolveSignal: (() => void) | undefined
    const signal = new Promise<void>((resolve) => {
      resolveSignal = resolve
    })

    const pending = waitForExit(signal, 10_000)
    resolveSignal!()

    await pending

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  test('rejects when the signal does not resolve before the deadline', async () => {
    vi.useFakeTimers()
    const pending = waitForExit(new Promise<void>(() => {}), 100)
    const assertion = expect(pending).rejects.toThrow('Timed out waiting for process exit')

    await vi.advanceTimersByTimeAsync(100)

    await assertion
  })
})
