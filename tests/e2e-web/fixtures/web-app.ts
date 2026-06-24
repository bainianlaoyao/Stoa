import { expect, type Page } from '@playwright/test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { createTestTempDir } from '../../../testing/test-temp'

const WEB_SERVER_READY_TIMEOUT_MS = 15_000
const RUNTIME_PROVIDER_READY_TIMEOUT_MS = 5_000

interface RuntimeCommand {
  type: string
  sessionId: string
  payload?: Record<string, unknown>
  replyTo: string
}

interface TestRuntimeProvider {
  commands: RuntimeCommand[]
  close: () => Promise<void>
}

export interface LaunchWebOptions {
  stateDir?: string
  port?: number
  token?: string
  env?: Record<string, string>
  beforeNavigate?: (context: {
    baseUrl: string
    port: number
    token: string
    stateDir: string
  }) => Promise<void>
}

export interface LaunchedWebApp {
  page: Page
  baseUrl: string
  port: number
  token: string
  stateDir: string
  runtimeCommands: RuntimeCommand[]
  close: () => Promise<void>
}

export async function createStateDir(prefix = 'stoa-web-playwright-'): Promise<string> {
  return await createTestTempDir(prefix)
}

export function resolveStoaServerEntrypoint(cwd = process.cwd()): string {
  return join(cwd, 'stoa-server', 'dist', 'index.cjs')
}

export function ensureStoaServerEntrypoint(cwd = process.cwd()): string {
  const entryPath = resolveStoaServerEntrypoint(cwd)
  if (!existsSync(entryPath)) {
    throw new Error(
      `Stoa server entry not found at ${entryPath}. Run "npm run build" before Playwright, or use "npm run test:e2e:web" so the build step runs first.`
    )
  }

  return entryPath
}

export function ensureWebClientBuild(cwd = process.cwd()): string {
  const indexPath = join(cwd, 'stoa-server', 'dist', 'web', 'index.html')
  if (!existsSync(indexPath)) {
    throw new Error(
      `Stoa web client build not found at ${indexPath}. Run "npm run build:web" or "npm run build" before browser Playwright tests.`
    )
  }

  return indexPath
}

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to resolve a free loopback port.')))
        return
      }

      const { port } = address
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve(port)
      })
    })
  })
}

