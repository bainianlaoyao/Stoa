import { main } from './run-real-first-round-experiment'

try {
  await main()
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(detail)
  process.exitCode = 1
}
