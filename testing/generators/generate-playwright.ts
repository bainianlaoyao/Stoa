import type { BehaviorSpec, JourneySpec, TopologySpec } from '../contracts/testing-contracts'

export interface PlaywrightSkeletonInput {
  behavior: BehaviorSpec
  topology: TopologySpec
  journey: JourneySpec
}

export function generatePlaywrightSkeleton(input: PlaywrightSkeletonInput): string {
  const { behavior, topology, journey } = input
  const rootTestId = topology.testIds.root
  const restoreButtonTestId = topology.testIds.restoreButton
  const sessionRowTestId = topology.testIds.sessionRow

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import { cleanupStateDir, launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'
import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'

export const meta = defineGeneratedTestMeta({
  id: '${journey.id}',
  behaviorIds: ['${behavior.id}'],
  entities: ['project', 'session', 'archive'],
  statesCovered: ['session.archived'],
  interruptionsCovered: [],
  observationLayers: ['ui'],
  riskBudget: '${behavior.coverageBudget}',
  regressionSources: []
})

test('${journey.id}', async () => {
  const app = await launchElectronApp()
  const sessionTitle = 'Generated Restore Shell'

  try {
    const projectRow = await createProject(app.page, {
      name: 'generated-restore-project',
      path: join(app.stateDir, 'generated-restore-project')
    })

    await createSession(app.page, projectRow, {
      title: sessionTitle,
      type: 'shell'
    })

    await app.page.getByRole('button', { name: \`Archive \${sessionTitle}\` }).click()
    await app.page.getByRole('button', { name: 'Archive' }).click()

    const root = app.page.getByTestId('${rootTestId}')
    const restoreButton = app.page.getByTestId('${restoreButtonTestId}')
    const sessionRow = app.page.getByTestId('${sessionRowTestId}')

    await expect(root).toBeVisible()
    await expect(sessionRow).toHaveCount(1)
    await expect(restoreButton).toBeVisible()
    await restoreButton.click()
    await expect(sessionRow).toHaveCount(0)
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
`
}
