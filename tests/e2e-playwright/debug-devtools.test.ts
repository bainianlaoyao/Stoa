import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp, getDebugModeActive } from './fixtures/electron-app'

test.describe('Debug DevTools toggle via key sequence', () => {
  test('typing 114514 toggles debug mode on', async () => {
    const app = await launchElectronApp()

    try {
      expect(await getDebugModeActive(app.electronApp)).toBe(false)

      await app.page.keyboard.type('114514')

      expect(await getDebugModeActive(app.electronApp)).toBe(true)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('typing 114514 twice toggles debug mode off', async () => {
    const app = await launchElectronApp()

    try {
      await app.page.keyboard.type('114514')
      expect(await getDebugModeActive(app.electronApp)).toBe(true)

      await app.page.keyboard.type('114514')
      expect(await getDebugModeActive(app.electronApp)).toBe(false)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('partial sequence does not trigger debug mode', async () => {
    const app = await launchElectronApp()

    try {
      await app.page.keyboard.type('1145')
      expect(await getDebugModeActive(app.electronApp)).toBe(false)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('non-digit keys reset the accumulator', async () => {
    const app = await launchElectronApp()

    try {
      await app.page.keyboard.type('114a514')
      expect(await getDebugModeActive(app.electronApp)).toBe(false)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
