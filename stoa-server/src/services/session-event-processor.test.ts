import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanonicalSessionEvent } from 'stoa-shared'
import { createDb, type StoaDb } from '../db/connection'
import { ProjectSessionManager, type WsHubLike } from './project-session-manager'
import { SqliteBackend } from './persistence-backend'
import { SessionEventProcessor } from './session-event-processor'
import { RuntimeBridgeHandler } from '../ws/runtime-bridge-handler'

function makeWsHub() {
  const events: Array<{ type: string; payload: unknown }> = []
  const wsHub: WsHubLike = {
    broadcast: vi.fn((type: string, payload: unknown) => {
      events.push({ type, payload })
    })
  }
  return { wsHub, events }
}

function makeEvent(overrides: Partial<CanonicalSessionEvent>): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    event_type: 'codex.UserPromptSubmit',
    timestamp: '2026-06-14T00:00:00.000Z',
    session_id: 'session_1',
    project_id: 'project_1',
    source: 'hook-sidecar',
    payload: {
      intent: 'agent.turn_started',
      summary: 'Turn started',
      sourceTurnId: 'turn_1',
      externalSessionId: 'codex_external_1'
    },
    evidence: {
      rawSource: { provider: 'codex' },
      hookEventName: 'UserPromptSubmit',
      providerSessionId: 'codex_external_1',
      turnId: 'turn_1',
      promptText: 'Say hello',
      cwd: '/repo',
      model: 'gpt-5-codex'
    },
    ...overrides
  }
}

