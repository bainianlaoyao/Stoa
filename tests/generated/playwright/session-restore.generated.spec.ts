// AUTO-GENERATED FILE. DO NOT EDIT.
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'

export const meta = defineGeneratedTestMeta({
  id: 'journey.session.restore.base',
  behaviorIds: ['session.restore'],
  entities: ['project', 'session', 'archive', 'recovery'],
  statesCovered: ['session.archived', 'session.running'],
  interruptionsCovered: [],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  riskBudget: 'critical',
  regressionSources: []
})

test('journey.session.restore.base', async ({ page }) => {
  const root = page.getByTestId('surface.archive')
  const restoreButton = page.getByTestId('archive.session.restore')
  const sessionRow = page.getByTestId('archive.session.row')

  await expect(root).toBeVisible()
  await expect(restoreButton).toBeVisible()
  await expect(sessionRow).toHaveCount(0)
})
