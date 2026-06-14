/**
 * Minimal WebSocket server transport (RFC 6455) for Stoa Server.
 *
 * Why this file exists
 * --------------------
 * The `ws` npm package is the standard, but in this build it is not
 * installed in `stoa-server`'s dependency set. To keep the
 * browser-UI wiring self-contained we implement a tiny subset of
 * RFC 6455 here:
 *
 *   - HTTP/1.1 `Upgrade: websocket` handshake with the
 *     `Sec-WebSocket-Accept` derivation defined in §1.3.
 *   - Text frames, both directions. Server→client frames use the
 *     "unmasked" form; client→server frames accept the "masked" form
 *     per §5.1.
 *   - Ping / pong / close frames.
 *
 * Out of scope
 * ------------
 *   - Continuation / binary / per-frame deflate. The Stoa Server
 *     protocol is JSON text only.
 *   - TLS, subprotocols, extensions, fragmentation. None of the
 *     current clients (Electron `StoaRuntimeClient`, the renderer's
 *     `StoaClient`) negotiate these.
 *
 * The transport is intentionally narrow so it can be replaced by the
 * `ws` package in the future without touching the rest of the code.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { RoleRouterSocket } from './role-router'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const SOCKET_BUFFER_INITIAL = 16 * 1024

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebSocketServerOptions {
  /** Receive the parsed `RoleRouterRequest` and the wire-level socket. */
  onConnection?: (req: IncomingMessage, socket: WebSocketConnection) => void
  /** Optional: log when a connection is rejected by the handshake. */
  onHandshakeError?: (error: Error) => void
}

export interface WebSocketConnection extends RoleRouterSocket {
  /** Underlying TCP socket. Exposed for tests. */
  readonly stream: Duplex
  /** Indicates the handshake has completed. */
  readonly ready: boolean
  /** Receive a `close` notification. */
  on(event: 'close', listener: (code: number, reason: string) => void): this
  on(event: 'message', listener: (data: string) => void): this
  off(event: 'close', listener: (code: number, reason: string) => void): this
  off(event: 'message', listener: (data: string) => void): this
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

/**
 * Wire a `http.Server` instance to perform WebSocket upgrades for
 * requests whose `Upgrade: websocket` and `Connection: Upgrade` headers
 * are present. Other requests are untouched.
 */
export function attachWebSocketServer(
  server: import('node:http').Server,
  options: WebSocketServerOptions = {},
): void {
  server.on('upgrade', (req, socket, head) => {
    if (!isWebSocketUpgrade(req)) {
      socket.destroy()
      return
    }
    if (head && head.length > 0) {
      // The very first frame should never arrive in `head` for a
      // well-behaved client, but tolerating it avoids a one-byte DoS.
      // We don't currently parse it because the role-router only cares
      // about full frames.
      head = Buffer.alloc(0)
    }
    try {
      const conn = acceptHandshake(req, socket)
      options.onConnection?.(req, conn)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      options.onHandshakeError?.(err)
      try {
        socket.write(
          'HTTP/1.1 400 Bad Request\r\n' +
            'Connection: close\r\n' +
            'Content-Length: 0\r\n\r\n',
        )
        socket.destroy()
      } catch {
        // Already closed.
      }
    }
  })
}

function isWebSocketUpgrade(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false
  const upgrade = (req.headers['upgrade'] ?? '').toString().toLowerCase()
  const connection = (req.headers['connection'] ?? '').toString().toLowerCase()
  if (!upgrade.includes('websocket')) return false
  if (!connection.split(/\s*,\s*/).some((token) => token === 'upgrade')) {
    return false
  }
  return typeof req.headers['sec-websocket-key'] === 'string'
}

// ---------------------------------------------------------------------------
// Handshake (server side)
// ---------------------------------------------------------------------------

function acceptHandshake(
  req: IncomingMessage,
  socket: Duplex,
): WebSocketConnection {
  const keyRaw = req.headers['sec-websocket-key']
  if (typeof keyRaw !== 'string' || keyRaw.length === 0) {
    throw new Error('Missing Sec-WebSocket-Key')
  }
  const accept = deriveAcceptValue(keyRaw)
  const headers: string[] = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
  ]
  const subprotocol = req.headers['sec-websocket-protocol']
  if (typeof subprotocol === 'string' && subprotocol.length > 0) {
    // We do not negotiate subprotocols; echo nothing.
  }
  socket.write(headers.concat('', '').join('\r\n'))

  return new WebSocketConnectionImpl(socket)
}

function deriveAcceptValue(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}

// ---------------------------------------------------------------------------
// Connection — frame encode / decode
// ---------------------------------------------------------------------------

type CloseListener = (code: number, reason: string) => void
type MessageListener = (data: string) => void

class WebSocketConnectionImpl implements WebSocketConnection {
  readonly stream: Duplex
  private _ready = false
  private _closed = false
  private buffer: Buffer = Buffer.alloc(0)
  private closeListeners: Set<CloseListener> = new Set()
  private messageListeners: Set<MessageListener> = new Set()