function formatServerOutput(stdoutBuffer: string[], stderrBuffer: string[]): string {
  const stdout = stdoutBuffer.join('').trim()
  const stderr = stderrBuffer.join('').trim()
  const output = [stdout ? `stdout:\n${stdout}` : '', stderr ? `stderr:\n${stderr}` : '']
    .filter(Boolean)
    .join('\n\n')

  return output ? `\n\nServer output:\n${output}` : ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function connectTestRuntimeProvider(baseUrl: string, token: string): Promise<TestRuntimeProvider> {
  const url = new URL('/ws', baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', token)
  url.searchParams.set('role', 'runtime')

  const ws = new WebSocket(url.toString())
  let closed = false
  const commands: RuntimeCommand[] = []
  const inputBuffers = new Map<string, string>()

  ws.addEventListener('message', (event: MessageEvent) => {
    const raw = typeof event.data === 'string' ? event.data : ''
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }

    if (!isRuntimeCommand(parsed)) {
      return
    }
    commands.push(parsed)

    ws.send(JSON.stringify({
      type: 'runtime:response',
      replyTo: parsed.replyTo,
      ok: true,
      data: runtimeResponseData(parsed),
    }))
    if (parsed.type === 'runtime:input') {
      const data = typeof parsed.payload?.data === 'string'
        ? parsed.payload.data
        : typeof parsed.payload?.base64Data === 'string'
          ? Buffer.from(parsed.payload.base64Data, 'base64').toString('utf8')
          : ''
      const buffered = `${inputBuffers.get(parsed.sessionId) ?? ''}${data}`
      if (/[\r\n]/.test(buffered)) {
        inputBuffers.set(parsed.sessionId, '')
        ws.send(JSON.stringify({
          type: 'runtime:terminal-data',
          sessionId: parsed.sessionId,
          data: `\r\n__WEB_RUNTIME_ECHO__${buffered.replace(/[\r\n]+/g, '')}\r\n`,
        }))
      } else {
        inputBuffers.set(parsed.sessionId, buffered)
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out connecting test runtime provider to ${url.toString()}`))
      try {
        ws.close()
      } catch {
        // Ignore close failures after timeout.
      }
    }, RUNTIME_PROVIDER_READY_TIMEOUT_MS)

    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })

    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`Failed to connect test runtime provider to ${url.toString()}`))
    }, { once: true })
  })

  return {
    commands,
    close: async () => {
      if (closed) {
        return
      }
      closed = true
      if (ws.readyState === WebSocket.CLOSED) {
        return
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500)
        ws.addEventListener('close', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
        ws.close(1000, 'test runtime provider shutdown')
      })
    },
  }
}

function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Partial<RuntimeCommand>
  return typeof record.type === 'string' &&
    record.type.startsWith('runtime:') &&
    typeof record.sessionId === 'string' &&
    typeof record.replyTo === 'string'
}

function runtimeResponseData(command: RuntimeCommand): unknown {
  if (command.type === 'runtime:get-terminal-replay') {
    return { text: '' }
  }
  if (command.type === 'runtime:create-child-session') {
    return { childSessionId: `${command.sessionId}-child` }
  }
  return { status: 'ok' }
}

async function waitForProcessExit(
  processHandle: ChildProcessWithoutNullStreams | null | undefined
): Promise<void> {
  if (!processHandle) {
    return
  }

  for (let attempt = 1; attempt <= 80; attempt += 1) {
    if (processHandle.exitCode !== null || processHandle.killed) {
      await sleep(125)
      return
    }

    await sleep(125)
  }

  await sleep(250)
}

async function waitForServerReady(
  processHandle: ChildProcessWithoutNullStreams,
  baseUrl: string,
  token: string,
  stdoutBuffer: string[],
  stderrBuffer: string[]
): Promise<void> {
  const deadline = Date.now() + WEB_SERVER_READY_TIMEOUT_MS
  let lastError: unknown = null

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Stoa server exited before becoming ready (exit code ${processHandle.exitCode ?? 'unknown'}).${formatServerOutput(stdoutBuffer, stderrBuffer)}`
      )
    }

    try {
      const discovery = await fetch(`${baseUrl}/api/v1/discovery`)
      if (discovery.ok) {
        const htmlResponse = await fetch(`${baseUrl}/`)
        const contentType = htmlResponse.headers.get('content-type') ?? ''
        const html = await htmlResponse.text()

        if (htmlResponse.ok && contentType.includes('text/html') && html.includes('<title>Stoa</title>')) {
          return
        }

        lastError = new Error(`Expected Stoa HTML from ${baseUrl}/ but received content-type "${contentType}".`)
      }
    } catch (error) {
      lastError = error
    }

    await sleep(200)
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
  throw new Error(
    `Stoa server did not become ready within ${WEB_SERVER_READY_TIMEOUT_MS}ms: ${reason}.${formatServerOutput(stdoutBuffer, stderrBuffer)}`
  )
}

async function closeServerProcess(processHandle: ChildProcessWithoutNullStreams): Promise<void> {
  if (processHandle.exitCode === null) {
    processHandle.kill('SIGTERM')
    await waitForProcessExit(processHandle)
  }

  if (processHandle.exitCode === null) {
    processHandle.kill('SIGKILL')
    await waitForProcessExit(processHandle)
  }
}

export async function launchWebApp(page: Page, options: LaunchWebOptions = {}): Promise<LaunchedWebApp> {
  const stateDir = options.stateDir ?? await createStateDir()
  const entryPath = ensureStoaServerEntrypoint()
  ensureWebClientBuild()

  const port = options.port ?? await reservePort()
  const token = options.token ?? 'stoa-dev-token'
  const baseUrl = `http://127.0.0.1:${port}`
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  let runtimeProvider: TestRuntimeProvider | null = null

  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOME: stateDir,
    USERPROFILE: stateDir,
    STOA_DIR: join(stateDir, '.stoa-server'),
    STOA_AUTH_TOKEN: token,
    ...options.env,
  }

  const env = Object.fromEntries(
    Object.entries(mergedEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )

  const serverProcess = spawn(process.execPath, [entryPath, '--port', String(port), '--web'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout.setEncoding('utf8')
  serverProcess.stderr.setEncoding('utf8')
  serverProcess.stdout.on('data', (chunk: string) => {
    stdoutBuffer.push(chunk)
  })
  serverProcess.stderr.on('data', (chunk: string) => {
    stderrBuffer.push(chunk)
  })

  try {
    await waitForServerReady(serverProcess, baseUrl, token, stdoutBuffer, stderrBuffer)
    runtimeProvider = await connectTestRuntimeProvider(baseUrl, token)
    await options.beforeNavigate?.({
      baseUrl,
      port,
      token,
      stateDir,
    })
    await page.goto(`${baseUrl}/#token=${encodeURIComponent(token)}`)
    await expect(page.getByTestId('app-viewport')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('command-panel')).toBeVisible()
  } catch (error) {
    await runtimeProvider?.close()
    await closeServerProcess(serverProcess)
    await cleanupStateDir(stateDir)
    throw error
  }

  return {
    page,
    baseUrl,
    port,
    token,
    stateDir,
    runtimeCommands: runtimeProvider.commands,
    async close() {
      await runtimeProvider?.close()
      await closeServerProcess(serverProcess)
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

      await sleep(250 * attempt)
    }
  }
}
