import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  cleanupStateDir,
  getMainE2EDebugState,
  launchElectronApp,
  readTerminalBuffer,
  waitForTerminalBufferText,
  waitForTerminalDebugHook
} from './fixtures/electron-app'
import { createProject, createSession, runTerminalCommand } from './helpers/ui-actions'

async function waitForSessionStatus(
  app: Awaited<ReturnType<typeof launchElectronApp>>,
  title: string,
  status: 'running'
): Promise<void> {
  await expect.poll(async () => {
    const debugState = await getMainE2EDebugState(app.electronApp)
    return debugState?.snapshot?.sessions.find((session) => session.title === title)?.status ?? null
  }).toBe(status)
}

test.describe('Electron terminal journeys', () => {
  test('terminal input/output', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'terminal-io-project',
        path: join(app.stateDir, 'terminal-io-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'shell'
      })

      await waitForSessionStatus(app, session.title, 'running')
      await waitForTerminalDebugHook(app.page)
      await expect(app.page.getByRole('region', { name: 'Terminal surface' })).toBeVisible()
      await expect(app.page.getByRole('region', { name: 'Terminal empty state' })).toHaveCount(0)

      await runTerminalCommand(app.page, 'Write-Output "__PLAYWRIGHT_OK__"')
      await waitForTerminalBufferText(app.page, '__PLAYWRIGHT_OK__')

      const buffer = await readTerminalBuffer(app.page)
      expect(buffer).toContain('__PLAYWRIGHT_OK__')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('session isolation', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'terminal-isolation-project',
        path: join(app.stateDir, 'terminal-isolation-project')
      })
      const sessionA = await createSession(app.page, projectRow, {
        type: 'shell'
      })
      const sessionB = await createSession(app.page, projectRow, {
        type: 'shell'
      })

      await waitForSessionStatus(app, sessionA.title, 'running')
      await waitForSessionStatus(app, sessionB.title, 'running')

      await sessionA.row.click()
      await expect(sessionA.row).toHaveAttribute('aria-current', 'true')
      await waitForTerminalDebugHook(app.page)
      await runTerminalCommand(app.page, 'Write-Output "__PLAYWRIGHT_A__"')
      await waitForTerminalBufferText(app.page, '__PLAYWRIGHT_A__')

      const bufferA = await readTerminalBuffer(app.page)
      expect(bufferA).toContain('__PLAYWRIGHT_A__')

      await sessionB.row.click()
      await expect(sessionB.row).toHaveAttribute('aria-current', 'true')
      await waitForTerminalDebugHook(app.page)

      const bufferBInitial = await readTerminalBuffer(app.page)
      expect(bufferBInitial).not.toContain('__PLAYWRIGHT_A__')

      await runTerminalCommand(app.page, 'Write-Output "__PLAYWRIGHT_B__"')
      await waitForTerminalBufferText(app.page, '__PLAYWRIGHT_B__')

      const bufferB = await readTerminalBuffer(app.page)
      expect(bufferB).toContain('__PLAYWRIGHT_B__')
      expect(bufferB).not.toContain('__PLAYWRIGHT_A__')

      await sessionA.row.click()
      await expect(sessionA.row).toHaveAttribute('aria-current', 'true')
      await waitForTerminalDebugHook(app.page)

      const bufferAReturn = await readTerminalBuffer(app.page)
      expect(bufferAReturn).toContain('__PLAYWRIGHT_A__')
      expect(bufferAReturn).not.toContain('__PLAYWRIGHT_B__')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('terminal viewport visual integrity', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'terminal-visual-project',
        path: join(app.stateDir, 'terminal-visual-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'shell'
      })

      await waitForSessionStatus(app, session.title, 'running')
      await waitForTerminalDebugHook(app.page)
      await runTerminalCommand(app.page, 'Write-Output "__PLAYWRIGHT_VISUAL__"')
      await waitForTerminalBufferText(app.page, '__PLAYWRIGHT_VISUAL__')

      const terminalViewport = app.page.locator('.terminal-viewport').first()
      await expect(terminalViewport).toHaveScreenshot('terminal-viewport.png', {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 400
      })
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
