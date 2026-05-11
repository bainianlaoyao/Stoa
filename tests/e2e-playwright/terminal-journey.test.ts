import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  appendTerminalData,
  cleanupStateDir,
  createStateDir,
  getMainE2EDebugState,
  launchElectronApp,
  readTerminalBuffer,
  waitForTerminalBufferText
} from './fixtures/electron-app'
import { createProject, createSession } from './helpers/ui-actions'

async function installFakeCodex(app: Awaited<ReturnType<typeof launchElectronApp>>): Promise<void> {
  const wrapperPath = join(
    app.stateDir,
    process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.sh'
  )
  const driverPath = join(app.stateDir, 'fake-codex-driver.mjs')
  const driverSource = [
    "import { spawn } from 'node:child_process'",
    "import { randomUUID } from 'node:crypto'",
    "import { join } from 'node:path'",
    '',
    'const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))',
    '',
    'async function invokeHook(eventName, payload) {',
    "  const dispatchPath = join(process.cwd(), '.stoa', 'hook-dispatch.mjs')",
    '  await new Promise((resolve, reject) => {',
    '    const child = spawn(process.execPath, [dispatchPath, "codex", eventName], {',
    '      cwd: process.cwd(),',
    '      env: process.env,',
    "      stdio: ['pipe', 'ignore', 'pipe']",
    '    })',
    "    let stderr = ''",
    "    child.stderr.on('data', (chunk) => { stderr += String(chunk) })",
    '    child.on("error", reject)',
    '    child.on("exit", (code) => {',
    '      if (code === 0) {',
    '        resolve(null)',
    '        return',
    '      }',
    '      reject(new Error(`hook ${eventName} failed with code ${code}: ${stderr}`))',
    '    })',
    '    child.stdin.end(JSON.stringify(payload))',
    '  })',
    '}',
    '',
    'const externalSessionId = randomUUID()',
    'const turnId = randomUUID()',
    "await invokeHook('SessionStart', {",
    '  session_id: externalSessionId,',
    '  cwd: process.cwd(),',
    "  model: 'gpt-5-codex'",
    '})',
    'await sleep(5000)',
    "await invokeHook('UserPromptSubmit', {",
    '  session_id: externalSessionId,',
    '  turn_id: turnId,',
    "  prompt: 'Say hello from fake codex',",
    '  cwd: process.cwd(),',
    "  model: 'gpt-5-codex'",
    '})',
    "console.log('__FAKE_CODEX_RUNNING__')",
    'await sleep(5000)',
    "await invokeHook('Stop', {",
    '  session_id: externalSessionId,',
    '  turn_id: turnId,',
    "  last_assistant_message: 'Fake codex complete',",
    '  cwd: process.cwd(),',
    "  model: 'gpt-5-codex'",
    '})',
    "console.log('__FAKE_CODEX_COMPLETE__')",
    'await sleep(15000)'
  ].join('\n')
  const wrapperSource = process.platform === 'win32'
    ? `@echo off\r\nnode "${driverPath}" %*\r\n`
    : `#!/bin/sh\nnode "${driverPath}" "$@"\n`

  await writeFile(driverPath, driverSource, 'utf8')
  await writeFile(wrapperPath, wrapperSource, 'utf8')

  if (process.platform !== 'win32') {
    await chmod(wrapperPath, 0o755)
  }

  await app.page.evaluate(async (providerPath) => {
    const api = (window as typeof window & {
      stoa?: { setSetting?: (key: string, value: unknown) => Promise<void> }
    }).stoa
    await api?.setSetting?.('providers', { codex: providerPath })
  }, wrapperPath)
}

