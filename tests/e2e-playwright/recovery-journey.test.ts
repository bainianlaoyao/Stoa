import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  getMainE2EDebugState,
  launchElectronApp,
  type LaunchedElectronApp
} from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

async function waitForSessionStatus(
  app: LaunchedElectronApp,
  title: string,
  status: 'running' | 'starting' | 'exited'
): Promise<void> {
  await expect.poll(async () => {
    const debugState = await getMainE2EDebugState(app.electronApp)
    return debugState?.snapshot?.sessions.find((session) => session.title === title)?.status ?? null
  }).toBe(status)
}

async function waitForSessionByTitle(app: LaunchedElectronApp, title: string) {
  await expect.poll(async () => {
    const debugState = await getMainE2EDebugState(app.electronApp)
    return debugState?.snapshot?.sessions.find((session) => session.title === title) ?? null
  }).not.toBeNull()

  const debugState = await getMainE2EDebugState(app.electronApp)
  const session = debugState?.snapshot?.sessions.find((candidate) => candidate.title === title)
  if (!session) {
    throw new Error(`Unable to find session with title ${title}`)
  }
  return session
}

test.describe('Electron recovery journeys', () => {
  test('shell recovery', async () => {
    let app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'recovery-shell-project',
        path: join(app.stateDir, 'recovery-shell-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'shell'
      })

      await expect(session.row).toHaveAttribute('aria-current', 'true')
      await waitForSessionStatus(app, session.title, 'running')

      const sessionBeforeRestart = await waitForSessionByTitle(app, session.title)
      expect(sessionBeforeRestart.recoveryMode).toBe('fresh-shell')

      app = await app.killAndRelaunch()

      const recoveredProjectRow = app.page.locator('.route-item--parent').filter({ hasText: 'recovery-shell-project' }).first()
      const recoveredSessionRow = app.page.locator('.route-item.child').filter({ hasText: session.title }).first()

      await expect(recoveredProjectRow).toBeVisible()
      await expect(recoveredSessionRow).toBeVisible()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')

      const recoveredSession = await waitForSessionByTitle(app, session.title)
      expect(recoveredSession.id).toBe(sessionBeforeRestart.id)
      expect(recoveredSession.recoveryMode).toBe('fresh-shell')
      await waitForSessionStatus(app, session.title, 'running')

      const terminalSurface = app.page.getByRole('region', { name: 'Terminal surface' })
      await expect(terminalSurface).toBeVisible()
      await expect(app.page.getByRole('region', { name: 'Terminal empty state' })).toHaveCount(0)
      await expect(app.page.locator('.terminal-viewport')).toContainText(session.title)
      await expect(app.page.locator('.terminal-viewport')).toContainText('会话运行中')
      await expect(app.page.locator('.terminal-viewport')).not.toContainText('会话已恢复')

      await app.page.getByRole('button', { name: 'Settings' }).click()
      await expect(app.page.locator('[data-surface="settings"][aria-label="Settings surface"]')).toBeVisible()
      await app.page.getByRole('button', { name: 'Command panel' }).click()
      await expect(terminalSurface).toBeVisible()
      await recoveredSessionRow.click()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
    } finally {
      await app.close()
    }
  })

  test('opencode recovery', async () => {
    let app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'recovery-opencode-project',
        path: join(app.stateDir, 'recovery-opencode-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'opencode'
      })

      await expect(session.row).toHaveAttribute('aria-current', 'true')
      const sessionBeforeRestart = await waitForSessionByTitle(app, session.title)
      expect(sessionBeforeRestart.recoveryMode).toBe('resume-external')

      app = await app.relaunch()

      const recoveredProjectRow = app.page.locator('.route-item--parent').filter({ hasText: 'recovery-opencode-project' }).first()
      const recoveredSessionRow = app.page.locator('.route-item.child').filter({ hasText: session.title }).first()

      await expect(recoveredProjectRow).toBeVisible()
      await expect(recoveredSessionRow).toBeVisible()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')

      const recoveredSession = await waitForSessionByTitle(app, session.title)
      expect(recoveredSession.id).toBe(sessionBeforeRestart.id)
      expect(recoveredSession.recoveryMode).toBe('resume-external')
      expect(recoveredSession.externalSessionId).toBe(sessionBeforeRestart.externalSessionId)

      await expect(recoveredSessionRow).toContainText(session.title)
      await expect(recoveredSessionRow).toContainText('opencode')

      const details = app.page.getByRole('region', { name: 'Session details' })
      const terminalSurface = app.page.getByRole('region', { name: 'Terminal surface' })

      if (await details.count()) {
        await expect(details).toContainText('resume-external')
        await expect(details).toContainText(session.title)
        await expect(details).toContainText('opencode')
      } else {
        await expect(terminalSurface).toBeVisible()
        await expect(app.page.locator('.terminal-viewport')).toContainText('会话运行中')
      }

      await app.page.getByRole('button', { name: 'Settings' }).click()
      await expect(app.page.locator('[data-surface="settings"][aria-label="Settings surface"]')).toBeVisible()
      await app.page.getByRole('button', { name: 'Command panel' }).click()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
    } finally {
      await app.close()
    }
  })
})
