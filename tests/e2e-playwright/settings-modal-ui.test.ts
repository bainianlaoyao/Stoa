import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchElectronApp } from './fixtures/electron-app'

test.describe('Settings tabs', () => {
  test('renders 3 tab buttons', async () => {
    const app = await launchElectronApp()
    try {
      await app.page.getByRole('button', { name: 'Settings' }).click()
      await expect(app.page.locator('[data-surface="settings"]')).toBeVisible()

      const tabs = app.page.locator('[data-settings-tab]')
      await expect(tabs).toHaveCount(3)
      await expect(app.page.locator('[data-settings-tab="general"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-tab="providers"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-tab="about"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('defaults to General panel', async () => {
    const app = await launchElectronApp()
    try {
      await app.page.getByRole('button', { name: 'Settings' }).click()
      await expect(app.page.locator('[aria-label="General settings"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('clicking Providers tab shows ProvidersSettings', async () => {
    const app = await launchElectronApp()
    try {
      await app.page.getByRole('button', { name: 'Settings' }).click()
      await app.page.locator('[data-settings-tab="providers"]').click()
      await expect(app.page.locator('[aria-label="Provider settings"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('clicking About tab shows AboutSettings', async () => {
    const app = await launchElectronApp()
    try {
      await app.page.getByRole('button', { name: 'Settings' }).click()
      await app.page.locator('[data-settings-tab="about"]').click()
      await expect(app.page.locator('[aria-label="About"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})

test.describe('Modal (BaseModal via NewProjectModal)', () => {
  test('modal opens and renders dialog with title', async () => {
    const app = await launchElectronApp()
    try {
      await expect(app.page.getByRole('region', { name: 'Command surface' })).toBeVisible()

      const newProjectBtn = app.page.locator('button', { hasText: 'New Project' })
      await expect(newProjectBtn).toBeVisible()
      await newProjectBtn.click()
      await expect(app.page.locator('[data-testid="modal-panel"]')).toBeVisible()
      await expect(app.page.locator('[data-testid="modal-title"]')).toContainText('New project')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('modal has role="dialog" and aria-modal', async () => {
    const app = await launchElectronApp()
    try {
      const newProjectBtn = app.page.locator('button', { hasText: 'New Project' })
      await newProjectBtn.click()
      const dialog = app.page.locator('[data-testid="modal-root"]')
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAttribute('role', 'dialog')
      await expect(dialog).toHaveAttribute('aria-modal', 'true')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('close button closes the modal', async () => {
    const app = await launchElectronApp()
    try {
      const newProjectBtn = app.page.locator('button', { hasText: 'New Project' })
      await newProjectBtn.click()
      await expect(app.page.locator('[data-testid="modal-panel"]')).toBeVisible()

      await app.page.locator('[data-testid="modal-close"]').click()
      await expect(app.page.locator('[data-testid="modal-panel"]')).not.toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('Escape key closes the modal', async () => {
    const app = await launchElectronApp()
    try {
      const newProjectBtn = app.page.locator('button', { hasText: 'New Project' })
      await newProjectBtn.click()
      await expect(app.page.locator('[data-testid="modal-panel"]')).toBeVisible()

      await app.page.keyboard.press('Escape')
      await expect(app.page.locator('[data-testid="modal-panel"]')).not.toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('aria-labelledby links title to dialog', async () => {
    const app = await launchElectronApp()
    try {
      const newProjectBtn = app.page.locator('button', { hasText: 'New Project' })
      await newProjectBtn.click()
      const dialog = app.page.locator('[data-testid="modal-root"]')
      await expect(dialog).toBeVisible()

      const labelledBy = await dialog.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()

      const titleId = await app.page.locator('[data-testid="modal-title"]').getAttribute('id')
      expect(labelledBy).toBe(titleId)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
