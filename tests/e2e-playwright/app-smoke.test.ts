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
})