  constructor(stream: Duplex) {
    this.stream = stream
    this._ready = true

    stream.on('data', (chunk: Buffer | string) => {
      this.onData(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    stream.on('error', (error: Error) => {
      this.emitClose(1011, error.message ?? 'stream error')
    })
    stream.on('close', () => {
      this.emitClose(1006, 'connection closed')
    })
  }

  get ready(): boolean {
    return this._ready
  }

  on(event: 'close' | 'message', listener: ((code: number, reason: string) => void) | ((data: string) => void)): this {
    if (event === 'close') {
      this.closeListeners.add(listener as CloseListener)
    } else if (event === 'message') {
      this.messageListeners.add(listener as MessageListener)
    }
    return this
  }

  off(event: 'close' | 'message', listener: ((code: number, reason: string) => void) | ((data: string) => void)): this {
    if (event === 'close') {
      this.closeListeners.delete(listener as CloseListener)
    } else if (event === 'message') {
      this.messageListeners.delete(listener as MessageListener)
    }
    return this
  }

  send(data: string): void {
    if (this._closed) return
    const frame = encodeTextFrame(data)
    try {
      this.stream.write(frame)
    } catch {
      this.emitClose(1011, 'write failed')
    }
  }

  close(code = 1000, reason = ''): void {
    if (this._closed) return
    this._closed = true
    try {
      this.stream.write(encodeCloseFrame(code, reason))
    } catch {
      // Stream already torn down; fall through to destroy.
    }
    try {
      this.stream.end()
    } catch {
      // Ignore.
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    while (true) {
      const frame = tryParseFrame(this.buffer)
      if (!frame) return
      this.buffer = this.buffer.subarray(frame.totalLength)
      this.dispatchFrame(frame)
    }
  }

  private dispatchFrame(frame: ParsedFrame): void {
    if (frame.opcode === 0x1) {
      // Text frame
      const text = frame.payload.toString('utf-8')
      for (const listener of this.messageListeners) {
        try {
          listener(text)
        } catch (error) {
          console.warn('[ws-transport] message listener threw', error)
        }
      }
      return
    }
    if (frame.opcode === 0x8) {
      // Close
      const code = frame.payload.length >= 2
        ? frame.payload.readUInt16BE(0)
        : 1000
      const reason = frame.payload.length > 2
        ? frame.payload.subarray(2).toString('utf-8')
        : ''
      this.emitClose(code, reason)
      return
    }
    if (frame.opcode === 0x9) {
      // Ping — reply with pong
      try {
        this.stream.write(encodeControlFrame(0xA, frame.payload))
      } catch {
        // Ignore.
      }
      return
    }
    if (frame.opcode === 0xA) {
      // Pong — ignore
      return
    }
    // Continuation / binary / reserved: not part of the Stoa protocol.
  }

  private emitClose(code: number, reason: string): void {
    if (this._closed) return
    this._closed = true
    for (const listener of this.closeListeners) {
      try {
        listener(code, reason)
      } catch (error) {
        console.warn('[ws-transport] close listener threw', error)
      }
    }
  }
}

interface ParsedFrame {
  opcode: number
  payload: Buffer
  totalLength: number
}

function tryParseFrame(buffer: Buffer): ParsedFrame | null {
  if (buffer.length < 2) return null
  const first = buffer[0]!
  const second = buffer[1]!
  const opcode = first & 0x0F
  const masked = (second & 0x80) !== 0
  let payloadLength = second & 0x7F
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null
    // Use BigInt-safe semantics by shifting a hi/lo pair; the Stoa
    // protocol never sends payloads > 2^53, so we cap at 2^32 - 1.
    const hi = buffer.readUInt32BE(offset)
    const lo = buffer.readUInt32BE(offset + 4)
    payloadLength = hi * 0x1_0000_0000 + lo
    offset += 8
  }

  let mask: Buffer | null = null
  if (masked) {
    if (buffer.length < offset + 4) return null
    mask = buffer.subarray(offset, offset + 4)
    offset += 4
  }

  if (buffer.length < offset + payloadLength) return null

  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength))
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = payload[i]! ^ mask[i % 4]!
    }
  }

  return { opcode, payload, totalLength: offset + payloadLength }
}

// ---------------------------------------------------------------------------
// Server → client frame encoding
// ---------------------------------------------------------------------------

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf-8')
  return encodeFrame(0x1, payload)
}

function encodeCloseFrame(code: number, reason: string): Buffer {
  const reasonBuf = Buffer.from(reason, 'utf-8')
  const payload = Buffer.alloc(2 + reasonBuf.length)
  payload.writeUInt16BE(code, 0)
  reasonBuf.copy(payload, 2)
  return encodeFrame(0x8, payload)
}

function encodeControlFrame(opcode: number, payload: Buffer): Buffer {
  return encodeFrame(opcode, payload)
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length
  let header: Buffer
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length < 0x1_00_00) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    // Stoa frames are far below 2^53; we can use double-precision
    // arithmetic here without loss of precision.
    const high = Math.floor(length / 0x1_0000_0000)
    const low = length - high * 0x1_0000_0000
    header.writeUInt32BE(high, 2)
    header.writeUInt32BE(low, 6)
  }
  return Buffer.concat([header, payload])
}

// ---------------------------------------------------------------------------
// Server-side frame encoder for runtime providers
// ---------------------------------------------------------------------------

/**
 * Encode a runtime provider's command frame (server → provider). Mirrors
 * the `RuntimeCommand` shape from `runtime-bridge-handler.ts`.
 */
export function encodeRuntimeCommand(command: {
  type: string
  sessionId: string
  payload: Record<string, unknown>
  replyTo: string
}): Buffer {
  return encodeTextFrame(JSON.stringify(command))
}

/**
 * Generate a random `Sec-WebSocket-Key` for tests that want to construct
 * a client request. Not used in production code.
 */
export function generateClientKey(): string {
  return randomBytes(16).toString('base64')
}

// Reserve an initial allocation; placeholder so the constant is exported
// for tests that need to simulate a buffer overflow.
export const SOCKET_BUFFER_HIGH_WATERMARK = SOCKET_BUFFER_INITIAL
