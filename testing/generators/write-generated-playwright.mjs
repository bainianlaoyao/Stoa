import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sessionRestoreBehavior } from '../behavior/session.behavior.ts'
import { generatePlaywrightSkeleton } from './generate-playwright.ts'
import { sessionRestoreJourney } from '../journeys/session-restore.journey.ts'
import { archiveTopology } from '../topology/archive.topology.ts'

const outputPath = resolve('tests/generated/playwright/session-restore.generated.spec.ts')
const generated = generatePlaywrightSkeleton({
  behavior: sessionRestoreBehavior,
  topology: archiveTopology,
  journey: sessionRestoreJourney
})

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, generated, 'utf8')
