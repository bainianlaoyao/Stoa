import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { cleanupStateDir, getMainE2EDebugState, launchElectronApp } from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

test.describe('Electron project/session journeys', () => {
  test('shell journey', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'demo-shell-project',
        path: join(app.stateDir, 'demo-shell-project')
      })

      await expect(projectRow).toContainText('demo-shell-project')

      const session = await createSession(app.page, projectRow, {
        type: 'shell'
      })

      await session.row.click()
      await expect(session.row).toContainText(session.title)
      await expect(session.row).toContainText('shell')
      await expect(session.row).toHaveAttribute('aria-current', 'true')
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
      const projectRow = await createProject(app, {
        name: 'demo-opencode-project',
        path: join(app.stateDir, 'demo-opencode-project')
      })

      const session = await createSession(app.page, projectRow, {
        type: 'opencode'
      })

      await session.row.click()
      await expect(session.row).toContainText(session.title)
      await expect(session.row).toContainText('opencode')

      const debugState = await getMainE2EDebugState(app.electronApp)
      const sessionState = debugState?.snapshot?.sessions.find((candidate) => candidate.title === session.title)

      expect(sessionState?.type).toBe('opencode')
      expect(debugState?.snapshot?.activeSessionId).toBe(sessionState?.id)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
