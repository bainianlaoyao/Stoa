import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp } from './fixtures/electron-app'

test.describe('Electron smoke sentinel', () => {
  test('boot shell spec', async () => {
    const app = await launchElectronApp()

    try {
      await expect(app.page.getByTestId('app-viewport')).toBeVisible()
      await expect(app.page.getByTestId('command-panel')).toBeVisible()
      await expect(app.page.locator('[data-activity-item="command"]')).toBeVisible()
      await expect(app.page.locator('[data-activity-item="archive"]')).toBeVisible()
      await expect(app.page.locator('[data-activity-item="settings"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('empty state spec', async () => {
    const app = await launchElectronApp()

    try {
      await expect(app.page.getByTestId('terminal-empty-state')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('activity icons remain visible while switching surfaces', async () => {
    const app = await launchElectronApp()

    try {
      const expectStableActivityIcons = async () => {
        const icons = app.page.locator('[data-activity-icon]')

        await expect(icons).toHaveCount(3)
        await expect(app.page.locator('[data-activity-item="command"] [data-activity-icon]')).toBeVisible()
        await expect(app.page.locator('[data-activity-item="archive"] [data-activity-icon]')).toBeVisible()
        await expect(app.page.locator('[data-activity-item="settings"] [data-activity-icon]')).toBeVisible()
      }

      await expectStableActivityIcons()

      await app.page.locator('[data-activity-item="settings"]').click()
      await expect(app.page.locator('[data-surface="settings"]')).toBeVisible()
      await expectStableActivityIcons()

      await app.page.locator('[data-activity-item="archive"]').click()
      await expect(app.page.locator('[data-surface="archive"]')).toBeVisible()
      await expectStableActivityIcons()

      await app.page.locator('[data-activity-item="command"]').click()
      await expect(app.page.getByTestId('command-panel')).toBeVisible()
      await expectStableActivityIcons()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
