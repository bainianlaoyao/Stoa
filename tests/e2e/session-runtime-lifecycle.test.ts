import { afterEach, describe, expect, test } from 'vitest'
import { PtyHost } from '@core/pty-host'
import { ProjectSessionManager } from '@core/project-session-manager'
import { startSessionRuntime } from '@core/session-runtime'
import type { SessionRuntimeManager } from '@core/session-runtime'
import type { ProviderCommand } from '@shared/project-session'
import type { ProviderDefinition } from '@extensions/providers'
import { createTestWorkspace, createTestGlobalStatePath } from './helpers'
import { readProjectSessions } from '@core/state-store'

function createEchoProvider(): ProviderDefinition {
  const isWin = process.platform === 'win32'

  return {
    providerId: 'test-echo',
    supportsResume() { return false },
    supportsStructuredEvents() { return false },
    async buildStartCommand(target, _context): Promise<ProviderCommand> {
      if (isWin) {
        return {
          command: 'cmd.exe',
          args: ['/c', 'echo', 'hello-from-e2e'],
          cwd: target.path,
          env: process.env as Record<string, string>
        }
      }
      return {
        command: 'echo',
        args: ['hello-from-e2e'],
        cwd: target.path,
        env: process.env as Record<string, string>
      }
    },
    async buildResumeCommand(target, _externalSessionId, _context): Promise<ProviderCommand> {
      if (isWin) {
        return {
          command: 'cmd.exe',
          args: ['/c', 'echo', 'resume-e2e'],
          cwd: target.path,
          env: process.env as Record<string, string>
        }
      }
      return {
        command: 'echo',
        args: ['resume-e2e'],
        cwd: target.path,
        env: process.env as Record<string, string>
      }
    },
    resolveSessionId(event) { return event.session_id ?? null },
    async installSidecar() {}
  }
}

function createFailProvider(): ProviderDefinition {
  const isWin = process.platform === 'win32'

  return {
    providerId: 'test-fail',
    supportsResume() { return false },
    supportsStructuredEvents() { return false },
    async buildStartCommand(target, _context): Promise<ProviderCommand> {
      if (isWin) {
        return {
          command: 'cmd.exe',
          args: ['/c', 'exit', '42'],
          cwd: target.path,
          env: process.env as Record<string, string>
        }
      }
      return {
        command: 'bash',
        args: ['-c', 'exit 42'],
        cwd: target.path,
        env: process.env as Record<string, string>
      }
    },
    async buildResumeCommand(target, _externalSessionId, _context): Promise<ProviderCommand> {
      return {
        command: isWin ? 'cmd.exe' : 'bash',
        args: isWin ? ['/c', 'exit', '1'] : ['-c', 'exit 1'],
        cwd: target.path,
        env: process.env as Record<string, string>
      }
    },
    resolveSessionId(event) { return event.session_id ?? null },
    async installSidecar() {}
  }
}

function waitForExit(signal: Promise<void>, timeoutMs = 10_000): Promise<void> {
  return Promise.race([
    signal,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for process exit')), timeoutMs)
    )
  ])
}

interface CapturingManager extends SessionRuntimeManager {
  terminalData: Array<{ sessionId: string; data: string }>
  exitSignal: Promise<void>
}

function createCapturingManager(delegate: ProjectSessionManager): CapturingManager {
  const terminalData: Array<{ sessionId: string; data: string }> = []
  let resolveExit: (() => void) | undefined
  const exitSignal = new Promise<void>((resolve) => { resolveExit = resolve })

  return {
    terminalData,
    exitSignal,
    async markSessionStarting(sessionId: string, summary: string, externalSessionId: string | null) {
      await delegate.markSessionStarting(sessionId, summary, externalSessionId)
    },
    async markSessionRunning(sessionId: string, externalSessionId: string | null) {
      await delegate.markSessionRunning(sessionId, externalSessionId)
    },
    async markSessionExited(sessionId: string, summary: string) {
      await delegate.markSessionExited(sessionId, summary)
      resolveExit!()
    },
    async appendTerminalData(chunk: { sessionId: string; data: string }) {
      terminalData.push(chunk)
    }
  }
}

