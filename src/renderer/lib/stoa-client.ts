/**
 * HTTP + WebSocket client for Stoa Server.
 *
 * Replaces Electron IPC with REST + WS for non-desktop operations.
 * Used inside the renderer via StoaClientPreloadAdapter.
 */

// ── ApiResponse envelope (mirrors server §5.2) ──────────────────────

export interface ApiResponseMeta {
  requestId: string
  timestamp: string
  pagination?: {
    cursor: string | null
    hasMore: boolean
    totalCount?: number
  }
}

export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
    nextSteps?: string[] | null
  }
  meta: ApiResponseMeta
}

export class StoaClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly nextSteps?: string[] | null,
  ) {
    super(message)
    this.name = 'StoaClientError'
  }
}

// ── WS event shape (mirrors server §7.2) ────────────────────────────

interface WsServerEvent {
  id: string
  type: string
  payload: unknown
  timestamp: string
}

interface WsClientMessage {
  type: string
  payload: unknown
  requestId?: string
}

// ── StoaClient ───────────────────────────────────────────────────────

export class StoaClient {
  private baseUrl: string
  private token: string
  private ws: WebSocket | null = null
  private wsHandlers = new Map<string, Set<(payload: unknown) => void>>()
  private wsBuffer: WsServerEvent[] = []
  private wsBuffering = false
  private lastEventId: string | null = null
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wsReconnectDelay = 1000
  private wsMaxReconnectDelay = 30000
  private disposed = false

  constructor(
    /** e.g. "http://localhost:3270" */
    baseUrl: string,
    /** Bearer token for Authorization header */
    token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
  }

  /** Get the base URL the client is connected to. */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /** Get the bearer token the client is using. */
  getToken(): string {
    return this.token
  }

  // ── HTTP helpers ─────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }

    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    const res = await fetch(url, init)
    const json = (await res.json()) as ApiResponse<T>

    if (!json.ok || json.error) {
      throw new StoaClientError(
        json.error?.code ?? 'unknown_error',
        json.error?.message ?? `Request failed with status ${res.status}`,
        json.error?.details,
        json.error?.nextSteps,
      )
    }

    return json
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body)
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body)
  }

  async delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, body)
  }

  // ── WebSocket ────────────────────────────────────────────────────

  connectWs(): void {
    if (this.ws || this.disposed) return

    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws'
    const params = new URLSearchParams({ token: this.token })
    if (this.lastEventId) {
      params.set('lastEventId', this.lastEventId)
    }

    this.wsBuffering = true
    this.wsBuffer = []

    const ws = new WebSocket(`${wsUrl}?${params.toString()}`)

    ws.onopen = () => {
      this.wsReconnectDelay = 1000
      // After initial state fetch, caller should call flushBuffer()
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsServerEvent
        this.lastEventId = msg.id

        if (this.wsBuffering) {
          this.wsBuffer.push(msg)
        } else {
          this.dispatchWsEvent(msg)
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      this.ws = null
      if (!this.disposed) {
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror, reconnect logic is there
    }

    this.ws = ws
  }

  /** Stop buffering and apply buffered events. Call after initial state fetch. */
  flushBuffer(): void {
    this.wsBuffering = false
    for (const msg of this.wsBuffer) {
      this.dispatchWsEvent(msg)
    }
    this.wsBuffer = []
  }

  private dispatchWsEvent(msg: WsServerEvent): void {
    const handlers = this.wsHandlers.get(msg.type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(msg.payload)
        } catch {
          // Prevent one handler error from breaking others
        }
      }
    }
  }

  subscribe(eventType: string, handler: (payload: unknown) => void): () => void {
    let set = this.wsHandlers.get(eventType)
    if (!set) {
      set = new Set()
      this.wsHandlers.set(eventType, set)
    }
    set.add(handler)

    // Send subscribe message to server
    this.sendWsMessage({ type: 'subscribe', payload: { eventTypes: [eventType] } })

    return () => {
      set!.delete(handler)
      if (set!.size === 0) {
        this.wsHandlers.delete(eventType)
      }
    }
  }

  unsubscribe(eventType: string): void {
    this.wsHandlers.delete(eventType)
    this.sendWsMessage({ type: 'unsubscribe', payload: { eventTypes: [eventType] } })
  }

  private sendWsMessage(msg: WsClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectTimer || this.disposed) return

    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null
      this.connectWs()
    }, this.wsReconnectDelay)

    this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, this.wsMaxReconnectDelay)
  }

  // ── Binary terminal input ────────────────────────────────────────

  sendBinaryInput(sessionId: string, data: Uint8Array): void {
    // Send as base64-encoded binary via WS client message
    const base64 = btoa(
      Array.from(data)
        .map((b) => String.fromCharCode(b))
        .join(''),
    )
    this.sendWsMessage({
      type: 'session:binary-input',
      payload: { sessionId, data: base64 },
    })
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.wsHandlers.clear()
    this.wsBuffer = []
  }
}
