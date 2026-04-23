import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  appendTerminalData,
  cleanupStateDir,
  getMainE2EDebugState,
  launchElectronApp,
  readTerminalBuffer,
  waitForTerminalBufferText
} from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

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

async function waitForSessionByTitle(
  app: Awaited<ReturnType<typeof launchElectronApp>>,
  title: string
) {
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

test.describe('Electron terminal journeys', () => {
  test('terminal live output propagates into replay and viewport', async () => {
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
      const sessionState = await waitForSessionByTitle(app, session.title)
      const terminalViewport = app.page.locator('.terminal-viewport').first()
      await expect(terminalViewport).toBeVisible()
      await expect(terminalViewport.locator('.terminal-viewport__xterm')).toBeVisible()
      await expect(terminalViewport.locator('.terminal-empty-state')).toHaveCount(0)

      await appendTerminalData(app.electronApp, sessionState.id, '\r\n__PLAYWRIGHT_OK__\r\n')
      await waitForTerminalBufferText(app.electronApp, sessionState.id, '__PLAYWRIGHT_OK__')

      const buffer = await readTerminalBuffer(app.electronApp, sessionState.id)
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
      const sessionAState = await waitForSessionByTitle(app, sessionA.title)
      const sessionBState = await waitForSessionByTitle(app, sessionB.title)

      await sessionA.row.click()
      await expect(sessionA.row).toHaveAttribute('aria-current', 'true')
      await appendTerminalData(app.electronApp, sessionAState.id, '\r\n__PLAYWRIGHT_A__\r\n')
      await waitForTerminalBufferText(app.electronApp, sessionAState.id, '__PLAYWRIGHT_A__')

      const bufferA = await readTerminalBuffer(app.electronApp, sessionAState.id)
      expect(bufferA).toContain('__PLAYWRIGHT_A__')

      await sessionB.row.click()
      await expect(sessionB.row).toHaveAttribute('aria-current', 'true')

      const bufferBInitial = await readTerminalBuffer(app.electronApp, sessionBState.id)
      expect(bufferBInitial).not.toContain('__PLAYWRIGHT_A__')

      await appendTerminalData(app.electronApp, sessionBState.id, '\r\n__PLAYWRIGHT_B__\r\n')
      await waitForTerminalBufferText(app.electronApp, sessionBState.id, '__PLAYWRIGHT_B__')

      const bufferB = await readTerminalBuffer(app.electronApp, sessionBState.id)
      expect(bufferB).toContain('__PLAYWRIGHT_B__')
      expect(bufferB).not.toContain('__PLAYWRIGHT_A__')

      await sessionA.row.click()
      await expect(sessionA.row).toHaveAttribute('aria-current', 'true')

      const bufferAReturn = await readTerminalBuffer(app.electronApp, sessionAState.id)
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
      const sessionState = await waitForSessionByTitle(app, session.title)
      await appendTerminalData(app.electronApp, sessionState.id, '\r\n__PLAYWRIGHT_VISUAL__\r\n')
      await waitForTerminalBufferText(app.electronApp, sessionState.id, '__PLAYWRIGHT_VISUAL__')

      const terminalViewport = app.page.locator('.terminal-viewport').first()
      await expect(terminalViewport).toBeVisible()
      await expect(terminalViewport.locator('.terminal-viewport__xterm')).toBeVisible()
      await expect(terminalViewport.locator('.terminal-viewport__shell')).toBeVisible()
      await expect(terminalViewport.locator('.terminal-viewport__xterm-mount')).toBeVisible()
      await expect(terminalViewport.locator('.xterm')).toBeVisible()
      await expect(terminalViewport.locator('.terminal-empty-state')).toHaveCount(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