describe('SessionEventProcessor', () => {
  let db: StoaDb | null = null

  afterEach(() => {
    const raw = (db as unknown as { $client?: { close?: () => void } } | null)?.$client
    raw?.close?.()
    db = null
  })

  it('projects Codex hook turns into SR snapshot state and graph events', async () => {
    db = createDb(':memory:')
    const { wsHub, events } = makeWsHub()
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Codex Project',
      path: '/repo',
      defaultSessionType: 'codex'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex Session'
    })
    const processor = new SessionEventProcessor({
      manager,
      db,
      wsHub,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    await processor.processEvent(makeEvent({
      event_type: 'codex.SessionStart',
      session_id: session.id,
      project_id: project.id,
      payload: {
        intent: 'runtime.alive',
        summary: 'Session running',
        externalSessionId: 'codex_external_1'
      },
      evidence: {
        rawSource: { provider: 'codex' },
        hookEventName: 'SessionStart',
        providerSessionId: 'codex_external_1',
        sessionStartSource: 'startup',
        cwd: '/repo',
        model: 'gpt-5-codex'
      }
    }))
    await processor.processEvent(makeEvent({
      session_id: session.id,
      project_id: project.id
    }))

    const running = manager.snapshot().sessions.find((candidate) => candidate.id === session.id)
    expect(running).toMatchObject({
      runtimeState: 'alive',
      turnState: 'running',
      turnEpoch: 1,
      externalSessionId: 'codex_external_1'
    })
    expect(events.some((event) => event.type === 'session:graph')).toBe(true)

    await processor.processEvent(makeEvent({
      event_type: 'codex.Stop',
      session_id: session.id,
      project_id: project.id,
      payload: {
        intent: 'agent.turn_completed',
        summary: 'Turn completed',
        sourceTurnId: 'turn_1',
        externalSessionId: 'codex_external_1'
      },
      evidence: {
        rawSource: { provider: 'codex' },
        hookEventName: 'Stop',
        providerSessionId: 'codex_external_1',
        turnId: 'turn_1',
        lastAssistantMessage: 'Done',
        cwd: '/repo',
        model: 'gpt-5-codex'
      }
    }))

    const completed = manager.snapshot().sessions.find((candidate) => candidate.id === session.id)
    expect(completed).toMatchObject({
      runtimeState: 'alive',
      turnState: 'idle',
      lastTurnOutcome: 'completed',
      hasUnseenCompletion: true
    })
  })

  it('broadcasts runtime failure events as presence failure updates', async () => {
    db = createDb(':memory:')
    const { wsHub, events } = makeWsHub()
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Claude Project',
      path: '/repo',
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    const processor = new SessionEventProcessor({
      manager,
      db,
      wsHub,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    await processor.processEvent(makeEvent({
      event_type: 'runtime.exited_failed',
      session_id: session.id,
      project_id: project.id,
      payload: {
        intent: 'runtime.exited_failed',
        runtimeExitCode: 42,
        runtimeExitReason: 'failed',
        summary: 'Runtime failed'
      },
      evidence: {
        rawSource: { provider: 'claude-code' },
        cwd: '/repo',
        model: 'sonnet'
      }
    }))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'exited',
      runtimeExitCode: 42,
      runtimeExitReason: 'failed',
      failureReason: 'runtime_crash'
    })
    expect(events).toContainEqual({
      type: 'observability:presence',
      payload: {
        sessionId: session.id,
        projectId: project.id,
        phase: 'failure',
        intent: 'runtime.exited_failed',
        timestamp: '2026-06-14T00:00:00.000Z'
      }
    })
  })

  it('allocates provider event sequences above manager-authored state patches', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Claude Project',
      path: '/repo',
      defaultSessionType: 'claude-code'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude Session'
    })
    const processor = new SessionEventProcessor({
      manager,
      db,
      wsHub,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    await processor.processEvent(makeEvent({
      event_type: 'claude-code.UserPromptSubmit',
      session_id: session.id,
      project_id: project.id,
      payload: {
        intent: 'agent.turn_started',
        summary: 'Turn started',
        sourceTurnId: 'turn_1'
      }
    }))
    await processor.processEvent(makeEvent({
      event_type: 'claude-code.Stop',
      session_id: session.id,
      project_id: project.id,
      payload: {
        intent: 'agent.turn_completed',
        summary: 'Turn completed',
        sourceTurnId: 'turn_1'
      }
    }))
    await manager.setActiveSession(session.id)

    const afterUiPatch = manager.snapshot().sessions.find((candidate) => candidate.id === session.id)!
    expect(afterUiPatch).toMatchObject({
      hasUnseenCompletion: false
    })

    await processor.processEvent(makeEvent({
      event_type: 'runtime.exited_failed',
      session_id: session.id,
      project_id: project.id,
      payload: {
        intent: 'runtime.exited_failed',
        runtimeExitCode: 42,
        runtimeExitReason: 'failed',
        summary: 'Runtime failed'
      }
    }))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'exited',
      runtimeExitCode: 42,
      runtimeExitReason: 'failed',
      failureReason: 'runtime_crash',
      summary: 'Runtime failed',
      lastStateSequence: afterUiPatch.lastStateSequence + 1
    })
  })

  it('applies provider PTY exit state from the runtime bridge', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const providerWs = {
      send: vi.fn()
    }
    const provider = runtimeBridge.registerProvider(providerWs, { token: 'token' })
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'OpenCode Session'
    })
    await manager.markRuntimeAlive(session.id, null)
    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    runtimeBridge.handleMessage(provider.id, JSON.stringify({
      type: 'runtime:pty-state',
      sessionId: session.id,
      state: {
        alive: false,
        exitCode: 2,
        exitReason: 'failed'
      }
    }))

    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'exited',
      runtimeExitCode: 2,
      runtimeExitReason: 'failed',
      failureReason: 'runtime_crash'
    })
  })

  it('applies provider PTY alive state from the runtime bridge', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const provider = runtimeBridge.registerProvider({ send: vi.fn() }, { token: 'token' })
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'OpenCode Session',
      externalSessionId: 'opencode-ext-live'
    })
    await manager.markRuntimeExited(session.id, 1, 'previous exit')
    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    runtimeBridge.handleMessage(provider.id, JSON.stringify({
      type: 'runtime:pty-state',
      sessionId: session.id,
      state: {
        alive: true,
        startedAt: '2026-06-14T00:00:01.000Z'
      }
    }))

    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      runtimeExitCode: null,
      runtimeExitReason: null,
      failureReason: null,
      externalSessionId: 'opencode-ext-live'
    })
  })

  it('persists provider disconnect as exited state for orphaned sessions', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const providerWs = {
      send: vi.fn()
    }
    const provider = runtimeBridge.registerProvider(providerWs, { token: 'token' })
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'shell'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Shell Session'
    })
    await manager.markRuntimeAlive(session.id, null)
    runtimeBridge.assignSession(provider.id, session.id)

    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    runtimeBridge.removeProvider(provider.id)
    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'exited',
      runtimeExitCode: 0,
      runtimeExitReason: 'clean',
      summary: 'Runtime provider disconnected'
    })
  })

  it('restores alive state when a provider reconnects with a live PTY after disconnect', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'OpenCode Session',
      externalSessionId: 'opencode-ext-1'
    })
    await manager.markRuntimeAlive(session.id, 'opencode-ext-1')

    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    const firstProvider = runtimeBridge.registerProvider({ send: vi.fn() }, { token: 'token' })
    runtimeBridge.assignSession(firstProvider.id, session.id)
    runtimeBridge.removeProvider(firstProvider.id)
    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'exited',
      runtimeExitCode: 0,
      runtimeExitReason: 'clean',
      externalSessionId: 'opencode-ext-1'
    })

    const reconnectedProvider = runtimeBridge.registerProvider({ send: vi.fn() }, { token: 'token' })
    runtimeBridge.handleMessage(reconnectedProvider.id, JSON.stringify({
      type: 'runtime:state-sync',
      sessions: [{
        sessionId: session.id,
        state: {
          alive: true,
          startedAt: '2026-06-14T00:00:01.000Z'
        }
      }]
    }))
    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      runtimeExitCode: null,
      runtimeExitReason: null,
      failureReason: null,
      externalSessionId: 'opencode-ext-1'
    })
    expect(runtimeBridge.getProviderForSession(session.id)).toBe(reconnectedProvider)
  })

  it('does not revive archived sessions from provider alive state-sync', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'Archived OpenCode Session'
    })
    await manager.markRuntimeExited(session.id, 0, 'archived exit')
    await manager.archiveSession(session.id)

    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    const provider = runtimeBridge.registerProvider({ send: vi.fn() }, { token: 'token' })
    runtimeBridge.handleMessage(provider.id, JSON.stringify({
      type: 'runtime:state-sync',
      sessions: [{
        sessionId: session.id,
        state: {
          alive: true,
          startedAt: '2026-06-14T00:00:01.000Z'
        }
      }]
    }))
    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      archived: true,
      runtimeState: 'exited',
      runtimeExitCode: 0,
      runtimeExitReason: 'clean'
    })
  })

  it('serializes provider disconnect and reconnect state so late disconnect writes cannot overwrite live PTYs', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'OpenCode Session',
      externalSessionId: 'opencode-ext-race'
    })
    await manager.markRuntimeAlive(session.id, 'opencode-ext-race')

    const originalMarkRuntimeExited = manager.markRuntimeExited.bind(manager)
    let releaseExit!: () => void
    let exitStarted!: () => void
    const exitGate = new Promise<void>((resolve) => {
      releaseExit = resolve
    })
    const exitStartedPromise = new Promise<void>((resolve) => {
      exitStarted = resolve
    })
    vi.spyOn(manager, 'markRuntimeExited').mockImplementation(async (...args) => {
      exitStarted()
      await exitGate
      return await originalMarkRuntimeExited(...args)
    })

    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    const firstProvider = runtimeBridge.registerProvider({ send: vi.fn() }, { token: 'token' })
    runtimeBridge.assignSession(firstProvider.id, session.id)
    runtimeBridge.removeProvider(firstProvider.id)
    await exitStartedPromise

    const reconnectedProvider = runtimeBridge.registerProvider({ send: vi.fn() }, { token: 'token' })
    runtimeBridge.handleMessage(reconnectedProvider.id, JSON.stringify({
      type: 'runtime:state-sync',
      sessions: [{
        sessionId: session.id,
        state: {
          alive: true,
          startedAt: '2026-06-14T00:00:01.000Z'
        }
      }]
    }))

    releaseExit()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'alive',
      runtimeExitCode: null,
      runtimeExitReason: null,
      failureReason: null,
      externalSessionId: 'opencode-ext-race'
    })
    expect(runtimeBridge.getProviderForSession(session.id)).toBe(reconnectedProvider)
  })

  it('persists dead provider state-sync entries as exited state', async () => {
    db = createDb(':memory:')
    const { wsHub } = makeWsHub()
    const runtimeBridge = new RuntimeBridgeHandler()
    const providerWs = {
      send: vi.fn()
    }
    const provider = runtimeBridge.registerProvider(providerWs, { token: 'token' })
    const manager = await ProjectSessionManager.create(new SqliteBackend(db), {
      webhookPort: 43127,
      wsHub
    })
    const project = await manager.createProject({
      name: 'Runtime Project',
      path: '/repo',
      defaultSessionType: 'opencode'
    })
    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'OpenCode Session'
    })
    await manager.markRuntimeAlive(session.id, null)

    new SessionEventProcessor({
      manager,
      db,
      wsHub,
      runtimeBridge,
      nowIso: () => '2026-06-14T00:00:00.000Z'
    })

    runtimeBridge.handleMessage(provider.id, JSON.stringify({
      type: 'runtime:state-sync',
      sessions: [{
        sessionId: session.id,
        state: {
          alive: false,
          exitCode: 9,
          exitReason: 'failed'
        }
      }]
    }))
    await new Promise((resolve) => setImmediate(resolve))

    expect(manager.snapshot().sessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      runtimeState: 'exited',
      runtimeExitCode: 9,
      runtimeExitReason: 'failed',
      failureReason: 'runtime_crash',
      summary: 'Runtime provider state sync reported exit'
    })
    expect(runtimeBridge.getProviderForSession(session.id)).toBeNull()
  })
})
