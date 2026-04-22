import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { CanonicalSessionEvent } from '@shared/project-session'

export interface LocalWebhookServerOptions {
  onEvent?: (event: CanonicalSessionEvent) => Promise<void> | void
  getSessionSecret?: (sessionId: string) => string | null
  port?: number
}

export interface LocalWebhookServer {
  app: Express
  port: number
  start: () => Promise<number>
  stop: () => Promise<void>
}

function isCanonicalSessionEvent(value: unknown): value is CanonicalSessionEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const event = value as Record<string, unknown>
  return event.event_version === 1
    && typeof event.event_id === 'string'
    && typeof event.event_type === 'string'
    && typeof event.timestamp === 'string'
    && typeof event.session_id === 'string'
    && typeof event.project_id === 'string'
    && typeof event.source === 'string'
    && !!event.payload
    && typeof event.payload === 'object'
}

export function createLocalWebhookServer(options: LocalWebhookServerOptions = {}): LocalWebhookServer {
  const app = express()
  app.use(express.json())

  let server: import('node:http').Server | null = null
  const port = options.port ?? 0

  app.get('/health', (_request, response) => {
    response.json({ ok: true })
  })

  app.post('/events', async (request, response) => {
    if (!isCanonicalSessionEvent(request.body)) {
      response.status(400).json({ accepted: false, reason: 'invalid_event' })
      return
    }

    const expectedSecret = options.getSessionSecret?.(request.body.session_id) ?? null
    if (!expectedSecret || request.header('x-stoa-secret') !== expectedSecret) {
      response.status(401).json({ accepted: false, reason: 'invalid_secret' })
      return
    }

    await options.onEvent?.(request.body)
    response.status(202).json({ accepted: true })
  })

  return {
    app,
    port,
    async start() {
      if (server) {
        return (server.address() as AddressInfo).port
      }

      const started = await new Promise<import('node:http').Server>((resolve) => {
        const httpServer = app.listen(port, '127.0.0.1', () => resolve(httpServer))
      })

      server = started
      return (started.address() as AddressInfo).port
    },
    async stop() {
      if (!server) {
        return
      }

      const active = server
      server = null
      await new Promise<void>((resolve, reject) => {
        active.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}
