/**
 * StoaRuntimeClient — Electron-side WebSocket client that connects to Stoa Server
 * as a runtime provider.
 *
 * Phase 3 of the Stoa Server/Client Separation plan.
 *
 * This module is standalone — it does not modify any existing files.
 * It will be wired into the Electron main process during Phase 5.
 */
import type { PtyHost } from '@core/pty-host'
import type { SessionType } from '@shared/project-session'

// ---------------------------------------------------------------------------
// Wire protocol types — mirror stoa-server/src/ws/events.ts + plan §6.3
// ---------------------------------------------------------------------------

export interface RuntimeCommand {
  type:
    | 'runtime:launch'
    | 'runtime:kill'
    | 'runtime:input'
    | 'runtime:resize'
    | 'runtime:interrupt'
    | 'runtime:get-terminal-replay'
    | 'runtime:create-child-session'
  sessionId: string
  payload: Record<string, unknown>
  replyTo: string
}

type RuntimeCommandType = RuntimeCommand['type']

interface QueuedInput {
  data: string | Buffer
}

interface QueuedResize {
  cols: number
  rows: number
}

export interface RuntimeResponse {
  type: 'runtime:response'
  replyTo: string
  ok: boolean
  data?: unknown
  error?: string
}

type RuntimeOutboundMessage =
  | RuntimeResponse
  | { type: 'runtime:terminal-data'; sessionId: string; data: string }
  | {
      type: 'runtime:pty-state'
      sessionId: string
      state: {
        alive: true
        startedAt?: string
      }
    }
  | {
      type: 'runtime:pty-state'
      sessionId: string
      state: {
        alive: false
        exitCode: number | null
        exitReason: 'clean' | 'failed'
      }
    }
  | {
      type: 'runtime:state-sync'
      sessions: Array<{
        sessionId: string
        state: {
          alive: true
          startedAt?: string
        }
      }>
    }

// ---------------------------------------------------------------------------
// Dependency injection — callers provide these at construction time
// ---------------------------------------------------------------------------

