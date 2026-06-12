/**
 * Live runtime bridge client — Stoa Server side.
 *
 * Phase 3 of the SR / Client separation. Adapts the high-level
 * `RuntimeBridgeClient` interface consumed by the supervisor services
 * to the per-command wire protocol handled by
 * `RuntimeBridgeHandler`. The supervisor services have no direct
 * dependency on WebSocket frames; they call semantic methods like
 * `launch()` and `input()` and this adapter translates them into
 * the matching `runtime:*` commands.
 *
 * All command timeouts (plan §6.5) and provider-disconnect semantics
 * (plan §6.6) are owned by the underlying handler — the adapter is
 * a thin translation layer that only shapes payloads.
 */
import type { RuntimeBridgeHandler, RuntimeCommandType } from '../ws/runtime-bridge-handler'
import { RuntimeBridgeError } from '../ws/runtime-bridge-handler'
import type {
  RuntimeBridgeClient,
  LaunchOptions,
  ChildSessionOptions
} from '../routes/runtime-bridge'

/**
 * Adapts `RuntimeBridgeHandler` to the semantic `RuntimeBridgeClient`
 * interface used by the supervisor services.
 */
export class LiveRuntimeBridgeClient implements RuntimeBridgeClient {
  constructor(
    private readonly handler: RuntimeBridgeHandler,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async launch(sessionId: string, options: LaunchOptions): Promise<void> {
    await this.dispatch(sessionId, 'runtime:launch', {
      command: options.command ?? null,
      cwd: options.cwd ?? null,
      cols: options.cols ?? null,
      rows: options.rows ?? null,
      env: options.env ?? null
    })
  }

  async kill(sessionId: string): Promise<void> {
    await this.dispatch(sessionId, 'runtime:kill', { killedAt: this.nowIso() })
  }

  async input(sessionId: string, data: string): Promise<void> {
    await this.dispatch(sessionId, 'runtime:input', { data })
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.dispatch(sessionId, 'runtime:resize', { cols, rows })
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.dispatch(sessionId, 'runtime:interrupt', { interruptedAt: this.nowIso() })
  }

  async getTerminalReplay(sessionId: string): Promise<string> {
    const result = await this.dispatch(sessionId, 'runtime:get-terminal-replay', {})
    if (typeof result === 'string') return result
    if (result && typeof result === 'object') {
      const candidate = (result as { text?: unknown }).text
      if (typeof candidate === 'string') return candidate
    }
    return ''
  }

  async createChildSession(parentId: string, options: ChildSessionOptions): Promise<string> {
    const result = await this.dispatch(parentId, 'runtime:create-child-session', {
      type: options.type,
      command: options.command ?? null,
      cwd: options.cwd ?? null
    })

    if (typeof result === 'string') return result
    if (result && typeof result === 'object') {
      const candidate = (result as { childSessionId?: unknown }).childSessionId
      if (typeof candidate === 'string') return candidate
    }
    throw new RuntimeBridgeError(
      'malformed_response',
      'create-child-session did not return a child session id',
      { command: 'runtime:create-child-session', sessionId: parentId }
    )
  }

  private async dispatch(
    sessionId: string,
    command: RuntimeCommandType,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    return await this.handler.sendCommand(sessionId, { type: command, payload })
  }
}

/**
 * Construct a live bridge client from a handler. Convenience for
 * composition sites in `index.ts` / DI wiring.
 */
export function createLiveRuntimeBridgeClient(
  handler: RuntimeBridgeHandler,
  nowIso?: () => string
): RuntimeBridgeClient {
  return new LiveRuntimeBridgeClient(handler, nowIso)
}
