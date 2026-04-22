import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { readProjectSessions } from '@core/state-store'
import { createLocalWebhookServer, type LocalWebhookServer } from '@core/webhook-server'
import type { CanonicalSessionEvent, SessionStatusEvent } from '@shared/project-session'
import { SessionRuntimeController } from '../../src/main/session-runtime-controller'
import {
  createMockWindow,
  createTestGlobalStatePath,
  createTestWorkspace
} from './helpers'

const servers: LocalWebhookServer[] = []

interface WebhookHarness {
  manager: ProjectSessionManager
  port: number
  secret: string
  sent: Array<{ channel: string; data: unknown }>
  session: {
    id: string
    projectId: string
    type: 'shell' | 'opencode'
  }
  workspaceDir: string
  globalStatePath: string
}

function createCanonicalEvent(
  sessionId: string,
  projectId: string,
  status: 'running' | 'exited',
  summary: string
): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: `evt_${randomUUID()}`,
    event_type: status === 'running' ? 'session.started' : 'session.completed',
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    project_id: projectId,
    source: 'hook-sidecar',
    payload: {
      status,
      summary,
      isProvisional: false
    }
  }
}

async function httpPost(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers
        }
      },
      (response) => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
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

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now()

  while (!(await check())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for webhook runtime integration state')
    }

    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

function getSessionEvents(sent: Array<{ channel: string; data: unknown }>): SessionStatusEvent[] {
  return sent
    .filter(entry => entry.channel === IPC_CHANNELS.sessionEvent)
    .map(entry => entry.data as SessionStatusEvent)
}