async function waitForSessionState(
  app: Awaited<ReturnType<typeof launchElectronApp>>,
  title: string,
  predicate: (session: { runtimeState?: string; turnState?: string; lastTurnOutcome?: string }) => boolean
): Promise<void> {
  await expect.poll(async () => {
    const debugState = await getMainE2EDebugState(app.electronApp)
    const session = debugState?.snapshot?.sessions.find((candidate) => candidate.title === title) ?? null
    return session && predicate(session) ? session : null
  }).not.toBeNull()
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

      await waitForSessionState(app, session.title, (candidate) => candidate.runtimeState === 'alive')
      const sessionState = await waitForSessionByTitle(app, session.title)
      const terminalViewport = app.page.getByTestId('terminal-viewport')
      await expect(terminalViewport).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-empty-state')).toHaveCount(0)

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

  test('claude live session without agent telemetry shows Ready in the row status', async () => {
    const app = await launchElectronApp()

    try {
      const projectRow = await createProject(app, {
        name: 'terminal-claude-running-project',
        path: join(app.stateDir, 'terminal-claude-running-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'claude-code'
      })

      await waitForSessionState(app, session.title, (candidate) => candidate.runtimeState === 'alive')

      const statusDot = session.row.locator('[data-testid="session-status-dot"]')
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')
      await expect(statusDot).toHaveAttribute('data-phase', 'ready')
      await expect(statusDot).toHaveAttribute('data-tone', 'neutral')
      await expect(session.row.locator('.route-session-label')).toContainText('Ready')
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })

  test('codex live session derives row status from hook events', async () => {
    const stateDir = await createStateDir('stoa-playwright-codex-hooks-')
    const app = await launchElectronApp({
      stateDir,
      env: {
        CODEX_HOME: join(stateDir, 'codex-home')
      }
    })

    try {
      await installFakeCodex(app)

      const projectRow = await createProject(app, {
        name: 'terminal-codex-hooks-project',
        path: join(app.stateDir, 'terminal-codex-hooks-project')
      })
      const session = await createSession(app.page, projectRow, {
        type: 'codex'
      })

      await waitForSessionState(app, session.title, (candidate) => candidate.runtimeState === 'alive')
      const sessionState = await waitForSessionByTitle(app, session.title)

      const statusDot = session.row.locator('[data-testid="session-status-dot"]')
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')
      await expect(statusDot).toHaveAttribute('data-phase', 'ready')

      await waitForTerminalBufferText(app.electronApp, sessionState.id, '__FAKE_CODEX_RUNNING__')
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-running', { timeout: 15000 })
      await expect(statusDot).toHaveAttribute('data-phase', 'running')
      await expect(session.row.locator('.route-session-label')).toContainText('Running')

      await waitForTerminalBufferText(app.electronApp, sessionState.id, '__FAKE_CODEX_COMPLETE__')
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-complete', { timeout: 15000 })

      await session.row.click()
      await expect(statusDot).toHaveAttribute('data-session-status-testid', 'session-status-ready')

      await expect.poll(async () => {
        const debugState = await getMainE2EDebugState(app.electronApp)
        return debugState?.snapshot?.sessions.find((candidate) => candidate.id === sessionState.id) ?? null
      }).toMatchObject({
        runtimeState: 'alive',
        turnState: 'idle',
        lastTurnOutcome: 'completed'
      })
    } finally {
      const { stateDir: launchedStateDir } = app
      await app.close()
      await cleanupStateDir(launchedStateDir)
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

      await waitForSessionState(app, sessionA.title, (candidate) => candidate.runtimeState === 'alive')
      await waitForSessionState(app, sessionB.title, (candidate) => candidate.runtimeState === 'alive')
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

      await waitForSessionState(app, session.title, (candidate) => candidate.runtimeState === 'alive')
      const sessionState = await waitForSessionByTitle(app, session.title)
      await appendTerminalData(app.electronApp, sessionState.id, '\r\n__PLAYWRIGHT_VISUAL__\r\n')
      await waitForTerminalBufferText(app.electronApp, sessionState.id, '__PLAYWRIGHT_VISUAL__')

      const terminalViewport = app.page.getByTestId('terminal-viewport')
      await expect(terminalViewport).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-shell')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-xterm-mount')).toBeVisible()
      // xterm is a third-party component — CSS class is the only available selector for internals
      await expect(terminalViewport.locator('.xterm')).toBeVisible()
      await expect(terminalViewport.getByTestId('terminal-empty-state')).toHaveCount(0)
    } finally {
      const { stateDir } = app
      await app.close()
      await cleanupStateDir(stateDir)
    }
  })
})
