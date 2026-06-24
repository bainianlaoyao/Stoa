import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { cleanupStateDir, launchWebApp } from './fixtures/web-app'
import { createProjectViaApi, createSessionViaApi } from './helpers/web-ui-actions'

async function readTerminalBuffer(page: import('@playwright/test').Page, sessionId: string): Promise<string> {
  return await page.evaluate((targetSessionId) => {
    return (window as Window & {
      __STOA_E2E_TERMINAL_PROBES__?: Map<string, () => string>
    }).__STOA_E2E_TERMINAL_PROBES__?.get(targetSessionId)?.() ?? ''
  }, sessionId)
}

async function focusTerminalInput(page: import('@playwright/test').Page) {
  const terminalViewport = page.getByTestId('terminal-viewport')
  await expect(terminalViewport).toBeVisible({ timeout: 30_000 })
  await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible({ timeout: 30_000 })
  await terminalViewport.click()
  const helperTextarea = terminalViewport.locator('.xterm-helper-textarea').first()
  await expect(helperTextarea).toBeAttached()
  await helperTextarea.focus()
  return helperTextarea
}

test.describe('Terminal Web E2E', () => {
  test('round-trips terminal input through REST, runtime bridge, provider terminal-data, and WS rendering', async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & {
        __STOA_E2E_TERMINAL_PROBES__?: Map<string, () => string>
      }).__STOA_E2E_TERMINAL_PROBES__ = new Map()
    })

    let sessionId = ''
    const app = await launchWebApp(page, {
      async beforeNavigate({ baseUrl, token, stateDir }) {
        const project = await createProjectViaApi({ baseUrl, token }, {
          name: 'web-terminal-project',
          path: join(stateDir, 'web-terminal-project'),
        })
        const session = await createSessionViaApi({ baseUrl, token }, {
          projectId: project.id,
          type: 'shell',
        })
        sessionId = session.id
      },
    })

    try {
      await focusTerminalInput(app.page)
      await app.page.keyboard.type('web-input-ok')
      await app.page.keyboard.press('Enter')

      await expect.poll(async () => app.runtimeCommands.some((command) => command.type === 'runtime:input')).toBe(true)
      await expect.poll(async () => app.runtimeCommands.some((command) => command.type === 'runtime:resize')).toBe(true)
      await expect.poll(async () => await readTerminalBuffer(app.page, sessionId)).toContain('__WEB_RUNTIME_ECHO__web-input-ok')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