export interface RuntimeClientDeps {
  /** The existing PtyHost instance that manages PTY processes. */
  ptyHost: PtyHost
  /**
   * Append terminal data for a session.
   * Maps to SessionRuntimeController.appendTerminalData().
   */
  appendTerminalData: (chunk: { sessionId: string; data: string }) => Promise<void>
  /**
   * Get the terminal replay buffer for a session.
   * Maps to SessionRuntimeController.getTerminalReplay().
   */
  getTerminalReplay: (sessionId: string) => Promise<string>
  /**
   * Launch a session runtime by session ID.
   * The implementation is provided by the wiring layer (index.ts) and
   * delegates to launchTrackedSessionRuntime + the full session lifecycle.
   * Returns true if the launch succeeded, false otherwise.
   */
  launchSession: (sessionId: string, options?: {
    projectId?: string
    title?: string
    type?: SessionType
    cwd?: string
    externalSessionId?: string | null
    initialDimensions?: { cols?: number; rows?: number }
  }) => Promise<boolean>
  /**
   * Create a child session (subagent).
   * Returns the new session ID, or throws on failure.
   */
  createChildSession: (payload: {
    parentId: string
    projectId?: string
    type: string
    title?: string
    subagentName?: string | null
    externalSessionId?: string | null
    initialCols?: number
    initialRows?: number
  }) => Promise<string>
  /**
   * Mark a session runtime as exited (called when PTY exits for runtime-launched sessions).
   * Optional — if not provided, PTY exit is not tracked through the runtime client.
   */
  markRuntimeExited?: (sessionId: string, exitCode: number | null, summary: string) => Promise<void>
  getSessionType?: (sessionId: string) => SessionType | null
  markAgentTurnInterrupted?: (sessionId: string, sessionType: Exclude<SessionType, 'shell'>) => Promise<void>
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface StoaRuntimeClientOptions {
  /** Full WS URL, e.g. 'ws://localhost:3270' */
  serverUrl: string
  /** Auth token for the WS connection. */
  authToken: string
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_JITTER_MS = 500
const CONNECT_TIMEOUT_MS = 5_000
const LAUNCH_TIMEOUT_MS = 29_000

export class StoaRuntimeClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private disposed = false
  private readonly pendingCommands = new Map<string, {
    resolve: (response: RuntimeResponse) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private readonly activeSessions = new Set<string>()
  private readonly launchingSessions = new Set<string>()
  private readonly activeSessionStartedAt = new Map<string, string>()
  private readonly pendingInputs = new Map<string, QueuedInput[]>()
  private readonly pendingResizes = new Map<string, QueuedResize>()

  constructor(
    private readonly options: StoaRuntimeClientOptions,
    private readonly deps: RuntimeClientDeps
  ) {}

  // -----------------------------------------------------------------------
  // Public lifecycle
  // -----------------------------------------------------------------------

  /**
   * Connect to Stoa Server as a runtime provider.
   * Resolves once the WebSocket is open and the server has accepted the connection.
   */
  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error('StoaRuntimeClient has been disposed')
    }

    const url = new URL('/ws', this.options.serverUrl)
    url.searchParams.set('token', this.options.authToken)
    url.searchParams.set('role', 'runtime')

    return await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url.toString())
      let settled = false
      const cleanup = (): void => {
        clearTimeout(connectTimeout)
      }
      const settleResolve = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (this.ws === ws) {
          this.ws = null
        }
        reject(error)
      }
      const connectTimeout = setTimeout(() => {
        settleReject(new Error(`Timed out connecting to ${this.options.serverUrl}`))
        try {
          ws.close()
        } catch {
          // Ignore close failures after timeout.
        }
      }, CONNECT_TIMEOUT_MS)

      ws.addEventListener('open', () => {
        console.log('[stoa-runtime-client] Connected to', this.options.serverUrl)
        this.reconnectAttempts = 0
        this.sendActiveSessionStateSync()
        settleResolve()
      })

      ws.addEventListener('message', (event: MessageEvent) => {
        this.handleMessage(event.data as string).catch((error) => {
          console.error('[stoa-runtime-client] Error handling message:', error)
        })
      })

      ws.addEventListener('close', (event: CloseEvent) => {
        console.log(`[stoa-runtime-client] Disconnected (code=${event.code}, reason=${event.reason || 'none'})`)
        if (!settled) {
          settleReject(new Error(`Connection closed before opening ${this.options.serverUrl}`))
          if (!this.disposed) {
            this.scheduleReconnect()
          }
          return
        }
        this.ws = null
        this.rejectAllPending('Connection closed')
        if (!this.disposed) {
          this.scheduleReconnect()
        }
      })

      ws.addEventListener('error', (event: Event) => {
        console.error('[stoa-runtime-client] WebSocket error:', (event as ErrorEvent).message ?? event)
      })

      // On first connection failure, reject the promise so the caller knows.
      ws.addEventListener('error', () => {
        settleReject(new Error(`Failed to connect to ${this.options.serverUrl}`))
      }, { once: true })

      this.ws = ws
    })
  }

  /**
   * Gracefully disconnect from Stoa Server.
   * Clears reconnection timers and rejects pending commands.
   */
  disconnect(): void {
    this.disposed = true
    this.clearReconnectTimer()
    this.rejectAllPending('Client disconnected')
    if (this.ws) {
      this.ws.close(1000, 'Client shutdown')
      this.ws = null
    }
  }

  /**
   * Whether the client is currently connected.
   */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // -----------------------------------------------------------------------
  // Incoming message handling
  // -----------------------------------------------------------------------

  private async handleMessage(raw: string): Promise<void> {
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      console.warn('[stoa-runtime-client] Received non-JSON message, ignoring')
      return
    }

    if (!isRecord(message)) {
      return
    }

    // Check if this is a runtime command from SR
    if (typeof message.type === 'string' && message.type.startsWith('runtime:') && typeof message.replyTo === 'string') {
      await this.handleCommand(message as unknown as RuntimeCommand)
      return
    }

    // Ignore other message types (subscriptions, etc.)
  }

  private async handleCommand(command: RuntimeCommand): Promise<void> {
    const { type, sessionId, payload, replyTo } = command

    try {
      let result: unknown

      switch (type) {
        case 'runtime:launch':
          result = await this.handleLaunch(sessionId, payload)
          break
        case 'runtime:kill':
          await this.handleKill(sessionId)
          break
        case 'runtime:input':
          await this.handleInput(sessionId, payload)
          break
        case 'runtime:resize':
          await this.handleResize(sessionId, payload)
          break
        case 'runtime:interrupt':
          await this.handleInterrupt(sessionId)
          break
        case 'runtime:get-terminal-replay':
          result = await this.handleGetTerminalReplay(sessionId)
          break
        case 'runtime:create-child-session':
          result = await this.handleCreateChildSession(sessionId, payload)
          break
        default:
          throw new Error(`Unknown runtime command: ${type}`)
      }

      this.sendResponse({ type: 'runtime:response', replyTo, ok: true, data: result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[stoa-runtime-client] Command ${type} failed for session ${sessionId}:`, message)
      this.sendResponse({ type: 'runtime:response', replyTo, ok: false, error: message })
    }
  }

  // -----------------------------------------------------------------------
  // Command handlers
  // -----------------------------------------------------------------------

  private async handleLaunch(sessionId: string, payload: Record<string, unknown>): Promise<unknown> {
    if (this.activeSessions.has(sessionId)) {
      console.log(`[stoa-runtime-client] Ignoring duplicate launch for ${sessionId}`)
      return { status: 'already_running' }
    }
    if (this.launchingSessions.has(sessionId)) {
      throw new Error(`runtime:launch is already in progress for session ${sessionId}`)
    }
    this.launchingSessions.add(sessionId)

    try {
      const initialDimensions: { cols?: number; rows?: number } = {}
      if (typeof payload.cols === 'number') {
        initialDimensions.cols = payload.cols
      }
      if (typeof payload.rows === 'number') {
        initialDimensions.rows = payload.rows
      }

      const launched = await this.launchWithTimeout(sessionId, {
        projectId: typeof payload.projectId === 'string' ? payload.projectId : undefined,
        title: typeof payload.title === 'string' ? payload.title : undefined,
        type: isSessionType(payload.type) ? payload.type : undefined,
        cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
        externalSessionId: typeof payload.externalSessionId === 'string' ? payload.externalSessionId : payload.externalSessionId === null ? null : undefined,
        initialDimensions: Object.keys(initialDimensions).length > 0 ? initialDimensions : undefined
      })

      if (!launched) {
        throw new Error(`Failed to launch session ${sessionId}`)
      }

      this.markSessionActive(sessionId)
      this.flushQueuedResize(sessionId)
      await this.flushQueuedInputAfterLaunch(sessionId)
      return { status: 'launched' }
    } finally {
      if (!this.activeSessions.has(sessionId)) {
        this.pendingInputs.delete(sessionId)
        this.pendingResizes.delete(sessionId)
      }
      this.launchingSessions.delete(sessionId)
    }
  }

  private async handleKill(sessionId: string): Promise<void> {
    this.launchingSessions.delete(sessionId)
    this.markSessionInactive(sessionId)
    await this.deps.ptyHost.killAndWait(sessionId)
  }

  private async handleInput(sessionId: string, payload: Record<string, unknown>): Promise<void> {
    const base64Data = payload.base64Data
    if (typeof base64Data === 'string') {
      const data = Buffer.from(base64Data, 'base64')
      if (this.activeSessions.has(sessionId)) {
        await this.writeInput(sessionId, data)
        return
      }
      if (this.launchingSessions.has(sessionId)) {
        this.queueInput(sessionId, data)
        return
      }
      this.assertSessionActive(sessionId, 'runtime:input')
      await this.writeInput(sessionId, data)
      return
    }

    const data = payload.data
    if (typeof data !== 'string') {
      throw new Error('runtime:input requires payload.data to be a string')
    }
    if (this.activeSessions.has(sessionId)) {
      await this.writeInput(sessionId, data)
      return
    }
    if (this.launchingSessions.has(sessionId)) {
      this.queueInput(sessionId, data)
      return
    }
    this.assertSessionActive(sessionId, 'runtime:input')
    await this.writeInput(sessionId, data)
  }

  private async handleResize(sessionId: string, payload: Record<string, unknown>): Promise<void> {
    const cols = payload.cols
    const rows = payload.rows
    if (typeof cols !== 'number' || typeof rows !== 'number') {
      throw new Error('runtime:resize requires payload.cols and payload.rows to be numbers')
    }
    if (this.launchingSessions.has(sessionId)) {
      this.pendingResizes.set(sessionId, { cols, rows })
      return
    }
    this.assertSessionActive(sessionId, 'runtime:resize')
    this.deps.ptyHost.resize(sessionId, cols, rows)
  }

  private async handleInterrupt(sessionId: string): Promise<void> {
    // Send Ctrl+C (ETX, ASCII 3) to the PTY
    if (this.activeSessions.has(sessionId)) {
      await this.writeInput(sessionId, '\x03')
      return
    }
    if (this.launchingSessions.has(sessionId)) {
      this.queueInput(sessionId, '\x03')
      return
    }
    this.assertSessionActive(sessionId, 'runtime:interrupt')
    await this.writeInput(sessionId, '\x03')
  }

  private async handleGetTerminalReplay(sessionId: string): Promise<unknown> {
    const replay = await this.deps.getTerminalReplay(sessionId)
    return { text: replay }
  }

  private async handleCreateChildSession(parentId: string, payload: Record<string, unknown>): Promise<unknown> {
    const sessionId = await this.deps.createChildSession({
      parentId,
      projectId: typeof payload.projectId === 'string' ? payload.projectId : undefined,
      type: typeof payload.type === 'string' ? payload.type : 'shell',
      title: typeof payload.title === 'string' ? payload.title : undefined,
      subagentName: payload.subagentName as string | null | undefined,
      externalSessionId: payload.externalSessionId as string | null | undefined,
      initialCols: typeof payload.initialCols === 'number' ? payload.initialCols : undefined,
      initialRows: typeof payload.initialRows === 'number' ? payload.initialRows : undefined
    })

    this.markSessionActive(sessionId)
    return { childSessionId: sessionId }
  }

  // -----------------------------------------------------------------------
  // Terminal data forwarding
  // -----------------------------------------------------------------------

  /**
   * Forward PTY output data to Stoa Server.
   * Call this from the PTY onData callback to stream terminal data to SR.
   *
   * Example wiring:
   * ```
   * ptyHost.start(sessionId, command, (data) => {
   *   runtimeClient.forwardTerminalData(sessionId, data)
   * })
   * ```
   */
  forwardTerminalData(sessionId: string, data: string): void {
    this.send({
      type: 'runtime:terminal-data',
      sessionId,
      data
    })
  }

  markRuntimeExited(sessionId: string, exitCode: number | null, summary: string): void {
    this.markSessionInactive(sessionId)
    this.send({
      type: 'runtime:pty-state',
      sessionId,
      state: {
        alive: false,
        exitCode,
        exitReason: exitCode === null || exitCode === 0 ? 'clean' : 'failed'
      }
    })
    void this.deps.markRuntimeExited?.(sessionId, exitCode, summary).catch((error) => {
      console.error(`[stoa-runtime-client] Failed to mark runtime exit for ${sessionId}:`, error)
    })
  }

  markRuntimeAlive(sessionId: string): void {
    this.markSessionActive(sessionId)
    this.send({
      type: 'runtime:pty-state',
      sessionId,
      state: {
        alive: true,
        startedAt: this.activeSessionStartedAt.get(sessionId)
      }
    })
  }

  // -----------------------------------------------------------------------
  // Outbound messaging
  // -----------------------------------------------------------------------

  private sendResponse(response: RuntimeResponse): void {
    this.send(response)
  }

  private async launchWithTimeout(
    sessionId: string,
    options: Parameters<RuntimeClientDeps['launchSession']>[1]
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        this.deps.launchSession(sessionId, options),
        new Promise<boolean>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`runtime:launch timed out after ${LAUNCH_TIMEOUT_MS}ms for session ${sessionId}`))
          }, LAUNCH_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private markSessionActive(sessionId: string): void {
    this.activeSessions.add(sessionId)
    if (!this.activeSessionStartedAt.has(sessionId)) {
      this.activeSessionStartedAt.set(sessionId, new Date().toISOString())
    }
  }

  private markSessionInactive(sessionId: string): void {
    this.launchingSessions.delete(sessionId)
    this.activeSessions.delete(sessionId)
    this.activeSessionStartedAt.delete(sessionId)
    this.pendingInputs.delete(sessionId)
    this.pendingResizes.delete(sessionId)
  }

  private assertSessionActive(sessionId: string, command: RuntimeCommandType): void {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`${command} cannot target inactive session ${sessionId}`)
    }
  }

  private queueInput(sessionId: string, data: string | Buffer): void {
    const queue = this.pendingInputs.get(sessionId) ?? []
    queue.push({ data })
    this.pendingInputs.set(sessionId, queue)
  }

  private async flushQueuedInput(sessionId: string): Promise<void> {
    const queue = this.pendingInputs.get(sessionId)
    if (!queue) {
      return
    }
    this.pendingInputs.delete(sessionId)
    for (const entry of queue) {
      await this.writeInput(sessionId, entry.data)
    }
  }

  private async flushQueuedInputAfterLaunch(sessionId: string): Promise<void> {
    try {
      await this.flushQueuedInput(sessionId)
    } catch (error) {
      console.warn(`[stoa-runtime-client] Failed to flush queued input for ${sessionId} after launch`, error)
    }
  }

  private async writeInput(sessionId: string, data: string | Buffer): Promise<void> {
    if (typeof data === 'string') {
      this.deps.ptyHost.write(sessionId, data)
      if (isUserInterruptInput(data)) {
        await this.markAgentTurnInterrupted(sessionId)
      }
      return
    }

    this.deps.ptyHost.writeBinary(sessionId, data)
    if (isUserInterruptBuffer(data)) {
      await this.markAgentTurnInterrupted(sessionId)
    }
  }

  private async markAgentTurnInterrupted(sessionId: string): Promise<void> {
    const sessionType = this.deps.getSessionType?.(sessionId) ?? null
    if (isAgentSessionType(sessionType)) {
      await this.deps.markAgentTurnInterrupted?.(sessionId, sessionType)
    }
  }

  private flushQueuedResize(sessionId: string): void {
    const resize = this.pendingResizes.get(sessionId)
    if (!resize) {
      return
    }
    this.pendingResizes.delete(sessionId)
    this.deps.ptyHost.resize(sessionId, resize.cols, resize.rows)
  }

  private sendActiveSessionStateSync(): void {
    if (this.activeSessions.size === 0) {
      return
    }

    this.send({
      type: 'runtime:state-sync',
      sessions: Array.from(this.activeSessions, (sessionId) => ({
        sessionId,
        state: {
          alive: true,
          startedAt: this.activeSessionStartedAt.get(sessionId)
        }
      }))
    })
  }

  private send(message: RuntimeOutboundMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      this.ws.send(JSON.stringify(message))
    } catch (error) {
      console.error('[stoa-runtime-client] Failed to send message:', error)
    }
  }

  // -----------------------------------------------------------------------
  // Reconnection with exponential backoff
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.disposed) {
      return
    }

    this.clearReconnectTimer()

    const jitter = Math.random() * RECONNECT_JITTER_MS
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts) + jitter,
      RECONNECT_MAX_MS
    )

    console.log(`[stoa-runtime-client] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts += 1
      this.connect().catch((error) => {
        console.error('[stoa-runtime-client] Reconnection failed:', error)
        // scheduleReconnect will be called again by the 'close' event handler
      })
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // -----------------------------------------------------------------------
  // Pending command cleanup
  // -----------------------------------------------------------------------

  private rejectAllPending(reason: string): void {
    for (const [replyTo, entry] of this.pendingCommands) {
      clearTimeout(entry.timer)
      this.pendingCommands.delete(replyTo)
      entry.resolve({ type: 'runtime:response', replyTo, ok: false, error: reason })
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSessionType(value: unknown): value is SessionType {
  return value === 'shell' || value === 'opencode' || value === 'codex' || value === 'claude-code'
}

function isAgentSessionType(sessionType: SessionType | null): sessionType is Exclude<SessionType, 'shell'> {
  return sessionType === 'codex'
    || sessionType === 'claude-code'
    || sessionType === 'opencode'
}

function isUserInterruptInput(data: string): boolean {
  return data === ''
}

function isUserInterruptBuffer(data: Buffer): boolean {
  return data.length === 1 && data[0] === 0x03
}
