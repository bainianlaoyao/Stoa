// AUTO-GENERATED FILE. DO NOT EDIT.
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import { cleanupStateDir, launchElectronApp } from '../../e2e-playwright/fixtures/electron-app'

export const meta = defineGeneratedTestMeta({
  id: 'journey.meta-session.surface.session-flow',
  behaviorIds: ['meta-session.surface.session-flow'],
  entities: ['meta-session', 'meta-session-surface', 'meta-session-terminal', 'meta-session-inspector'],
  statesCovered: ['meta-session.session.created', 'meta-session.session.active'],
  interruptionsCovered: [],
  observationLayers: ['ui', 'renderer-store'],
  riskBudget: 'high',
  regressionSources: ['meta-session-surface', 'meta-session-store']
})

test('journey.meta-session.surface.session-flow', async () => {
  const app = await launchElectronApp()

  try {
    await app.page.locator('[data-activity-item="meta-session"]').click()
    await expect(app.page.getByTestId('surface.meta-session')).toBeVisible()
    await expect(app.page.getByTestId('meta-session-session-list')).toBeVisible()
    await expect(app.page.getByTestId('meta-session-terminal-deck')).toBeVisible()
    await expect(app.page.getByTestId('meta-session-inspector-panel')).toBeVisible()
    const initialCount = await app.page.getByTestId('meta-session.session.item').count()
    await app.page.getByTestId('meta-session.session.create').click()
    await expect(app.page.getByTestId('provider-card')).toBeVisible()
    await app.page.locator('[data-testid="provider-card.item"][data-provider-type="claude-code"]').click()
    await expect(app.page.getByTestId('meta-session.session.item')).toHaveCount(initialCount + 1)
    await expect(app.page.locator('[data-testid="meta-session.session.item"][data-session-id]')).toHaveCount(initialCount + 1)
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
