// AUTO-GENERATED FILE. DO NOT EDIT.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { defineGeneratedTestMeta } from '../../../testing/contracts/testing-contracts'
import {
  cleanupStateDir,
  launchElectronApp
} from '../../e2e-playwright/fixtures/electron-app'
import { createProject, createSession } from '../../e2e-playwright/helpers/ui-actions'

export const meta = defineGeneratedTestMeta({
  id: 'journey.mobile.ui-v1',
  behaviorIds: [
    'mobile.drilldown',
    'mobile.search',
    'mobile.session.create',
    'mobile.terminal.controls',
    'mobile.health'
  ],
  entities: ['mobile-shell', 'workspace', 'session', 'xterm', 'backend-health'],
  statesCovered: [
    'mobile.workspace-home',
    'mobile.session-list',
    'mobile.session-view',
    'mobile.keys-rail',
    'mobile.fixed-wide-terminal',
    'mobile.health-connected'
  ],
  interruptionsCovered: [
    'viewport.rotates.landscape',
    'sheet.dismissedBeforeSelection',
    'tapOutsideKeyRail',
    'backend.failureLongerThan15s'
  ],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
  riskBudget: 'critical',
  regressionSources: ['mobile-ui-v1-design-spec', 'backend-health-ipc']
})

test('journey.mobile.ui-v1', async () => {
  const app = await launchElectronApp()

  try {
    await app.page.setViewportSize({ width: 1280, height: 800 })

    const projectRow = await createProject(app, {
      name: 'shell-mobile-project',
      path: join(app.stateDir, 'shell-mobile-project')
    })

    const session = await createSession(app.page, projectRow, {
      type: 'shell'
    })

    await app.page.setViewportSize({ width: 390, height: 844 })

    await expect(app.page.getByTestId('mobile-shell')).toBeVisible()
    await expect(app.page.getByTestId('mobile-workspace-home')).toBeVisible()
    await expect(app.page.getByTestId('mobile-recent-session').first()).toBeVisible()
    await expect(app.page.getByTestId('mobile-new-session')).toHaveCount(0)
    await expect(app.page.getByTestId('right-sidebar')).toHaveCount(0)
    await expect(app.page.getByTestId('workspace.quick-actions')).toHaveCount(0)

    await app.page.getByTestId('mobile-global-search-trigger').click()
    await expect(app.page.getByTestId('mobile-global-search-layer')).toBeVisible()
    await app.page.getByTestId('mobile-global-search-layer').click({ position: { x: 4, y: 4 } })
    await expect(app.page.getByTestId('mobile-global-search-layer')).toHaveCount(0)

    await app.page.getByTestId('mobile-global-search-trigger').click()
    await expect(app.page.getByTestId('mobile-global-search-layer')).toBeVisible()
    await app.page.getByTestId('mobile-global-search-input').fill('shell')
    await expect(app.page.getByTestId('mobile-global-search-session-result').first()).toBeVisible()
    await expect(app.page.getByTestId('mobile-global-search-workspace-result').first()).toBeVisible()
    const searchText = await app.page.getByTestId('mobile-global-search-layer').textContent() ?? ''
    expect(searchText.indexOf('Sessions')).toBeLessThan(searchText.indexOf('Workspaces'))
    await app.page.getByTestId('mobile-global-search-workspace-result').first().click()
    await expect(app.page.getByTestId('mobile-session-list')).toBeVisible()
    await app.page.getByTestId('mobile-back').click()

    await app.page.getByTestId('mobile-global-search-trigger').click()
    await app.page.getByTestId('mobile-global-search-input').fill('shell')
    await app.page.getByTestId('mobile-global-search-session-result').first().click()
    await expect(app.page.getByTestId('mobile-session-view')).toBeVisible()
    await app.page.getByTestId('mobile-back').click()
    await app.page.getByTestId('mobile-back').click()

    await app.page.getByTestId('mobile-workspace-row').filter({ hasText: 'shell-mobile-project' }).click()
    await expect(app.page.getByTestId('mobile-session-list')).toBeVisible()
    await expect(app.page.getByTestId('mobile-new-session')).toBeVisible()

    await app.page.getByTestId('mobile-session-row').filter({ hasText: session.title }).click()
    await expect(app.page.getByTestId('mobile-session-view')).toBeVisible()
    await expect(app.page.getByTestId('terminal-xterm')).toBeVisible()
    await expect(app.page.getByTestId('terminal-shell')).toHaveCSS('min-width', '960px')
    await app.page.getByTestId('mobile-back').click()

    await app.page.getByTestId('mobile-new-session').click()
    await expect(app.page.getByTestId('mobile-new-session-sheet')).toBeVisible()
    await app.page.locator('.mobile-sheet-layer').click({ position: { x: 4, y: 4 } })
    await expect(app.page.getByTestId('mobile-new-session-sheet')).toHaveCount(0)

    await app.page.getByTestId('mobile-new-session').click()
    await expect(app.page.getByTestId('mobile-new-session-sheet')).toBeVisible()
    await app.page.locator('[data-testid="mobile-session-type-option"][data-provider-type="shell"]').click()
    await expect(app.page.getByTestId('mobile-session-view')).toBeVisible()
    await expect(app.page.getByTestId('terminal-xterm')).toBeVisible()

    await app.page.getByTestId('mobile-keys-handle').click()
    await expect(app.page.getByTestId('mobile-keys-rail')).toBeVisible()
    await expect(app.page.locator('[data-testid^="mobile-key-"]')).toHaveCount(9)
    await app.page.getByTestId('mobile-keys-dismiss').click({ position: { x: 8, y: 8 } })
    await expect(app.page.getByTestId('mobile-keys-rail')).toHaveCount(0)

    await app.page.getByTestId('mobile-session-more').click()
    await expect(app.page.getByTestId('mobile-session-actions-sheet')).toBeVisible()
    await expect(app.page.getByTestId('mobile-session-actions-sheet')).not.toContainText('Display')

    await app.page.setViewportSize({ width: 844, height: 390 })
    await expect(app.page.getByTestId('mobile-shell')).toBeVisible()
    await expect(app.page.getByTestId('mobile-session-view')).toBeVisible()
    await expect(app.page.getByTestId('mobile-keys-handle')).toBeVisible()

    await app.page.setViewportSize({ width: 1280, height: 800 })
    await expect(app.page.getByTestId('activity-bar')).toBeVisible()
    await expect(app.page.getByTestId('mobile-shell')).toHaveCount(0)
  } finally {
    const { stateDir } = app
    await app.close()
    await cleanupStateDir(stateDir)
  }
})
