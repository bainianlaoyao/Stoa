import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { cleanupStateDir, launchElectronApp } from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

test.describe('Electron project/session journeys', () => {
  test('shell journey', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app.page, {
        name: 'demo-shell-project',
        path: join(app.stateDir, 'demo-shell-project')
      })

      await expect(projectRow.locator('.route-name')).toContainText('demo-shell-project')
      await expect(projectRow.locator('.route-path')).toContainText(app.stateDir)

      const sessionRow = await createSession(app.page, projectRow, {
        title: 'Shell 1',
        type: 'shell'
      })

      await expect(sessionRow).toContainText('Shell 1')
      await expect(sessionRow).toContainText('shell')
      await expect(sessionRow).toHaveAttribute('aria-current', 'true')
      await expect(app.page.getByRole('region', { name: 'Terminal empty state' })).toHaveCount(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('opencode journey', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app.page, {
        name: 'demo-opencode-project',
        path: join(app.stateDir, 'demo-opencode-project')
      })

      const sessionRow = await createSession(app.page, projectRow, {
        title: 'OpenCode 1',
        type: 'opencode'
      })

      await expect(sessionRow).toContainText('OpenCode 1')
      await expect(sessionRow).toContainText('opencode')
      await expect(sessionRow).toHaveAttribute('aria-current', 'true')
      await expect(app.page.getByRole('region', { name: 'Session details' })).toContainText('OpenCode 1')
      await expect(app.page.getByRole('region', { name: 'Session details' })).toContainText('opencode')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
