import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BootstrapState, CanonicalSessionEvent } from '@shared/project-session'

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

export async function createStateDir(prefix = 'stoa-playwright-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

export function resolveElectronMainEntrypoint(cwd = process.cwd()): string {
  return join(cwd, 'out', 'main', 'index.js')
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
  const electronApp = await electron.launch({
    args: [entryPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      VIBECODING_E2E: '1',
      VIBECODING_STATE_DIR: stateDir,
      ...options.env,
    },
  })

  const page = await electronApp.firstWindow()
  await expect(page.getByRole('region', { name: 'Application viewport' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('region', { name: 'Command surface' })).toBeVisible()

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

export async function readTerminalBuffer(page: Page): Promise<string> {
  return await page.evaluate(() => {
    return window.__VIBECODING_TERMINAL_DEBUG__?.getActiveBufferText?.() ?? ''
  })
}

export async function waitForTerminalDebugHook(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return Boolean(window.__VIBECODING_TERMINAL_DEBUG__?.getActiveBufferText)
  })
}

export async function waitForTerminalBufferText(page: Page, text: string): Promise<void> {
  await page.waitForFunction((expectedText) => {
    const bufferText = window.__VIBECODING_TERMINAL_DEBUG__?.getActiveBufferText?.() ?? ''
    return bufferText.includes(expectedText)
  }, text)
}

export async function getMainE2EDebugState(electronApp: ElectronApplication): Promise<MainE2EDebugState | null> {
  return await electronApp.evaluate(async () => {
    return globalThis.__VIBECODING_MAIN_E2E__?.getDebugState() ?? null
  })
}

export async function queueNextFolderPick(
  electronApp: ElectronApplication,
  path: string | null
): Promise<void> {
  await electronApp.evaluate(async (_electron, nextPath) => {
    globalThis.__VIBECODING_MAIN_E2E__?.queueDialogPickFolder(nextPath)
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
