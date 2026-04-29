import { readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { InMemoryObservationStore } from '@core/observation-store'
import { ObservabilityService } from '@core/observability-service'
import { ProjectSessionManager } from '@core/project-session-manager'
import { RuntimeStateStore } from '@core/memory/runtime-state-store'
import { TurnMaintenancePhaseError } from '@core/memory/turn-maintenance-runner'
import type { CanonicalSessionEvent, SessionStatePatchEvent } from '@shared/project-session'
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
      agentState: 'idle',
      hasUnseenCompletion: true,
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
      agentState: 'idle',
      hasUnseenCompletion: true,
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
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
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
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      summary: 'Turn complete',
      externalSessionId: undefined
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
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
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
        agentState: 'idle',
        hasUnseenCompletion: false,
        summary: 'Turn interrupted'
      }
    })
    const response = await postEvent(port, canonical, secret)

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith(
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.turn_interrupted',
        agentState: 'idle',
        hasUnseenCompletion: false,
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
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
    })
    expect(observability.getSessionPresence(session.id)).toMatchObject({
      sessionId: session.id,
      runtimeState: 'alive',
      agentState: 'idle',
      phase: 'complete',
      confidence: 'authoritative',
      recoveryPointerState: 'trusted'
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

    expect(response.statusCode).toBe(202)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(1)
    expect(controller.applyProviderStatePatch).toHaveBeenCalledWith({
      sessionId: 'session_1',
      sequence: 1,
      occurredAt: expect.any(String),
      intent: 'agent.turn_completed',
      source: 'provider',
      sourceEventType: 'claude-code.Stop',
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      summary: 'Stop',
      externalSessionId: undefined
    })
  })

  test('claude UserPromptSubmit hook returns Claude-compatible hookSpecificOutput when recall produces memory', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-recall-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-recall-workspace-')
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

    const bridge = new SessionEventBridge(
      manager,
      {
        applyProviderStatePatch: async (patch) => {
          await manager.applySessionStatePatch(patch)
        }
      },
      undefined,
      {
        evolverBridge: {
          warmStart: vi.fn(async () => null),
          recall: vi.fn(async () => ({
            content: 'Use uv instead of pip.',
            sourceRefs: [],
            selectionPolicy: 'test'
          })),
          observeWrite: vi.fn(async () => {})
        }
      }
    )
    bridges.push(bridge)

    const port = await bridge.start()
    const secret = bridge.issueSessionSecret(session.id)
    const response = await postClaudeHook(
      port,
      {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Install requests for this repository.'
      },
      {
        'x-stoa-secret': secret,
        'x-stoa-session-id': session.id,
        'x-stoa-project-id': project.id
      }
    )

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'Use uv instead of pip.'
      }
    })
  })

  test('claude PreToolUse after PermissionRequest infers permission resolved before resuming running state', async () => {
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

    expect((await postClaudeHook(port, { hook_event_name: 'PermissionRequest' }, headers)).statusCode).toBe(202)
    expect((await postClaudeHook(port, { hook_event_name: 'PreToolUse' }, headers)).statusCode).toBe(202)

    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(3)
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.permission_requested',
        sourceEventType: 'claude-code.PermissionRequest'
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.permission_resolved',
        sourceEventType: 'claude-code.PermissionResolvedInferred',
        agentState: 'working',
        summary: 'Permission resolved (inferred)'
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.tool_started',
        sourceEventType: 'claude-code.PreToolUse'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      agentState: 'working',
      blockingReason: null,
      hasUnseenCompletion: false,
      summary: 'PreToolUse'
    })
  })

  test('claude Stop after PermissionRequest infers permission resolved before completing the turn', async () => {
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

    expect((await postClaudeHook(port, { hook_event_name: 'PermissionRequest' }, headers)).statusCode).toBe(202)
    expect((await postClaudeHook(port, { hook_event_name: 'Stop' }, headers)).statusCode).toBe(202)

    expect(controller.applyProviderStatePatch).toHaveBeenCalledTimes(3)
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.permission_requested',
        sourceEventType: 'claude-code.PermissionRequest'
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.permission_resolved',
        sourceEventType: 'claude-code.PermissionResolvedInferred',
        agentState: 'working',
        summary: 'Permission resolved (inferred)'
      })
    )
    expect(controller.applyProviderStatePatch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining<Partial<SessionStatePatchEvent>>({
        intent: 'agent.turn_completed',
        sourceEventType: 'claude-code.Stop'
      })
    )
    expect(manager.snapshot().sessions.find(candidate => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      agentState: 'idle',
      blockingReason: null,
      hasUnseenCompletion: true,
      summary: 'Stop'
    })
  })

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
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
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
      runtimeState: undefined,
      agentState: 'idle',
      hasUnseenCompletion: true,
      runtimeExitCode: undefined,
      runtimeExitReason: undefined,
      blockingReason: undefined,
      summary: 'session.idle',
      externalSessionId: 'opencode-real-123'
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
  })

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
        runtimeState: undefined,
        agentState: 'idle',
        hasUnseenCompletion: true,
        runtimeExitCode: undefined,
        runtimeExitReason: undefined,
        blockingReason: undefined,
        summary: 'session.idle',
        externalSessionId: 'opencode-real-123'
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

  test('claude SessionStart calls warmStart and returns hook context', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-warm-start-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-warm-start-workspace-')
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

    const warmStart = vi.fn(async () => ({
      content: 'recent memory',
      sourceRefs: [],
      selectionPolicy: 'warm-start-v1'
    }))
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evolverBridge: {
        warmStart,
        recall: vi.fn(async () => null),
        observeWrite: vi.fn(async () => {})
      }
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

    expect(response.statusCode).toBe(200)
    expect(warmStart).toHaveBeenCalledOnce()
    expect(JSON.parse(response.body)).toMatchObject({
      hookSpecificOutput: {
        additionalContext: 'recent memory'
      }
    })
  })

  test('Stop seals the turn and dispatches the turn maintenance runner', async () => {
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

    const persistedEvidenceRef = {
      evidenceId: 'evt_stop_1',
      projectId: project.id,
      stoaSessionId: session.id,
      providerSessionId: session.externalSessionId,
      turnId: 'turn_stop_1',
      eventId: 'evt_stop_1',
      eventType: 'claude-code.Stop',
      evidenceKey: 'claude-code:provider-session-1:turn_stop_1',
      kind: 'turn-slice' as const,
      metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1', 'metadata.json'),
      path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1', 'turn-slice.json'),
      createdAt: '2026-04-29T00:00:00.000Z',
      toolName: null
    }
    const sealTurn = vi.fn(async () => {})
    const listEvidenceRefsForTurn = vi.fn(async () => [persistedEvidenceRef])
    const turnMaintenanceRunner = {
      run: vi.fn(async () => ({ jobId: 'job_turn_stop_1' }))
    }
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evidenceStore: {
        persist: async () => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_1'),
          metadataPath: persistedEvidenceRef.metadataPath,
          snapshotPath: persistedEvidenceRef.path,
          evidenceKey: persistedEvidenceRef.evidenceKey,
          evidenceRef: persistedEvidenceRef
        }),
        sealTurn,
        listEvidenceRefsForTurn
      },
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"stop"}', 'utf8')
      }),
      turnMaintenanceRunner
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

    expect(response.statusCode).toBe(202)
    expect(sealTurn).toHaveBeenCalledWith(workspaceDir, session.id, 'turn_stop_1', ['evt_stop_1'])
    await vi.waitFor(() => {
      expect(listEvidenceRefsForTurn).toHaveBeenCalledWith(workspaceDir, session.id, 'turn_stop_1')
      expect(turnMaintenanceRunner.run).toHaveBeenCalledWith({
        projectRoot: workspaceDir,
        stoaSessionId: session.id,
        providerSessionId: undefined,
        turnId: 'turn_stop_1',
        evidenceRefs: [persistedEvidenceRef]
      })
    })
  })

  test('Stop replaces the queued placeholder job when the runner reports a different real job id', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-real-job-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-real-job-workspace-')
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

    const persistedEvidenceRef = {
      evidenceId: 'evt_stop_real_job',
      projectId: project.id,
      stoaSessionId: session.id,
      providerSessionId: session.externalSessionId,
      turnId: 'turn_stop_real_job',
      eventId: 'evt_stop_real_job',
      eventType: 'claude-code.Stop',
      evidenceKey: 'claude-code:provider-session-1:turn_stop_real_job',
      kind: 'turn-slice' as const,
      metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_real_job', 'metadata.json'),
      path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_real_job', 'turn-slice.json'),
      createdAt: '2026-04-29T00:00:00.000Z',
      toolName: null
    }
    const turnMaintenanceRunner = {
      run: vi.fn(async () => ({ jobId: 'job_real_turn_stop_real_job' }))
    }
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evidenceStore: {
        persist: async () => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_real_job'),
          metadataPath: persistedEvidenceRef.metadataPath,
          snapshotPath: persistedEvidenceRef.path,
          evidenceKey: persistedEvidenceRef.evidenceKey,
          evidenceRef: persistedEvidenceRef
        }),
        sealTurn: async () => {},
        listEvidenceRefsForTurn: async () => [persistedEvidenceRef]
      },
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"stop"}', 'utf8')
      }),
      turnMaintenanceRunner
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

    expect(response.statusCode).toBe(202)

    const runtimeStateStore = new RuntimeStateStore(workspaceDir)
    const sessionKey = `${project.id}\n${session.id}`
    await vi.waitFor(async () => {
      await expect(runtimeStateStore.listJobsForSession(sessionKey)).resolves.toEqual([
        {
          jobId: 'job_real_turn_stop_real_job',
          sessionKey,
          turnId: 'turn_stop_real_job',
          state: 'done',
          updatedAt: expect.any(String)
        }
      ])
      await expect(runtimeStateStore.getJob('job_turn_stop_real_job')).resolves.toBeNull()
    })
  })

  test('Stop does not queue runtime jobs when no turn maintenance runner is configured', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-no-runner-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-no-runner-workspace-')
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

    const persistedEvidenceRef = {
      evidenceId: 'evt_stop_no_runner',
      projectId: project.id,
      stoaSessionId: session.id,
      providerSessionId: session.externalSessionId,
      turnId: 'turn_stop_no_runner',
      eventId: 'evt_stop_no_runner',
      eventType: 'claude-code.Stop',
      evidenceKey: 'claude-code:provider-session-1:turn_stop_no_runner',
      kind: 'turn-slice' as const,
      metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_no_runner', 'metadata.json'),
      path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_no_runner', 'turn-slice.json'),
      createdAt: '2026-04-29T00:00:00.000Z',
      toolName: null
    }
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evidenceStore: {
        persist: async () => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_no_runner'),
          metadataPath: persistedEvidenceRef.metadataPath,
          snapshotPath: persistedEvidenceRef.path,
          evidenceKey: persistedEvidenceRef.evidenceKey,
          evidenceRef: persistedEvidenceRef
        }),
        sealTurn: async () => {},
        listEvidenceRefsForTurn: vi.fn(async () => [persistedEvidenceRef])
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

    expect(response.statusCode).toBe(202)
    const runtimeStateStore = new RuntimeStateStore(workspaceDir)
    const sessionKey = `${project.id}\n${session.id}`
    await expect(runtimeStateStore.listJobsForSession(sessionKey)).resolves.toEqual([])
  })

  test('Stop replaces the queued placeholder job when turn maintenance fails with a real job id', async () => {
    const stateDir = await createTestTempDir('session-event-bridge-failed-job-state-')
    const workspaceDir = await createTestTempDir('session-event-bridge-failed-job-workspace-')
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

    const persistedEvidenceRef = {
      evidenceId: 'evt_stop_failed_job',
      projectId: project.id,
      stoaSessionId: session.id,
      providerSessionId: session.externalSessionId,
      turnId: 'turn_stop_failed_job',
      eventId: 'evt_stop_failed_job',
      eventType: 'claude-code.Stop',
      evidenceKey: 'claude-code:provider-session-1:turn_stop_failed_job',
      kind: 'turn-slice' as const,
      metadataPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_failed_job', 'metadata.json'),
      path: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_failed_job', 'turn-slice.json'),
      createdAt: '2026-04-29T00:00:00.000Z',
      toolName: null
    }
    const turnMaintenanceRunner = {
      run: vi.fn(async () => {
        throw new TurnMaintenancePhaseError('job_real_turn_stop_failed_job', 'distill failed', new Error('distill failed'))
      })
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bridge = new SessionEventBridge(manager, {
      applyProviderStatePatch: async () => {}
    }, undefined, {
      evidenceStore: {
        persist: async () => ({
          eventDirectoryPath: join(workspaceDir, '.stoa', 'memory', 'evidence', session.id, 'evt_stop_failed_job'),
          metadataPath: persistedEvidenceRef.metadataPath,
          snapshotPath: persistedEvidenceRef.path,
          evidenceKey: persistedEvidenceRef.evidenceKey,
          evidenceRef: persistedEvidenceRef
        }),
        sealTurn: async () => {},
        listEvidenceRefsForTurn: async () => [persistedEvidenceRef]
      },
      transcriptSnapshotter: async () => ({
        kind: 'turn-slice',
        fileName: 'turn-slice.json',
        content: Buffer.from('{"summary":"stop"}', 'utf8')
      }),
      turnMaintenanceRunner
    })
    bridges.push(bridge)

    try {
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

      expect(response.statusCode).toBe(202)

      const runtimeStateStore = new RuntimeStateStore(workspaceDir)
      const sessionKey = `${project.id}\n${session.id}`
      await vi.waitFor(async () => {
        await expect(runtimeStateStore.listJobsForSession(sessionKey)).resolves.toEqual([
          {
            jobId: 'job_real_turn_stop_failed_job',
            sessionKey,
            turnId: 'turn_stop_failed_job',
            state: 'failed',
            error: 'distill failed',
            updatedAt: expect.any(String)
          }
        ])
        await expect(runtimeStateStore.getJob('job_turn_stop_failed_job')).resolves.toBeNull()
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  test('main shutdown path awaits bridge stop before re-triggering quit', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

    expect(indexSource).toMatch(/app\.on\('before-quit', async \(event\) => \{/)
    expect(indexSource).toMatch(/event\.preventDefault\(\)/)
    expect(indexSource).toMatch(/await stopSessionEventBridge\(\)/)
    expect(indexSource).toMatch(/app\.quit\(\)/)
  })
})
