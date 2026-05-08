import type { SessionType } from '@shared/project-session'

export interface SessionInputSessionLookup {
  getSessionType: (sessionId: string) => SessionType | null
}

export interface SessionInputTransport {
  write: (sessionId: string, data: string) => void | Promise<void>
  writeBinary: (sessionId: string, data: Uint8Array) => void | Promise<void>
}

export interface SessionInputRouterOptions {
  onUserInterrupt?: (sessionId: string, sessionType: Exclude<SessionType, 'shell'>) => Promise<void> | void
}

export class SessionInputRouter {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly generations = new Map<string, number>()
  private readonly onUserInterrupt?: (sessionId: string, sessionType: Exclude<SessionType, 'shell'>) => Promise<void> | void

  constructor(
    private readonly sessions: SessionInputSessionLookup,
    private readonly transport: SessionInputTransport,
    options: SessionInputRouterOptions = {}
  ) {
    this.onUserInterrupt = options.onUserInterrupt
  }

  async send(sessionId: string, data: string): Promise<void> {
    if (!data) {
      return
    }

    const sessionType = this.sessions.getSessionType(sessionId)
    if (isAgentSessionType(sessionType) && isUserInterruptInput(data)) {
      this.resetSession(sessionId)
      await Promise.resolve(this.transport.write(sessionId, data))
      await this.onUserInterrupt?.(sessionId, sessionType)
      return
    }

    await this.enqueue(sessionId, () => this.transport.write(sessionId, data))
  }

  async sendBinary(sessionId: string, data: Uint8Array): Promise<void> {
    await this.enqueue(sessionId, () => this.transport.writeBinary(sessionId, data))
  }

  resetSession(sessionId: string): void {
    const nextGeneration = (this.generations.get(sessionId) ?? 0) + 1
    this.generations.set(sessionId, nextGeneration)
    this.queues.delete(sessionId)
  }

  dispose(): void {
    this.queues.clear()
    this.generations.clear()
  }

  private enqueue(sessionId: string, fn: () => void | Promise<void>): Promise<void> {
    const generation = this.generations.get(sessionId) ?? 0
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(() => {
      if ((this.generations.get(sessionId) ?? 0) !== generation) {
        return
      }

      return fn()
    }, () => {
      if ((this.generations.get(sessionId) ?? 0) !== generation) {
        return
      }

      return fn()
    })
    this.queues.set(sessionId, next)
    const cleanup = () => {
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId)
      }
    }
    next.then(cleanup, cleanup)
    return next
  }
}

function isAgentSessionType(sessionType: SessionType | null): sessionType is Exclude<SessionType, 'shell'> {
  return sessionType === 'codex'
    || sessionType === 'claude-code'
    || sessionType === 'opencode'
    || sessionType === 'hermes-agent'
}

function isUserInterruptInput(data: string): boolean {
  return data.includes('\u0003')
}
