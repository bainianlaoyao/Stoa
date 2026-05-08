import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { sessionRestoreBehavior } from '../behavior/session.behavior'
import {
  generateClaudeLifecyclePlaywrightSkeleton,
  generateHermesSurfaceSessionFlowPlaywrightSkeleton,
  generatePlaywrightSkeleton,
  generateWorkspaceQuickAccessPlaywrightSkeleton
} from './generate-playwright'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { archiveTopology } from '../topology/archive.topology'

const outputPath = resolve('tests/generated/playwright/session-restore.generated.spec.ts')
const generated = generatePlaywrightSkeleton({
  behavior: sessionRestoreBehavior,
  topology: archiveTopology,
  journey: sessionRestoreJourney
})

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, generated, 'utf8')

const claudeLifecycleOutputPath = resolve('tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts')
await mkdir(dirname(claudeLifecycleOutputPath), { recursive: true })
await writeFile(claudeLifecycleOutputPath, generateClaudeLifecyclePlaywrightSkeleton(), 'utf8')

const workspaceQuickAccessOutputPath = resolve('tests/generated/playwright/workspace-quick-access.generated.spec.ts')
await mkdir(dirname(workspaceQuickAccessOutputPath), { recursive: true })
await writeFile(workspaceQuickAccessOutputPath, generateWorkspaceQuickAccessPlaywrightSkeleton(), 'utf8')

const hermesSurfaceOutputPath = resolve('tests/generated/playwright/hermes-surface-session-flow.generated.spec.ts')
await mkdir(dirname(hermesSurfaceOutputPath), { recursive: true })
await writeFile(hermesSurfaceOutputPath, generateHermesSurfaceSessionFlowPlaywrightSkeleton(), 'utf8')
