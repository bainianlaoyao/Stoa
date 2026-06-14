/**
 * StoaServerSpawner — manages the Stoa Server (SR) child process lifecycle
 * from within the Electron main process.
 *
 * Phase 5 of the Stoa Server/Client Separation plan.
 *
 * Responsibilities:
 *   - Find an available port in the configured range
 *   - Spawn the SR process as a child
 *   - Wait for health check with timeout + retry
 *   - Generate / read the auth token
 *   - Write the port file for stoa-ctl compatibility
 *   - Connect the StoaRuntimeClient
 *   - Crash recovery (restart SR)
 *   - Graceful shutdown (SIGTERM → SIGKILL)
 *
 * SR is a required child service for the Electron shell.
 */
import { ChildProcess, fork } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { StoaRuntimeClient } from './stoa-runtime-client'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface StoaServerConfig {
  /** Port range to probe for an available port. Default [3270, 3280]. */
  portRange: [number, number]
  /** Path to the ~/.stoa directory. */
  stoaDir: string
  /** Auth token — if empty, one will be generated. */
  authToken: string
}

// ---------------------------------------------------------------------------
// External dependency injection — keeps the spawner testable
// ---------------------------------------------------------------------------

export interface SpawnerDeps {
  /** Resolve the resources path for the bundled stoa-server. */
  getResourcesPath: () => string
  /** Whether the app is packaged (changes how the SR entry point is resolved). */
  isPackaged: boolean
  /** App root path for development mode resolution. */
  getAppRootPath: () => string
  /** Node executable for development mode SR, which must not use Electron's Node ABI. */
  getNodeExecPath: () => string
  /** Called when SR needs a runtime client connected. */
  createRuntimeClient: (port: number, authToken: string) => StoaRuntimeClient | null
}

// ---------------------------------------------------------------------------
// Auth token file helpers
// ---------------------------------------------------------------------------

const TOKEN_FILE_NAME = 'server-token.json'

function tokenFilePath(stoaDir: string): string {
  return join(stoaDir, TOKEN_FILE_NAME)
}

function readOrGenerateAuthToken(stoaDir: string): string {
  const filePath = tokenFilePath(stoaDir)
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(content) as { token?: string }
      if (typeof parsed.token === 'string' && parsed.token.length > 0) {
        return parsed.token
      }
    }
  } catch {
    // fall through to generate
  }

  const token = randomBytes(32).toString('hex')
  mkdirSync(stoaDir, { recursive: true })
  writeFileSync(filePath, JSON.stringify({ token }), { mode: 0o600 })
  return token
}

// ---------------------------------------------------------------------------
// Port availability
// ---------------------------------------------------------------------------

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('close', () => resolve(true))
    server.listen(port, '127.0.0.1', () => {
      server.close()
    })
  })
}

async function findAvailablePortInRange(
  range: [number, number]
): Promise<number> {
  for (let port = range[0]; port <= range[1]; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(
    `No available port in range ${range[0]}-${range[1]}`
  )
}

// ---------------------------------------------------------------------------
// Health check polling
// ---------------------------------------------------------------------------

async function waitForHealth(
  port: number,
  authToken: string,
  timeoutMs: number,
  intervalMs: number
): Promise<void> {
  const url = `http://127.0.0.1:${port}/ctl/health`
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        return
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `SR health check timed out after ${timeoutMs}ms on port ${port}`
  )
}

// ---------------------------------------------------------------------------
// Spawner
// ---------------------------------------------------------------------------

const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_INTERVAL_MS = 500
const CRASH_RESTART_DELAY_MS = 2_000
const SHUTDOWN_SIGTERM_WAIT_MS = 10_000

export class StoaServerSpawner {
  private process: ChildProcess | null = null
  private port = 0
  private authToken: string
  private runtimeClient: StoaRuntimeClient | null = null
  private crashed = false
  private disposed = false

  constructor(
    private readonly config: StoaServerConfig,
    private readonly deps: SpawnerDeps
  ) {
    this.authToken = config.authToken || readOrGenerateAuthToken(config.stoaDir)
  }

  // -----------------------------------------------------------------------
  // Public lifecycle
  // -----------------------------------------------------------------------

