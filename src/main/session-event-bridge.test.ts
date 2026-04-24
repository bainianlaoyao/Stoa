import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { InMemoryObservationStore } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import type { CanonicalSessionEvent, SessionStatus } from '@shared/project-session'
import type { ObservationEvent } from '@shared/observability'
import { createTestTempDir } from '../../testing/test-temp'
import { SessionEventBridge } from './session-event-bridge'

const bridges: SessionEventBridge[] = []
const tempDirs: string[] = []

function createCanonicalEvent(overrides: Partial<CanonicalSessionEvent> = {}): CanonicalSessionEvent {
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
    },
    ...overrides
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
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
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

  test('canonical turn_complete events also ingest an observability event', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applySessionEvent: vi.fn(async () => {})
    }
    const observability = {
      ingest: vi.fn(() => true)
    }
    const bridge = new SessionEventBridge(manager, controller, observability, {
      nowIso: () => '2026-01-01T00:00:10.000Z'
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const canonical = createTurnCompleteEvent()
    const response = await postEvent(port, canonical, secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applySessionEvent).toHaveBeenCalledWith({
      sessionId: 'session_1',
      status: 'turn_complete',
      summary: 'Turn complete',
      externalSessionId: undefined
    })
    expect(observability.ingest).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ObservationEvent>>({
        eventId: 'evt_turn_complete',
        eventVersion: 1,
        occurredAt: canonical.timestamp,
        ingestedAt: '2026-01-01T00:00:10.000Z',
        scope: 'session',
        projectId: 'project_1',
        sessionId: 'session_1',
        providerId: null,
        category: 'presence',
        type: 'presence.turn_complete',
        severity: 'info',
        retention: 'operational',
        source: 'hook-sidecar',
        correlationId: null,
        dedupeKey: null,
        payload: {
          summary: 'Turn complete'
        }
      })
    )
  })

  test('canonical event externalSessionId is reflected in observability after manager apply and sync', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'S1',
      externalSessionId: null
    })
    await manager.applySessionEvent(session.id, 'running', 'Running', null)
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:10.000Z'
    })
    observability.syncSessions(manager.snapshot().sessions, manager.snapshot().activeSessionId)
    const controller = {
      applySessionEvent: vi.fn(async (appliedEvent: {
        sessionId: string
        status: SessionStatus
        summary: string
        externalSessionId?: string | null
      }) => {
        await manager.applySessionEvent(
          appliedEvent.sessionId,
          appliedEvent.status,
          appliedEvent.summary,
          appliedEvent.externalSessionId
        )
        const snapshot = manager.snapshot()
        observability.syncSessions(snapshot.sessions, snapshot.activeSessionId)
      })
    }
    const bridge = new SessionEventBridge(manager, controller, observability, {
      nowIso: () => '2026-01-01T00:00:10.000Z'
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postEvent(
      port,
      createCanonicalEvent({ session_id: session.id, project_id: project.id }),
      secret
    )

    expect(response.statusCode).toBe(202)
    expect(controller.applySessionEvent).toHaveBeenCalledWith({
      sessionId: session.id,
      status: 'awaiting_input',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    expect(observability.getSessionPresence(session.id)).toMatchObject({
      sessionId: session.id,
      canonicalStatus: 'awaiting_input',
      confidence: 'authoritative',
      recoveryPointerState: 'trusted'
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