function getSessionState(manager: ProjectSessionManager, sessionId: string) {
  const session = manager.snapshot().sessions.find(candidate => candidate.id === sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found in manager snapshot`)
  }

  return session
}

async function createWebhookHarness(): Promise<WebhookHarness> {
  const workspaceDir = await createTestWorkspace('stoa-e2e-webhook-runtime-')
  const globalStatePath = await createTestGlobalStatePath()

  const manager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath
  })

  const project = await manager.createProject({
    path: workspaceDir,
    name: 'webhook-runtime-test'
  })

  const session = await manager.createSession({
    projectId: project.id,
    type: 'shell',
    title: 'Webhook Runtime Shell'
  })

  const secret = `secret-${randomUUID()}`
  const secretsBySession = new Map<string, string>([[session.id, secret]])
  const { window, sent } = createMockWindow()
  const controller = new SessionRuntimeController(manager, () => window)

  const server = createLocalWebhookServer({
    getSessionSecret(sessionId) {
      return secretsBySession.get(sessionId) ?? null
    },
    async onEvent(event) {
      const currentSession = getSessionState(manager, event.session_id)

      if (event.payload.status === 'running') {
        await controller.markSessionRunning(event.session_id, currentSession.externalSessionId)
        return
      }

      if (event.payload.status === 'exited') {
        await controller.markSessionExited(event.session_id, event.payload.summary ?? '会话已退出')
        return
      }

      throw new Error(`Unsupported webhook status for test: ${event.payload.status ?? 'missing'}`)
    }
  })

  servers.push(server)
  const port = await server.start()

  return {
    manager,
    port,
    secret,
    sent,
    session: {
      id: session.id,
      projectId: project.id,
      type: session.type
    },
    workspaceDir,
    globalStatePath
  }
}

describe('E2E: webhook runtime integration', () => {
  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map(async server => server.stop()))
  })

  test('accepts the correct secret and pushes running state through the controller', async () => {
    const harness = await createWebhookHarness()
    const response = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(harness.session.id, harness.session.projectId, 'running', 'event accepted'),
      { 'x-stoa-secret': harness.secret }
    )

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual({ accepted: true })

    await waitFor(() => getSessionEvents(harness.sent).length === 1)

    expect(getSessionEvents(harness.sent)).toEqual([
      {
        sessionId: harness.session.id,
        status: 'running',
        summary: '会话运行中'
      }
    ])

    expect(getSessionState(harness.manager, harness.session.id).status).toBe('running')

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.last_known_status).toBe('running')
    expect(persistedSession!.last_summary).toBe('会话运行中')
  })

  test('rejects wrong and missing secrets without changing state or pushing IPC events', async () => {
    const harness = await createWebhookHarness()
    const initialDiskSessions = await readProjectSessions(harness.workspaceDir)
    const initialPersistedSession = initialDiskSessions.sessions.find(
      candidate => candidate.session_id === harness.session.id
    )

    expect(initialPersistedSession).toBeDefined()
    expect(initialPersistedSession!.last_known_status).toBe('bootstrapping')
    expect(getSessionState(harness.manager, harness.session.id).status).toBe('bootstrapping')

    const wrongSecretResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(harness.session.id, harness.session.projectId, 'running', 'should be rejected'),
      { 'x-stoa-secret': 'wrong-secret' }
    )

    const missingSecretResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(harness.session.id, harness.session.projectId, 'running', 'should also be rejected')
    )

    expect(wrongSecretResponse.statusCode).toBe(401)
    expect(JSON.parse(wrongSecretResponse.body)).toEqual({ accepted: false, reason: 'invalid_secret' })
    expect(missingSecretResponse.statusCode).toBe(401)
    expect(JSON.parse(missingSecretResponse.body)).toEqual({ accepted: false, reason: 'invalid_secret' })

    expect(getSessionEvents(harness.sent)).toHaveLength(0)
    expect(getSessionState(harness.manager, harness.session.id).status).toBe('bootstrapping')

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.last_known_status).toBe('bootstrapping')
    expect(persistedSession!.last_summary).toBe('等待会话启动')
  })

  test('pushes and persists running then exited transitions from webhook events', async () => {
    const harness = await createWebhookHarness()

    const runningResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(harness.session.id, harness.session.projectId, 'running', 'webhook says running'),
      { 'x-stoa-secret': harness.secret }
    )

    expect(runningResponse.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      return getSessionEvents(harness.sent).length === 1
        && persistedSession?.last_known_status === 'running'
    })

    expect(getSessionEvents(harness.sent)[0]).toEqual({
      sessionId: harness.session.id,
      status: 'running',
      summary: '会话运行中'
    })

    const runningDiskSessions = await readProjectSessions(harness.workspaceDir)
    const runningPersistedSession = runningDiskSessions.sessions.find(
      candidate => candidate.session_id === harness.session.id
    )

    expect(runningPersistedSession).toBeDefined()
    expect(runningPersistedSession!.last_known_status).toBe('running')

    const exitSummary = `${harness.session.type} 已退出 (0)`
    const exitedResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(harness.session.id, harness.session.projectId, 'exited', exitSummary),
      { 'x-stoa-secret': harness.secret }
    )

    expect(exitedResponse.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      const sessionEvents = getSessionEvents(harness.sent)
      return sessionEvents.length === 2
        && sessionEvents[1]?.status === 'exited'
        && persistedSession?.last_known_status === 'exited'
    })

    expect(getSessionEvents(harness.sent)).toEqual([
      {
        sessionId: harness.session.id,
        status: 'running',
        summary: '会话运行中'
      },
      {
        sessionId: harness.session.id,
        status: 'exited',
        summary: exitSummary
      }
    ])

    expect(getSessionState(harness.manager, harness.session.id).status).toBe('exited')

    const exitedDiskSessions = await readProjectSessions(harness.workspaceDir)
    const exitedPersistedSession = exitedDiskSessions.sessions.find(
      candidate => candidate.session_id === harness.session.id
    )

    expect(exitedPersistedSession).toBeDefined()
    expect(exitedPersistedSession!.last_known_status).toBe('exited')
    expect(exitedPersistedSession!.last_summary).toBe(exitSummary)
  })
})
