import { randomUUID } from 'node:crypto'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type { SessionStatus } from '@shared/project-session'

interface SessionEventApplier {
  applySessionEvent: (event: {
    sessionId: string
    status: SessionStatus
    summary: string
    externalSessionId?: string | null
  }) => Promise<void>
}

export class SessionEventBridge {
  private readonly sessionSecrets = new Map<string, string>()
  private server: ReturnType<typeof createLocalWebhookServer> | null = null
  private port: number | null = null

  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly controller: SessionEventApplier
  ) {}

  async start(): Promise<number> {
    if (this.port !== null) {
      return this.port
    }

    if (!this.server) {
      this.server = createLocalWebhookServer({
        getSessionSecret: (sessionId) => {
          return this.sessionSecrets.get(sessionId) ?? null
        },
        onEvent: async (event) => {
          await this.controller.applySessionEvent({
            sessionId: event.session_id,
            status: event.payload.status ?? 'running',
            summary: event.payload.summary ?? event.event_type,
            externalSessionId: event.payload.externalSessionId
          })
        }
      })
    }

    this.port = await this.server.start()
    await this.manager.setTerminalWebhookPort(this.port)
    return this.port
  }

  issueSessionSecret(sessionId: string): string {
    const secret = `stoa-${randomUUID()}`
    this.sessionSecrets.set(sessionId, secret)
    return secret
  }

  debugSnapshotSessionSecrets(): Record<string, string> {
    return Object.fromEntries(this.sessionSecrets)
  }

  async stop(): Promise<void> {
    await this.server?.stop()
    this.server = null
    this.sessionSecrets.clear()
    this.port = null
    await this.manager.setTerminalWebhookPort(null)
  }
}
