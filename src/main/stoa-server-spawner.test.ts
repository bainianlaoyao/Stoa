/**
 * Comprehensive integration tests for StoaServerSpawner.
 *
 * Covers:
 *   - Auth token file generation, re-read, and corruption recovery
 *   - Port availability detection
 *   - Port range scanning
 *   - Spawn lifecycle (entry point resolution, fork arguments, stdout/stderr piping)
 *   - Health check polling (success and timeout)
 *   - Runtime client connect/disconnect
 *   - Crash detection and restart logic
 *   - Graceful shutdown (SIGTERM -> SIGKILL)
 *   - Re-spawn guard
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoaRuntimeClient } from './stoa-runtime-client'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

const mockFork = vi.fn()
vi.mock('node:child_process', () => {
  return {
    default: { fork: (...args: unknown[]) => mockFork(...args) },
    fork: (...args: unknown[]) => mockFork(...args)
  }
})

const mockRandomBytes = vi.fn(() => Buffer.from('a'.repeat(64)))
vi.mock('node:crypto', () => {
  return {
    default: { randomBytes: (...args: unknown[]) => mockRandomBytes(...args) },
    randomBytes: (...args: unknown[]) => mockRandomBytes(...args)
  }
})

// randomBytes(32).toString('hex') with Buffer.from('a'.repeat(64)) yields '6161...' (128 chars)
const MOCK_HEX_TOKEN = Buffer.from('a'.repeat(64)).toString('hex')

// Mock net's createServer to control port availability.
// We avoid setImmediate/setTimeout inside the mock so the surrounding
// vi.useFakeTimers() calls in tests can drive the spawner deterministically.
let portAvailability: Map<number, boolean> = new Map()
let mockServer: {
  errorListeners: Array<() => void>
  closeListeners: Array<() => void>
  listenCallback: (() => void) | undefined
} = { errorListeners: [], closeListeners: [], listenCallback: undefined }

function createMockServer(): unknown {
  mockServer = { errorListeners: [], closeListeners: [], listenCallback: undefined }
  const inst: {
    port: number
    closed: boolean
    once: (event: string, cb: () => void) => unknown
    listen: (port: number, host: string, cb?: () => void) => unknown
    close: () => unknown
  } = {
    port: 0,
    closed: false,
    once: (event: string, cb: () => void) => {
      if (event === 'error') {
        mockServer.errorListeners.push(cb)
      }
      if (event === 'close') {
        mockServer.closeListeners.push(cb)
      }
      return inst
    },
    listen: (port: number, _host: string, cb?: () => void) => {
      inst.port = port
      mockServer.listenCallback = cb
      // Synchronously fire the appropriate listener chain.
      // Tests can opt to "use the port" by registering it as true,
      // or "block the port" by registering it as false.
      if (portAvailability.get(port) === false) {
        for (const l of mockServer.errorListeners) l()
      } else {
        inst.closed = true
        for (const l of mockServer.closeListeners) l()
        cb?.()
      }
      return inst
    },
    close: () => {
      inst.closed = true
      return inst
    }
  }
  return inst
}

vi.mock('node:net', () => {
  return {
    default: { createServer: () => createMockServer() },
    createServer: () => createMockServer()
  }
})

// Mock global fetch for health checks
const mockFetch = vi.fn()
const originalFetch = globalThis.fetch
globalThis.fetch = mockFetch as unknown as typeof fetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockChildProcess(): {
  process: EventEmitter & {
    stdout: EventEmitter | null
    stderr: EventEmitter | null
    kill: ReturnType<typeof vi.fn>
    pid: number
  }
  stdout: EventEmitter
  stderr: EventEmitter
} {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter | null
    stderr: EventEmitter | null
    kill: ReturnType<typeof vi.fn>
    pid: number
  }
  emitter.stdout = stdout
  emitter.stderr = stderr
  emitter.pid = 12345
  emitter.kill = vi.fn()
  return { process: emitter, stdout, stderr }
}

function createFakeRuntimeClient(): StoaRuntimeClient & {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
} {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn()
  } as unknown as StoaRuntimeClient & {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }
}

function createDeps(overrides: Partial<{
  getResourcesPath: () => string
  isPackaged: boolean
  getAppRootPath: () => string
  createRuntimeClient: (port: number, authToken: string) => StoaRuntimeClient | null
}> = {}): {
  getResourcesPath: () => string
  isPackaged: boolean
  getAppRootPath: () => string
  createRuntimeClient: (port: number, authToken: string) => StoaRuntimeClient | null
} {
  return {
    getResourcesPath: overrides.getResourcesPath ?? (() => '/resources'),
    isPackaged: overrides.isPackaged ?? false,
    getAppRootPath: overrides.getAppRootPath ?? (() => '/app/root'),
    createRuntimeClient:
      overrides.createRuntimeClient ?? (() => createFakeRuntimeClient())
  }
}

const tempDirs: string[] = []

function createTempStoaDir(): string {
  const tmpRoot = join(process.cwd(), '.tmp', `spawner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpRoot, { recursive: true })
  const stoaDir = join(tmpRoot, '.stoa')
  mkdirSync(stoaDir, { recursive: true })
  tempDirs.push(stoaDir)
  return stoaDir
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  portAvailability = new Map()
  mockServer = { errorListeners: [], closeListeners: [], listenCallback: undefined }
  mockFork.mockReset()
  mockRandomBytes.mockReset()
  mockRandomBytes.mockImplementation(() => Buffer.from('a'.repeat(64)))
  mockFetch.mockReset()
  vi.useRealTimers()
})

const ORIGINAL_DATE_NOW = Date.now.bind(Date)

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0
  // Reset Date.now in case a test patched it
  Date.now = ORIGINAL_DATE_NOW
})

afterAll(() => {
  // Restore the real fetch ONLY at the end of the test file.
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// Auth token file helpers (tested via constructor behaviour + filesystem)
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - auth token handling', () => {
  it('generates a new auth token file when none exists', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [3270, 3270], stoaDir, authToken: '' },
      createDeps()
    )

    const token = spawner.getAuthToken()
    expect(token).toBe(MOCK_HEX_TOKEN)

    const tokenFile = join(stoaDir, 'server-token.json')
    expect(existsSync(tokenFile)).toBe(true)
    const content = JSON.parse(readFileSync(tokenFile, 'utf8'))
    expect(content.token).toBe(token)
  })

  it('reuses an existing valid auth token file on subsequent constructions', async () => {
    const stoaDir = createTempStoaDir()
    const tokenFile = join(stoaDir, 'server-token.json')
    writeFileSync(tokenFile, JSON.stringify({ token: 'preexisting-token-12345' }))

    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [3270, 3270], stoaDir, authToken: '' },
      createDeps()
    )

    expect(spawner.getAuthToken()).toBe('preexisting-token-12345')
  })

  it('regenerates token when existing file has invalid JSON', async () => {
    const stoaDir = createTempStoaDir()
    const tokenFile = join(stoaDir, 'server-token.json')
    writeFileSync(tokenFile, 'this is not json {{{')

    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [3270, 3270], stoaDir, authToken: '' },
      createDeps()
    )

    const token = spawner.getAuthToken()
    expect(token).toBe(MOCK_HEX_TOKEN)
    expect(existsSync(tokenFile)).toBe(true)
  })

  it('regenerates token when existing file has empty/missing token field', async () => {
    const stoaDir = createTempStoaDir()
    const tokenFile = join(stoaDir, 'server-token.json')
    writeFileSync(tokenFile, JSON.stringify({ token: '' }))

    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [3270, 3270], stoaDir, authToken: '' },
      createDeps()
    )

    const token = spawner.getAuthToken()
    expect(token).toBe(MOCK_HEX_TOKEN)
    expect(token).not.toBe('')
  })

  it('prefers constructor-supplied authToken over filesystem', async () => {
    const stoaDir = createTempStoaDir()
    writeFileSync(join(stoaDir, 'server-token.json'), JSON.stringify({ token: 'from-file' }))

    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [3270, 3270], stoaDir, authToken: 'explicit-token' },
      createDeps()
    )

    expect(spawner.getAuthToken()).toBe('explicit-token')
  })
})

// ---------------------------------------------------------------------------
// Port availability scanning
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - port range scanning', () => {
  it('finds the first available port in the configured range', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [4000, 4005], stoaDir, authToken: 'tok' },
      createDeps()
    )

    // 4000 and 4001 are busy; 4002 is free
    portAvailability.set(4000, false)
    portAvailability.set(4001, false)
    portAvailability.set(4002, true)
    portAvailability.set(4003, true)
    portAvailability.set(4004, true)
    portAvailability.set(4005, true)

    // Provide a child process so the spawn() call can complete
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    const port = await spawner.spawn()
    expect(port).toBe(4002)
    expect(spawner.getPort()).toBe(4002)
  })

  it('throws when no port in the range is available', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [4100, 4102], stoaDir, authToken: 'tok' },
      createDeps()
    )

    portAvailability.set(4100, false)
    portAvailability.set(4101, false)
    portAvailability.set(4102, false)

    await expect(spawner.spawn()).rejects.toThrow(/No available port in range 4100-4102/)
  })

  it('throws when re-spawning an already-spawned process', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [4200, 4200], stoaDir, authToken: 'tok' },
      createDeps()
    )

    portAvailability.set(4200, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()
    await expect(spawner.spawn()).rejects.toThrow(/already spawned/)
  })
})

// ---------------------------------------------------------------------------
// Spawn lifecycle
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - spawn()', () => {
  it('uses resources path entry point in packaged mode', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [5000, 5000], stoaDir, authToken: 'tok' },
      createDeps({ isPackaged: true, getResourcesPath: () => '/usr/resources' })
    )

    portAvailability.set(5000, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()
    expect(mockFork).toHaveBeenCalledWith(
      join('/usr/resources', 'stoa-server', 'index.cjs'),
      ['--port', '5000'],
      expect.objectContaining({ stdio: 'pipe' })
    )
  })

  it('uses app root path entry point in development mode', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [5100, 5100], stoaDir, authToken: 'tok' },
      createDeps({ isPackaged: false, getAppRootPath: () => '/app' })
    )

    portAvailability.set(5100, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()
    expect(mockFork).toHaveBeenCalledWith(
      join('/app', 'stoa-server', 'dist', 'index.cjs'),
      ['--port', '5100'],
      expect.objectContaining({ stdio: 'pipe' })
    )
  })

  it('forwards stdout and stderr from child process', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [5200, 5200], stoaDir, authToken: 'tok' },
      createDeps()
    )

    portAvailability.set(5200, true)
    const { process: childProcess, stdout, stderr } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await spawner.spawn()
    stdout.emit('data', Buffer.from('hello-out'))
    stderr.emit('data', Buffer.from('hello-err'))

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('hello-out'))
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('hello-err'))

    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Health check polling
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - waitForHealth()', () => {
  it('resolves when /ctl/health returns 200', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [6000, 6000], stoaDir, authToken: 'healthtok' },
      createDeps()
    )

    portAvailability.set(6000, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()

    mockFetch.mockResolvedValueOnce({
      ok: true
    } as unknown as Response)

    await expect(spawner.waitForHealth()).resolves.toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:6000/ctl/health',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer healthtok' }
      })
    )
  })

  it('retries on failed responses and eventually times out', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [6100, 6100], stoaDir, authToken: 'tok' },
      createDeps()
    )

    portAvailability.set(6100, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()

    // Always fail with !ok — fetch is mocked to never return ok
    mockFetch.mockResolvedValue({ ok: false } as unknown as Response)

    // Patch Date.now so the health-check deadline (30000ms in real time)
    // is reached within ~50ms of real time. We multiply real elapsed time
    // by 1000 to make the wall clock match the spawner's expected deadline.
    const realStart = Date.now()
    const originalNow = Date.now
    Date.now = () => originalNow() + (originalNow() - realStart) * 1000

    try {
      const promise = spawner.waitForHealth()
      await expect(promise).rejects.toThrow(/SR health check timed out/)
    } finally {
      Date.now = originalNow
    }
  })

  it('retries on network errors and eventually times out', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [6200, 6200], stoaDir, authToken: 'tok' },
      createDeps()
    )

    portAvailability.set(6200, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()

    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const realStart = Date.now()
    const originalNow = Date.now
    Date.now = () => originalNow() + (originalNow() - realStart) * 1000

    try {
      const promise = spawner.waitForHealth()
      await expect(promise).rejects.toThrow(/SR health check timed out/)
    } finally {
      Date.now = originalNow
    }
  })
})

// ---------------------------------------------------------------------------
// Runtime client wiring
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - connectRuntime()', () => {
  it('calls createRuntimeClient and connects it', async () => {
    const stoaDir = createTempStoaDir()
    const runtimeClient = createFakeRuntimeClient()
    const createRuntimeClient = vi.fn().mockReturnValue(runtimeClient)
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [7000, 7000], stoaDir, authToken: 'rtok' },
      createDeps({ createRuntimeClient })
    )

    portAvailability.set(7000, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)
    await spawner.spawn()

    await spawner.connectRuntime()

    expect(createRuntimeClient).toHaveBeenCalledWith(7000, 'rtok')
    expect(runtimeClient.connect).toHaveBeenCalledOnce()
  })

  it('skips connection when createRuntimeClient returns null', async () => {
    const stoaDir = createTempStoaDir()
    const createRuntimeClient = vi.fn().mockReturnValue(null)
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [7100, 7100], stoaDir, authToken: 'rtok' },
      createDeps({ createRuntimeClient })
    )

    portAvailability.set(7100, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)
    await spawner.spawn()

    await expect(spawner.connectRuntime()).resolves.toBeUndefined()
    expect(createRuntimeClient).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - shutdown()', () => {
  it('sends SIGTERM, awaits graceful exit, and does not SIGKILL when process exits', async () => {
    const stoaDir = createTempStoaDir()
    const runtimeClient = createFakeRuntimeClient()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [8000, 8000], stoaDir, authToken: 'tok' },
      createDeps({ createRuntimeClient: () => runtimeClient })
    )

    portAvailability.set(8000, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)
    await spawner.spawn()
    await spawner.connectRuntime()

    // Simulate graceful exit shortly after SIGTERM
    setImmediate(() => {
      childProcess.emit('exit', 0, 'SIGTERM')
    })

    await spawner.shutdown()

    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM')
    // SIGKILL should NOT be called because exit happened gracefully
    expect(childProcess.kill).not.toHaveBeenCalledWith('SIGKILL')
    expect(runtimeClient.disconnect).toHaveBeenCalledOnce()
  })

  it('falls back to SIGKILL when SIGTERM does not produce an exit within the wait window', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [8100, 8100], stoaDir, authToken: 'tok' },
      createDeps({ createRuntimeClient: () => null })
    )

    portAvailability.set(8100, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)
    await spawner.spawn()

    // Speed up both the wall clock and the timers so the 10s SIGTERM
    // wait elapses in a few ms of real time.
    const realStart = Date.now()
    const originalNow = Date.now
    Date.now = () => originalNow() + (originalNow() - realStart) * 1000

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const shutdownPromise = spawner.shutdown()
      // Drive microtasks/timers to completion
      for (let i = 0; i < 200; i++) {
        await vi.advanceTimersByTimeAsync(100)
      }
      await shutdownPromise
    } finally {
      vi.useRealTimers()
      Date.now = originalNow
    }

    expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM')
    expect(childProcess.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('handles the no-process case by returning immediately', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [8200, 8200], stoaDir, authToken: 'tok' },
      createDeps()
    )

    // Never called spawn() — process is null
    await expect(spawner.shutdown()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Crash detection and restart
// ---------------------------------------------------------------------------

describe('StoaServerSpawner - crash handling', () => {
  it('schedules a restart with a new port when the child crashes', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [9000, 9005], stoaDir, authToken: 'tok' },
      createDeps({ createRuntimeClient: () => null })
    )

    // Initial spawn picks port 9000
    portAvailability.set(9000, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()

    // After spawn(), the simulated child still "occupies" port 9000 until
    // it exits. Once it crashes, the port is no longer bound.
    // Mark 9000 as taken (EADDRINUSE) and 9001 as free, so the restart
    // will pick 9001.
    portAvailability.set(9000, false)
    portAvailability.set(9001, true)

    // Health check on restart must succeed so restart() resolves
    mockFetch.mockResolvedValue({ ok: true } as unknown as Response)

    // Speed up wall clock + timers so the 2s crash restart delay elapses fast
    const realStart = Date.now()
    const originalNow = Date.now
    Date.now = () => originalNow() + (originalNow() - realStart) * 1000

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // Simulate a crash (non-zero exit) -> triggers handleCrash
      childProcess.emit('exit', 1, null)

      // Drive the 2s crash delay + subsequent restart work
      for (let i = 0; i < 200; i++) {
        await vi.advanceTimersByTimeAsync(100)
      }
    } finally {
      vi.useRealTimers()
      Date.now = originalNow
    }

    // Should have called fork a second time (the restart)
    expect(mockFork.mock.calls.length).toBeGreaterThanOrEqual(2)
    const secondCall = mockFork.mock.calls[1]
    expect(secondCall[0]).toBe(join('/app/root', 'stoa-server', 'dist', 'index.cjs'))
    expect(secondCall[1]).toEqual(['--port', '9001'])
  })

  it('does not schedule a restart on a clean (code=0) exit', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [9100, 9100], stoaDir, authToken: 'tok' },
      createDeps()
    )

    portAvailability.set(9100, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()

    childProcess.emit('exit', 0, null)
    // No second fork should be queued
    expect(mockFork).toHaveBeenCalledTimes(1)
  })

  it('does not restart after shutdown() was called', async () => {
    const stoaDir = createTempStoaDir()
    const { StoaServerSpawner } = await import('./stoa-server-spawner')
    const spawner = new StoaServerSpawner(
      { portRange: [9200, 9200], stoaDir, authToken: 'tok' },
      createDeps({ createRuntimeClient: () => null })
    )

    portAvailability.set(9200, true)
    const { process: childProcess } = createMockChildProcess()
    mockFork.mockReturnValueOnce(childProcess)

    await spawner.spawn()

    // shutdown() sets disposed=true and clears the process
    // Simulate graceful exit during shutdown so it resolves fast
    setImmediate(() => {
      childProcess.emit('exit', 0, 'SIGTERM')
    })
    await spawner.shutdown()

    // Now simulate a crash — should be ignored because disposed=true
    childProcess.emit('exit', 1, null)
    // Give a chance for any stray async work
    await new Promise((r) => setTimeout(r, 50))

    // No second fork should happen
    expect(mockFork).toHaveBeenCalledTimes(1)
  })
})
