import type { SessionType } from '@shared/project-session'

const ESCAPE = '\u001b'
const DEFAULT_CODEX_PLAIN_INPUT_MIN_INTERVAL_MS = 35

export interface SessionInputSessionLookup {
  getSessionType: (sessionId: string) => SessionType | null
}

export interface SessionInputTransport {
  write: (sessionId: string, data: string) => void
}

export interface SessionInputRouterOptions {
  codexPlainInputMinIntervalMs?: number
  codexSubmitInputMinIntervalMs?: number
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
  onUserInterrupt?: (sessionId: string, sessionType: Exclude<SessionType, 'shell'>) => Promise<void> | void
}

export class SessionInputRouter {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly generations = new Map<string, number>()
  private readonly lastCodexPlainWriteAt = new Map<string, number>()
  private readonly codexPlainInputMinIntervalMs: number
  private readonly codexSubmitInputMinIntervalMs: number
  private readonly nowMs: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly onUserInterrupt?: (sessionId: string, sessionType: Exclude<SessionType, 'shell'>) => Promise<void> | void

  constructor(
    private readonly sessions: SessionInputSessionLookup,
    private readonly transport: SessionInputTransport,
    options: SessionInputRouterOptions = {}
  ) {
    this.codexPlainInputMinIntervalMs = options.codexPlainInputMinIntervalMs ?? DEFAULT_CODEX_PLAIN_INPUT_MIN_INTERVAL_MS
    this.codexSubmitInputMinIntervalMs = options.codexSubmitInputMinIntervalMs ?? 120
    this.nowMs = options.nowMs ?? (() => Date.now())
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.onUserInterrupt = options.onUserInterrupt
  }

  async send(sessionId: string, data: string): Promise<void> {
    if (!data) {
      return
    }

    const sessionType = this.sessions.getSessionType(sessionId)
    if (isAgentSessionType(sessionType) && isUserInterruptInput(data)) {
      this.resetSession(sessionId)
      this.transport.write(sessionId, data)
      await this.onUserInterrupt?.(sessionId, sessionType)
      return
    }

    const frames = sessionType === 'codex' ? expandCodexFrames(data) : [data]
    if (frames.length === 0) {
      return
    }

    const generation = this.generations.get(sessionId) ?? 0
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => {
        // Preserve per-session order even if a previous send failed.
      })
      .then(async () => {
        await this.flushFrames(sessionId, sessionType, frames, generation)
      })

    this.queues.set(sessionId, next)
    const cleanup = () => {
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId)
      }
    }
    next.then(cleanup, cleanup)

    await next
  }

  resetSession(sessionId: string): void {
    const nextGeneration = (this.generations.get(sessionId) ?? 0) + 1
    this.generations.set(sessionId, nextGeneration)
    this.queues.delete(sessionId)
    this.lastCodexPlainWriteAt.delete(sessionId)
  }

  dispose(): void {
    this.queues.clear()
    this.generations.clear()
    this.lastCodexPlainWriteAt.clear()
  }

  private async flushFrames(
    sessionId: string,
    sessionType: SessionType | null,
    frames: string[],
    generation: number
  ): Promise<void> {
    for (const frame of frames) {
      if (!this.isGenerationCurrent(sessionId, generation)) {
        return
      }

      if (sessionType === 'codex' && isCodexPlainFrame(frame)) {
        const lastWriteAt = this.lastCodexPlainWriteAt.get(sessionId)
        if (lastWriteAt !== undefined) {
          const minimumIntervalMs = isCodexSubmitFrame(frame)
            ? this.codexSubmitInputMinIntervalMs
            : this.codexPlainInputMinIntervalMs
          const waitMs = Math.max(0, minimumIntervalMs - (this.nowMs() - lastWriteAt))
          if (waitMs > 0) {
            await this.sleep(waitMs)
            if (!this.isGenerationCurrent(sessionId, generation)) {
              return
            }
          }
        }

        this.transport.write(sessionId, frame)
        this.lastCodexPlainWriteAt.set(sessionId, this.nowMs())
        continue
      }

      this.transport.write(sessionId, frame)
    }
  }

  private isGenerationCurrent(sessionId: string, generation: number): boolean {
    return (this.generations.get(sessionId) ?? 0) === generation
  }
}

function expandCodexFrames(data: string): string[] {
  if (!data) {
    return []
  }

  if (data.includes(ESCAPE)) {
    return [data]
  }

  const frames = [...data]
  return frames.length <= 1 ? [data] : frames
}

function isCodexPlainFrame(data: string): boolean {
  return !data.includes(ESCAPE)
}

function isCodexSubmitFrame(data: string): boolean {
  return data === '\r' || data === '\n'
}

function isAgentSessionType(sessionType: SessionType | null): sessionType is Exclude<SessionType, 'shell'> {
  return sessionType === 'codex' || sessionType === 'claude-code' || sessionType === 'opencode'
}

function isUserInterruptInput(data: string): boolean {
  return data.includes('\u0003')
}
