import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'
import pty, { type IPty } from 'node-pty'
import type { ProviderCommand } from '@shared/project-session'
import { detectShellFamily, buildShellIntegrationEnv, generateNonce } from './shell-integration-env'

export interface ShellIntegrationOptions {
  enabled: boolean
  shellPath: string
}

export interface PtySession {
  runtimeId: string
}

interface ExitWaiter {
  pid: number
  promise: Promise<void>
  resolve: () => void
  settled: boolean
}

const execFileAsync = promisify(execFile)

function getShellScriptsDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(__dirname, 'shell-integration-scripts')
}

function createExitWaiter(pid: number): ExitWaiter {
  let resolve!: () => void
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    pid,
    promise,
    resolve,
    settled: false
  }
}

async function waitForExit(waiter: ExitWaiter, timeoutMs: number): Promise<boolean> {
  if (waiter.settled) {
    return true
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      waiter.promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), timeoutMs)
      })
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function forceKillProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }

  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      return
    }

    process.kill(pid, 'SIGKILL')
  } catch {
    // Best-effort shutdown cleanup.
  }
}

export class PtyHost {
  private readonly sessions = new Map<string, IPty>()
  private readonly exitWaiters = new Map<string, ExitWaiter>()
  private readonly runtimeTokens = new Map<string, number>()

  start(runtimeId: string, command: ProviderCommand, onData: (data: string) => void, onExit: (exitCode: number) => void, shellIntegration?: ShellIntegrationOptions): PtySession {
    const generation = (this.runtimeTokens.get(runtimeId) ?? 0) + 1
    this.runtimeTokens.set(runtimeId, generation)

    let spawnCommand = command.command
    let spawnArgs = command.args
    let spawnEnv: Record<string, string | undefined> = {
      ...command.env,
      TERM: command.env?.TERM ?? 'xterm-256color',
      COLORTERM: command.env?.COLORTERM ?? 'truecolor',
      TERM_PROGRAM: 'Stoa',
      TERM_PROGRAM_VERSION: '0.1.1',
    }

    if (shellIntegration?.enabled && shellIntegration.shellPath) {
      const family = detectShellFamily(shellIntegration.shellPath)
      const nonce = generateNonce()
      const scriptDir = getShellScriptsDir()
      const integration = buildShellIntegrationEnv(family, shellIntegration.shellPath, nonce, scriptDir)
      if (integration) {
        spawnEnv = { ...spawnEnv, ...integration.env }
        spawnCommand = shellIntegration.shellPath
        spawnArgs = integration.args
      }
    }

    const terminal = pty.spawn(spawnCommand, spawnArgs, {
      cwd: command.cwd,
      name: 'xterm-256color',
      cols: command.initialCols ?? 120,
      rows: command.initialRows ?? 30,
      env: spawnEnv,
    })
    this.exitWaiters.set(runtimeId, createExitWaiter(terminal.pid))

    terminal.onData(onData)
    terminal.onExit(({ exitCode }) => {
      if (this.runtimeTokens.get(runtimeId) !== generation) {
        return
      }

      this.sessions.delete(runtimeId)
      this.resolveExitWaiter(runtimeId)
      onExit(exitCode)
    })

    this.sessions.set(runtimeId, terminal)
    return { runtimeId }
  }

  write(workspaceId: string, data: string): void {
    this.sessions.get(workspaceId)?.write(data)
  }

  writeBinary(workspaceId: string, data: Uint8Array | Buffer | string): void {
    const terminal = this.sessions.get(workspaceId)
    if (!terminal) {
      return
    }

    if (typeof data === 'string') {
      terminal.write(Buffer.from(data, 'binary'))
      return
    }

    terminal.write(Buffer.from(data))
  }

  resize(workspaceId: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) {
      return
    }

    this.sessions.get(workspaceId)?.resize(cols, rows)
  }

  kill(runtimeId: string): void {
    const terminal = this.sessions.get(runtimeId)
    if (terminal) {
      terminal.kill()
      this.sessions.delete(runtimeId)
    }
  }

  async killAndWait(runtimeId: string, timeoutMs = 2_000): Promise<void> {
    const terminal = this.sessions.get(runtimeId)
    const waiter = this.exitWaiters.get(runtimeId)

    if (terminal) {
      terminal.kill()
      this.sessions.delete(runtimeId)
    }

    if (!waiter) {
      return
    }

    if (await waitForExit(waiter, timeoutMs)) {
      return
    }

    await forceKillProcessTree(waiter.pid)
    if (await waitForExit(waiter, 1_000)) {
      return
    }

    this.exitWaiters.delete(runtimeId)
  }

  dispose(): void {
    this.sessions.forEach((terminal) => terminal.kill())
    this.sessions.clear()
  }

  async disposeAndWait(timeoutMs = 2_000): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((runtimeId) => this.killAndWait(runtimeId, timeoutMs)))
    this.sessions.clear()
  }

  private resolveExitWaiter(runtimeId: string): void {
    const waiter = this.exitWaiters.get(runtimeId)
    if (!waiter || waiter.settled) {
      return
    }

    waiter.settled = true
    waiter.resolve()
    this.exitWaiters.delete(runtimeId)
  }
}
