import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { CanonicalWorkspaceEvent } from '@shared/workspace'

export interface LocalWebhookServerOptions {
  onEvent?: (event: CanonicalWorkspaceEvent) => Promise<void> | void
  getWorkspaceSecret?: (workspaceId: string) => string | null
  port?: number
}

export interface LocalWebhookServer {
  app: Express
  port: number
  start: () => Promise<number>
  stop: () => Promise<void>
}

function isCanonicalWorkspaceEvent(value: unknown): value is CanonicalWorkspaceEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const event = value as Record<string, unknown>
  return event.event_version === 1
    && typeof event.event_id === 'string'
    && typeof event.event_type === 'string'
    && typeof event.timestamp === 'string'
    && typeof event.workspace_id === 'string'
    && typeof event.provider_id === 'string'
    && 'session_id' in event
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
    if (!isCanonicalWorkspaceEvent(request.body)) {
      response.status(400).json({ accepted: false, reason: 'invalid_event' })
      return
    }

    const expectedSecret = options.getWorkspaceSecret?.(request.body.workspace_id) ?? null
    if (!expectedSecret || request.header('x-vibecoding-secret') !== expectedSecret) {
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
