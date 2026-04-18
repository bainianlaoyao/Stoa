import { afterEach, describe, expect, test } from 'vitest'
import { createLocalWebhookServer } from './webhook-server'
import type { CanonicalWorkspaceEvent } from '@shared/workspace'

const servers: Array<ReturnType<typeof createLocalWebhookServer>> = []

function createEvent(): CanonicalWorkspaceEvent {
  return {
    event_version: 1,
    event_id: 'evt_webhook_1',
    event_type: 'session.started',
    timestamp: '2026-04-18T10:00:00.000Z',
    workspace_id: 'ws_demo_001',
    provider_id: 'opencode',
    session_id: 'chat-123',
    source: 'hook-sidecar',
    payload: {
      status: 'running',
      summary: 'event accepted',
      is_provisional: false
    }
  }
}

describe('local webhook server', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.stop()))
  })

  test('rejects event posts without a matching workspace secret', async () => {
    const accepted: CanonicalWorkspaceEvent[] = []
    const server = createLocalWebhookServer({
      getWorkspaceSecret(workspaceId) {
        return workspaceId === 'ws_demo_001' ? 'secret-1' : null
      },
      onEvent(event) {
        accepted.push(event)
      }
    })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(createEvent())
    })

    expect(response.status).toBe(401)
    expect(accepted).toHaveLength(0)
  })

  test('accepts canonical events when workspace secret matches', async () => {
    const accepted: CanonicalWorkspaceEvent[] = []
    const server = createLocalWebhookServer({
      getWorkspaceSecret(workspaceId) {
        return workspaceId === 'ws_demo_001' ? 'secret-1' : null
      },
      onEvent(event) {
        accepted.push(event)
      }
    })
    servers.push(server)
    const port = await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vibecoding-secret': 'secret-1'
      },
      body: JSON.stringify(createEvent())
    })

    expect(response.status).toBe(202)
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.event_id).toBe('evt_webhook_1')
  })
})
