/**
 * Runtime Bridge Handler — Stoa Server side.
 *
 * Phase 3 of the SR / Client separation (plan section 6). The Electron
 * process connects to SR over WebSocket as a "runtime provider" that
 * owns PTY processes. SR sends `RuntimeCommand` messages; the provider
 * responds with `RuntimeResponse` payloads. This module owns the
 * connection registry, the pending-command bookkeeping, the per-command
 * timeouts (plan §6.5), and the crash-recovery protocol (plan §6.6).
 *
 * The handler is deliberately WS-agnostic. It only depends on the minimal
 * `WsLike` interface from `ws/hub.ts` so unit tests can drive it with
 * in-memory fakes.
 */
import { randomUUID } from 'node:crypto'
import type { WsLike } from './hub'

// ---------------------------------------------------------------------------
// Wire protocol — mirrors plan section 6.3.
// ---------------------------------------------------------------------------

/** All runtime commands SR can issue to a runtime provider. */
export type RuntimeCommandType =
  | 'runtime:launch'
  | 'runtime:kill'
  | 'runtime:input'
  | 'runtime:resize'
  | 'runtime:interrupt'
  | 'runtime:get-terminal-replay'
  | 'runtime:create-child-session'

/** Wire shape of a runtime command sent SR → provider. */
export interface RuntimeCommand {
  type: RuntimeCommandType
  sessionId: string
  payload: Record<string, unknown>
  replyTo: string
}

/** Wire shape of a runtime response received provider → SR. */
export interface RuntimeResponse {
  type: 'runtime:response'
  replyTo: string
  ok: boolean
  data?: unknown
  error?: string
}

/** Wire shape of an inbound provider message: a response or terminal data. */
export type ProviderInboundMessage =
  | { kind: 'response'; response: RuntimeResponse }
  | { kind: 'terminal-data'; sessionId: string; data: string }
  | { kind: 'pty-state'; sessionId: string; state: ProviderPtyState }

/** Minimal PTY state sync — used during crash recovery (plan §6.6). */
export interface ProviderPtyState {
  alive: boolean
  exitCode?: number | null
  exitReason?: 'clean' | 'failed' | null
  cols?: number
  rows?: number
  startedAt?: string
}

// ---------------------------------------------------------------------------
// Timeout configuration — plan section 6.5
// ---------------------------------------------------------------------------

const RUNTIME_COMMAND_TIMEOUTS_MS: Record<RuntimeCommandType, number> = {
  'runtime:launch': 30_000,
  'runtime:kill': 10_000,
  'runtime:input': 5_000,
  'runtime:resize': 5_000,
  'runtime:interrupt': 5_000,
  'runtime:get-terminal-replay': 15_000,
  'runtime:create-child-session': 30_000
}

