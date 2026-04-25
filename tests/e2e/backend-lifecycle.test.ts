import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import { readGlobalState, readProjectSessions } from '@core/state-store'
import { createLocalWebhookServer } from '@core/webhook-server'
import type { LocalWebhookServer } from '@core/webhook-server'
import { startSessionRuntime } from '@core/session-runtime'
import { getProvider } from '@extensions/providers'
import type { ProviderCommand, CanonicalSessionEvent } from '@shared/project-session'
import {
  createTestWorkspace,
  createTestGlobalStatePath,
  readGlobalStateFile,
  tempDirs
} from './helpers'

function createMockPtyHost() {
  const calls: Array<{ runtimeId: string; command: ProviderCommand }> = []
  return {
    host: {
      start(runtimeId: string, command: ProviderCommand, _onData: (data: string) => void, onExit: (exitCode: number) => void) {
        calls.push({ runtimeId, command })
        return { runtimeId, sessionId: `shell-${randomUUID()}` }
      }
    },
    calls,
    lastCall() { return calls[calls.length - 1] }
  }
}

function createMockManager() {
  const log: Array<{ method: string; args: unknown[] }> = []
  return {
    manager: {
      async markRuntimeStarting(sessionId: string, summary: string, externalSessionId: string | null) {
        log.push({ method: 'markRuntimeStarting', args: [sessionId, summary, externalSessionId] })
      },
      async markRuntimeAlive(sessionId: string, externalSessionId: string | null) {
        log.push({ method: 'markRuntimeAlive', args: [sessionId, externalSessionId] })
      },
      async markRuntimeExited(sessionId: string, exitCode: number | null, summary: string) {
        log.push({ method: 'markRuntimeExited', args: [sessionId, exitCode, summary] })
      },
      async markRuntimeFailedToStart(sessionId: string, summary: string) {
        log.push({ method: 'markRuntimeFailedToStart', args: [sessionId, summary] })
      },
      async appendTerminalData(chunk: { sessionId: string; data: string }) {
        log.push({ method: 'appendTerminalData', args: [chunk] })
      }
    },
    log,
    methodNames() { return log.map(e => e.method) }
  }
}

function createCanonicalEvent(sessionId: string, projectId: string): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: `evt_${randomUUID()}`,
    event_type: 'session.started',
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    project_id: projectId,
    source: 'hook-sidecar',
    payload: {
      intent: 'agent.turn_started',
      agentState: 'working',
      summary: 'event accepted'
    }
  }
}

async function httpGet(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET' },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => { body += chunk })
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body })
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
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
        response.on('data', (chunk: string) => { data += chunk })
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

