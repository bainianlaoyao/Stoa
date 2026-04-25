import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  getMainE2EDebugState,
  launchElectronApp,
  type LaunchedElectronApp
} from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

async function waitForSessionState(
  app: LaunchedElectronApp,
  title: string,
  predicate: (session: { runtimeState?: string; agentState?: string }) => boolean
): Promise<void> {
  await expect.poll(async () => {
    const debugState = await getMainE2EDebugState(app.electronApp)
    const session = debugState?.snapshot?.sessions.find((candidate) => candidate.title === title) ?? null
    return session && predicate(session) ? session : null
  }).not.toBeNull()
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
      await waitForSessionState(app, session.title, (candidate) => candidate.runtimeState === 'alive')

      const sessionBeforeRestart = await waitForSessionByTitle(app, session.title)
      expect(sessionBeforeRestart.recoveryMode).toBe('fresh-shell')

      app = await app.killAndRelaunch()

      const recoveredProjectRow = app.page.locator('[data-project-name="recovery-shell-project"]').first()
      const recoveredSessionRow = app.page.locator(`[data-session-title="${session.title}"]`).first()

      await expect(recoveredProjectRow).toBeVisible()
      await expect(recoveredSessionRow).toBeVisible()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')

      const recoveredSession = await waitForSessionByTitle(app, session.title)
      expect(recoveredSession.id).toBe(sessionBeforeRestart.id)
      expect(recoveredSession.recoveryMode).toBe('fresh-shell')
      await waitForSessionState(app, session.title, (candidate) => candidate.runtimeState === 'alive')

      const terminalViewport = app.page.getByTestId('terminal-viewport')
      await expect(terminalViewport).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-empty-state')).toHaveCount(0)
      await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-xterm-mount')).toBeVisible()

      await app.page.locator('[data-activity-item="settings"]').click()
      await expect(app.page.locator('[data-surface="settings"]')).toBeVisible()
      await app.page.locator('[data-activity-item="command"]').click()
      await expect(terminalViewport).toBeVisible()
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

      const recoveredProjectRow = app.page.locator('[data-project-name="recovery-opencode-project"]').first()
      const recoveredSessionRow = app.page.locator(`[data-session-title="${session.title}"]`).first()

      await expect(recoveredProjectRow).toBeVisible()
      await expect(recoveredSessionRow).toBeVisible()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')

      const recoveredSession = await waitForSessionByTitle(app, session.title)
      expect(recoveredSession.id).toBe(sessionBeforeRestart.id)
      expect(recoveredSession.recoveryMode).toBe('resume-external')
      expect(recoveredSession.externalSessionId).toBe(sessionBeforeRestart.externalSessionId)

      await expect(recoveredSessionRow).toHaveAttribute('data-session-title', session.title)
      await expect(recoveredSessionRow).toHaveAttribute('data-session-type', 'opencode')

      const terminalViewport = app.page.getByTestId('terminal-viewport')
      await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-xterm-mount')).toBeVisible()

      await app.page.locator('[data-activity-item="settings"]').click()
      await expect(app.page.locator('[data-surface="settings"]')).toBeVisible()
      await app.page.locator('[data-activity-item="command"]').click()
      await expect(recoveredSessionRow).toHaveAttribute('aria-current', 'true')
    } finally {
      await app.close()
    }
  })
})
