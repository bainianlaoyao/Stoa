import { readFileSync } from 'node:fs'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { InMemoryObservationStore } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import { MetaSessionCommandDispatcher } from '@core/meta-session-command-dispatcher'
import { MetaSessionContextAssembler } from '@core/meta-session-context-assembler'
import { createMetaSessionControlServer } from '@core/meta-session-control-server'
import { MetaSessionManager } from '@core/meta-session-manager'
import { MetaSessionProposalStore } from '@core/meta-session-proposal-store'
import { resolveMetaSessionStateFilePath } from '@core/meta-session-state-store'
import { TurnMaintenanceRunner } from '@core/memory/turn-maintenance-runner'
import type { CanonicalSessionEvent, SessionStatePatchEvent } from '@shared/project-session'
import type { MemoryNotificationEvent } from '@shared/project-session'
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
      intent: 'agent.turn_completed',
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    },
    ...overrides
  }
}

function createCompletionEvent(): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'evt_completion',
    event_type: 'session.idle',
    timestamp: new Date().toISOString(),
    session_id: 'session_1',
    project_id: 'project_1',
    source: 'hook-sidecar',
    payload: {
      intent: 'agent.turn_completed',
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

async function postCodexHook(
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

async function postOpenCodeHook(
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
        path: '/hooks/opencode',
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

async function postMemoryNotification(
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
        path: '/memory-notifications',
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

async function getPath(
  port: number,
  path: string,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers
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
    req.end()
  })
}

describe('SessionEventBridge', () => {
  afterEach(async () => {
    await Promise.allSettled(bridges.splice(0).map(async (bridge) => bridge.stop()))
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
  })

  test('issuing a secret allows the same session event to reach applyProviderStatePatch', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postEvent(port, createCanonicalEvent(), secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: 'session_1',
      sequence: 1,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'session.idle',
      turnEpoch: 1,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
  })

  test('forwards observation events to the optional observation tap before applying the provider patch', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const captureObservation = vi.fn(async () => {})
    const bridge = new SessionEventBridge(manager, controller, undefined, {
      captureObservation
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postEvent(port, createCanonicalEvent(), secret)

    expect(response.statusCode).toBe(202)
    expect(captureObservation).toHaveBeenCalledOnce()
    expect(captureObservation).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'session',
      sessionId: 'session_1',
      projectId: 'project_1'
    }))
    expect(controller.applyProviderStatePatch).toHaveBeenCalledOnce()
  })

  test('shared loopback server can expose meta session control routes via configureServerApp', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const proposalStore = new MetaSessionProposalStore()
    const metaSessionStateDir = await createTestTempDir('session-event-bridge-meta-session-state-')
    const metaSessionManager = await MetaSessionManager.create({
      statePath: resolveMetaSessionStateFilePath(join(metaSessionStateDir, 'global.json'))
    })
    const metaSession = await metaSessionManager.createSession({
      title: 'Global Triage',
      backendSessionType: 'claude-code',
      capabilityLevel: 3
    })
    const assembler = new MetaSessionContextAssembler({
      snapshotSource: manager,
      getSessionPresence() {
        return null
      },
      listSessionEvents() {
        return { events: [], nextCursor: null }
      },
      async getTerminalReplay() {
        return ''
      }
    })

    const bridge = new SessionEventBridge(manager, controller, undefined, {
      configureServerApp(app) {
        const dispatcher = new MetaSessionCommandDispatcher({
          snapshotSource: manager,
          sessionInput: {
            async send() {}
          },
          proposals: proposalStore
        })
        createMetaSessionControlServer({
          app,
          metaSessionSource: metaSessionManager,
          snapshotSource: manager,
          getSessionPresence() {
            return null
          },
          contextAssembler: assembler,
          dispatcher,
          proposals: proposalStore,
          workSessionLifecycle: {
            async createSession() {
              throw new Error('unused')
            },
            async archiveSession() {
              return null
            }
          }
        })
      }
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const response = await getPath(port, '/ctl/state/brief', {
      'x-stoa-session-id': metaSession.id
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      data: {
        activeProjectId: null,
        activeSessionId: null
      }
    })
  })

  test('canonical completion events reach applyProviderStatePatch unchanged', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postEvent(port, createCompletionEvent(), secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: 'session_1',
      sequence: 1,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'session.idle',
      turnEpoch: 1,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'Turn complete',
      externalSessionId: undefined
    })
  })

  test('submitCanonicalEvent maps Codex rollout task_started/task_complete into sequential running and complete patches', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-codex-rollout-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-codex-rollout-workspace-')
    tempDirs.push(stateDir, workspaceDir)

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'Codex Project',
      path: workspaceDir,
      defaultSessionType: 'codex'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session',
      externalSessionId: 'codex-real-321'
    })
    await manager.markRuntimeAlive(session.id, 'codex-real-321')

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    await bridge.submitCanonicalEvent({
      event_version: 1,
      event_id: 'evt_codex_rollout_started',
      event_type: 'codex.rollout.task_started',
      timestamp: '2026-05-10T09:19:07.257Z',
      session_id: session.id,
      project_id: project.id,
      source: 'provider-adapter',
      payload: {
        intent: 'agent.turn_started',
        sourceTurnId: 'turn_codex_1',
        summary: 'task_started',
        externalSessionId: 'codex-real-321'
      }
    })

    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        sessionId: session.id,
        intent: 'agent.turn_started',
        turnEpoch: 1,
        sourceTurnId: 'turn_codex_1',
        sourceEventType: 'codex.rollout.task_started',
        externalSessionId: 'codex-real-321'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'running',
      turnEpoch: 1,
      lastTurnOutcome: 'none'
    })

    await bridge.submitCanonicalEvent({
      event_version: 1,
      event_id: 'evt_codex_rollout_complete',
      event_type: 'codex.rollout.task_complete',
      timestamp: '2026-05-10T09:24:55.652Z',
      session_id: session.id,
      project_id: project.id,
      source: 'provider-adapter',
      payload: {
        intent: 'agent.turn_completed',
        sourceTurnId: 'turn_codex_1',
        summary: 'task_complete',
        externalSessionId: 'codex-real-321'
      }
    })

    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        sessionId: session.id,
        intent: 'agent.turn_completed',
        turnEpoch: 1,
        sourceTurnId: 'turn_codex_1',
        sourceEventType: 'codex.rollout.task_complete',
        externalSessionId: 'codex-real-321'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 1,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })
  })

  test('same-session provider events allocate increasing sequences when manager snapshot is stale', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const firstResponse = await postEvent(
      port,
      createCanonicalEvent({ event_id: 'evt_1', timestamp: '2026-01-01T00:00:01.000Z' }),
      secret
    )
    const secondResponse = await postEvent(
      port,
      createCanonicalEvent({ event_id: 'evt_2', timestamp: '2026-01-01T00:00:02.000Z' }),
      secret
    )

    expect(firstResponse.statusCode).toBe(202)
    expect(secondResponse.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(2)
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        sessionId: 'session_1',
        sequence: 1
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        sessionId: 'session_1',
        sequence: 2
      })
    )
  })

  test('unknown sourceTurnId on a terminal event does not open a brand-new turn after restart-like mapping loss', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-stale-turn-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-stale-turn-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, null)

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postEvent(
      port,
      createCanonicalEvent({
        session_id: session.id,
        project_id: project.id,
        event_id: 'evt_stale_stop',
        event_type: 'claude-code.Stop',
        source: 'provider-adapter',
        payload: {
          intent: 'agent.turn_completed',
          sourceTurnId: 'old-turn-1',
          summary: 'late stop'
        }
      }),
      secret
    )

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith(
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.turn_completed',
        turnEpoch: 0,
        sourceTurnId: 'old-turn-1'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 0,
      lastTurnOutcome: 'none',
      hasUnseenCompletion: false,
      summary: 'late stop'
    })
  })

  test('runtime.failed_to_start is ingested as failure presence, not startup lifecycle info', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const observability = {
      ingest: vi.fn(() => true)
    }
    const bridge = new SessionEventBridge(manager, controller, observability, {
      nowIso: () => '2026-01-01T00:00:12.000Z'
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const response = await postEvent(
      port,
      createCanonicalEvent({
        event_id: 'evt_failed_start',
        event_type: 'runtime.failed_to_start',
        source: 'system-recovery',
        payload: {
          intent: 'runtime.failed_to_start',
          failureReason: 'failed_to_start',
          runtimeExitCode: 1,
          runtimeExitReason: 'failed',
          summary: 'failed to start'
        }
      }),
      secret
    )

    expect(response.statusCode).toBe(202)
    expect(observability.ingest).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ObservationEvent>>({
        eventId: 'evt_failed_start',
        category: 'presence',
        type: 'presence.failure',
        severity: 'error',
        retention: 'critical'
      })
    )
  })

  test('same-session provider events apply in arrival order when the first apply is delayed', async () => {
    const manager = ProjectSessionManager.createForTest()
    const applyOrder: number[] = []
    let releaseFirstApply!: () => void
    let firstApplyStartedResolver!: () => void
    const firstApplyStarted = new Promise<void>((resolve) => {
      firstApplyStartedResolver = resolve
    })
    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        applyOrder.push(patch.sequence)
        if (patch.sequence === 1) {
          firstApplyStartedResolver()
          await new Promise<void>((release) => {
            releaseFirstApply = release
          })
        }
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const firstResponsePromise = postEvent(
      port,
      createCanonicalEvent({ event_id: 'evt_1', timestamp: '2026-01-01T00:00:01.000Z' }),
      secret
    )
    await firstApplyStarted
    const secondResponsePromise = postEvent(
      port,
      createCanonicalEvent({ event_id: 'evt_2', timestamp: '2026-01-01T00:00:02.000Z' }),
      secret
    )

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(applyOrder).toEqual([1])

    releaseFirstApply()
    const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise])

    expect(firstResponse.statusCode).toBe(202)
    expect(secondResponse.statusCode).toBe(202)
    expect(applyOrder).toEqual([1, 2])
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        sessionId: 'session_1',
        sequence: 1
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        sessionId: 'session_1',
        sequence: 2
      })
    )
  })

  test('claude SessionStart hook is accepted without returning lifecycle payload from the bridge', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-session-start-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-session-start-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session',
      externalSessionId: 'claude-external-maintenance-1'
    })
    await manager.markRuntimeAlive(session.id, 'claude-external-maintenance-1')

    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      { hook_event_name: 'SessionStart' },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
  })

  test('claude hook acceptance can be driven by lease-authoritative hook authorization without issuing a bridge secret', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-lease-auth-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-lease-auth-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller, undefined, {
      authorizeHookRequest: async (input) => {
        if (
          input.sessionId !== session.id
          || input.projectId !== project.id
          || input.provider !== 'claude-code'
          || input.secret !== 'lease-secret-1'
        ) {
          return { ok: false, reason: 'invalid_secret' }
        }

        return {
          ok: true,
          lease: {
            version: 1,
            sessionId: session.id,
            projectId: project.id,
            provider: 'claude-code',
            leaseState: 'active',
            ownerInstanceId: 'instance-a',
            generation: 1,
            webhookBaseUrl: 'http://127.0.0.1:43127',
            sessionSecret: 'lease-secret-1',
            createdAt: '2026-05-10T12:00:00.000Z',
            updatedAt: '2026-05-10T12:00:00.000Z',
            heartbeatAt: '2026-05-10T12:00:00.000Z',
            expiresAt: '2099-05-10T12:00:20.000Z',
            commitLockNonce: 'nonce-lease-1',
            commitToken: 'token-lease-1'
          }
        }
      }
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const response = await postClaudeHook(
      port,
      { hook_event_name: 'SessionStart' },
      {
        'x-stoa-secret': 'lease-secret-1',
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
  })

  test('claude SessionStart does not flip an alive session into running before any prompt', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-session-start-stateful-')
    const workspaceDir = await createTestTempDir('session-event-bridge-session-start-stateful-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      { hook_event_name: 'SessionStart', session_id: 'claude-external-1' },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 0,
      lastTurnOutcome: 'none',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: false
    })
  })

  test('codex Stop with mismatched external session id is ignored outside a trusted rebind window', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-codex-mismatch-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-codex-mismatch-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'codex'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session',
      externalSessionId: 'codex-root-1'
    })
    await manager.markRuntimeAlive(session.id, 'codex-root-1')
    await manager.applySessionStatePatch({
      sessionId: session.id,
      sequence: manager.snapshot().sessions.find(candidate => candidate.id === session.id)!.lastStateSequence + 1,
      occurredAt: '2026-05-16T10:00:00.000Z',
      intent: 'agent.turn_started',
      source: 'provider',
      sourceEventType: 'codex.UserPromptSubmit',
      turnEpoch: 1,
      sourceTurnId: 'turn-root-1',
      summary: 'root turn started',
      externalSessionId: 'codex-root-1'
    })

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postCodexHook(
      port,
      {
        hook_event_name: 'Stop',
        session_id: 'codex-subagent-1',
        turn_id: 'turn-subagent-1'
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(controller.applyProviderStatePatch).not.toHaveBeenCalled()
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'running',
      turnEpoch: 1,
      lastTurnOutcome: 'none',
      externalSessionId: 'codex-root-1'
    })
  })

  test('codex mismatched completion cannot override a user-interrupted session', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-codex-interrupt-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-codex-interrupt-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'codex'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session',
      externalSessionId: 'codex-root-2'
    })
    await manager.markRuntimeAlive(session.id, 'codex-root-2')
    await manager.applySessionStatePatch({
      sessionId: session.id,
      sequence: manager.snapshot().sessions.find(candidate => candidate.id === session.id)!.lastStateSequence + 1,
      occurredAt: '2026-05-16T10:01:00.000Z',
      intent: 'agent.turn_started',
      source: 'provider',
      sourceEventType: 'codex.UserPromptSubmit',
      turnEpoch: 1,
      sourceTurnId: 'turn-root-2',
      summary: 'root turn started',
      externalSessionId: 'codex-root-2'
    })
    await manager.markAgentTurnInterrupted(session.id, 'Interrupted by user')

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postCodexHook(
      port,
      {
        hook_event_name: 'Stop',
        session_id: 'codex-subagent-2',
        turn_id: 'turn-subagent-2'
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(controller.applyProviderStatePatch).not.toHaveBeenCalled()
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 1,
      lastTurnOutcome: 'interrupted',
      hasUnseenCompletion: false,
      externalSessionId: 'codex-root-2'
    })
  })

  test('codex SessionStart can rebind the external session id during a trusted resume launch', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-codex-rebind-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-codex-rebind-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'codex'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session',
      externalSessionId: 'codex-old-root'
    })
    await manager.markRuntimeAlive(session.id, 'codex-old-root')

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridge.registerCodexLaunchIntent(session.id, 'resume')
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postCodexHook(
      port,
      {
        hook_event_name: 'SessionStart',
        session_id: 'codex-new-root',
        source: 'resume'
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith(
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'runtime.alive',
        sourceEventType: 'codex.SessionStart',
        externalSessionId: 'codex-new-root'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      externalSessionId: 'codex-new-root'
    })
  })

  test('claude UserPromptSubmit no longer routes through an adapter recall hook', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-recall-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-recall-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'What quick check should I run first?'
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
  })

  test('forwards authenticated memory notifications to the registered callback', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-memory-notification-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-memory-notification-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })

    const notifications: MemoryNotificationEvent[] = []
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      nowIso: () => '2026-05-01T00:00:00.000Z',
      onMemoryNotification: (notification) => {
        notifications.push(notification)
      }
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postMemoryNotification(
      port,
      {
        kind: 'recall',
        status: 'success',
        title: 'Memory recalled',
        message: 'Evolver recalled recent memory for this session.'
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(202)
    expect(notifications).toEqual([
      expect.objectContaining<Partial<MemoryNotificationEvent>>({
        projectId: project.id,
        sessionId: session.id,
        kind: 'recall',
        status: 'success',
        title: 'Memory recalled',
        message: 'Evolver recalled recent memory for this session.',
        createdAt: '2026-05-01T00:00:00.000Z'
      })
    ])
  })

  test('canonical completion events also ingest an observability event', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
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
    const canonical = createCompletionEvent()
    const response = await postEvent(port, canonical, secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: 'session_1',
      sequence: 1,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'session.idle',
      turnEpoch: 1,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'Turn complete',
      externalSessionId: undefined
    })
    expect(observability.ingest).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ObservationEvent>>({
        eventId: 'evt_completion',
        eventVersion: 1,
        occurredAt: canonical.timestamp,
        ingestedAt: '2026-01-01T00:00:10.000Z',
        scope: 'session',
        projectId: 'project_1',
        sessionId: 'session_1',
        providerId: null,
        category: 'presence',
        type: 'presence.complete',
        severity: 'attention',
        retention: 'critical',
        sequence: 0,
        source: 'hook-sidecar',
        correlationId: null,
        dedupeKey: null,
        payload: {
          summary: 'Turn complete'
        }
      })
    )
  })

  test('canonical user interruption events are recorded as ready presence evidence', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const observability = {
      ingest: vi.fn(() => true)
    }
    const bridge = new SessionEventBridge(manager, controller, observability, {
      nowIso: () => '2026-01-01T00:00:11.000Z'
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret('session_1')
    const canonical = createCanonicalEvent({
      event_id: 'evt_interrupted',
      event_type: 'agent.turn_interrupted',
      payload: {
        intent: 'agent.turn_interrupted',
        summary: 'Turn interrupted'
      }
    })
    const response = await postEvent(port, canonical, secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith(
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.turn_interrupted',
        turnEpoch: 1,
        summary: 'Turn interrupted'
      })
    )
    expect(observability.ingest).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ObservationEvent>>({
        eventId: 'evt_interrupted',
        category: 'presence',
        type: 'presence.ready',
        severity: 'info',
        retention: 'operational'
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
    await manager.markRuntimeAlive(session.id, null)
    const observability = new ObservabilityService(new InMemoryObservationStore(), {
      nowIso: () => '2026-01-01T00:00:10.000Z'
    })
    observability.syncSessions(manager.snapshot().sessions, manager.snapshot().activeSessionId)
    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
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
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: session.id,
      sequence: 2,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'session.idle',
      turnEpoch: 1,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    expect(observability.getSessionPresence(session.id)).toMatchObject({
      sessionId: session.id,
      runtimeState: 'alive',
      turnState: 'idle',
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true,
      phase: 'complete',
      confidence: 'authoritative',
      recoveryPointerState: 'trusted'
    })
  })

  test('OpenCode message.updated after session.idle does not reopen the completed main turn', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-opencode-complete-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-opencode-complete-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'OpenCode Project',
      path: workspaceDir,
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'OpenCode Session',
      externalSessionId: 'opencode-real-456'
    })
    await manager.markRuntimeAlive(session.id, 'opencode-real-456')

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const headers = {
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': project.id
    }

    expect((await postOpenCodeHook(port, {
      hook_event_name: 'session.status',
      provider_session_id: 'opencode-real-456',
      session_status: 'busy'
    }, headers)).statusCode).toBe(204)

    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'running',
      turnEpoch: 1,
      lastTurnOutcome: 'none'
    })

    expect((await postOpenCodeHook(port, {
      hook_event_name: 'session.idle',
      provider_session_id: 'opencode-real-456'
    }, headers)).statusCode).toBe(204)

    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 1,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })

    expect((await postOpenCodeHook(port, {
      hook_event_name: 'message.updated',
      provider_session_id: 'opencode-real-456',
      message_id: 'assistant-message-after-idle'
    }, headers)).statusCode).toBe(204)

    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 1,
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })
  })

  test('claude raw Stop hooks are adapted before reaching applyProviderStatePatch', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
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

    expect(response.statusCode).toBe(204)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(1)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: 'session_1',
      sequence: 1,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'claude-code.Stop',
      turnEpoch: 0,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'Stop',
      externalSessionId: undefined
    })
  })

  test('claude PreToolUse after PermissionRequest keeps provider patch history and naturally clears blocked state once work resumes', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const headers = {
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': project.id
    }

    expect((await postClaudeHook(port, { hook_event_name: 'PermissionRequest' }, headers)).statusCode).toBe(204)
    expect((await postClaudeHook(port, { hook_event_name: 'PreToolUse' }, headers)).statusCode).toBe(204)

    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(2)
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.permission_requested',
        turnEpoch: 1,
        sourceEventType: 'claude-code.PermissionRequest'
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.tool_started',
        turnEpoch: 1,
        sourceEventType: 'claude-code.PreToolUse'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'running',
      turnEpoch: 1,
      lastTurnOutcome: 'none',
      blockingReason: null,
      hasUnseenCompletion: false,
      summary: 'PreToolUse'
    })
  }, 15_000)

  test('claude Stop after PermissionRequest clears blocked state through normal completion reduction', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const controller = {
      applyProviderStatePatch: vi.fn(async (patch: SessionStatePatchEvent) => {
        await manager.applySessionStatePatch(patch)
      })
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const headers = {
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': project.id
    }

    expect((await postClaudeHook(port, { hook_event_name: 'PermissionRequest' }, headers)).statusCode).toBe(204)
    expect((await postClaudeHook(port, {
      hook_event_name: 'Stop',
      transcript_path: join(workspaceDir, 'missing-transcript.jsonl')
    }, headers)).statusCode).toBe(204)

    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(2)
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.permission_requested',
        turnEpoch: 1,
        sourceEventType: 'claude-code.PermissionRequest'
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.turn_completed',
        turnEpoch: 1,
        sourceEventType: 'claude-code.Stop'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      turnEpoch: 1,
      lastTurnOutcome: 'completed',
      blockingReason: null,
      hasUnseenCompletion: true,
      summary: 'Stop'
    })
  }, 15_000)

  test('applies provider state patches without requiring observability ingestion', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-workspace-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({ name: 'Demo', path: workspaceDir })
    const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude' })
    await manager.markRuntimeAlive(session.id, 'external-1')

    const applied: SessionStatePatchEvent[] = []
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async (patch) => {
        applied.push(patch)
      }
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const headers = {
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': project.id
    }

    await postClaudeHook(port, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'call_123',
      model: 'claude-sonnet'
    }, headers)

    expect(applied.length).toBeGreaterThanOrEqual(1)
    expect(applied[0]!.intent).toBe('agent.tool_started')
  })

  test('forwards model and snippet as evidence metadata', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-evidence-')
    const workspaceDir = await createTestTempDir('session-event-bridge-evidence-ws-')
    tempDirs.push(stateDir, workspaceDir)
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({ name: 'Demo', path: workspaceDir })
    const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude' })
    await manager.markRuntimeAlive(session.id, 'external-1')

    const ingested: ObservationEvent[] = []
    const bridge = new SessionEventBridge(
      manager,
      {
        applyProviderStatePatch: async () => {}
      },
      {
        ingest: (event) => {
          ingested.push(event)
          return true
        }
      }
    )
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const headers = {
      'x-stoa-secret': secret,
      'x-stoa-session-id': session.id,
      'x-stoa-project-id': project.id
    }

    await postClaudeHook(port, {
      hook_event_name: 'Stop',
      session_id: 'claude-external-1',
      transcript_path: '/tmp/claude-transcript.jsonl',
      cwd: '/repo/app',
      last_assistant_message: 'Done with the task.'
    }, headers)

    const evidenceEvent = ingested.find(e => e.type === 'presence.complete')
    expect(evidenceEvent).toBeDefined()
    expect(evidenceEvent!.payload).toMatchObject({
      summary: 'Stop',
      snippet: 'Done with the task.',
      evidence: {
        rawSource: {
          provider: 'claude-code',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        hookEventName: 'Stop',
        providerSessionId: 'claude-external-1',
        transcriptPath: '/tmp/claude-transcript.jsonl',
        lastAssistantMessage: 'Done with the task.',
        cwd: '/repo/app'
      }
    })
  })

  test('forwards canonical notify evidence without changing the provider state patch', async () => {
    const manager = ProjectSessionManager.createForTest()
    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
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
    const canonical = createCanonicalEvent({
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'notify',
          rawEventName: 'agent-turn-complete'
        },
        providerSessionId: 'codex-thread-7',
        turnId: 'turn-7',
        cwd: '/repo/codex',
        inputMessages: ['Run the test suite'],
        lastAssistantMessage: 'Tests are green.'
      }
    })
    const response = await postEvent(port, canonical, secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: 'session_1',
      sequence: 1,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'session.idle',
      turnEpoch: 0,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    expect(observability.ingest).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ObservationEvent>>({
        payload: expect.objectContaining({
          summary: 'session.idle',
          evidence: {
            rawSource: {
              provider: 'codex',
              channel: 'notify',
              rawEventName: 'agent-turn-complete'
            },
            providerSessionId: 'codex-thread-7',
            turnId: 'turn-7',
            cwd: '/repo/codex',
            inputMessages: ['Run the test suite'],
            lastAssistantMessage: 'Tests are green.'
          }
        })
      })
    )
  })

  test('persists canonical evidence snapshots under the owning project without changing state patch behavior', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-store-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-store-workspace-')
    const otherWorkspaceDir = await createTestTempDir('session-event-bridge-store-other-workspace-')
    const transcriptPath = join(workspaceDir, 'provider-transcript.jsonl')
    tempDirs.push(stateDir, workspaceDir, otherWorkspaceDir)
    await writeFile(transcriptPath, '{"role":"assistant","content":"Fixed the evidence persistence."}\n', 'utf8')

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({ name: 'Demo', path: workspaceDir, defaultSessionType: 'codex' })
    const otherProject = await manager.createProject({ name: 'Other', path: otherWorkspaceDir, defaultSessionType: 'codex' })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session',
      externalSessionId: 'provider-session-bridge'
    })
    await manager.markRuntimeAlive(session.id, 'provider-session-bridge')

    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const bridge = new SessionEventBridge(manager, controller)
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postEvent(port, createCanonicalEvent({
      event_id: 'event-evidence-1',
      session_id: session.id,
      project_id: otherProject.id,
      payload: {
        intent: 'agent.turn_completed',
        summary: 'session.idle',
        externalSessionId: 'provider-session-bridge'
      },
      evidence: {
        rawSource: {
          provider: 'codex',
          channel: 'hook',
          rawEventName: 'Stop'
        },
        providerSessionId: 'provider-session-bridge',
        turnId: 'turn-evidence-1',
        transcriptPath,
        lastAssistantMessage: 'Fixed the evidence persistence.'
      }
    }), secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: session.id,
      sequence: 2,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'session.idle',
      turnEpoch: 0,
      sourceTurnId: undefined,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      failureReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'provider-session-bridge'
    })

    const evidenceDir = join(
      workspaceDir,
      '.stoa',
      'memory',
      'evidence',
      session.id,
      'event-evidence-1'
    )
    const metadata = JSON.parse(await readFile(join(evidenceDir, 'metadata.json'), 'utf8'))
    expect(metadata).toMatchObject({
      provider: 'codex',
      providerSessionId: 'provider-session-bridge',
      turnId: 'turn-evidence-1',
      evidenceKey: 'codex:provider-session-bridge:turn-evidence-1',
      transcriptPointer: transcriptPath,
      snapshot: {
        kind: 'provider-transcript',
        fileName: 'transcript.jsonl',
        sourceTranscriptPath: transcriptPath
      }
    })
    expect(await readFile(join(evidenceDir, 'transcript.jsonl'), 'utf8')).toBe(
      '{"role":"assistant","content":"Fixed the evidence persistence."}\n'
    )
  }, 15_000)

  test('evidence persistence failures are logged without blocking the provider state patch', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-persist-failure-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-persist-failure-workspace-')
    tempDirs.push(stateDir, workspaceDir)

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({ name: 'Demo', path: workspaceDir, defaultSessionType: 'codex' })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session',
      externalSessionId: 'provider-session-bridge'
    })
    await manager.markRuntimeAlive(session.id, 'provider-session-bridge')

    const controller = {
      applyProviderStatePatch: vi.fn(async () => {})
    }
    const evidenceStore = {
      persist: vi.fn(async () => {
        throw new Error('disk full')
      })
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bridge = new SessionEventBridge(manager, controller, undefined, {
      evidenceStore,
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"captured"}', 'utf8')
      })
    })
    bridges.push(bridge)

    try {
      const port = await bridge.start()
      const secret = bridge.issueSessionSecret(session.id)
      const response = await postEvent(port, createCanonicalEvent({
        event_id: 'event-evidence-failure',
        session_id: session.id,
        project_id: project.id,
        payload: {
          intent: 'agent.turn_completed',
          summary: 'session.idle',
          externalSessionId: 'provider-session-bridge'
        },
        evidence: {
          rawSource: {
            provider: 'codex',
            channel: 'hook',
            rawEventName: 'Stop'
          },
          providerSessionId: 'provider-session-bridge',
          lastAssistantMessage: 'Fixed the evidence persistence.'
        }
      }), secret)

      expect(response.statusCode).toBe(202)
      expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
        sessionId: session.id,
        sequence: 2,
        occurredAt: expect.any(String),
        intent: 'agent.turn_completed',
        source: 'provider',
        sourceEventType: 'session.idle',
        turnEpoch: 1,
        sourceTurnId: undefined,
        runtimeExitCode: undefined,
        runtimeExitReason: undefined,
        blockingReason: undefined,
        failureReason: undefined,
        summary: 'session.idle',
        externalSessionId: 'provider-session-bridge'
      })
      expect(evidenceStore.persist).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalledWith(
        `[session-event-bridge] Failed to persist evidence for session ${session.id} event event-evidence-failure:`,
        expect.any(Error)
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  test('Stop accepts the hook after persisting evidence and applying the provider patch', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-maintain-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-maintain-workspace-')
    tempDirs.push(stateDir, workspaceDir)

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evidenceStore: {
        persist: async () => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1'),
          metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1', 'metadata.json'),
          snapshotPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1', 'turn-slice.json'),
          evidenceKey: 'claude-code::evt_stop_1',
          evidenceRef: {
            evidenceId: 'evt_stop_1',
            projectId: project.id,
            stoaSessionId: session.id,
            providerSessionId: session.externalSessionId,
            turnId: 'turn_stop_1',
            eventId: 'evt_stop_1',
            eventType: 'claude-code.Stop',
            evidenceKey: 'claude-code::evt_stop_1',
            kind: 'turn-slice',
            metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1', 'metadata.json'),
            path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1', 'turn-slice.json'),
            createdAt: '2026-04-29T00:00:00.000Z',
            toolName: null
          }
        })
      },
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"stop"}', 'utf8')
      })
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      { hook_event_name: 'Stop' },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
  })

  test('captureEvidence=false preserves provider state patches without persisting evidence or running maintenance', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-no-capture-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-no-capture-workspace-')
    tempDirs.push(stateDir, workspaceDir)

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const applyProviderStatePatch = vi.fn(async () => {})
    const persist = vi.fn(async () => {
      throw new Error('persist should not be called when captureEvidence=false')
    })
    const run = vi.fn(async () => {
      throw new Error('turn maintenance should not run when captureEvidence=false')
    })

    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch
    }, undefined, {
      captureEvidence: false,
      evidenceStore: {
        persist
      },
      turnMaintenanceRunner: {
        run
      } as unknown as TurnMaintenanceRunner
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      { hook_event_name: 'Stop' },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(persist).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(applyProviderStatePatch).toHaveBeenCalledOnce()
    await expect(stat(join(workspaceDir, '.stoa', 'memory', 'evidence', session.id))).rejects.toThrow()
  })

  test('PostToolUse accepts the hook after persisting evidence and applying the provider patch', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-write-context-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-write-context-workspace-')
    tempDirs.push(stateDir, workspaceDir)

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evidenceStore: {
        persist: async ({ event }) => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, event.event_id),
          metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, event.event_id, 'metadata.json'),
          snapshotPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, event.event_id, 'turn-slice.json'),
          evidenceKey: `claude-code::${event.event_id}`,
          evidenceRef: {
            evidenceId: event.event_id,
            projectId: project.id,
            stoaSessionId: session.id,
            providerSessionId: session.externalSessionId,
            turnId: null,
            eventId: event.event_id,
            eventType: event.event_type,
            evidenceKey: `claude-code::${event.event_id}`,
            kind: 'turn-slice',
            metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, event.event_id, 'metadata.json'),
            path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, event.event_id, 'turn-slice.json'),
            createdAt: event.timestamp,
            toolName: null
          }
        })
      },
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"write"}', 'utf8')
      })
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: join(workspaceDir, 'note.txt'),
          content: 'error: test failed'
        }
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
  })

  test('Stop seals turn evidence and dispatches turn maintenance through the runner', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-runner-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-runner-workspace-')
    tempDirs.push(stateDir, workspaceDir)

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath: join(stateDir, 'global.json')
    })
    const project = await manager.createProject({
      name: 'P1',
      path: workspaceDir,
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    await manager.markRuntimeAlive(session.id, session.externalSessionId)

    const evidenceRef = {
      evidenceId: 'evt_stop_maintained',
      projectId: project.id,
      stoaSessionId: session.id,
      providerSessionId: 'claude-external-maintenance-1',
      turnId: 'turn_stop_maintained',
      eventId: 'evt_stop_maintained',
      eventType: 'claude-code.Stop',
      evidenceKey: 'claude-code:external:turn_stop_maintained',
      kind: 'turn-slice' as const,
      metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_maintained', 'metadata.json'),
      path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_maintained', 'turn-slice.json'),
      createdAt: '2026-04-29T00:00:00.000Z',
      toolName: null
    }

    let finishJob!: () => void
    const completedJob = new Promise<void>((resolve) => {
      finishJob = resolve
    })

    const runtimeStateStore = {
      recordSealedTurn: vi.fn(async () => {}),
      upsertJob: vi.fn(async (record: {
        jobId: string
        sessionKey: string
        turnId: string
        state: 'queued' | 'running' | 'done' | 'failed'
        error?: string
        updatedAt: string
      }) => {
        if (record.state === 'done') {
          finishJob()
        }
      }),
      replaceJob: vi.fn(async (_previousJobId: string, record: {
        jobId: string
        sessionKey: string
        turnId: string
        state: 'queued' | 'running' | 'done' | 'failed'
        error?: string
        updatedAt: string
      }) => {
        if (record.state === 'done') {
          finishJob()
        }
      })
    }

    const runner = new TurnMaintenanceRunner(
      {
        repoRoot: workspaceDir,
        stageTurn: async (input) => ({ jobId: `job_${input.turnId}` }),
        solidify: async () => {},
        prepareDistill: async () => ({ kind: 'none' }),
        completeDistill: async () => {}
      },
      {
        resolve: async () => ({
          invoke: async () => ({ content: 'unused' })
        })
      }
    )
    const runSpy = vi.spyOn(runner, 'run').mockResolvedValue({
      jobId: 'job_turn_stop_maintained'
    })

    const sealTurn = vi.fn(async () => {})
    const listEvidenceRefsForTurn = vi.fn(async () => [evidenceRef])
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      nowIso: () => '2026-05-01T00:00:00.000Z',
      evidenceStore: {
        persist: async () => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_maintained'),
          metadataPath: evidenceRef.metadataPath,
          snapshotPath: evidenceRef.path,
          evidenceKey: evidenceRef.evidenceKey,
          evidenceRef
        }),
        sealTurn,
        listEvidenceRefsForTurn
      },
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"stop"}', 'utf8')
      }),
      turnMaintenanceRunner: runner,
      createRuntimeStateStore: () => runtimeStateStore
    })
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      {
        hook_event_name: 'Stop',
        session_id: 'claude-external-maintenance-1',
        transcript_path: join(workspaceDir, 'missing-transcript.jsonl')
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(204)
    await completedJob

    expect(sealTurn).toHaveBeenCalledWith(
      workspaceDir,
      session.id,
      'turn_stop_maintained',
      ['evt_stop_maintained']
    )
    expect(listEvidenceRefsForTurn).toHaveBeenCalledWith(
      workspaceDir,
      session.id,
      'turn_stop_maintained'
    )
    expect(runtimeStateStore.recordSealedTurn).toHaveBeenCalledWith({
      sessionKey: `${project.id}\n${session.id}`,
      projectId: project.id,
      stoaSessionId: session.id,
      turnId: 'turn_stop_maintained',
      evidenceIds: ['evt_stop_maintained'],
      sealedAt: expect.any(String)
    })
    expect(runSpy).toHaveBeenCalledWith({
      projectId: project.id,
      projectRoot: workspaceDir,
      stoaSessionId: session.id,
      providerSessionId: 'claude-external-maintenance-1',
      turnId: 'turn_stop_maintained',
      evidenceRefs: [evidenceRef]
    })
    expect(runtimeStateStore.upsertJob).toHaveBeenCalledWith({
      jobId: 'job_turn_stop_maintained',
      sessionKey: `${project.id}\n${session.id}`,
      turnId: 'turn_stop_maintained',
      state: 'done',
      updatedAt: '2026-05-01T00:00:00.000Z'
    })
  })

  test('main shutdown path awaits bridge stop before re-triggering quit', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

    expect(indexSource).toMatch(/app\.on\('before-quit', async \(event\) => \{/)
    expect(indexSource).toMatch(/event\.preventDefault\(\)/)
    expect(indexSource).toMatch(/await ptyHost\?\.disposeAndWait\(\)/)
    expect(indexSource).toMatch(/await stopSessionEventBridge\(\)/)
    expect(indexSource).toMatch(/app\.quit\(\)/)
  })
})