describe('E2E: Backend Full User Lifecycle', () => {
  // ── Phase 1: Fresh start → first project ──────────────────────────

  describe('Phase 1: Fresh start → first project', () => {
    test('starts with empty state when no state file exists', async () => {
      const globalStatePath = await createTestGlobalStatePath()
      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(0)
      expect(snapshot.sessions).toHaveLength(0)
      expect(snapshot.activeProjectId).toBeNull()
      expect(snapshot.activeSessionId).toBeNull()
    })

    test('creates first project in test_workspace with real directory', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({
        path: workspaceDir,
        name: 'test_workspace'
      })

      expect(project.name).toBe('test_workspace')
      expect(project.path).toBe(workspaceDir)
      expect(project.id).toMatch(/^project_/)

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(1)
    })

    test('auto-activates the first created project', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({
        path: workspaceDir,
        name: 'test_workspace'
      })

      const snapshot = manager.snapshot()
      expect(snapshot.activeProjectId).toBe(project.id)
    })

    test('persists project to global.json on disk', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({
        path: workspaceDir,
        name: 'test_workspace'
      })

      const diskState = await readGlobalStateFile(globalStatePath)
      expect(diskState.projects).toHaveLength(1)
      expect(diskState.projects[0]!.name).toBe('test_workspace')
      expect(diskState.projects[0]!.path).toBe(workspaceDir)
    })

    test('re-reading global.json yields identical project data', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({
        path: workspaceDir,
        name: 'test_workspace'
      })

      const diskState = await readGlobalStateFile(globalStatePath)
      expect(diskState.projects[0]!.project_id).toBe(project.id)
      expect(diskState.projects[0]!.name).toBe(project.name)
      expect(diskState.projects[0]!.path).toBe(project.path)
      expect(diskState.projects[0]!.created_at).toBe(project.createdAt)
    })
  })

  // ── Phase 2: Multi-project → session creation ─────────────────────

  describe('Phase 2: Multi-project → session creation', () => {
    test('creates second project in test_workspace2', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: workspace1, name: 'test_workspace' })
      const project2 = await manager.createProject({ path: workspace2, name: 'test_workspace2' })

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(2)
      expect(snapshot.projects[1]!.name).toBe('test_workspace2')
      expect(snapshot.projects[1]!.id).toBe(project2.id)
    })

    test('creates shell session under project 1', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Shell 1'
      })

      expect(session.projectId).toBe(project.id)
      expect(session.type).toBe('shell')
      expect(session.id).toMatch(/^session_/)
    })

    test('creates opencode session under project 2', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: workspace1, name: 'test_workspace' })
      const project2 = await manager.createProject({ path: workspace2, name: 'test_workspace2' })

      const session = await manager.createSession({
        projectId: project2.id,
        type: 'opencode',
        title: 'OpenCode 1'
      })

      expect(session.projectId).toBe(project2.id)
      expect(session.type).toBe('opencode')
    })

    test('shell session gets fresh-shell recovery mode', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Shell 1'
      })

      expect(session.recoveryMode).toBe('fresh-shell')
    })

    test('opencode session gets resume-external recovery mode', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'OpenCode 1'
      })

      expect(session.recoveryMode).toBe('resume-external')
    })

    test('new session becomes active and switches active project', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project1 = await manager.createProject({ path: workspace1, name: 'test_workspace' })
      const project2 = await manager.createProject({ path: workspace2, name: 'test_workspace2' })

      expect(manager.snapshot().activeProjectId).toBe(project1.id)

      const session2 = await manager.createSession({
        projectId: project2.id,
        type: 'opencode',
        title: 'OpenCode in P2'
      })

      const snapshot = manager.snapshot()
      expect(snapshot.activeProjectId).toBe(project2.id)
      expect(snapshot.activeSessionId).toBe(session2.id)
    })

    test('all data persisted correctly to global.json plus per-project sessions.json files', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project1 = await manager.createProject({ path: workspace1, name: 'test_workspace' })
      const project2 = await manager.createProject({ path: workspace2, name: 'test_workspace2' })
      await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell 1' })
      await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'OpenCode 1' })

      const snapshot = manager.snapshot()
      const diskGlobal = await readGlobalStateFile(globalStatePath)
      const diskSessions1 = await readProjectSessions(workspace1)
      const diskSessions2 = await readProjectSessions(workspace2)

      expect(snapshot.projects).toHaveLength(2)
      expect(diskGlobal.projects).toHaveLength(2)
      expect(snapshot.sessions).toHaveLength(2)
      expect(diskSessions1.sessions).toHaveLength(1)
      expect(diskSessions2.sessions).toHaveLength(1)
      expect(diskGlobal.projects[0]!.name).toBe('test_workspace')
      expect(diskGlobal.projects[1]!.name).toBe('test_workspace2')
    })
  })

  // ── Phase 3: State persistence and recovery ───────────────────────

  describe('Phase 3: State persistence and recovery', () => {
    test('snapshot returns immutable copies (mutation-safe)', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })

      const snap1 = manager.snapshot()
      snap1.projects[0]!.name = 'mutated'
      snap1.sessions[0]!.summary = 'changed'

      const snap2 = manager.snapshot()
      expect(snap2.projects[0]!.name).toBe('test_workspace')
      expect(snap2.sessions[0]!.summary).toBe('Waiting for session to start')
    })

    test('destroying and recreating manager restores all projects', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: workspace1, name: 'test_workspace' })
      await manager.createProject({ path: workspace2, name: 'test_workspace2' })

      const restored = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = restored.snapshot()
      expect(snapshot.projects).toHaveLength(2)
      expect(snapshot.projects[0]!.name).toBe('test_workspace')
      expect(snapshot.projects[1]!.name).toBe('test_workspace2')
    })

    test('destroying and recreating manager restores all sessions', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })
      await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode 1', externalSessionId: 'ext-abc' })

      const restored = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = restored.snapshot()
      expect(snapshot.sessions).toHaveLength(2)
      expect(snapshot.sessions[0]!.type).toBe('shell')
      expect(snapshot.sessions[1]!.type).toBe('opencode')
      expect(snapshot.sessions[1]!.externalSessionId).toBe('ext-abc')
    })

    test('active IDs are preserved across restart', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project1 = await manager.createProject({ path: workspace1, name: 'test_workspace' })
      const project2 = await manager.createProject({ path: workspace2, name: 'test_workspace2' })
      const session = await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'OpenCode 1' })

      const restored = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const diskState = await readGlobalStateFile(globalStatePath)
      const snapshot = restored.snapshot()

      expect(snapshot.activeProjectId).toBe(project2.id)
      expect(snapshot.activeSessionId).toBe(session.id)
      expect(diskState.active_project_id).toBe(project2.id)
      expect(diskState.active_session_id).toBe(session.id)
    })

    test('buildBootstrapRecoveryPlan returns correct actions', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      const shell = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })
      const opencode = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode 1', externalSessionId: 'ext-xyz' })

      const plan = manager.buildBootstrapRecoveryPlan()

      expect(plan).toHaveLength(2)
      expect(plan[0]!.sessionId).toBe(shell.id)
      expect(plan[0]!.action).toBe('fresh-shell')
      expect(plan[1]!.sessionId).toBe(opencode.id)
      expect(plan[1]!.action).toBe('resume-external')
    })

    test('recovery plan: shell → fresh-shell, opencode → resume-external', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })
      await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode 1' })

      const plan = manager.buildBootstrapRecoveryPlan()

      expect(plan[0]!.action).toBe('fresh-shell')
      expect(plan[1]!.action).toBe('resume-external')
    })

    test('recovery plan includes correct externalSessionId for opencode sessions', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OpenCode 1', externalSessionId: 'ext-session-999' })

      const plan = manager.buildBootstrapRecoveryPlan()

      expect(plan).toHaveLength(1)
      expect(plan[0]!.action).toBe('resume-external')
      if (plan[0]!.action === 'resume-external') {
        expect(plan[0]!.externalSessionId).toBe('ext-session-999')
      }
    })
  })

  // ── Phase 4: Active project/session management ────────────────────

  describe('Phase 4: Active project/session management', () => {
    test('creating session auto-sets both activeProjectId and activeSessionId', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      expect(manager.snapshot().activeProjectId).toBe(project.id)
      expect(manager.snapshot().activeSessionId).toBeNull()

      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Shell 1'
      })

      const snapshot = manager.snapshot()
      expect(snapshot.activeProjectId).toBe(project.id)
      expect(snapshot.activeSessionId).toBe(session.id)
    })

    test('switching between sessions in different projects updates both active IDs', async () => {
      const workspace1 = await createTestWorkspace('stoa-e2e-test_workspace-')
      const workspace2 = await createTestWorkspace('stoa-e2e-test_workspace2-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project1 = await manager.createProject({ path: workspace1, name: 'test_workspace' })
      const project2 = await manager.createProject({ path: workspace2, name: 'test_workspace2' })

      const session1 = await manager.createSession({ projectId: project1.id, type: 'shell', title: 'Shell P1' })
      expect(manager.snapshot().activeProjectId).toBe(project1.id)
      expect(manager.snapshot().activeSessionId).toBe(session1.id)

      const session2 = await manager.createSession({ projectId: project2.id, type: 'opencode', title: 'OpenCode P2' })
      expect(manager.snapshot().activeProjectId).toBe(project2.id)
      expect(manager.snapshot().activeSessionId).toBe(session2.id)
    })

    test('first project auto-activates when no active project exists', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-test_workspace-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      expect(manager.snapshot().activeProjectId).toBeNull()

      const project = await manager.createProject({ path: workspaceDir, name: 'test_workspace' })
      expect(manager.snapshot().activeProjectId).toBe(project.id)
    })
  })

  // ── Phase 5: Webhook server integration ───────────────────────────

  describe('Phase 5: Webhook server integration', () => {
    const activeServers: LocalWebhookServer[] = []

    afterEach(async () => {
      await Promise.allSettled(activeServers.splice(0).map(s => s.stop()))
    })

    test('webhook server starts on ephemeral port', async () => {
      const server = createLocalWebhookServer()
      activeServers.push(server)

      const port = await server.start()
      expect(port).toBeGreaterThan(0)
      expect(port).toBeLessThan(65536)
    })

    test('health endpoint returns { ok: true }', async () => {
      const server = createLocalWebhookServer()
      activeServers.push(server)
      const port = await server.start()

      const response = await httpGet(port, '/health')
      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.body) as { ok: boolean }
      expect(body.ok).toBe(true)
    })

    test('accepts canonical event with correct secret', async () => {
      const accepted: CanonicalSessionEvent[] = []
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_demo_001' ? 'my-secret' : null
        },
        onEvent(event) {
          accepted.push(event)
        }
      })
      activeServers.push(server)
      const port = await server.start()

      const event = createCanonicalEvent('session_demo_001', 'project_demo')
      const response = await httpPost(port, '/events', event, { 'x-stoa-secret': 'my-secret' })

      expect(response.statusCode).toBe(202)
      expect(accepted).toHaveLength(1)
      expect(accepted[0]!.event_id).toBe(event.event_id)
    })

    test('rejects event without matching secret', async () => {
      const accepted: CanonicalSessionEvent[] = []
      const server = createLocalWebhookServer({
        getSessionSecret(sessionId) {
          return sessionId === 'session_demo_001' ? 'my-secret' : null
        },
        onEvent(event) {
          accepted.push(event)
        }
      })
      activeServers.push(server)
      const port = await server.start()

      const event = createCanonicalEvent('session_demo_001', 'project_demo')
      const response = await httpPost(port, '/events', event)

      expect(response.statusCode).toBe(401)
      expect(accepted).toHaveLength(0)
    })

    test('rejects malformed event body', async () => {
      const server = createLocalWebhookServer()
      activeServers.push(server)
      const port = await server.start()

      const response = await httpPost(port, '/events', { garbage: true })

      expect(response.statusCode).toBe(400)
    })
  })

  // ── Phase 6: Session runtime integration (with mock PTY) ──────────

  describe('Phase 6: Session runtime integration (with mock PTY)', () => {
    test('startSessionRuntime calls markRuntimeStarting then markRuntimeAlive', async () => {
      const provider = getProvider('opencode')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_test_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'Test',
          type: 'opencode',
          status: 'bootstrapping',
          externalSessionId: null
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager
      })

      expect(mock.methodNames()).toEqual([
        'markRuntimeStarting',
        'markRuntimeAlive'
      ])
      expect(mock.log[0]!.method).toBe('markRuntimeStarting')
      expect(mock.log[1]!.method).toBe('markRuntimeAlive')
    })

    test('shell session: uses buildStartCommand (never resume)', async () => {
      const provider = getProvider('local-shell')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_shell_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'Shell Test',
          type: 'shell',
          status: 'bootstrapping',
          externalSessionId: null
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager
      })

      const command = pty.lastCall()!.command
      const expectedShell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
      expect(command.command).toBe(expectedShell)
      expect(command.args).toEqual([])
    })

    test('opencode session without externalSessionId: uses buildStartCommand', async () => {
      const provider = getProvider('opencode')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_op_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'OpenCode Test',
          type: 'opencode',
          status: 'bootstrapping',
          externalSessionId: null
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager
      })

      const command = pty.lastCall()!.command
      expect(command.args).toEqual([])
      expect(command.args).not.toContain('--session')
    })

    test('opencode session with externalSessionId: uses buildResumeCommand', async () => {
      const provider = getProvider('opencode')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_op_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'OpenCode Resume',
          type: 'opencode',
          status: 'running',
          externalSessionId: 'ext-123'
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager
      })

      const command = pty.lastCall()!.command
      expect(command.args).toEqual(['--session', 'ext-123'])
    })

    test('opencode session launches through configured user shell when shellPath is provided', async () => {
      const provider = getProvider('opencode')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_op_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'OpenCode Test',
          type: 'opencode',
          status: 'bootstrapping',
          externalSessionId: null
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager,
        shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      })

      const command = pty.lastCall()!.command
      expect(command.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      expect(command.args).toContain('-Command')
    })

    test('opencode session bridges cmd shell with .ps1 provider path through powershell', async () => {
      const provider = getProvider('opencode')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_op_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'OpenCode Test',
          type: 'opencode',
          status: 'bootstrapping',
          externalSessionId: null
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager,
        shellPath: 'C:\\Windows\\System32\\cmd.exe',
        providerPath: 'C:\\Users\\test\\AppData\\Roaming\\npm\\opencode.ps1'
      })

      const command = pty.lastCall()!.command
      expect(command.command).toBe('C:\\Windows\\System32\\cmd.exe')
      expect(command.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
      expect(command.args[3]).toContain('powershell.exe')
      expect(command.args[3]).toContain('opencode.ps1')
    })

    test('fresh start preserves existing externalSessionId during runtime transition', async () => {
      const provider = getProvider('opencode')
      const pty = createMockPtyHost()
      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_op_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'OpenCode Test',
          type: 'opencode',
          status: 'needs_confirmation',
          externalSessionId: 'stale-ext'
        },
        webhookPort: 43127,
        provider,
        ptyHost: pty.host,
        manager: mock.manager
      })

      const startingLog = mock.log.find(entry => entry.method === 'markRuntimeStarting')
      const runningLog = mock.log.find(entry => entry.method === 'markRuntimeAlive')
      expect(startingLog?.args[2]).toBe('stale-ext')
      expect(runningLog?.args[1]).toBe('stale-ext')
    })

    test('PTY exit callback triggers markRuntimeExited', async () => {
      const provider = getProvider('local-shell')
      let exitCallback: ((exitCode: number) => void) | undefined

      const ptyHost = {
        start(runtimeId: string, command: ProviderCommand, _onData: (data: string) => void, onExit: (exitCode: number) => void) {
          exitCallback = onExit
          return { runtimeId, sessionId: `pty-${randomUUID()}` }
        }
      }

      const mock = createMockManager()

      await startSessionRuntime({
        session: {
          id: 'session_shell_1',
          projectId: 'project_test',
          path: 'D:/demo',
          title: 'Shell Test',
          type: 'shell',
          status: 'bootstrapping',
          externalSessionId: null
        },
        webhookPort: 43127,
        provider,
        ptyHost,
        manager: mock.manager
      })

      expect(exitCallback).toBeDefined()
      exitCallback!(0)

      expect(mock.methodNames()).toContain('markRuntimeExited')
      const exitLog = mock.log.find(e => e.method === 'markRuntimeExited')
      expect(exitLog!.args[0]).toBe('session_shell_1')
      expect(exitLog!.args[1]).toBe(0)
      expect(exitLog!.args[2]).toMatch(/exited/)
    })
  })

  // ── Phase 7: Provider integration ─────────────────────────────────

  describe('Phase 7: Provider integration', () => {
    test('local-shell provider: buildStartCommand returns platform shell', async () => {
      const provider = getProvider('local-shell')
      const command = await provider.buildStartCommand(
        { session_id: 's1', project_id: 'p1', path: 'D:/demo', title: 'test', type: 'shell' },
        { webhookPort: 43127, sessionSecret: 'secret', providerPort: 43128 }
      )

      const expectedShell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
      expect(command.command).toBe(expectedShell)
      expect(command.cwd).toBe('D:/demo')
    })

    test('opencode provider: buildStartCommand preserves manual shell semantics', async () => {
      const provider = getProvider('opencode')
      const command = await provider.buildStartCommand(
        { session_id: 's1', project_id: 'p1', path: 'D:/demo', title: 'test', type: 'opencode' },
        { webhookPort: 43127, sessionSecret: 'secret', providerPort: 43128 }
      )

      expect(command.command).toBe('opencode')
      expect(command.args).toEqual([])
    })

    test('opencode provider: buildStartCommand uses configured provider path when available', async () => {
      const provider = getProvider('opencode')
      const command = await provider.buildStartCommand(
        { session_id: 's1', project_id: 'p1', path: 'D:/demo', title: 'test', type: 'opencode' },
        {
          webhookPort: 43127,
          sessionSecret: 'secret',
          providerPort: 43128,
          providerPath: 'C:/Users/test/AppData/Roaming/npm/opencode.ps1'
        }
      )

      expect(command.command).toBe('C:/Users/test/AppData/Roaming/npm/opencode.ps1')
      expect(command.args).toEqual([])
    })

    test('opencode provider: buildResumeCommand includes --session flag', async () => {
      const provider = getProvider('opencode')
      const command = await provider.buildResumeCommand(
        { session_id: 's1', project_id: 'p1', path: 'D:/demo', title: 'test', type: 'opencode' },
        'ext-session-42',
        { webhookPort: 43127, sessionSecret: 'secret', providerPort: 43128 }
      )

      expect(command.args).toEqual(['--session', 'ext-session-42'])
    })

    test('opencode provider: installSidecar writes plugin file to disk', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-sidecar-')
      const provider = getProvider('opencode')

      await provider.installSidecar(
        { session_id: 's1', project_id: 'p1', path: workspaceDir, title: 'test', type: 'opencode' },
        { webhookPort: 43127, sessionSecret: 'test-secret', providerPort: 43128 }
      )

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
    })

    test('sidecar plugin contains webhook URL with correct port', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-sidecar-')
      const provider = getProvider('opencode')

      await provider.installSidecar(
        { session_id: 's1', project_id: 'p1', path: workspaceDir, title: 'test', type: 'opencode' },
        { webhookPort: 43127, sessionSecret: 'test-secret', providerPort: 43128 }
      )

      const pluginPath = join(workspaceDir, '.opencode', 'plugins', 'stoa-status.ts')
      const content = await readFile(pluginPath, 'utf-8')
      expect(content).toContain('127.0.0.1:43127')
      expect(content).toContain('process.env.STOA_SESSION_ID')
      expect(content).toContain('process.env.STOA_PROJECT_ID')
      expect(content).toContain('process.env.STOA_SESSION_SECRET')
      expect(content).not.toContain('test-secret')
    })

    test('getProvider fall back to local-shell for unknown provider', () => {
      const provider = getProvider('nonexistent-provider')
      expect(provider.providerId).toBe('local-shell')
    })
  })
})
