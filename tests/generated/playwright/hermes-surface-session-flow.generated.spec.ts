// AUTO-GENERATED FILE. DO NOT EDIT.
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import { cleanupStateDir, launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'

export const meta = defineGeneratedTestMeta({
  id: 'journey.hermes.surface.session-flow',
  behaviorIds: ['hermes.surface.session-flow'],
  entities: ['hermes-session', 'hermes-surface', 'hermes-terminal', 'hermes-inspector'],
  statesCovered: ['hermes.session.created', 'hermes.session.active'],
  interruptionsCovered: [],
  observationLayers: ['ui', 'renderer-store'],
  riskBudget: 'high',
  regressionSources: ['hermes-surface', 'hermes-store']
})

test('journey.hermes.surface.session-flow', async () => {
  const app = await launchElectronApp()

  try {
    await app.page.locator('[data-activity-item="hermes"]').click()
    await expect(app.page.getByTestId('surface.hermes')).toBeVisible()
    await expect(app.page.getByTestId('hermes-session-list')).toBeVisible()
    await expect(app.page.getByTestId('hermes-terminal-deck')).toBeVisible()
    await expect(app.page.getByTestId('hermes-inspector-panel')).toBeVisible()
    const initialCount = await app.page.getByTestId('hermes.session.item').count()
    await app.page.getByTestId('hermes.session.create').click()
    await expect(app.page.getByTestId('provider-card')).toBeVisible()
    await app.page.locator('[data-testid="provider-card.item"][data-provider-type="claude-code"]').click()
    await expect(app.page.getByTestId('hermes.session.item')).toHaveCount(initialCount + 1)
    await expect(app.page.locator('[data-testid="hermes.session.item"][data-session-id]')).toHaveCount(initialCount + 1)
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