/** When true, a timeout on a resize command resolves silently (no error). */
const RUNTIME_SILENT_TIMEOUT: Partial<Record<RuntimeCommandType, true>> = {
  'runtime:resize': true
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `sendCommand` when the runtime bridge is unavailable or
 * the command did not complete inside its configured timeout window.
 */
export class RuntimeBridgeError extends Error {
  readonly code:
    | 'no_provider'
    | 'timeout'
    | 'provider_disconnected'
    | 'provider_rejected'
    | 'malformed_response'
  readonly command: RuntimeCommandType
  readonly sessionId: string

  constructor(
    code: RuntimeBridgeError['code'],
    message: string,
    context: { command: RuntimeCommandType; sessionId: string }
  ) {
    super(message)
    this.name = 'RuntimeBridgeError'
    this.code = code
    this.command = context.command
    this.sessionId = context.sessionId
  }
}

// ---------------------------------------------------------------------------
// Provider record
// ---------------------------------------------------------------------------

/** A connected Electron runtime provider. */
export interface RuntimeProvider {
  id: string
  ws: WsLike
  connected: true
  /** Session IDs this provider currently holds PTYs for. */
  managedSessions: Set<string>
}

// ---------------------------------------------------------------------------
// Pending command bookkeeping
// ---------------------------------------------------------------------------

interface PendingCommand {
  command: RuntimeCommand
  resolve: (value: unknown) => void
  reject: (error: RuntimeBridgeError) => void
  timer: NodeJS.Timeout
  providerId: string
  silent: boolean
}

// ---------------------------------------------------------------------------
// Hooks — listeners the host (e.g. session-event-processor) can attach
// so terminal data, state-sync, and rejection events translate into
// downstream side effects (broadcast, observability).
// ---------------------------------------------------------------------------

export interface RuntimeBridgeHooks {
  /** Receive terminal data pushed from a runtime provider. */
  onTerminalData?(payload: { sessionId: string; data: string; providerId: string }): void
  /** Provider reported PTY state for a session (used during recovery). */
  onPtyState?(payload: { sessionId: string; providerId: string; state: ProviderPtyState }): void
  /** A provider went away — sessions it managed are now orphaned. */
  onProviderDisconnected?(payload: {
    providerId: string
    orphanedSessionIds: string[]
  }): void
  /** A provider finished its initial state sync handshake. */
  onProviderReady?(payload: { providerId: string; ptyStates: Array<{ sessionId: string; state: ProviderPtyState }> }): void
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class RuntimeBridgeHandler {
  private providers: Map<string, RuntimeProvider> = new Map()
  private pendingCommands: Map<string, PendingCommand> = new Map()
  private hooks: RuntimeBridgeHooks = {}
  /** Per-session last-known PTY state, used for crash recovery. */
  private lastKnownPtyState: Map<string, { providerId: string; state: ProviderPtyState }> = new Map()

  setHooks(hooks: RuntimeBridgeHooks): void {
    this.hooks = hooks
  }

  /**
   * Register a new runtime provider (Electron connects via WS).
   * The caller is responsible for calling `removeProvider` when the
   * underlying socket closes.
   */
  registerProvider(ws: WsLike, _auth: { token: string }): RuntimeProvider {
    const provider: RuntimeProvider = {
      id: `provider_${randomUUID()}`,
      ws,
      connected: true,
      managedSessions: new Set()
    }
    this.providers.set(provider.id, provider)
    return provider
  }

  /**
   * Remove provider on disconnect. Rejects all pending commands
   * issued through this provider and reports the orphaned session IDs
   * to whoever is listening on the disconnect hook.
   */
  removeProvider(providerId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    this.providers.delete(providerId)
    provider.connected = true // literal type: remains `true`; cleanup is via delete

    const orphanedSessionIds = Array.from(provider.managedSessions)
    provider.managedSessions.clear()
    for (const sessionId of orphanedSessionIds) {
      const last = this.lastKnownPtyState.get(sessionId)
      if (last && last.providerId === providerId) {
        this.lastKnownPtyState.delete(sessionId)
      }
    }

    // Reject every pending command routed to this provider
    for (const [replyTo, pending] of this.pendingCommands.entries()) {
      if (pending.providerId !== providerId) continue
      clearTimeout(pending.timer)
      this.pendingCommands.delete(replyTo)
      if (pending.silent) {
        pending.resolve(null)
      } else {
        pending.reject(
          new RuntimeBridgeError('provider_disconnected', 'Runtime provider disconnected', {
            command: pending.command.type,
            sessionId: pending.command.sessionId
          })
        )
      }
    }

    try {
      this.hooks.onProviderDisconnected?.({ providerId, orphanedSessionIds })
    } catch (error) {
      console.warn('[runtime-bridge] onProviderDisconnected hook threw', error)
    }
  }

  /**
   * Send a runtime command to the provider managing a session.
   *
   * The command is dispatched with `replyTo` so the matching response
   * resolves this promise. Throws `RuntimeBridgeError('no_provider')`
   * if no provider currently holds the session, or `'timeout'` if
   * the provider does not respond inside the per-command budget
   * (resize timeouts resolve to `null` instead of rejecting).
   */
  async sendCommand(
    sessionId: string,
    command: Omit<RuntimeCommand, 'sessionId' | 'replyTo'> & { type: RuntimeCommandType }
  ): Promise<unknown> {
    const provider = this.getProviderForCommand(sessionId, command.type)
    if (!provider) {
      throw new RuntimeBridgeError(
        'no_provider',
        `No runtime provider is currently managing session ${sessionId}`,
        { command: command.type, sessionId }
      )
    }

    const replyTo = `cmd_${randomUUID()}`
    const wireCommand: RuntimeCommand = {
      type: command.type,
      sessionId,
      payload: command.payload,
      replyTo
    }

    const silent = RUNTIME_SILENT_TIMEOUT[command.type] === true
    const timeoutMs = RUNTIME_COMMAND_TIMEOUTS_MS[command.type]

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingCommands.get(replyTo)
        if (!pending) return
        this.pendingCommands.delete(replyTo)
        if (pending.silent) {
          pending.resolve(null)
          return
        }
        pending.reject(
          new RuntimeBridgeError(
            'timeout',
            `Runtime command ${command.type} timed out after ${timeoutMs}ms`,
            { command: command.type, sessionId }
          )
        )
      }, timeoutMs)

      const pending: PendingCommand = {
        command: wireCommand,
        resolve,
        reject,
        timer,
        providerId: provider.id,
        silent
      }
      this.pendingCommands.set(replyTo, pending)

      try {
        provider.ws.send(JSON.stringify(wireCommand))
      } catch (error) {
        clearTimeout(timer)
        this.pendingCommands.delete(replyTo)
        reject(
          new RuntimeBridgeError(
            'provider_disconnected',
            `Failed to send ${command.type} to provider: ${error instanceof Error ? error.message : String(error)}`,
            { command: command.type, sessionId }
          )
        )
      }
    })
  }

  /**
   * Handle an incoming message from a provider. The raw frame is parsed
   * and routed to either the pending-command resolver (responses) or
   * the terminal-data / pty-state hooks.
   */
  handleMessage(providerId: string, message: unknown): void {
    const provider = this.providers.get(providerId)
    if (!provider) {
      console.warn(`[runtime-bridge] Received message from unknown provider ${providerId}`)
      return
    }

    if (typeof message !== 'string') {
      // Binary frames are not part of the runtime bridge protocol.
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      console.warn('[runtime-bridge] Provider sent malformed JSON; dropping frame')
      return
    }

    if (!parsed || typeof parsed !== 'object') return
    const frame = parsed as Record<string, unknown>

    if (frame.type === 'runtime:response' && typeof frame.replyTo === 'string') {
      this.handleResponse(provider, frame)
      return
    }

    if (frame.type === 'runtime:terminal-data' && typeof frame.sessionId === 'string' && typeof frame.data === 'string') {
      this.handleTerminalData(provider, frame.sessionId, frame.data)
      return
    }

    if (frame.type === 'runtime:pty-state' && typeof frame.sessionId === 'string') {
      this.handlePtyState(provider, frame.sessionId, frame.state)
      return
    }

    if (frame.type === 'runtime:state-sync' && Array.isArray(frame.sessions)) {
      this.handleStateSync(provider, frame.sessions as unknown[])
      return
    }
  }

  /**
   * Get the provider currently managing a specific session, or `null`
   * when no provider has registered the session yet.
   */
  getProviderForSession(sessionId: string): RuntimeProvider | null {
    for (const provider of this.providers.values()) {
      if (provider.managedSessions.has(sessionId)) {
        return provider
      }
    }
    return null
  }

  private getProviderForCommand(sessionId: string, command: RuntimeCommandType): RuntimeProvider | null {
    const assigned = this.getProviderForSession(sessionId)
    if (assigned) return assigned
    if (command !== 'runtime:launch') return null
    return this.providers.values().next().value ?? null
  }

  /**
   * Mark a session as managed by a specific provider. Called by the
   * `runtime:launch` and `runtime:create-child-session` response paths
   * and by the provider's `runtime:state-sync` frame so crash-recovery
   * lookups find the right provider.
   */
  assignSession(providerId: string, sessionId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) return
    provider.managedSessions.add(sessionId)
  }

  /** Unregister a session from whatever provider is managing it. */
  unassignSession(sessionId: string): void {
    for (const provider of this.providers.values()) {
      provider.managedSessions.delete(sessionId)
    }
    this.lastKnownPtyState.delete(sessionId)
  }

  /** Read-only view of all currently connected providers. */
  listProviders(): RuntimeProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * Number of in-flight runtime commands waiting for a provider reply.
   * Exposed for diagnostics and tests.
   */
  get pendingCount(): number {
    return this.pendingCommands.size
  }

  // -------------------------------------------------------------------------
  // Internal: response routing
  // -------------------------------------------------------------------------

  private handleResponse(provider: RuntimeProvider, frame: Record<string, unknown>): void {
    const replyTo = frame.replyTo as string
    const pending = this.pendingCommands.get(replyTo)
    if (!pending) {
      // Late or unsolicited response — drop without erroring.
      return
    }

    clearTimeout(pending.timer)
    this.pendingCommands.delete(replyTo)

    const ok = frame.ok === true
    const data = frame.data
    const errorMessage = typeof frame.error === 'string' ? frame.error : null

    if (!ok) {
      if (pending.silent) {
        pending.resolve(null)
        return
      }
      pending.reject(
        new RuntimeBridgeError(
          'provider_rejected',
          errorMessage ?? `Runtime command ${pending.command.type} rejected by provider`,
          { command: pending.command.type, sessionId: pending.command.sessionId }
        )
      )
      return
    }

    // Track which session this command successfully touched so future
    // commands route to the same provider.
    if (pending.command.type === 'runtime:launch') {
      provider.managedSessions.add(pending.command.sessionId)
    }
    if (pending.command.type === 'runtime:create-child-session') {
      const childSessionId = extractChildSessionId(data)
      if (childSessionId) {
        provider.managedSessions.add(childSessionId)
      }
    }

    pending.resolve(data)
  }

  private handleTerminalData(provider: RuntimeProvider, sessionId: string, data: string): void {
    try {
      this.hooks.onTerminalData?.({ sessionId, data, providerId: provider.id })
    } catch (error) {
      console.warn('[runtime-bridge] onTerminalData hook threw', error)
    }
  }

  private handlePtyState(
    provider: RuntimeProvider,
    sessionId: string,
    rawState: unknown
  ): void {
    const state = normalizePtyState(rawState)
    if (!state) return
    if (state.alive) {
      provider.managedSessions.add(sessionId)
      this.lastKnownPtyState.set(sessionId, { providerId: provider.id, state })
    } else {
      provider.managedSessions.delete(sessionId)
      const last = this.lastKnownPtyState.get(sessionId)
      if (last && last.providerId === provider.id) {
        this.lastKnownPtyState.delete(sessionId)
      }
    }
    try {
      this.hooks.onPtyState?.({ sessionId, providerId: provider.id, state })
    } catch (error) {
      console.warn('[runtime-bridge] onPtyState hook threw', error)
    }
  }

  private handleStateSync(provider: RuntimeProvider, sessions: unknown[]): void {
    const ptyStates: Array<{ sessionId: string; state: ProviderPtyState }> = []
    for (const entry of sessions) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      if (typeof record.sessionId !== 'string') continue
      const state = normalizePtyState(record.state)
      if (!state) continue
      if (state.alive) {
        provider.managedSessions.add(record.sessionId)
        this.lastKnownPtyState.set(record.sessionId, { providerId: provider.id, state })
      } else {
        provider.managedSessions.delete(record.sessionId)
        const last = this.lastKnownPtyState.get(record.sessionId)
        if (last && last.providerId === provider.id) {
          this.lastKnownPtyState.delete(record.sessionId)
        }
      }
      ptyStates.push({ sessionId: record.sessionId, state })
    }
    try {
      this.hooks.onProviderReady?.({ providerId: provider.id, ptyStates })
    } catch (error) {
      console.warn('[runtime-bridge] onProviderReady hook threw', error)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePtyState(value: unknown): ProviderPtyState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const alive = record.alive === true
  const exitCode = typeof record.exitCode === 'number'
    ? record.exitCode
    : record.exitCode === null
      ? null
      : undefined
  const exitReason = record.exitReason === 'clean' || record.exitReason === 'failed'
    ? record.exitReason
    : record.exitReason === null
      ? null
      : undefined
  const cols = typeof record.cols === 'number' ? record.cols : undefined
  const rows = typeof record.rows === 'number' ? record.rows : undefined
  const startedAt = typeof record.startedAt === 'string' ? record.startedAt : undefined

  return {
    alive,
    exitCode,
    exitReason,
    cols,
    rows,
    startedAt
  }
}

function extractChildSessionId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as { childSessionId?: unknown }).childSessionId
  return typeof candidate === 'string' ? candidate : null
}
