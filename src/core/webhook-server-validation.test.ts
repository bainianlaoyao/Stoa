import { afterEach, describe, expect, test } from 'vitest'
import { request } from 'node:http'
import { createLocalWebhookServer } from './webhook-server'
import type { CanonicalSessionEvent } from '@shared/project-session'

const servers: Array<ReturnType<typeof createLocalWebhookServer>> = []

function createTestServer(secret: string | null = 'secret-1') {
  const events: CanonicalSessionEvent[] = []
  const server = createLocalWebhookServer({
    getSessionSecret: (_sessionId) => secret,
    onEvent: (event) => {
      events.push(event)
    }
  })
  servers.push(server)
  return { server, events }
}

function createValidEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_version: 1,
    event_id: 'evt_001',
    event_type: 'session.started',
    timestamp: new Date().toISOString(),
    session_id: 'session_test',
    project_id: 'project_test',
    source: 'hook-sidecar',
    payload: { status: 'running' },
    ...overrides
  }
}

async function postJson(
  port: number,
  body: unknown,
  secret?: string
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
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
        let data = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body: data })
        })
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function getHealth(
  port: number
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET'
      },
      (response) => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          data += chunk
        })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body: data })
        })
      }
    )

    req.on('error', reject)
    req.end()
  })
}

describe('webhook event validation', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.stop()))
  })

  describe('isCanonicalSessionEvent rejection branches', () => {
    test('rejects null body', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, null)

      expect(response.statusCode).toBe(400)
    })

    test('rejects empty object', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, {})

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.body)).toEqual({ accepted: false, reason: 'invalid_event' })
    })

    test('rejects missing event_version', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.event_version

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects wrong event_version', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, createValidEvent({ event_version: 2 }))

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing event_id', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.event_id

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects non-string event_id', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, createValidEvent({ event_id: 123 }))

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing event_type', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.event_type

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing timestamp', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.timestamp

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing session_id', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.session_id

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing project_id', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.project_id

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing source', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.source

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects missing payload', async () => {
      const { server } = createTestServer()
      const port = await server.start()
      const event = createValidEvent()
      delete event.payload

      const response = await postJson(port, event)

      expect(response.statusCode).toBe(400)
    })

    test('rejects non-object payload (string)', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, createValidEvent({ payload: 'string' }))

      expect(response.statusCode).toBe(400)
    })

    test('rejects null payload', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, createValidEvent({ payload: null }))

      expect(response.statusCode).toBe(400)
    })

    test('accepts valid minimal event', async () => {
      const { server, events } = createTestServer()
      const port = await server.start()

      const response = await postJson(port, createValidEvent(), 'secret-1')

      expect(response.statusCode).toBe(202)
      expect(JSON.parse(response.body)).toEqual({ accepted: true })
      expect(events).toHaveLength(1)
    })

    test('accepts event with extra fields (correlation_id)', async () => {
      const { server, events } = createTestServer()
      const port = await server.start()

      const response = await postJson(
        port,
        createValidEvent({ correlation_id: 'corr-123' }),
        'secret-1'
      )

      expect(response.statusCode).toBe(202)
      expect(events).toHaveLength(1)
      expect(events[0]!.correlation_id).toBe('corr-123')
    })

    test('accepts event with empty payload object', async () => {
      const { server, events } = createTestServer()
      const port = await server.start()

      const response = await postJson(
        port,
        createValidEvent({ payload: {} }),
        'secret-1'
      )

      expect(response.statusCode).toBe(202)
      expect(events).toHaveLength(1)
    })
  })

  describe('secret validation branches', () => {
    test('rejects when getSessionSecret returns null', async () => {
      const { server } = createTestServer(null)
      const port = await server.start()

      const response = await postJson(port, createValidEvent(), 'secret-1')

      expect(response.statusCode).toBe(401)
      expect(JSON.parse(response.body)).toEqual({ accepted: false, reason: 'invalid_secret' })
    })

    test('rejects when secret header does not match', async () => {
      const { server } = createTestServer('abc')
      const port = await server.start()

      const response = await postJson(port, createValidEvent(), 'xyz')

      expect(response.statusCode).toBe(401)
      expect(JSON.parse(response.body)).toEqual({ accepted: false, reason: 'invalid_secret' })
    })

    test('rejects when secret header is missing', async () => {
      const { server } = createTestServer('abc')
      const port = await server.start()

      const response = await postJson(port, createValidEvent())

      expect(response.statusCode).toBe(401)
      expect(JSON.parse(response.body)).toEqual({ accepted: false, reason: 'invalid_secret' })
    })

    test('accepts when secret matches', async () => {
      const { server, events } = createTestServer('secret-1')
      const port = await server.start()

      const response = await postJson(port, createValidEvent(), 'secret-1')

      expect(response.statusCode).toBe(202)
      expect(events).toHaveLength(1)
    })
  })

  describe('health endpoint', () => {
    test('GET /health returns { ok: true }', async () => {
      const { server } = createTestServer()
      const port = await server.start()

      const response = await getHealth(port)

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ ok: true })
    })
  })

  describe('server lifecycle', () => {
    test('start returns a valid port number', async () => {
      const { server } = createTestServer()

      const port = await server.start()

      expect(typeof port).toBe('number')
      expect(port).toBeGreaterThan(0)
    })

    test('start returns same port on second call', async () => {
      const { server } = createTestServer()

      const port1 = await server.start()
      const port2 = await server.start()

      expect(port1).toBe(port2)
    })

    test('stop resolves without error when server is running', async () => {
      const { server } = createTestServer()
      await server.start()

      await expect(server.stop()).resolves.toBeUndefined()
    })

    test('stop resolves without error when server was never started', async () => {
      const { server } = createTestServer()

      await expect(server.stop()).resolves.toBeUndefined()
    })
  })
})
