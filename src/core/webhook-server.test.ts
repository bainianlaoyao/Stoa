import { afterEach, describe, expect, test } from 'vitest'
import { request } from 'node:http'
import { createLocalWebhookServer } from './webhook-server'
import type { CanonicalSessionEvent } from '@shared/project-session'

const servers: Array<ReturnType<typeof createLocalWebhookServer>> = []

function createEvent(): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'evt_webhook_1',
    event_type: 'session.started',
    timestamp: '2026-04-18T10:00:00.000Z',
    session_id: 'session_demo_001',
    project_id: 'project_demo',
    source: 'hook-sidecar',
    payload: {
      status: 'running',
      summary: 'event accepted',
      isProvisional: false
    }
  }
}

async function postEvent(
  port: number,
  event: CanonicalSessionEvent,
  secret?: string
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(event)
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/events',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...(secret ? { 'x-stoa-secret': secret } : {})
        }
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body })
        })
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function postClaudeHook(
  port: number,
  hookBody: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(hookBody)
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/hooks/claude-code',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers
        }
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body })
        })
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

describe('local webhook server', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.stop()))
  })

  test('rejects event posts without a matching session secret', async () => {
    const accepted: CanonicalSessionEvent[] = []
    const server = createLocalWebhookServer({
      getSessionSecret(sessionId) {
        return sessionId === 'session_demo_001' ? 'secret-1' : null
      },
      onEvent(event) {
        accepted.push(event)
      }
    })
    servers.push(server)
    const port = await server.start()

    const response = await postEvent(port, createEvent())

    expect(response.statusCode).toBe(401)
    expect(accepted).toHaveLength(0)
  })

  test('accepts canonical events when session secret matches', async () => {
    const accepted: CanonicalSessionEvent[] = []
    const server = createLocalWebhookServer({
      getSessionSecret(sessionId) {
        return sessionId === 'session_demo_001' ? 'secret-1' : null
      },
      onEvent(event) {
        accepted.push(event)
      }
    })
    servers.push(server)
    const port = await server.start()

    const response = await postEvent(port, createEvent(), 'secret-1')

    expect(response.statusCode).toBe(202)
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.event_id).toBe('evt_webhook_1')
  })

  test('accepts Claude hook events when session headers and secret match', async () => {
    const accepted: CanonicalSessionEvent[] = []
    const server = createLocalWebhookServer({
      getSessionSecret(sessionId) {
        return sessionId === 'session_demo_001' ? 'secret-1' : null
      },
      onEvent(event) {
        accepted.push(event)
      }
    })
    servers.push(server)
    const port = await server.start()

    const response = await postClaudeHook(
      port,
      { hook_event_name: 'Stop', session_id: 'claude-external-1' },
      {
        'x-stoa-session-id': 'session_demo_001',
        'x-stoa-project-id': 'project_demo',
        'x-stoa-secret': 'secret-1'
      }
    )

    expect(response.statusCode).toBe(202)
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({
      event_type: 'claude-code.Stop',
      session_id: 'session_demo_001',
      project_id: 'project_demo',
      payload: {
        status: 'turn_complete'
      }
    })
  })
})
