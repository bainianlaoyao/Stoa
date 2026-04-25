import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '@core/ipc-channels'
import { ProjectSessionManager } from '@core/project-session-manager'
import { readProjectSessions } from '@core/state-store'
import type { CanonicalSessionEvent, SessionSummaryEvent } from '@shared/project-session'
import { SessionRuntimeController } from '../../src/main/session-runtime-controller'
import { SessionEventBridge } from '../../src/main/session-event-bridge'
import {
  createMockWindow,
  createTestGlobalStatePath,
  createTestWorkspace
} from './helpers'

const bridges: SessionEventBridge[] = []

interface WebhookHarness {
  manager: ProjectSessionManager
  port: number
  secret: string
  sent: Array<{ channel: string; data: unknown }>
  session: {
    id: string
    projectId: string
    type: 'shell' | 'opencode' | 'codex' | 'claude-code'
  }
  workspaceDir: string
  globalStatePath: string
}

function createCanonicalEvent(
  sessionId: string,
  projectId: string,
  eventType: string,
  payload: CanonicalSessionEvent['payload']
): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: `evt_${randomUUID()}`,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    project_id: projectId,
    source: 'hook-sidecar',
    payload
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

async function postClaudeHook(
  port: number,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return await httpPost(port, '/hooks/claude-code', body, headers)
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

function getSessionEvents(sent: Array<{ channel: string; data: unknown }>): SessionSummaryEvent[] {
  return sent
    .filter(entry => entry.channel === IPC_CHANNELS.sessionEvent)
    .map(entry => {
      expect(entry.data).toEqual({
        session: expect.objectContaining({
          id: expect.any(String)
        })
      })
      expect(entry.data).not.toHaveProperty('sessionId')
      expect(entry.data).not.toHaveProperty('status')

      return entry.data as SessionSummaryEvent
    })
}

function getLatestSessionEvent(sent: Array<{ channel: string; data: unknown }>): SessionSummaryEvent | undefined {
  return getSessionEvents(sent).at(-1)
}

function getSessionState(manager: ProjectSessionManager, sessionId: string) {
  const session = manager.snapshot().sessions.find(candidate => candidate.id === sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found in manager snapshot`)
  }

  return session
}

async function createWebhookHarness(
  sessionType: 'shell' | 'opencode' | 'codex' | 'claude-code' = 'opencode'
): Promise<WebhookHarness> {
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
    type: sessionType,
    title: `Webhook Runtime ${sessionType}`
  })

  const { window, sent } = createMockWindow()
  const controller = new SessionRuntimeController(manager, () => window)
  const bridge = new SessionEventBridge(manager, controller)
  bridges.push(bridge)
  const port = await bridge.start()
  const secret = bridge.issueSessionSecret(session.id)

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
    await Promise.allSettled(bridges.splice(0).map(async bridge => bridge.stop()))
  })

  test('accepts the correct secret and pushes running state with provider externalSessionId through the bridge', async () => {
    const harness = await createWebhookHarness()
    const response = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.started',
        {
          intent: 'runtime.alive',
          runtimeState: 'alive',
          summary: 'event accepted',
          externalSessionId: 'opencode-real-123'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual({ accepted: true })

    await waitFor(() => getLatestSessionEvent(harness.sent)?.session.runtimeState === 'alive')

    expect(getLatestSessionEvent(harness.sent)).toEqual({
      session: expect.objectContaining({
        id: harness.session.id,
        runtimeState: 'alive',
        agentState: 'unknown',
        hasUnseenCompletion: false,
        summary: 'event accepted',
        externalSessionId: 'opencode-real-123'
      })
    })

    expect(getSessionState(harness.manager, harness.session.id).runtimeState).toBe('alive')
    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe('opencode-real-123')

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.runtime_state).toBe('alive')
    expect(persistedSession!.last_summary).toBe('event accepted')
    expect(persistedSession!.external_session_id).toBe('opencode-real-123')
  })

  test('rejects wrong and missing secrets without changing state or pushing IPC events', async () => {
    const harness = await createWebhookHarness()
    const initialDiskSessions = await readProjectSessions(harness.workspaceDir)
    const initialPersistedSession = initialDiskSessions.sessions.find(
      candidate => candidate.session_id === harness.session.id
    )

    expect(initialPersistedSession).toBeDefined()
    expect(initialPersistedSession!.runtime_state).toBe('created')
    expect(getSessionState(harness.manager, harness.session.id)).toMatchObject({
      runtimeState: 'created',
      agentState: 'unknown',
      summary: 'Waiting for session to start'
    })

    const wrongSecretResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.started',
        {
          intent: 'runtime.alive',
          runtimeState: 'alive',
          summary: 'should be rejected',
          externalSessionId: 'opencode-real-123'
        }
      ),
      { 'x-stoa-secret': 'wrong-secret' }
    )

    const missingSecretResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.started',
        {
          intent: 'runtime.alive',
          runtimeState: 'alive',
          summary: 'should also be rejected',
          externalSessionId: 'opencode-real-123'
        }
      )
    )

    expect(wrongSecretResponse.statusCode).toBe(401)
    expect(JSON.parse(wrongSecretResponse.body)).toEqual({ accepted: false, reason: 'invalid_secret' })
    expect(missingSecretResponse.statusCode).toBe(401)
    expect(JSON.parse(missingSecretResponse.body)).toEqual({ accepted: false, reason: 'invalid_secret' })

    expect(getSessionEvents(harness.sent)).toHaveLength(0)
    expect(getSessionState(harness.manager, harness.session.id)).toMatchObject({
      runtimeState: 'created',
      agentState: 'unknown',
      summary: 'Waiting for session to start'
    })

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.runtime_state).toBe('created')
    expect(persistedSession!.last_summary).toBe('Waiting for session to start')
    expect(persistedSession!.external_session_id).toBeNull()
  })

  test('idle webhook event persists agent completion state and the provider externalSessionId', async () => {
    const harness = await createWebhookHarness()

    const idleResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.idle',
        {
          intent: 'agent.turn_completed',
          agentState: 'idle',
          hasUnseenCompletion: true,
          summary: 'session.idle',
          externalSessionId: 'opencode-real-456'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    expect(idleResponse.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      return getLatestSessionEvent(harness.sent)?.session.agentState === 'idle'
        && getLatestSessionEvent(harness.sent)?.session.hasUnseenCompletion === true
        && persistedSession?.agent_state === 'idle'
    })

    expect(getLatestSessionEvent(harness.sent)).toEqual({
      session: expect.objectContaining({
        id: harness.session.id,
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'session.idle',
        externalSessionId: 'opencode-real-456'
      })
    })

    const idleDiskSessions = await readProjectSessions(harness.workspaceDir)
    const idlePersistedSession = idleDiskSessions.sessions.find(
      candidate => candidate.session_id === harness.session.id
    )

    expect(idlePersistedSession).toBeDefined()
    expect(idlePersistedSession!.agent_state).toBe('idle')
    expect(idlePersistedSession!.has_unseen_completion).toBe(true)
    expect(idlePersistedSession!.last_summary).toBe('session.idle')
    expect(idlePersistedSession!.external_session_id).toBe('opencode-real-456')
    expect(getSessionState(harness.manager, harness.session.id).agentState).toBe('idle')
    expect(getSessionState(harness.manager, harness.session.id).hasUnseenCompletion).toBe(true)
    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe('opencode-real-456')
  })

  test('running then exited webhook events persist final exited state through the bridge', async () => {
    const harness = await createWebhookHarness()

    const runningResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.started',
        {
          intent: 'runtime.alive',
          runtimeState: 'alive',
          summary: 'session.started',
          externalSessionId: 'opencode-real-789'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    expect(runningResponse.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      return getLatestSessionEvent(harness.sent)?.session.runtimeState === 'alive'
        && persistedSession?.last_summary === 'session.started'
    })

    const exitedResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.completed',
        {
          intent: 'runtime.exited_clean',
          runtimeState: 'exited',
          runtimeExitCode: 0,
          runtimeExitReason: 'clean',
          summary: 'session.completed',
          externalSessionId: 'opencode-real-789'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    expect(exitedResponse.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      return getLatestSessionEvent(harness.sent)?.session.runtimeState === 'exited'
        && getLatestSessionEvent(harness.sent)?.session.runtimeExitReason === 'clean'
        && persistedSession?.runtime_state === 'exited'
    })

    expect(getSessionEvents(harness.sent).map(event => ({
      runtimeState: event.session.runtimeState,
      runtimeExitReason: event.session.runtimeExitReason,
      summary: event.session.summary,
      externalSessionId: event.session.externalSessionId
    }))).toEqual([
      {
        runtimeState: 'alive',
        runtimeExitReason: null,
        summary: 'session.started',
        externalSessionId: 'opencode-real-789'
      },
      {
        runtimeState: 'exited',
        runtimeExitReason: 'clean',
        summary: 'session.completed',
        externalSessionId: 'opencode-real-789'
      }
    ])

    const exitedDiskSessions = await readProjectSessions(harness.workspaceDir)
    const exitedPersistedSession = exitedDiskSessions.sessions.find(
      candidate => candidate.session_id === harness.session.id
    )

    expect(exitedPersistedSession).toBeDefined()
    expect(exitedPersistedSession!.runtime_state).toBe('exited')
    expect(exitedPersistedSession!.runtime_exit_reason).toBe('clean')
    expect(exitedPersistedSession!.last_summary).toBe('session.completed')
    expect(exitedPersistedSession!.external_session_id).toBe('opencode-real-789')
    expect(getSessionState(harness.manager, harness.session.id).runtimeState).toBe('exited')
    expect(getSessionState(harness.manager, harness.session.id).runtimeExitReason).toBe('clean')
    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe('opencode-real-789')
  })

  test('canonical completion events persist and emit through the bridge', async () => {
    const harness = await createWebhookHarness('codex')

    const turnCompleteResponse = await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.idle',
        {
          intent: 'agent.turn_completed',
          agentState: 'idle',
          hasUnseenCompletion: true,
          summary: 'Turn complete',
          externalSessionId: 'codex-real-321'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    expect(turnCompleteResponse.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      return getLatestSessionEvent(harness.sent)?.session.agentState === 'idle'
        && getLatestSessionEvent(harness.sent)?.session.hasUnseenCompletion === true
        && persistedSession?.agent_state === 'idle'
    })

    expect(getLatestSessionEvent(harness.sent)).toEqual({
      session: expect.objectContaining({
        id: harness.session.id,
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Turn complete',
        externalSessionId: 'codex-real-321'
      })
    })

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.agent_state).toBe('idle')
    expect(persistedSession!.has_unseen_completion).toBe(true)
    expect(persistedSession!.last_summary).toBe('Turn complete')
    expect(persistedSession!.external_session_id).toBe('codex-real-321')
    expect(getSessionState(harness.manager, harness.session.id).agentState).toBe('idle')
    expect(getSessionState(harness.manager, harness.session.id).hasUnseenCompletion).toBe(true)
    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe('codex-real-321')
  })

  test('claude Stop hooks persist agent completion through the raw hook route', async () => {
    const harness = await createWebhookHarness('claude-code')
    const initialExternalSessionId = getSessionState(harness.manager, harness.session.id).externalSessionId

    const response = await postClaudeHook(
      harness.port,
      { hook_event_name: 'Stop' },
      {
        'x-stoa-secret': harness.secret,
        'x-stoa-session-id': harness.session.id,
        'x-stoa-project-id': harness.session.projectId
      }
    )

    expect(response.statusCode).toBe(202)

    await waitFor(async () => {
      const diskSessions = await readProjectSessions(harness.workspaceDir)
      const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
      return getLatestSessionEvent(harness.sent)?.session.agentState === 'idle'
        && getLatestSessionEvent(harness.sent)?.session.hasUnseenCompletion === true
        && persistedSession?.agent_state === 'idle'
    })

    expect(getLatestSessionEvent(harness.sent)).toEqual({
      session: expect.objectContaining({
        id: harness.session.id,
        agentState: 'idle',
        hasUnseenCompletion: true,
        summary: 'Stop',
        externalSessionId: initialExternalSessionId
      })
    })

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)

    expect(persistedSession).toBeDefined()
    expect(persistedSession!.agent_state).toBe('idle')
    expect(persistedSession!.has_unseen_completion).toBe(true)
    expect(persistedSession!.last_summary).toBe('Stop')
    expect(persistedSession!.external_session_id).toBe(initialExternalSessionId)
    expect(getSessionState(harness.manager, harness.session.id).agentState).toBe('idle')
    expect(getSessionState(harness.manager, harness.session.id).hasUnseenCompletion).toBe(true)
    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe(initialExternalSessionId)
  })

  test('reconciles externalSessionId when provider switches sessions mid-conversation', async () => {
    const harness = await createWebhookHarness('opencode')

    await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.started',
        {
          intent: 'runtime.alive',
          runtimeState: 'alive',
          summary: 'initial session',
          externalSessionId: 'original-session'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    await waitFor(() => getSessionEvents(harness.sent).length === 1)
    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe('original-session')

    await httpPost(
      harness.port,
      '/events',
      createCanonicalEvent(
        harness.session.id,
        harness.session.projectId,
        'session.started',
        {
          intent: 'runtime.alive',
          runtimeState: 'alive',
          summary: 'session resumed',
          externalSessionId: 'resumed-session-abc'
        }
      ),
      { 'x-stoa-secret': harness.secret }
    )

    await waitFor(() => getSessionEvents(harness.sent).length === 2)

    expect(getSessionState(harness.manager, harness.session.id).externalSessionId).toBe('resumed-session-abc')

    const events = getSessionEvents(harness.sent)
    expect(events[0]!.session.externalSessionId).toBe('original-session')
    expect(events[1]!.session.externalSessionId).toBe('resumed-session-abc')

    const diskSessions = await readProjectSessions(harness.workspaceDir)
    const persistedSession = diskSessions.sessions.find(candidate => candidate.session_id === harness.session.id)
    expect(persistedSession!.external_session_id).toBe('resumed-session-abc')
  })
})