  /**
   * Find an available port and spawn the SR process.
   * Returns the port SR is listening on.
   */
  async spawn(): Promise<number> {
    if (this.process) {
      throw new Error('SR process is already spawned')
    }

    this.port = await findAvailablePortInRange(this.config.portRange)

    const entryPoint = this.resolveEntryPoint()
    console.log(`[stoa-server-spawner] Spawning SR from ${entryPoint} on port ${this.port}`)

    this.process = fork(entryPoint, ['--port', String(this.port), '--web'], {
      stdio: 'pipe',
      env: this.createChildEnv(),
      ...this.createForkExecOptions()
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(`[sr:stdout] ${data}`)
    })
    this.process.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[sr:stderr] ${data}`)
    })

    this.process.on('exit', (code, signal) => {
      console.log(`[stoa-server-spawner] SR exited (code=${code}, signal=${signal})`)
      this.process = null
      if (!this.disposed && code !== 0) {
        this.handleCrash()
      }
    })

    return this.port
  }

  /**
   * Poll GET /ctl/health until SR responds, with timeout.
   */
  async waitForHealth(): Promise<void> {
    await waitForHealth(
      this.port,
      this.authToken,
      HEALTH_TIMEOUT_MS,
      HEALTH_INTERVAL_MS
    )
    console.log(`[stoa-server-spawner] SR health check passed on port ${this.port}`)
  }

  /**
   * Read the auth token (either provided or auto-generated).
   */
  getAuthToken(): string {
    return this.authToken
  }

  /**
   * Get the port SR is listening on.
   */
  getPort(): number {
    return this.port
  }

  /**
   * Connect the StoaRuntimeClient to SR.
   */
  async connectRuntime(): Promise<void> {
    const client = this.deps.createRuntimeClient(this.port, this.authToken)
    if (!client) {
      throw new Error('No runtime client provided for Stoa Server runtime bridge')
    }
    this.runtimeClient = client
    await client.connect()
    console.log('[stoa-server-spawner] Runtime client connected')
  }

  /**
   * Graceful shutdown: SIGTERM → wait → SIGKILL.
   */
  async shutdown(): Promise<void> {
    this.disposed = true

    // Disconnect runtime client first
    this.runtimeClient?.disconnect()
    this.runtimeClient = null

    const proc = this.process
    if (!proc) {
      return
    }

    // Send SIGTERM
    try {
      proc.kill('SIGTERM')
    } catch {
      // process may have already exited
    }

    // Wait up to 10s for graceful exit
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        const onExit = (): void => {
          cleanup()
          resolve(true)
        }
        const cleanup = (): void => {
          proc.removeListener('exit', onExit)
        }
        proc.once('exit', onExit)
      }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), SHUTDOWN_SIGTERM_WAIT_MS)
      })
    ])

    if (!exited && proc.pid != null) {
      console.warn('[stoa-server-spawner] SR did not exit gracefully, sending SIGKILL')
      try {
        proc.kill('SIGKILL')
      } catch {
        // already dead
      }
    }

    this.process = null
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private resolveEntryPoint(): string {
    if (this.deps.isPackaged) {
      // In packaged builds, SR is in resources/stoa-server/
      return join(this.deps.getResourcesPath(), 'stoa-server', 'index.cjs')
    }
    // In development, use the stoa-server dist output
    return join(this.deps.getAppRootPath(), 'stoa-server', 'dist', 'index.cjs')
  }

  private createChildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      STOA_AUTH_TOKEN: this.authToken,
      STOA_DIR: this.config.stoaDir
    }
  }

  private createForkExecOptions(): { execPath?: string } {
    if (this.deps.isPackaged) {
      return {}
    }

    return {
      execPath: this.deps.getNodeExecPath()
    }
  }

  private handleCrash(): void {
    if (this.disposed) {
      return
    }
    if (this.crashed) {
      console.error('[stoa-server-spawner] SR crashed again after restart, giving up')
      return
    }

    this.crashed = true
    this.runtimeClient?.disconnect()
    this.runtimeClient = null

    console.log(`[stoa-server-spawner] SR crashed, restarting in ${CRASH_RESTART_DELAY_MS}ms...`)
    setTimeout(() => {
      this.restart().catch((error) => {
        console.error('[stoa-server-spawner] SR restart failed:', error)
      })
    }, CRASH_RESTART_DELAY_MS)
  }

  private async restart(): Promise<void> {
    console.log('[stoa-server-spawner] Restarting SR...')
    this.process = null

    // Find a new port (old one may be occupied by the dead process)
    this.port = await findAvailablePortInRange(this.config.portRange)

    const entryPoint = this.resolveEntryPoint()
    this.process = fork(entryPoint, ['--port', String(this.port), '--web'], {
      stdio: 'pipe',
      env: this.createChildEnv(),
      ...this.createForkExecOptions()
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(`[sr:stdout] ${data}`)
    })
    this.process.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[sr:stderr] ${data}`)
    })

    this.process.on('exit', (code, signal) => {
      console.log(`[stoa-server-spawner] SR exited after restart (code=${code}, signal=${signal})`)
      this.process = null
      if (!this.disposed && code !== 0) {
        this.handleCrash()
      }
    })

    await this.waitForHealth()
    await this.connectRuntime()
    console.log('[stoa-server-spawner] SR restarted successfully')
  }
}
