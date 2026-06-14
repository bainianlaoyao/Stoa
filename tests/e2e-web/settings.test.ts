import { test, expect } from '@playwright/test'
import { cleanupStateDir, launchWebApp } from './fixtures/web-app'

async function openCommandSurfaceNewProject(app: Awaited<ReturnType<typeof launchWebApp>>): Promise<void> {
  await app.page.locator('[data-activity-item="command"]').click()
  await expect(app.page.getByTestId('command-panel')).toBeVisible()
  await app.page.getByTestId('command-panel').getByTestId('workspace.new-project').click()
}

test.describe('Settings tabs', () => {
  test('renders 5 tab buttons', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await expect(app.page.locator('[data-surface="settings"]')).toBeVisible()

      const tabs = app.page.locator('[data-settings-tab]')
      await expect(tabs).toHaveCount(5)
      await expect(app.page.locator('[data-settings-tab="general"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-tab="terminal"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-tab="providers"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-tab="advanced"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-tab="about"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('defaults to General panel', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await expect(app.page.locator('[aria-label="General settings"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('clicking Providers tab shows ProvidersSettings', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await app.page.locator('[data-settings-tab="providers"]').click()
      await expect(app.page.locator('[aria-label="Provider settings"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('clicking Terminal tab shows TerminalSettings', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await app.page.locator('[data-settings-tab="terminal"]').click()
      await expect(app.page.locator('[aria-label="Terminal settings"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('Claude permissions switch renders as a visible control in ProvidersSettings', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await app.page.locator('[data-settings-tab="providers"]').click()
      await expect(app.page.locator('[aria-label="Provider settings"]')).toBeVisible()

      const contentPanel = app.page.locator('.settings-surface__content-panel')
      await contentPanel.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })

      const switchControl = app.page.locator(
        '[data-settings-field="provider-claude-code-dangerously-skip-permissions"] [role="switch"]'
      )
      await expect(switchControl).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('clicking About tab shows AboutSettings', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await app.page.locator('[data-settings-tab="about"]').click()
      await expect(app.page.locator('[aria-label="About"]')).toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('search focuses the matching General section instead of showing unrelated cards', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await app.page.locator('[data-settings-search]').fill('theme')

      await expect(app.page.locator('[data-settings-tab]')).toHaveCount(1)
      await expect(app.page.locator('[data-settings-tab="general"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-field="themeMode"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-field="locale"]')).toHaveCount(0)
      await expect(app.page.locator('[data-settings-field="shellPath"]')).toHaveCount(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('search auto-expands the matching Terminal section and hides unrelated ones', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await app.page.locator('[data-activity-item="settings"]').click()
      await app.page.locator('[data-settings-search]').fill('cursor')

      await expect(app.page.locator('[data-settings-tab]')).toHaveCount(1)
      await expect(app.page.locator('[data-settings-tab="terminal"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-section-toggle="cursor"]')).toHaveAttribute('aria-expanded', 'true')
      await expect(app.page.locator('[data-settings-field="terminalCursorBlink"]')).toBeVisible()
      await expect(app.page.locator('[data-settings-field="terminalScrollback"]')).toHaveCount(0)
      await expect(app.page.locator('[data-settings-field="terminalCopyOnSelection"]')).toHaveCount(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})

test.describe('Modal (BaseModal via NewProjectModal)', () => {
  test('modal opens and renders dialog with title', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await expect(app.page.getByTestId('command-panel')).toBeVisible()

      await openCommandSurfaceNewProject(app)
      await expect(app.page.getByTestId('modal-panel')).toBeVisible()
      await expect(app.page.getByTestId('modal-title')).toContainText('New project')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('modal has role="dialog" and aria-modal', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await openCommandSurfaceNewProject(app)
      await expect(app.page.getByTestId('modal-panel')).toBeVisible()
      const dialog = app.page.getByTestId('modal-root')
      await expect(dialog).toHaveAttribute('role', 'dialog')
      await expect(dialog).toHaveAttribute('aria-modal', 'true')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('close button closes the modal', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await openCommandSurfaceNewProject(app)
      await expect(app.page.getByTestId('modal-panel')).toBeVisible()

      await app.page.getByTestId('modal-close').click()
      await expect(app.page.getByTestId('modal-panel')).not.toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('Escape key closes the modal', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await openCommandSurfaceNewProject(app)
      await expect(app.page.getByTestId('modal-panel')).toBeVisible()

      await app.page.keyboard.press('Escape')
      await expect(app.page.getByTestId('modal-panel')).not.toBeVisible()
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('aria-labelledby links title to dialog', async ({ page }) => {
    const app = await launchWebApp(page)
    try {
      await openCommandSurfaceNewProject(app)
      await expect(app.page.getByTestId('modal-panel')).toBeVisible()

      const dialog = app.page.getByTestId('modal-root')
      const labelledBy = await dialog.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()

      const titleId = await app.page.getByTestId('modal-title').getAttribute('id')
      expect(labelledBy).toBe(titleId)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
