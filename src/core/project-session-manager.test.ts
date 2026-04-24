import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as stateStore from './state-store'
import { readProjectSessions } from './state-store'
import { ProjectSessionManager } from './project-session-manager'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { createTestTempDir } from '../../testing/test-temp'

const tempDirs: string[] = []

async function createTempGlobalStatePath(): Promise<string> {
  const dir = await createTestTempDir('stoa-psm-')
  tempDirs.push(dir)
  return join(dir, 'global.json')
}

async function createTempProjectDir(prefix = 'project'): Promise<string> {
  const dir = await createTestTempDir(`stoa-${prefix}-`)
  tempDirs.push(dir)
  return dir
}

describe('ProjectSessionManager', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('createForTest seeds isolated bootstrap state snapshots', async () => {
    const manager = ProjectSessionManager.createForTest()

    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha',
      defaultSessionType: 'shell'
    })

    await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Alpha shell'
    })

    const snapshot = manager.snapshot()
    snapshot.projects[0]!.name = 'mutated'
    snapshot.sessions[0]!.summary = 'changed'

    const fresh = manager.snapshot()
    expect(fresh.projects[0]?.name).toBe('alpha')
    expect(fresh.sessions[0]?.summary).toBe('Waiting for session to start')
    expect(fresh.activeProjectId).toBe(project.id)
    expect(fresh.activeSessionId).toBe(fresh.sessions[0]?.id ?? null)
  })

  test('exposes claude permission skipping as disabled by default', () => {
    const manager = ProjectSessionManager.createForTest()

    expect(manager.getSettings().claudeDangerouslySkipPermissions).toBe(false)
  })

  test('persists claude permission skipping setting across reloads', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    await manager.setSetting('claudeDangerouslySkipPermissions', true)

    const reloaded = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(reloaded.getSettings().claudeDangerouslySkipPermissions).toBe(true)
  })

  test('rejects startup when persisted global state is corrupted', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    await writeFile(globalStatePath, '{broken json', 'utf-8')

    await expect(ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })).rejects.toThrow()
  })

  test('retries a transient global state read once before bootstrapping', async () => {
    vi.resetModules()

    class MockStateReadError extends Error {
      readonly filePath: string
      readonly isTransient: boolean

      constructor(message: string, filePath: string, isTransient: boolean) {
        super(message)
        this.name = 'StateReadError'
        this.filePath = filePath
        this.isTransient = isTransient
      }
    }

    const readGlobalState = vi.fn()
      .mockRejectedValueOnce(new MockStateReadError('temporarily locked', 'D:/transient/global.json', true))
      .mockResolvedValueOnce({
        version: 3,
        active_project_id: null,
        active_session_id: null,
        projects: [],
        settings: { ...DEFAULT_SETTINGS }
      })

    const readAllProjectSessions = vi.fn().mockResolvedValue([])

    vi.doMock('@core/state-store', () => ({
      DEFAULT_GLOBAL_STATE: {
        version: 3,
        active_project_id: null,
        active_session_id: null,
        projects: [],
        settings: { ...DEFAULT_SETTINGS }
      },
      StateReadError: MockStateReadError,
      readGlobalState,
      readAllProjectSessions,
      readProjectSessions: vi.fn(),
      writeGlobalState: vi.fn(),
      writeProjectSessions: vi.fn()
    }))

    const { ProjectSessionManager: MockedManager } = await import('./project-session-manager')

    const manager = await MockedManager.create({
      webhookPort: null,
      globalStatePath: 'D:/transient/global.json'
    })

    expect(manager.snapshot().projects).toEqual([])
    expect(readGlobalState).toHaveBeenCalledTimes(2)

    vi.doUnmock('@core/state-store')
    vi.resetModules()
  })

  test('persists project session files before global state so active references commit last', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const callOrder: string[] = []
    const originalWriteProjectSessions = stateStore.writeProjectSessions
    const originalWriteGlobalState = stateStore.writeGlobalState
    const writeProjectSessionsSpy = vi
      .spyOn(stateStore, 'writeProjectSessions')
      .mockImplementation(async (...args) => {
        callOrder.push('project')
        return await originalWriteProjectSessions(...args)
      })
    const writeGlobalStateSpy = vi
      .spyOn(stateStore, 'writeGlobalState')
      .mockImplementation(async (...args) => {
        callOrder.push('global')
        return await originalWriteGlobalState(...args)
      })

    try {
      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })
      const project = await manager.createProject({
        path: projectDir,
        name: 'alpha',
        defaultSessionType: 'shell'
      })

      callOrder.length = 0
      writeProjectSessionsSpy.mockClear()
      writeGlobalStateSpy.mockClear()

      await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Alpha shell'
      })

      expect(writeProjectSessionsSpy).toHaveBeenCalledOnce()
      expect(writeGlobalStateSpy).toHaveBeenCalledOnce()
      expect(callOrder).toEqual(['project', 'global'])
    } finally {
      writeProjectSessionsSpy.mockRestore()
      writeGlobalStateSpy.mockRestore()
    }
  })

  test('serializes concurrent persist calls so disk writes never overlap', async () => {
    vi.resetModules()

    let activeGlobalWrites = 0
    let maxConcurrentGlobalWrites = 0
    let allowFirstWriteToFinish: (() => void) | undefined
    let signalFirstWriteStarted: (() => void) | undefined
    let pauseWrites = false
    const firstWriteStarted = new Promise<void>((resolve) => {
      signalFirstWriteStarted = resolve
    })

    const writeGlobalState = vi.fn(async (state: unknown) => {
      activeGlobalWrites += 1
      maxConcurrentGlobalWrites = Math.max(maxConcurrentGlobalWrites, activeGlobalWrites)

      if (pauseWrites && writeGlobalState.mock.calls.length === 1) {
        signalFirstWriteStarted?.()
        await new Promise<void>((resolve) => {
          allowFirstWriteToFinish = resolve
        })
      }

      activeGlobalWrites -= 1
      return state
    })

    const writeProjectSessions = vi.fn(async () => undefined)

    vi.doMock('@core/state-store', async () => {
      const actual = await vi.importActual<typeof import('@core/state-store')>('@core/state-store')
      return {
        ...actual,
        writeGlobalState,
        writeProjectSessions
      }
    })

    const { ProjectSessionManager: MockedManager } = await import('./project-session-manager')
    const manager = await MockedManager.create({
      webhookPort: null,
      globalStatePath: 'D:/persist/global.json'
    })

    const project1 = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
    const project2 = await manager.createProject({ name: 'beta', path: 'D:/beta' })

    writeGlobalState.mockClear()
    writeProjectSessions.mockClear()
    activeGlobalWrites = 0
    maxConcurrentGlobalWrites = 0
    pauseWrites = true

    const firstPersist = manager.setActiveProject(project2.id)
    await firstWriteStarted
    const secondPersist = manager.setSetting('terminalFontSize', 16)
    allowFirstWriteToFinish?.()
    await Promise.all([firstPersist, secondPersist])

    expect(maxConcurrentGlobalWrites).toBe(1)
    expect(project1.id).not.toBe(project2.id)
    expect(writeGlobalState).toHaveBeenCalledTimes(2)

    const lastGlobalState = writeGlobalState.mock.calls.at(-1)?.[0] as {
      active_project_id: string | null
      settings?: { terminalFontSize?: number }
    }
    expect(lastGlobalState.active_project_id).toBe(project2.id)
    expect(lastGlobalState.settings?.terminalFontSize).toBe(16)

    vi.doUnmock('@core/state-store')
    vi.resetModules()
  })

  test('clears dangling active project references during bootstrap', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const now = new Date().toISOString()

    await stateStore.writeGlobalState({
      version: 3,
      active_project_id: 'project_missing',
      active_session_id: null,
      projects: [
        {
          project_id: 'project_real',
          name: 'alpha',
          path: projectDir,
          default_session_type: 'shell',
          created_at: now,
          updated_at: now
        }
      ]
    }, globalStatePath)
    await stateStore.writeProjectSessions(projectDir, {
      version: 4,
      project_id: 'project_real',
      sessions: []
    })

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(manager.snapshot().projects).toHaveLength(1)
    expect(manager.snapshot().activeProjectId).toBeNull()
    expect(manager.snapshot().activeSessionId).toBeNull()
  })

  test('hydrates active project from the active session when persisted active project is stale', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const now = new Date().toISOString()

    await stateStore.writeGlobalState({
      version: 3,
      active_project_id: 'project_missing',
      active_session_id: 'session_real',
      projects: [
        {
          project_id: 'project_real',
          name: 'alpha',
          path: projectDir,
          default_session_type: 'shell',
          created_at: now,
          updated_at: now
        }
      ]
    }, globalStatePath)
    await stateStore.writeProjectSessions(projectDir, {
      version: 4,
      project_id: 'project_real',
      sessions: [
        {
          session_id: 'session_real',
          project_id: 'project_real',
          type: 'shell',
          title: 'Alpha shell',
          last_known_status: 'running',
          last_summary: 'alive',
          external_session_id: null,
          created_at: now,
          updated_at: now,
          last_activated_at: now,
          recovery_mode: 'fresh-shell',
          archived: false
        }
      ]
    })

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(manager.snapshot().activeProjectId).toBe('project_real')
    expect(manager.snapshot().activeSessionId).toBe('session_real')
  })

  test('clears active session references when the active session belongs to a missing project', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const now = new Date().toISOString()

    await stateStore.writeGlobalState({
      version: 3,
      active_project_id: null,
      active_session_id: 'session_real',
      projects: [
        {
          project_id: 'project_real',
          name: 'alpha',
          path: projectDir,
          default_session_type: 'shell',
          created_at: now,
          updated_at: now
        }
      ]
    }, globalStatePath)
    await stateStore.writeProjectSessions(projectDir, {
      version: 4,
      project_id: 'project_real',
      sessions: [
        {
          session_id: 'session_real',
          project_id: 'project_missing',
          type: 'shell',
          title: 'Orphan shell',
          last_known_status: 'running',
          last_summary: 'alive',
          external_session_id: null,
          created_at: now,
          updated_at: now,
          last_activated_at: now,
          recovery_mode: 'fresh-shell',
          archived: false
        }
      ]
    })

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(manager.snapshot().activeProjectId).toBeNull()
    expect(manager.snapshot().activeSessionId).toBeNull()
  })

  test('rejects orphan sessions and enforces unique project paths', async () => {
    const manager = ProjectSessionManager.createForTest()

    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha',
      defaultSessionType: 'shell'
    })

    await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Shell 1'
    })

    await expect(
      manager.createProject({
        name: 'alpha-copy',
        path: 'D:/alpha',
        defaultSessionType: 'shell'
      })
    ).rejects.toThrow('Project path already exists')

    await expect(
      manager.createSession({
        projectId: 'missing-project',
        type: 'shell',
        title: 'Orphan shell'
      })
    ).rejects.toThrow('Session must belong to an existing project')
  })

  test('creates the first project as active and restores it from persisted state', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const manager = await ProjectSessionManager.create({
      webhookPort: 43127,
      globalStatePath
    })

    const created = await manager.createProject({
      path: projectDir,
      name: 'stoa',
      defaultSessionType: 'shell'
    })

    const snapshot = manager.snapshot()
    expect(snapshot.terminalWebhookPort).toBe(43127)
    expect(snapshot.activeProjectId).toBe(created.id)
    expect(snapshot.activeSessionId).toBe(null)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]?.path).toBe(projectDir)

    const restored = await ProjectSessionManager.create({
      webhookPort: 43127,
      globalStatePath
    })

    expect(restored.snapshot().projects[0]?.id).toBe(created.id)
    expect(restored.snapshot().activeProjectId).toBe(created.id)
  })

  test('creates sessions under a project and makes the new session active', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    const project = await manager.createProject({
      path: projectDir,
      name: 'alpha',
      defaultSessionType: 'shell'
    })

    const session = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'Alpha opencode'
    })

    const snapshot = manager.snapshot()
    expect(session.projectId).toBe(project.id)
    expect(session.recoveryMode).toBe('resume-external')
    expect(session.status).toBe('bootstrapping')
    expect(session.lastActivatedAt).not.toBe(null)
    expect(snapshot.activeProjectId).toBe(project.id)
    expect(snapshot.activeSessionId).toBe(session.id)
    expect(snapshot.sessions[0]?.title).toBe('Alpha opencode')
  })

  test('setTerminalWebhookPort updates runtime state without rewriting global.json', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    await manager.createProject({
      path: projectDir,
      name: 'alpha',
      defaultSessionType: 'shell'
    })

    const before = await stat(globalStatePath)
    const beforeContent = await readFile(globalStatePath, 'utf-8')
    await new Promise(resolve => setTimeout(resolve, 25))

    await manager.setTerminalWebhookPort(43127)

    const after = await stat(globalStatePath)
    const afterContent = await readFile(globalStatePath, 'utf-8')
    expect(manager.snapshot().terminalWebhookPort).toBe(43127)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(afterContent).toBe(beforeContent)
  })

  test('refuses to overwrite persisted projects with an unexpected empty list', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    await manager.createProject({
      path: projectDir,
      name: 'alpha',
      defaultSessionType: 'shell'
    })

    const before = await readFile(globalStatePath, 'utf-8')
    ;(manager as never as { state: { projects: []; activeProjectId: null } }).state.projects = []
    ;(manager as never as { state: { projects: []; activeProjectId: null } }).state.activeProjectId = null

    await manager.setSetting('terminalFontSize', 16)

    const after = await readFile(globalStatePath, 'utf-8')
    expect(JSON.parse(after).projects).toHaveLength(1)
    expect(after).toBe(before)
  })

  test('seeds external session ids for claude-code sessions at creation time', async () => {
    const manager = ProjectSessionManager.createForTest()
    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha',
      defaultSessionType: 'shell'
    })

    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude alpha'
    })

    expect(session.recoveryMode).toBe('resume-external')
    expect(session.externalSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  test('treats null claude-code externalSessionId as unset and still seeds a UUID', async () => {
    const manager = ProjectSessionManager.createForTest()
    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha',
      defaultSessionType: 'shell'
    })

    const session = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude alpha',
      externalSessionId: null
    })

    expect(session.externalSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  test('relaunches shell sessions and resumes opencode sessions during bootstrap', async () => {
    const manager = ProjectSessionManager.createForTest()
    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha',
      defaultSessionType: 'shell'
    })

    const shell = await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Shell 1'
    })
    const opencode = await manager.createSession({
      projectId: project.id,
      type: 'opencode',
      title: 'Deploy',
      externalSessionId: 'ext-123'
    })

    const outcomes = manager.buildBootstrapRecoveryPlan()

    expect(outcomes).toEqual([
      { sessionId: shell.id, action: 'fresh-shell' },
      { sessionId: opencode.id, action: 'resume-external', externalSessionId: 'ext-123' }
    ])
  })

  test('includes codex and claude-code sessions in bootstrap resume plans', async () => {
    const manager = ProjectSessionManager.createForTest()
    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha',
      defaultSessionType: 'shell'
    })

    const codex = await manager.createSession({
      projectId: project.id,
      type: 'codex',
      title: 'Codex alpha'
    })
    const claude = await manager.createSession({
      projectId: project.id,
      type: 'claude-code',
      title: 'Claude alpha'
    })

    expect(manager.buildBootstrapRecoveryPlan()).toEqual([
      { sessionId: codex.id, action: 'resume-external', externalSessionId: null },
      {
        sessionId: claude.id,
        action: 'resume-external',
        externalSessionId: claude.externalSessionId
      }
    ])
  })

  describe('session lifecycle methods', () => {
    test('markSessionStarting updates status and summary', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionStarting(session.id, '正在启动 shell', null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.status).toBe('starting')
      expect(updated.summary).toBe('正在启动 shell')
    })

    test('markSessionRunning preserves null externalSessionId for fresh shell starts', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionRunning(session.id, null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.status).toBe('running')
      expect(updated.externalSessionId).toBeNull()
      expect(updated.summary).toBe('Session running')
    })

    test('markSessionRunning does not invent a session id for shell sessions', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionRunning(session.id, null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.externalSessionId).toBeNull()
    })

    test('markSessionRunning replaces ready canonical states when runtime becomes active again', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.applySessionEvent(session.id, 'awaiting_input', 'session.idle', 'opencode-real-123')
      await manager.markSessionRunning(session.id, 'opencode-real-456')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.status).toBe('running')
      expect(updated.summary).toBe('Session running')
      expect(updated.externalSessionId).toBe('opencode-real-456')
    })

    test('markSessionRunning preserves blocked and failed states while refreshing externalSessionId', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const blockedSession = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'blocked' })
      const failedSession = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'failed' })

      await manager.applySessionEvent(blockedSession.id, 'needs_confirmation', 'PermissionRequest', 'claude-real-123')
      await manager.applySessionEvent(failedSession.id, 'error', 'Provider error', 'claude-real-456')
      await manager.markSessionRunning(blockedSession.id, 'claude-real-789')
      await manager.markSessionRunning(failedSession.id, 'claude-real-999')

      const updatedBlocked = manager.snapshot().sessions.find(s => s.id === blockedSession.id)!
      const updatedFailed = manager.snapshot().sessions.find(s => s.id === failedSession.id)!
      expect(updatedBlocked.status).toBe('needs_confirmation')
      expect(updatedBlocked.summary).toBe('PermissionRequest')
      expect(updatedBlocked.externalSessionId).toBe('claude-real-789')
      expect(updatedFailed.status).toBe('error')
      expect(updatedFailed.summary).toBe('Provider error')
      expect(updatedFailed.externalSessionId).toBe('claude-real-999')
    })

    test('markSessionExited updates status and summary', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionExited(session.id, 'shell exited (0)')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.status).toBe('exited')
      expect(updated.summary).toBe('shell exited (0)')
    })

    test('lifecycle methods are no-ops for unknown session IDs', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      await expect(manager.markSessionStarting('nonexistent', 'x', null)).resolves.toBeUndefined()
      await expect(manager.markSessionRunning('nonexistent', null)).resolves.toBeUndefined()
      await expect(manager.markSessionExited('nonexistent', 'x')).resolves.toBeUndefined()
    })

    test('markSessionStarting persists to project sessions file', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionStarting(session.id, 'starting...', null)

      const diskSessions = await readProjectSessions(projectDir)
      expect(diskSessions.sessions[0]!.last_known_status).toBe('starting')
      expect(diskSessions.sessions[0]!.last_summary).toBe('starting...')
    })
  })

  describe('active setter methods', () => {
    test('setActiveProject updates activeProjectId', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const dir1 = await createTempProjectDir()
      const dir2 = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const p1 = await manager.createProject({ path: dir1, name: 'P1' })
      const p2 = await manager.createProject({ path: dir2, name: 'P2' })

      expect(manager.snapshot().activeProjectId).toBe(p1.id)
      await manager.setActiveProject(p2.id)
      expect(manager.snapshot().activeProjectId).toBe(p2.id)
    })

    test('setActiveSession updates both activeSessionId and activeProjectId', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const dir1 = await createTempProjectDir()
      const dir2 = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const p1 = await manager.createProject({ path: dir1, name: 'P1' })
      const p2 = await manager.createProject({ path: dir2, name: 'P2' })
      const s1 = await manager.createSession({ projectId: p1.id, type: 'shell', title: 'S1' })
      const s2 = await manager.createSession({ projectId: p2.id, type: 'shell', title: 'S2' })

      await manager.setActiveSession(s1.id)
      expect(manager.snapshot().activeSessionId).toBe(s1.id)
      expect(manager.snapshot().activeProjectId).toBe(p1.id)

      await manager.setActiveSession(s2.id)
      expect(manager.snapshot().activeSessionId).toBe(s2.id)
      expect(manager.snapshot().activeProjectId).toBe(p2.id)
    })

    test('setActiveProject is no-op for unknown project ID', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      await manager.createProject({ path: projectDir, name: 'P1' })
      const before = manager.snapshot().activeProjectId
      await manager.setActiveProject('nonexistent')
      expect(manager.snapshot().activeProjectId).toBe(before)
    })

    test('setActiveSession is no-op for unknown session ID', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const before = manager.snapshot().activeSessionId
      await manager.setActiveSession('nonexistent')
      expect(manager.snapshot().activeSessionId).toBe(before)
    })
  })

  describe('archive and restore', () => {
    test('archiveSession sets archived=true and clears activeSessionId', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.archiveSession(session.id)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.archived).toBe(true)
      expect(manager.snapshot().activeSessionId).toBeNull()
    })

    test('restoreSession sets archived=false and makes the restored session active', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.archiveSession(session.id)
      await manager.restoreSession(session.id)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.archived).toBe(false)
      expect(manager.snapshot().activeProjectId).toBe(project.id)
      expect(manager.snapshot().activeSessionId).toBe(session.id)
    })

    test('getArchivedSessions returns only archived sessions', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const s1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'S2' })

      await manager.archiveSession(s1.id)

      const archived = manager.getArchivedSessions()
      expect(archived).toHaveLength(1)
      expect(archived[0]!.id).toBe(s1.id)
    })

    test('archiveSession is no-op for unknown session ID', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      await expect(manager.archiveSession('nonexistent')).resolves.toBeUndefined()
    })

    test('restoreSession is no-op for unknown session ID', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      await expect(manager.restoreSession('nonexistent')).resolves.toBeUndefined()
    })

    test('buildBootstrapRecoveryPlan skips archived sessions', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const s1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })
      await manager.createSession({ projectId: project.id, type: 'shell', title: 'S2' })

      await manager.archiveSession(s1.id)

      const plan = manager.buildBootstrapRecoveryPlan()
      expect(plan).toHaveLength(1)
      expect(plan[0]!.sessionId).not.toBe(s1.id)
    })

    test('archived state persists across manager restart', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()

      const manager1 = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager1.createProject({ path: projectDir, name: 'test' })
      const session = await manager1.createSession({ projectId: project.id, type: 'shell', title: 'S1' })
      await manager1.archiveSession(session.id)

      const manager2 = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const restored = manager2.snapshot().sessions.find(s => s.id === session.id)!
      expect(restored.archived).toBe(true)
    })
  })
})
