import { afterEach, describe, expect, test } from 'vitest'
import { request } from 'node:http'
import { createLocalWebhookServer } from './webhook-server'
import type { CanonicalSessionEvent } from '@shared/project-session'
import type { SessionHookLease } from '../main/hook-lease-registry'

const servers: Array<ReturnType<typeof createLocalWebhookServer>> = []

function createActiveLease(overrides: Partial<SessionHookLease> = {}): SessionHookLease {
  return {
    version: 1,
    sessionId: 'session_demo_001',
    projectId: 'project_demo',
    provider: 'claude-code',
    leaseState: 'active',
    ownerInstanceId: 'instance-a',
    generation: 1,
    webhookBaseUrl: 'http://127.0.0.1:43127',
    sessionSecret: 'secret-1',
    commitLockNonce: 'nonce-a',
    commitToken: 'token-a',
    createdAt: '2026-05-10T12:00:00.000Z',
    updatedAt: '2026-05-10T12:00:00.000Z',
    heartbeatAt: '2026-05-10T12:00:00.000Z',
    expiresAt: '2026-05-10T12:00:20.000Z',
    ...overrides
  }
}

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
      intent: 'agent.turn_started',
      turnEpoch: 1,
      summary: 'event accepted'
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

async function postCodexHook(
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
        path: '/hooks/codex',
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
    const authorizationInputs: Array<{
      sessionId: string
      projectId: string
      provider: 'claude-code' | 'codex' | 'opencode'
      secret: string | null
    }> = []
    const server = createLocalWebhookServer({
      getSessionSecret(sessionId) {
        return sessionId === 'session_demo_001' ? 'secret-1' : null
      },
      async authorizeHookRequest(input) {
        authorizationInputs.push(input)
        const sessionId = input.sessionId
        return sessionId === 'session_demo_001'
          ? { ok: true, lease: createActiveLease() }
          : { ok: false, reason: 'invalid_secret' }
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

    expect(response.statusCode).toBe(204)
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({
      event_type: 'claude-code.Stop',
      session_id: 'session_demo_001',
      project_id: 'project_demo',
      payload: {
        intent: 'agent.turn_completed',
        summary: 'Stop'
      }
    })
    expect(authorizationInputs).toEqual([{
      sessionId: 'session_demo_001',
      projectId: 'project_demo',
      provider: 'claude-code',
      secret: 'secret-1'
    }])
  })

  test('rejects Claude hook events when the project header does not match the active lease project', async () => {
    const accepted: CanonicalSessionEvent[] = []
    const server = createLocalWebhookServer({
      getSessionSecret(sessionId) {
        return sessionId === 'session_demo_001' ? 'secret-1' : null
      },
      authorizeHookRequest(input) {
        const sessionId = input.sessionId
        return sessionId === 'session_demo_001'
          ? { ok: true, lease: createActiveLease() }
          : { ok: false, reason: 'invalid_secret' }
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
        'x-stoa-project-id': 'wrong-project',
        'x-stoa-secret': 'secret-1'
      }
    )

    expect(response.statusCode).toBe(401)
    expect(accepted).toHaveLength(0)
  })

  test('accepts Claude hook events through lease-authoritative authorization even when getSessionSecret returns null', async () => {
    const accepted: CanonicalSessionEvent[] = []
    const server = createLocalWebhookServer({
      getSessionSecret() {
        return null
      },
      async authorizeHookRequest(input) {
        return input.sessionId === 'session_demo_001'
          ? { ok: true, lease: createActiveLease() }
          : { ok: false, reason: 'invalid_secret' }
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

    expect(response.statusCode).toBe(204)
    expect(accepted).toHaveLength(1)
  })

  describe('codex hook endpoint', () => {
    test('rejects codex hook posts without matching session secret', async () => {
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

      const response = await postCodexHook(
        port,
        { hook_event_name: 'SessionStart', session_id: 'codex-external-1' },
        {
          'x-stoa-session-id': 'session_demo_001',
          'x-stoa-project-id': 'project_demo',
          'x-stoa-secret': 'wrong-secret'
        }
      )

      expect(response.statusCode).toBe(401)
      expect(accepted).toHaveLength(0)
    })

    test('accepts codex hook events when session headers and secret match', async () => {
      const accepted: CanonicalSessionEvent[] = []
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_demo_001' ? 'secret-1' : null
        },
        authorizeHookRequest(input) {
          const sessionId = input.sessionId
          return sessionId === 'session_demo_001'
            ? { ok: true, lease: createActiveLease({ provider: 'codex' }) }
            : { ok: false, reason: 'invalid_secret' }
        },
        onEvent(event) {
          accepted.push(event)
        }
      })
      servers.push(server)
      const port = await server.start()

      const response = await postCodexHook(
        port,
        { hook_event_name: 'SessionStart', session_id: 'codex-external-1' },
        {
          'x-stoa-session-id': 'session_demo_001',
          'x-stoa-project-id': 'project_demo',
          'x-stoa-secret': 'secret-1'
        }
      )

      expect(response.statusCode).toBe(204)
      expect(accepted).toHaveLength(1)
      expect(accepted[0]).toMatchObject({
        event_type: 'codex.SessionStart',
        session_id: 'session_demo_001'
      })
    })

    test('rejects codex hook events when the endpoint provider does not match the active lease provider', async () => {
      const accepted: CanonicalSessionEvent[] = []
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_demo_001' ? 'secret-1' : null
        },
        authorizeHookRequest(input) {
          const sessionId = input.sessionId
          return sessionId === 'session_demo_001'
            ? { ok: true, lease: createActiveLease({ provider: 'claude-code' }) }
            : { ok: false, reason: 'invalid_secret' }
        },
        onEvent(event) {
          accepted.push(event)
        }
      })
      servers.push(server)
      const port = await server.start()

      const response = await postCodexHook(
        port,
        { hook_event_name: 'SessionStart', session_id: 'codex-external-1' },
        {
          'x-stoa-session-id': 'session_demo_001',
          'x-stoa-project-id': 'project_demo',
          'x-stoa-secret': 'secret-1'
        }
      )

      expect(response.statusCode).toBe(401)
      expect(accepted).toHaveLength(0)
    })

    test('returns ignored:true for unsupported codex hook events', async () => {
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

      const response = await postCodexHook(
        port,
        { hook_event_name: 'PostToolResult' },
        {
          'x-stoa-session-id': 'session_demo_001',
          'x-stoa-project-id': 'project_demo',
          'x-stoa-secret': 'secret-1'
        }
      )

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')
      expect(accepted).toHaveLength(0)
    })
  })
})
