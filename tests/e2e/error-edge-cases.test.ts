import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { ProjectSessionManager } from '@core/project-session-manager'
import { readGlobalState, readProjectSessions } from '@core/state-store'
import type { PersistedGlobalStateV3 } from '@shared/project-session'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  )
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createGlobalStatePath(): Promise<string> {
  const dir = await createTempDir('vibecoding-e2e-error-')
  return join(dir, 'global.json')
}

async function readGlobalFile(path: string): Promise<PersistedGlobalStateV3> {
  return await readGlobalState(path)
}

async function writeRawStateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf-8')
}

describe('E2E: Error and Edge Cases', () => {
  describe('Duplicate project path prevention', () => {
    test('rejects second project with same path (different name)', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-dup-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: workspaceDir, name: 'Alpha' })

      await expect(
        manager.createProject({ path: workspaceDir, name: 'Beta' })
      ).rejects.toThrow('Project path already exists')

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(1)
      expect(snapshot.projects[0]!.name).toBe('Alpha')

      const diskState = await readGlobalFile(globalStatePath)
      expect(diskState.projects).toHaveLength(1)
    })

    test('rejects case-insensitive path match (D:/ALPHA vs d:/alpha)', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: 'D:/ALPHA', name: 'Upper' })

      await expect(
        manager.createProject({ path: 'd:/alpha', name: 'Lower' })
      ).rejects.toThrow('Project path already exists')

      expect(manager.snapshot().projects).toHaveLength(1)
    })

    test('rejects trailing slash variant (D:/alpha vs D:/alpha/)', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: 'D:/alpha', name: 'NoSlash' })

      await expect(
        manager.createProject({ path: 'D:/alpha/', name: 'WithSlash' })
      ).rejects.toThrow('Project path already exists')

      expect(manager.snapshot().projects).toHaveLength(1)
    })
  })

  describe('Orphan session prevention', () => {
    test('rejects session with non-existent projectId', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await expect(
        manager.createSession({
          projectId: 'project_nonexistent',
          type: 'shell',
          title: 'Orphan'
        })
      ).rejects.toThrow('Session must belong to an existing project')

      const snapshot = manager.snapshot()
      expect(snapshot.sessions).toHaveLength(0)
    })
  })

  describe('State file corruption recovery', () => {
    test('recovers from corrupted JSON', async () => {
      const globalStatePath = await createGlobalStatePath()
      await writeRawStateFile(globalStatePath, '{not valid json!!!')

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

    test('can create projects and sessions normally after corruption recovery', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-corrupt-')
      const globalStatePath = await createGlobalStatePath()
      await writeRawStateFile(globalStatePath, 'corrupt!!!')

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({
        path: workspaceDir,
        name: 'Recovered'
      })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'Post-Recovery'
      })

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(1)
      expect(snapshot.sessions).toHaveLength(1)
      expect(snapshot.projects[0]!.name).toBe('Recovered')
      expect(snapshot.sessions[0]!.id).toBe(session.id)
    })

    test('falls back to default for wrong version number', async () => {
      const globalStatePath = await createGlobalStatePath()
      await writeRawStateFile(globalStatePath, JSON.stringify({
        version: 99,
        active_project_id: null,
        active_session_id: null,
        projects: [{ project_id: 'p1', name: 'X', path: 'D:/x', created_at: '', updated_at: '' }]
      }))

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(0)
      expect(snapshot.activeProjectId).toBeNull()
    })

    test('falls back to default when version=2 but missing projects key', async () => {
      const globalStatePath = await createGlobalStatePath()
      await writeRawStateFile(globalStatePath, JSON.stringify({
        version: 3,
        active_project_id: null,
        active_session_id: null
      }))

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(0)
    })

    test('falls back to default when version=2 but missing sessions key', async () => {
      const globalStatePath = await createGlobalStatePath()
      await writeRawStateFile(globalStatePath, JSON.stringify({
        version: 3,
        active_project_id: null,
        active_session_id: null,
        projects: []
      }))

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = manager.snapshot()
      expect(snapshot.sessions).toHaveLength(0)
    })
  })

  describe('Concurrent manager instances (same state file)', () => {
    test('managers have in-memory isolation', async () => {
      const workspace1 = await createTempDir('vibecoding-e2e-conc-a-')
      const workspace2 = await createTempDir('vibecoding-e2e-conc-b-')
      const globalStatePath = await createGlobalStatePath()

      const managerA = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const managerB = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await managerA.createProject({ path: workspace1, name: 'Project A' })

      expect(managerA.snapshot().projects).toHaveLength(1)
      expect(managerB.snapshot().projects).toHaveLength(0)

      await managerB.createProject({ path: workspace2, name: 'Project B' })

      expect(managerA.snapshot().projects).toHaveLength(1)
      expect(managerA.snapshot().projects[0]!.name).toBe('Project A')
      expect(managerB.snapshot().projects).toHaveLength(1)
      expect(managerB.snapshot().projects[0]!.name).toBe('Project B')
    })
  })

  describe('Empty and null states', () => {
    test('fresh manager returns empty snapshot with null active IDs', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toEqual([])
      expect(snapshot.sessions).toEqual([])
      expect(snapshot.activeProjectId).toBeNull()
      expect(snapshot.activeSessionId).toBeNull()
    })

    test('state.json on disk matches DEFAULT_STATE for empty manager', async () => {
      const globalStatePath = await createGlobalStatePath()

      await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const diskState = await readGlobalFile(globalStatePath)
      expect(diskState.version).toBe(3)
      expect(diskState.projects).toEqual([])
      expect(diskState.active_project_id).toBeNull()
      expect(diskState.active_session_id).toBeNull()
    })

    test('recovers from external state file deletion', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-del-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: workspaceDir, name: 'Soon Gone' })
      expect(manager.snapshot().projects).toHaveLength(1)

      await unlink(globalStatePath)

      const freshManager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const snapshot = freshManager.snapshot()
      expect(snapshot.projects).toHaveLength(0)
      expect(snapshot.activeProjectId).toBeNull()
    })
  })

  describe('Session status edge cases', () => {
    test('shell sessions always get recoveryMode fresh-shell', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-shell-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'P' })
      const shell1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })
      const shell2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 2' })

      expect(shell1.recoveryMode).toBe('fresh-shell')
      expect(shell2.recoveryMode).toBe('fresh-shell')
    })

    test('opencode sessions always get recoveryMode resume-external', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-oc-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'P' })
      const oc1 = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OC 1' })
      const oc2 = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'OC 2', externalSessionId: 'ext-42' })

      expect(oc1.recoveryMode).toBe('resume-external')
      expect(oc2.recoveryMode).toBe('resume-external')
    })

    test('opencode session WITH externalSessionId stores it correctly', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-extid-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'P' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'With Ext',
        externalSessionId: 'ext-abc-123'
      })

      expect(session.externalSessionId).toBe('ext-abc-123')
      expect(session.recoveryMode).toBe('resume-external')

      const diskSessions = await readProjectSessions(workspaceDir)
      expect(diskSessions.sessions[0]!.external_session_id).toBe('ext-abc-123')
    })

    test('opencode session WITHOUT externalSessionId stores null', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-noext-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'P' })
      const session = await manager.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'No Ext'
      })

      expect(session.externalSessionId).toBeNull()
      expect(session.recoveryMode).toBe('resume-external')
    })
  })

  describe('Path normalization', () => {
    test('rejects different case path as duplicate', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: 'D:/Alpha', name: 'Original' })

      await expect(
        manager.createProject({ path: 'D:/alpha', name: 'Different Case' })
      ).rejects.toThrow('Project path already exists')

      expect(manager.snapshot().projects).toHaveLength(1)
    })

    test('rejects trailing slash variant as duplicate', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: 'D:/Alpha', name: 'Original' })

      await expect(
        manager.createProject({ path: 'D:/Alpha/', name: 'Trailing Slash' })
      ).rejects.toThrow('Project path already exists')
    })

    test('rejects double trailing slash variant as duplicate', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: 'D:/Alpha', name: 'Original' })

      await expect(
        manager.createProject({ path: 'D:/Alpha//', name: 'Double Slash' })
      ).rejects.toThrow('Project path already exists')
    })

    test('rejects Windows backslash variant as duplicate', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      await manager.createProject({ path: 'D:/Alpha', name: 'Forward Slash' })

      await expect(
        manager.createProject({ path: 'D:\\Alpha', name: 'Backslash' })
      ).rejects.toThrow('Project path already exists')

      expect(manager.snapshot().projects).toHaveLength(1)
    })
  })

  describe('Rapid sequential operations', () => {
    test('creates 5 projects rapidly with unique IDs', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const projects = []
      for (let i = 0; i < 5; i++) {
        const dir = await createTempDir(`vibecoding-e2e-rapid-p${i}-`)
        const p = await manager.createProject({ path: dir, name: `Project ${i}` })
        projects.push(p)
      }

      const snapshot = manager.snapshot()
      expect(snapshot.projects).toHaveLength(5)

      const ids = projects.map(p => p.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(5)

      const diskState = await readGlobalFile(globalStatePath)
      expect(diskState.projects).toHaveLength(5)
    })

    test('creates 5 sessions under same project rapidly', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-rapid-s-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'Rapid' })

      const sessions = []
      for (let i = 0; i < 5; i++) {
        const s = await manager.createSession({
          projectId: project.id,
          type: 'shell',
          title: `Session ${i}`
        })
        sessions.push(s)
      }

      const snapshot = manager.snapshot()
      expect(snapshot.sessions).toHaveLength(5)

      const ids = sessions.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(5)

      expect(snapshot.activeSessionId).toBe(sessions[4]!.id)
    })
  })

  describe('Bootstrap recovery plan edge cases', () => {
    test('empty sessions returns empty recovery plan', async () => {
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const plan = manager.buildBootstrapRecoveryPlan()
      expect(plan).toEqual([])
    })

    test('mixed session types produce correct recovery actions', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-recovery-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'Recovery' })
      const shell = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell' })
      const opencode = await manager.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'OpenCode',
        externalSessionId: 'ext-xyz'
      })
      const shell2 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 2' })

      const plan = manager.buildBootstrapRecoveryPlan()
      expect(plan).toHaveLength(3)
      expect(plan[0]!.sessionId).toBe(shell.id)
      expect(plan[0]!.action).toBe('fresh-shell')
      expect(plan[1]!.sessionId).toBe(opencode.id)
      expect(plan[1]!.action).toBe('resume-external')
      if (plan[1]!.action === 'resume-external') {
        expect(plan[1]!.externalSessionId).toBe('ext-xyz')
      }
      expect(plan[2]!.sessionId).toBe(shell2.id)
      expect(plan[2]!.action).toBe('fresh-shell')
    })

    test('opencode session without externalSessionId still gets resume-external action', async () => {
      const workspaceDir = await createTempDir('vibecoding-e2e-noext-recovery-')
      const globalStatePath = await createGlobalStatePath()

      const manager = await ProjectSessionManager.create({
        webhookPort: null,
        globalStatePath
      })

      const project = await manager.createProject({ path: workspaceDir, name: 'NoExt' })
      await manager.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'No External ID'
      })

      const plan = manager.buildBootstrapRecoveryPlan()
      expect(plan).toHaveLength(1)
      expect(plan[0]!.action).toBe('resume-external')
      if (plan[0]!.action === 'resume-external') {
        expect(plan[0]!.externalSessionId).toBeNull()
      }
    })
  })
})
