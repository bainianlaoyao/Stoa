import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BootstrapState, CanonicalSessionEvent } from '@shared/project-session'
import { createTestTempDir } from '../../../testing/test-temp'

export interface LaunchOptions {
  stateDir?: string
  env?: Record<string, string>
}

export interface LaunchedElectronApp {
  electronApp: ElectronApplication
  page: Page
  stateDir: string
  close: () => Promise<void>
  kill: () => Promise<void>
  killAndRelaunch: () => Promise<LaunchedElectronApp>
  relaunch: () => Promise<LaunchedElectronApp>
}

export interface MainE2EDebugState {
  webhookPort: number | null
  sessionSecrets: Record<string, string>
  snapshot: BootstrapState | null
}

interface MainE2EDebugApi {
  getDebugState: () => MainE2EDebugState
  queueDialogPickFolder: (path: string | null) => void
  getTerminalReplay: (sessionId: string) => Promise<string>
  appendTerminalData: (sessionId: string, data: string) => Promise<void>
}

export async function createStateDir(prefix = 'stoa-playwright-'): Promise<string> {
  return await createTestTempDir(prefix)
}

export function resolveElectronMainEntrypoint(cwd = process.cwd()): string {
  return join(cwd, 'out', 'main', 'index.cjs')
}

export function ensureElectronMainEntrypoint(cwd = process.cwd()): string {
  const entryPath = resolveElectronMainEntrypoint(cwd)
  if (!existsSync(entryPath)) {
    throw new Error(
      `Electron main entry not found at ${entryPath}. Run \"npm run build\" before Playwright, or use \"npm run test:e2e\" so the build step runs first.`
    )
  }

  return entryPath
}

async function waitForProcessExit(processHandle: ChildProcess | null | undefined): Promise<void> {
  if (!processHandle) {
    return
  }

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    if (processHandle.exitCode !== null || processHandle.killed) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 125))
  }

  await new Promise((resolve) => setTimeout(resolve, 500))
}

async function closeElectronAppWithTimeout(
  electronApp: ElectronApplication,
  processHandle: ChildProcess | null | undefined,
  timeoutMs = 5_000
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  try {
    await Promise.race([
      electronApp.close(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timed out closing Electron app after ${timeoutMs}ms`))
        }, timeoutMs)
      })
    ])
  } catch {
    processHandle?.kill('SIGKILL')
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
    await waitForProcessExit(processHandle)
  }
}

export async function launchElectronApp(options: LaunchOptions = {}): Promise<LaunchedElectronApp> {
  const stateDir = options.stateDir ?? await createStateDir()
  const entryPath = ensureElectronMainEntrypoint()
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    VIBECODING_E2E: '1',
    VIBECODING_STATE_DIR: stateDir,
    ...options.env,
  }
  delete env.ELECTRON_RENDERER_URL

  const electronApp = await electron.launch({
    args: [entryPath],
    env,
  })

  const page = await electronApp.firstWindow()
  await expect(page.getByTestId('app-viewport')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('command-panel')).toBeVisible()

  return {
    electronApp,
    page,
    stateDir,
    async close() {
      const processHandle = electronApp.process()
      await closeElectronAppWithTimeout(electronApp, processHandle)
    },
    async kill() {
      const processHandle = electronApp.process()
      processHandle?.kill('SIGKILL')
      await waitForProcessExit(processHandle)
    },
    async killAndRelaunch() {
      const processHandle = electronApp.process()
      processHandle?.kill('SIGKILL')
      await waitForProcessExit(processHandle)
      return await launchElectronApp({ stateDir, env: options.env })
    },
    async relaunch() {
      const processHandle = electronApp.process()
      await closeElectronAppWithTimeout(electronApp, processHandle)
      return await launchElectronApp({ stateDir, env: options.env })
    },
  }
}

export async function cleanupStateDir(stateDir: string): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await rm(stateDir, { recursive: true, force: true })
      return
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EBUSY' || attempt === 20) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
}

export async function readTerminalBuffer(
  electronApp: ElectronApplication,
  sessionId: string
): Promise<string> {
  return await electronApp.evaluate(async (_electron, targetSessionId) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: MainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    return await api?.getTerminalReplay(targetSessionId) ?? ''
  }, sessionId)
}

export async function appendTerminalData(
  electronApp: ElectronApplication,
  sessionId: string,
  data: string
): Promise<void> {
  await electronApp.evaluate(async (_electron, payload) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: MainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    await api?.appendTerminalData(payload.sessionId, payload.data)
  }, { sessionId, data })
}

export async function waitForTerminalBufferText(
  electronApp: ElectronApplication,
  sessionId: string,
  text: string
): Promise<void> {
  await expect.poll(async () => {
    return await readTerminalBuffer(electronApp, sessionId)
  }).toContain(text)
}

export async function getMainE2EDebugState(electronApp: ElectronApplication): Promise<MainE2EDebugState | null> {
  return await electronApp.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: MainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    return api?.getDebugState() ?? null
  })
}

export async function getDebugModeActive(electronApp: ElectronApplication): Promise<boolean> {
  return await electronApp.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: MainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    return api?.getDebugModeActive() ?? false
  })
}

export async function queueNextFolderPick(
  electronApp: ElectronApplication,
  path: string | null
): Promise<void> {
  await electronApp.evaluate(async (_electron, nextPath) => {
    const api = (globalThis as typeof globalThis & {
      __VIBECODING_MAIN_E2E__?: MainE2EDebugApi
    }).__VIBECODING_MAIN_E2E__
    api?.queueDialogPickFolder(nextPath)
  }, path)
}

export async function postWebhookEvent(options: {
  port: number
  secret: string
  event: CanonicalSessionEvent
}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${options.port}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': options.secret
    },
    body: JSON.stringify(options.event)
  })

  const body = await response.json().catch(() => null)
  return {
    status: response.status,
    body
  }
}

export async function postClaudeHookEvent(options: {
  port: number
  secret: string
  sessionId: string
  projectId: string
  body: Record<string, unknown>
}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${options.port}/hooks/claude-code`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-stoa-secret': options.secret,
      'x-stoa-session-id': options.sessionId,
      'x-stoa-project-id': options.projectId
    },
    body: JSON.stringify(options.body)
  })

  const body = await response.json().catch(() => null)
  return {
    status: response.status,
    body
  }
}