describe('E2E: Session Runtime Full Lifecycle', () => {
  const activeHosts: PtyHost[] = []

  afterEach(() => {
    for (const host of activeHosts.splice(0)) {
      host.dispose()
    }
  })

  describe('Shell session: bootstrapping → starting → running → exited', () => {
    test('completes full lifecycle with real PtyHost and real state persistence', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-lifecycle-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({
        path: workspaceDir,
        name: 'lifecycle-test'
      })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Lifecycle Shell'
      })

      expect(manager.snapshot().sessions[0]!.status).toBe('bootstrapping')

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id,
          projectId: session.projectId,
          path: workspaceDir,
          title: session.title,
          type: session.type,
          status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127,
        provider: createEchoProvider(),
        ptyHost,
        manager: capturing
      })

      let snapshot = manager.snapshot()
      expect(snapshot.sessions.find(s => s.id === session.id)!.status).toBe('running')
      expect(snapshot.sessions.find(s => s.id === session.id)!.externalSessionId).toBeNull()

      await waitForExit(capturing.exitSignal)

      snapshot = manager.snapshot()
      expect(snapshot.sessions.find(s => s.id === session.id)!.status).toBe('exited')
      expect(snapshot.sessions.find(s => s.id === session.id)!.summary).toMatch(/已退出/)
    })

    test('captures terminal data from real process output', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-output-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })
      const project = await manager.createProject({ path: workspaceDir, name: 'output-test' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Output Shell'
      })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id,
          projectId: session.projectId,
          path: workspaceDir,
          title: session.title,
          type: session.type,
          status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127,
        provider: createEchoProvider(),
        ptyHost,
        manager: capturing
      })

      await waitForExit(capturing.exitSignal)

      const allData = capturing.terminalData.map(c => c.data).join('')
      expect(allData).toContain('hello-from-e2e')
      for (const chunk of capturing.terminalData) {
        expect(chunk.sessionId).toBe(session.id)
      }
    })

    test('state is persisted to disk at each lifecycle stage', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-persist-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })
      const project = await manager.createProject({ path: workspaceDir, name: 'persist-test' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Persist Shell'
      })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id,
          projectId: session.projectId,
          path: workspaceDir,
          title: session.title,
          type: session.type,
          status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127,
        provider: createEchoProvider(),
        ptyHost,
        manager: capturing
      })

      const diskRunning = await readProjectSessions(workspaceDir)
      expect(diskRunning.sessions[0]!.last_known_status).toBe('running')

      await waitForExit(capturing.exitSignal)

      const diskExited = await readProjectSessions(workspaceDir)
      expect(diskExited.sessions[0]!.last_known_status).toBe('exited')
      expect(diskExited.sessions[0]!.last_summary).toMatch(/已退出/)
    })
  })

  describe('Multiple sessions lifecycle', () => {
    test('runs two sessions sequentially through full lifecycle', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-multi-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })
      const project = await manager.createProject({ path: workspaceDir, name: 'multi-test' })
      const session1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Session 1' })
      const session2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Session 2' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const provider = createEchoProvider()

      const capturing1 = createCapturingManager(manager)
      await startSessionRuntime({
        session: {
          id: session1.id, projectId: session1.projectId, path: workspaceDir,
          title: session1.title, type: session1.type, status: session1.status,
          externalSessionId: session1.externalSessionId
        },
        webhookPort: 43127, provider, ptyHost, manager: capturing1
      })
      await waitForExit(capturing1.exitSignal)

      const capturing2 = createCapturingManager(manager)
      await startSessionRuntime({
        session: {
          id: session2.id, projectId: session2.projectId, path: workspaceDir,
          title: session2.title, type: session2.type, status: session2.status,
          externalSessionId: session2.externalSessionId
        },
        webhookPort: 43127, provider, ptyHost, manager: capturing2
      })
      await waitForExit(capturing2.exitSignal)

      const snapshot = manager.snapshot()
      expect(snapshot.sessions).toHaveLength(2)
      expect(snapshot.sessions[0]!.status).toBe('exited')
      expect(snapshot.sessions[1]!.status).toBe('exited')
      expect(capturing1.terminalData[0]!.sessionId).toBe(session1.id)
      expect(capturing2.terminalData[0]!.sessionId).toBe(session2.id)
    })
  })

  describe('PtyHost cleanup after exit', () => {
    test('process exit removes session from PTY map', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-cleanup-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'cleanup-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Cleanup Shell' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)
      expect(() => ptyHost.write(session.id, 'should-not-crash')).not.toThrow()
    })
  })

  describe('Restart recovery after full lifecycle', () => {
    test('restarted manager reflects final exited state from disk', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-recovery-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'recovery-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Recovery Shell' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createEchoProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)

      const restored = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const snapshot = restored.snapshot()
      expect(snapshot.projects).toHaveLength(1)
      expect(snapshot.sessions).toHaveLength(1)
      expect(snapshot.sessions[0]!.status).toBe('exited')
      expect(snapshot.sessions[0]!.summary).toMatch(/已退出/)
      expect(snapshot.sessions[0]!.id).toBe(session.id)
      expect(snapshot.sessions[0]!.externalSessionId).toBeNull()
    })
  })

  describe('Concurrent sessions', () => {
    test('two sessions run concurrently and exit independently', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-concurrent-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'concurrent-test' })
      const session1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Concurrent 1' })
      const session2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Concurrent 2' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const provider = createEchoProvider()
      const capturing1 = createCapturingManager(manager)
      const capturing2 = createCapturingManager(manager)

      await Promise.all([
        startSessionRuntime({
          session: {
            id: session1.id, projectId: session1.projectId, path: workspaceDir,
            title: session1.title, type: session1.type, status: session1.status,
            externalSessionId: session1.externalSessionId
          },
          webhookPort: 43127, provider, ptyHost, manager: capturing1
        }),
        startSessionRuntime({
          session: {
            id: session2.id, projectId: session2.projectId, path: workspaceDir,
            title: session2.title, type: session2.type, status: session2.status,
            externalSessionId: session2.externalSessionId
          },
          webhookPort: 43127, provider, ptyHost, manager: capturing2
        })
      ])

      let snapshot = manager.snapshot()
      expect(snapshot.sessions.find(s => s.id === session1.id)!.status).toBe('running')
      expect(snapshot.sessions.find(s => s.id === session2.id)!.status).toBe('running')

      await Promise.all([
        waitForExit(capturing1.exitSignal),
        waitForExit(capturing2.exitSignal)
      ])

      snapshot = manager.snapshot()
      expect(snapshot.sessions.find(s => s.id === session1.id)!.status).toBe('exited')
      expect(snapshot.sessions.find(s => s.id === session2.id)!.status).toBe('exited')
      expect(capturing1.terminalData.some(c => c.data.includes('hello-from-e2e'))).toBe(true)
      expect(capturing2.terminalData.some(c => c.data.includes('hello-from-e2e'))).toBe(true)
    })
  })

  describe('Non-zero exit code', () => {
    test('captures exit code from failing process', async () => {
      const workspaceDir = await createTestWorkspace('stoa-e2e-rt-exitcode-')
      const globalStatePath = await createTestGlobalStatePath()

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: workspaceDir, name: 'exitcode-test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Fail Shell' })

      const ptyHost = new PtyHost()
      activeHosts.push(ptyHost)
      const capturing = createCapturingManager(manager)

      await startSessionRuntime({
        session: {
          id: session.id, projectId: session.projectId, path: workspaceDir,
          title: session.title, type: session.type, status: session.status,
          externalSessionId: session.externalSessionId
        },
        webhookPort: 43127, provider: createFailProvider(), ptyHost, manager: capturing
      })

      await waitForExit(capturing.exitSignal)

      const exitedSession = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(exitedSession.status).toBe('exited')
      expect(exitedSession.summary).toContain('42')
    })
  })
})
