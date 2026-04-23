import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as stateStore from './state-store'
import { readProjectSessions } from './state-store'
import { ProjectSessionManager } from './project-session-manager'
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
    expect(fresh.sessions[0]?.summary).toBe('等待会话启动')
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

  test('persists project session files before global state so global.json is the commit marker', async () => {
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
      expect(updated.summary).toBe('会话运行中')
    })

    test('markSessionRunning does not invent a session id for shell sessions', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionRunning(session.id, null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.externalSessionId).toBeNull()
    })

    test('markSessionRunning does not downgrade richer canonical states but can still refresh externalSessionId', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.applySessionEvent(session.id, 'awaiting_input', 'session.idle', 'opencode-real-123')
      await manager.markSessionRunning(session.id, 'opencode-real-456')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.status).toBe('awaiting_input')
      expect(updated.summary).toBe('session.idle')
      expect(updated.externalSessionId).toBe('opencode-real-456')
    })

    test('markSessionExited updates status and summary', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markSessionExited(session.id, 'shell 已退出 (0)')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.status).toBe('exited')
      expect(updated.summary).toBe('shell 已退出 (0)')
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
