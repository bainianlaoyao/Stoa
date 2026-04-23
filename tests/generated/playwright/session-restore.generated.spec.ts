// AUTO-GENERATED FILE. DO NOT EDIT.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import { cleanupStateDir, launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'
import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'

export const meta = defineGeneratedTestMeta({
  id: 'journey.session.restore.base',
  behaviorIds: ['session.restore'],
  entities: ['project', 'session', 'archive'],
  statesCovered: ['session.archived'],
  interruptionsCovered: [],
  observationLayers: ['ui'],
  riskBudget: 'critical',
  regressionSources: []
})

test('journey.session.restore.base', async () => {
  const app = await launchElectronApp()

  try {
    const projectRow = await createProject(app, {
      name: 'generated-restore-project',
      path: join(app.stateDir, 'generated-restore-project')
    })

    const session = await createSession(app.page, projectRow, {
      type: 'shell'
    })

    await app.page.getByRole('button', { name: `Archive ${session.title}` }).click()
    await app.page.getByRole('button', { name: 'Archive' }).click()

    const root = app.page.getByTestId('surface.archive')
    const restoreButton = app.page.getByTestId('archive.session.restore')
    const sessionRow = app.page.getByTestId('archive.session.row')

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
