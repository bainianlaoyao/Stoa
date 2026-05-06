export function waitForExit(signal: Promise<void>, timeoutMs = 10_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error('Timed out waiting for process exit'))
    }, timeoutMs)

    const settleWithCleanup = (callback: () => void) => {
      clearTimeout(timeoutHandle)
      callback()
    }

    signal.then(
      () => settleWithCleanup(resolve),
      (error) => settleWithCleanup(() => reject(error))
    )
  })
}
