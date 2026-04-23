import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp } from './fixtures/electron-app'

test.describe('Electron smoke sentinel', () => {
  test('boot shell spec', async () => {
    const app = await launchElectronApp()

    try {
      await expect(app.page.getByRole('region', { name: 'Application viewport' })).toBeVisible()
      await expect(app.page.getByRole('region', { name: 'Command surface' })).toBeVisible()
      await expect(app.page.getByRole('button', { name: 'Command panel' })).toBeVisible()
      await expect(app.page.getByRole('button', { name: 'Archive' })).toBeVisible()
      await expect(app.page.getByRole('button', { name: 'Settings' })).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('empty state spec', async () => {
    const app = await launchElectronApp()

    try {
      await expect(app.page.locator('.terminal-empty-state')).toBeVisible()
      await expect(app.page.locator('.terminal-empty-state')).toContainText('没有可显示的会话')
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

      await app.page.getByRole('button', { name: 'Settings' }).click()
      await expect(app.page.locator('[data-surface="settings"][aria-label="Settings surface"]')).toBeVisible()
      await expectStableActivityIcons()

      await app.page.getByRole('button', { name: 'Archive' }).click()
      await expect(app.page.locator('[data-surface="archive"][aria-label="Archive surface"]')).toBeVisible()
      await expectStableActivityIcons()

      await app.page.getByRole('button', { name: 'Command panel' }).click()
      await expect(app.page.getByRole('region', { name: 'Command surface' })).toBeVisible()
      await expectStableActivityIcons()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
