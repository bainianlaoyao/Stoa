/**
 * Runtime bridge client interface and factory.
 *
 * Phase 3 (plan §6): exports the `RuntimeBridgeClient` interface consumed by
 * the supervisor services, a `createStubRuntimeBridge()` for use before the
 * Electron runtime provider is connected, and a `createLiveRuntimeBridge()`
 * factory that wires to the real `RuntimeBridgeHandler`.
 */
import type { RuntimeBridgeHandler } from '../ws/runtime-bridge-handler'
import { LiveRuntimeBridgeClient, createLiveRuntimeBridgeClient } from '../services/runtime-bridge-client'
import { AppError } from '../shared/errors'

// ---------------------------------------------------------------------------
// Interface + option types — unchanged from Phase 2b
// ---------------------------------------------------------------------------

export interface RuntimeBridgeClient {
  launch(sessionId: string, options: LaunchOptions): Promise<void>
  kill(sessionId: string): Promise<void>
  input(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  interrupt(sessionId: string): Promise<void>
  getTerminalReplay(sessionId: string): Promise<string>
  createChildSession(parentId: string, options: ChildSessionOptions): Promise<string>
}

export interface LaunchOptions {
  command?: string
  cwd?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
}

export interface ChildSessionOptions {
  type: string
  command?: string
  cwd?: string
}

// ---------------------------------------------------------------------------
// Stub — 503 until a runtime provider connects
// ---------------------------------------------------------------------------

function throwNotConnected(): never {
  throw new AppError({
    code: 'internal_error',
    message: 'Runtime bridge not connected',
    statusCode: 503,
    nextSteps: ['Ensure the Electron process is running and the runtime bridge is connected']
  })
}

class StubRuntimeBridgeClient implements RuntimeBridgeClient {
  async launch(_sessionId: string, _options: LaunchOptions): Promise<void> {
    throwNotConnected()
  }
  async kill(_sessionId: string): Promise<void> {
    throwNotConnected()
  }
  async input(_sessionId: string, _data: string): Promise<void> {
    throwNotConnected()
  }
  async resize(_sessionId: string, _cols: number, _rows: number): Promise<void> {
    throwNotConnected()
  }
  async interrupt(_sessionId: string): Promise<void> {
    throwNotConnected()
  }
  async getTerminalReplay(_sessionId: string): Promise<string> {
    throwNotConnected()
  }
  async createChildSession(_parentId: string, _options: ChildSessionOptions): Promise<string> {
    throwNotConnected()
  }
}

export function createStubRuntimeBridge(): RuntimeBridgeClient {
  return new StubRuntimeBridgeClient()
}

// ---------------------------------------------------------------------------
// Live factory — Phase 3
// ---------------------------------------------------------------------------

/**
 * Create a live `RuntimeBridgeClient` backed by the given handler.
 * The handler must already be wired to the WS upgrade path so
 * runtime providers can register themselves.
 */
export function createLiveRuntimeBridge(handler: RuntimeBridgeHandler): RuntimeBridgeClient {
  return createLiveRuntimeBridgeClient(handler)
}

// Re-export the live client class for direct import if desired
export { LiveRuntimeBridgeClient }
