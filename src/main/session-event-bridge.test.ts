import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import type { CanonicalSessionEvent } from '@shared/project-session'
import { SessionEventBridge } from './session-event-bridge'

const bridges: SessionEventBridge[] = []

function createCanonicalEvent(): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'evt_1',
    event_type: 'session.idle',
    timestamp: new Date().toISOString(),
    session_id: 'session_1',
    project_id: 'project_1',
    source: 'hook-sidecar',
    payload: {
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    }
  }
}

function createTurnCompleteEvent(): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'evt_turn_complete',
    event_type: 'session.idle',
    timestamp: new Date().toISOString(),
    session_id: 'session_1',
    project_id: 'project_1',
    source: 'hook-sidecar',
    payload: {
      status: 'turn_complete',
      summary: 'Turn complete'
    }
  }
}

async function postEvent(
  port: number,
  event: CanonicalSessionEvent,
  secret: string
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
          'x-stoa-secret': secret
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
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
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

describe('SessionEventBridge', () => {
  afterEach(async () => {
    await Promise.allSettled(bridges.splice(0).map(async (bridge) => bridge.stop()))
  })

  test('issuing a secret allows the same session event to reach applySessionEvent', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applySessionEvent: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postEvent(port, createCanonicalEvent(), secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applySessionEvent).toHaveBeenCalledWith({
      sessionId: 'session_1',
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
  })

  test('canonical turn_complete events reach applySessionEvent unchanged', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applySessionEvent: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postEvent(port, createTurnCompleteEvent(), secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applySessionEvent).toHaveBeenCalledWith({
      sessionId: 'session_1',
      status: 'turn_complete',
      summary: 'Turn complete',
      externalSessionId: undefined
    })
  })

  test('claude raw Stop hooks are adapted before reaching applySessionEvent', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applySessionEvent: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postClaudeHook(
      port,
      { hook_event_name: 'Stop' },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': 'session_1',
        'x-stoa-project-id': 'project_1'
      }
    )

    expect(response.statusCode).toBe(202)
    expect(controller.applySessionEvent).toHaveBeenCalledTimes(1)
    expect(controller.applySessionEvent).toHaveBeenCalledWith({
      sessionId: 'session_1',
      status: 'turn_complete',
      summary: 'Stop',
      externalSessionId: undefined
    })
  })

  test('main shutdown path awaits bridge stop before re-triggering quit', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

    expect(indexSource).toMatch(/app\.on\('before-quit', async \(event\) => \{/)
    expect(indexSource).toMatch(/event\.preventDefault\(\)/)
    expect(indexSource).toMatch(/await stopSessionEventBridge\(\)/)
    expect(indexSource).toMatch(/app\.quit\(\)/)
  })
})
