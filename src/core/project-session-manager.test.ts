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

  test('fills missing persisted settings with current defaults', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    await writeFile(globalStatePath, JSON.stringify({
      version: 4,
      active_project_id: null,
      active_session_id: null,
      projects: [],
      settings: {
        shellPath: 'C:\\WINDOWS\\system32\\cmd.exe',
        terminal: {},
        providers: {},
        claudeDangerouslySkipPermissions: true,
        locale: 'en'
      }
    }), 'utf-8')
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(manager.getSettings().workspaceIde).toEqual(DEFAULT_SETTINGS.workspaceIde)
    expect(manager.getSettings().evolverInferenceProvider).toBe(DEFAULT_SETTINGS.evolverInferenceProvider)
    expect(manager.getSettings().evolverExecutionMode).toBe(DEFAULT_SETTINGS.evolverExecutionMode)
    expect(manager.getSettings().titleGeneration).toEqual(DEFAULT_SETTINGS.titleGeneration)

    const persisted = JSON.parse(await readFile(globalStatePath, 'utf-8')) as {
      settings?: {
        workspaceIde?: unknown
        evolverInferenceProvider?: unknown
        evolverExecutionMode?: unknown
        titleGeneration?: unknown
      }
    }
    expect(persisted.settings?.workspaceIde).toEqual(DEFAULT_SETTINGS.workspaceIde)
    expect(persisted.settings?.evolverInferenceProvider).toBe(DEFAULT_SETTINGS.evolverInferenceProvider)
    expect(persisted.settings?.evolverExecutionMode).toBe(DEFAULT_SETTINGS.evolverExecutionMode)
    expect(persisted.settings?.titleGeneration).toEqual(DEFAULT_SETTINGS.titleGeneration)
  })

  test('persists evolver inference provider setting across reloads', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    await manager.setSetting('evolverInferenceProvider', 'claude-code')

    const reloaded = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(reloaded.getSettings().evolverInferenceProvider).toBe('claude-code')
  })

  test('persists evolver execution mode setting across reloads', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    await manager.setSetting('evolverExecutionMode', 'workspace-shell')

    const reloaded = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(reloaded.getSettings().evolverExecutionMode).toBe('workspace-shell')
  })

  test('persists title generation settings across reloads', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    await manager.setSetting('titleGeneration', {
      enabled: true,
      apiKey: 'sk-title',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5-mini'
    })

    const reloaded = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(reloaded.getSettings().titleGeneration).toEqual({
      enabled: true,
      apiKey: 'sk-title',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5-mini'
    })
  })

  test('rejects startup when persisted global state is corrupted', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    await writeFile(globalStatePath, '{broken json', 'utf-8')

    await expect(ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })).rejects.toThrow()
  })

  test('migrates persisted v3 global state during bootstrap', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    await writeFile(globalStatePath, JSON.stringify({
      version: 3,
      active_project_id: null,
      active_session_id: null,
      projects: [],
      settings: { ...DEFAULT_SETTINGS }
    }), 'utf-8')

    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      globalStatePath
    })

    expect(manager.snapshot().projects).toEqual([])
    expect(manager.getSettings().evolverInferenceProvider).toBe(DEFAULT_SETTINGS.evolverInferenceProvider)
  })

  test('retries a transient global state read once before bootstrap completes', async () => {
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
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [],
        settings: { ...DEFAULT_SETTINGS }
      })

    const readAllProjectSessions = vi.fn().mockResolvedValue([])

    vi.doMock('@core/state-store', () => ({
      DEFAULT_GLOBAL_STATE: {
        version: 4,
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
    const secondPersist = manager.setSetting('terminal', { fontSize: 16 })
    allowFirstWriteToFinish?.()
    await Promise.all([firstPersist, secondPersist])

    expect(maxConcurrentGlobalWrites).toBe(1)
    expect(project1.id).not.toBe(project2.id)
    expect(writeGlobalState).toHaveBeenCalledTimes(2)

    const lastGlobalState = writeGlobalState.mock.calls.at(-1)?.[0] as {
      active_project_id: string | null
      settings?: { terminal?: { fontSize?: number } }
    }
    expect(lastGlobalState.active_project_id).toBe(project2.id)
    expect(lastGlobalState.settings?.terminal?.fontSize).toBe(16)

    vi.doUnmock('@core/state-store')
    vi.resetModules()
  })

  test('clears dangling active project references during bootstrap', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const now = new Date().toISOString()

    await stateStore.writeGlobalState({
      version: 4,
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
      version: 7,
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
      version: 4,
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
      version: 7,
      project_id: 'project_real',
      sessions: [
        {
          session_id: 'session_real',
          project_id: 'project_real',
          parent_session_id: null,
          created_by_session_id: null,
          type: 'shell',
          title: 'Alpha shell',
          runtime_state: 'alive',
          turn_state: 'idle',
          turn_epoch: 0,
          last_turn_outcome: 'none',
          failure_reason: null,
          has_unseen_completion: false,
          runtime_exit_code: null,
          runtime_exit_reason: null,
          last_state_sequence: 3,
          blocking_reason: null,
          last_summary: 'alive',
          external_session_id: null,
          title_generation: {
            prompt: null,
            assistantSnippet: null,
            contextUpdatedAt: null,
            autoGeneratedTurnEpoch: null
          },
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
      version: 4,
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
      version: 7,
      project_id: 'project_real',
      sessions: [
        {
          session_id: 'session_real',
          project_id: 'project_missing',
          parent_session_id: null,
          created_by_session_id: null,
          type: 'shell',
          title: 'Orphan shell',
          runtime_state: 'alive',
          turn_state: 'idle',
          turn_epoch: 0,
          last_turn_outcome: 'none',
          failure_reason: null,
          has_unseen_completion: false,
          runtime_exit_code: null,
          runtime_exit_reason: null,
          last_state_sequence: 3,
          blocking_reason: null,
          last_summary: 'alive',
          external_session_id: null,
          title_generation: {
            prompt: null,
            assistantSnippet: null,
            contextUpdatedAt: null,
            autoGeneratedTurnEpoch: null
          },
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
    expect(session.runtimeState).toBe('created')
    expect(session.turnState).toBe('idle')
    expect(session.lastTurnOutcome).toBe('none')
    expect(session.hasUnseenCompletion).toBe(false)
    expect(session.runtimeExitCode).toBeNull()
    expect(session.runtimeExitReason).toBeNull()
    expect(session.lastStateSequence).toBe(0)
    expect(session.blockingReason).toBeNull()
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

    await manager.setSetting('terminal', { fontSize: 16 })

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

  test('uses fresh-shell recovery for codex sessions without external ids and resume-external for claude-code', async () => {
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
      { sessionId: codex.id, action: 'fresh-shell' },
      {
        sessionId: claude.id,
        action: 'resume-external',
        externalSessionId: claude.externalSessionId
      }
    ])
  })

  describe('session lifecycle methods', () => {
    test('createSession initializes runtime created agent unknown and no unseen completion', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })

      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      expect(session.runtimeState).toBe('created')
      expect(session.turnState).toBe('idle')
      expect(session.lastTurnOutcome).toBe('none')
      expect(session.hasUnseenCompletion).toBe(false)
      expect(session.runtimeExitCode).toBeNull()
      expect(session.runtimeExitReason).toBeNull()
      expect(session.lastStateSequence).toBe(0)
      expect(session.blockingReason).toBeNull()
      expect(session.summary).toBe('Waiting for session to start')
      expect(session.titleGenerationContext).toEqual({
        prompt: null,
        assistantSnippet: null,
        contextUpdatedAt: null,
        autoGeneratedTurnEpoch: null
      })
    })

    test('createSession generates shell title when title is omitted', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'myproj', path: 'D:/repo' })

      const first = await manager.createSession({ projectId: project.id, type: 'shell', title: '' })
      const second = await manager.createSession({ projectId: project.id, type: 'shell', title: '' })

      expect(first.title).toBe('shell-1')
      expect(second.title).toBe('shell-2')
    })

  test('createSession generates provider title when title is omitted', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'myproj', path: 'D:/repo' })

      const session = await manager.createSession({ projectId: project.id, type: 'codex', title: '' })

      expect(session.title).toBe('codex-myproj')
    })

    test('createSession stores lineage for child sessions and persists it', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'tree' })
      const parent = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })

      const child = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child',
        parentSessionId: parent.id,
        createdBySessionId: parent.id
      })

      expect(child.parentSessionId).toBe(parent.id)
      expect(child.createdBySessionId).toBe(parent.id)

      const persisted = await readProjectSessions(projectDir)
      expect(persisted.version).toBe(7)
      expect(persisted.sessions.find((session) => session.session_id === child.id)).toMatchObject({
        parent_session_id: parent.id,
        created_by_session_id: parent.id
      })

      const reloaded = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      expect(reloaded.snapshot().sessions.find((session) => session.id === child.id)).toMatchObject({
        parentSessionId: parent.id,
        createdBySessionId: parent.id
      })
    })

    test('createSession rejects invalid parent ids and cross-project parents', async () => {
      const manager = ProjectSessionManager.createForTest()
      const alpha = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const beta = await manager.createProject({ name: 'beta', path: 'D:/beta' })
      const betaRoot = await manager.createSession({ projectId: beta.id, type: 'shell', title: 'beta-root' })

      await expect(manager.createSession({
        projectId: alpha.id,
        type: 'shell',
        title: 'missing-parent',
        parentSessionId: 'session_missing'
      })).rejects.toThrow('Parent session must exist')

      await expect(manager.createSession({
        projectId: alpha.id,
        type: 'shell',
        title: 'cross-project-child',
        parentSessionId: betaRoot.id
      })).rejects.toThrow('Parent session must belong to the same project')
    })

    test('createSession rejects archived parent sessions', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })

      await manager.archiveSession(root.id)

      await expect(manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'child-on-archived-parent',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })).rejects.toThrow('Parent session must be live')
    })

    test('createSession rejects invalid creator ids, cross-project creators, and parent creator mismatch', async () => {
      const manager = ProjectSessionManager.createForTest()
      const alpha = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const beta = await manager.createProject({ name: 'beta', path: 'D:/beta' })
      const alphaRoot = await manager.createSession({ projectId: alpha.id, type: 'shell', title: 'alpha-root' })
      const betaRoot = await manager.createSession({ projectId: beta.id, type: 'shell', title: 'beta-root' })

      await expect(manager.createSession({
        projectId: alpha.id,
        type: 'shell',
        title: 'missing-creator',
        createdBySessionId: 'session_missing'
      })).rejects.toThrow('Creator session must exist')

      await expect(manager.createSession({
        projectId: alpha.id,
        type: 'shell',
        title: 'cross-project-creator',
        createdBySessionId: betaRoot.id
      })).rejects.toThrow('Creator session must belong to the same project')

      await expect(manager.createSession({
        projectId: alpha.id,
        type: 'shell',
        title: 'mismatch',
        parentSessionId: alphaRoot.id,
        createdBySessionId: null
      })).rejects.toThrow('Creator session must equal parent session for direct children')

      await expect(manager.createSession({
        projectId: alpha.id,
        type: 'shell',
        title: 'mismatch-2',
        parentSessionId: alphaRoot.id,
        createdBySessionId: betaRoot.id
      })).rejects.toThrow('Creator session must belong to the same project')
    })

    test('createSession allows root sessions with null creator lineage', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })

      const root = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'root',
        createdBySessionId: null
      })

      expect(root.parentSessionId).toBeNull()
      expect(root.createdBySessionId).toBeNull()
    })

    test('createSession rejects creator lineage on root sessions without a parent', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const creator = await manager.createSession({ projectId: project.id, type: 'shell', title: 'creator' })

      await expect(manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'invalid-root',
        createdBySessionId: creator.id
      })).rejects.toThrow('Root sessions cannot declare createdBySessionId without parentSessionId')
    })

    test('derives session node snapshots with tree metadata', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })
      const childA = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child-a',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const childB = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'child-b',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const grandchild = await manager.createSession({
        projectId: project.id,
        type: 'claude-code',
        title: 'grandchild',
        parentSessionId: childA.id,
        createdBySessionId: childA.id
      })

      expect(manager.getSessionNodeSnapshot(root.id)).toMatchObject({
        session: { id: root.id },
        tree: {
          rootSessionId: root.id,
          depth: 0,
          childCount: 2,
          descendantCount: 3
        }
      })
      expect(manager.getSessionNodeSnapshot(childA.id)).toMatchObject({
        session: { id: childA.id },
        tree: {
          rootSessionId: root.id,
          depth: 1,
          childCount: 1,
          descendantCount: 1
        }
      })
      expect(manager.getSessionNodeSnapshot(grandchild.id)).toMatchObject({
        session: { id: grandchild.id },
        tree: {
          rootSessionId: root.id,
          depth: 2,
          childCount: 0,
          descendantCount: 0
        }
      })
      expect(manager.getSessionNodeSnapshot(childB.id)).toMatchObject({
        session: { id: childB.id },
        tree: {
          rootSessionId: root.id,
          depth: 1,
          childCount: 0,
          descendantCount: 0
        }
      })
      expect(manager.getSessionNodeSnapshot('missing-session')).toBeNull()
    })

    test('updateSessionTitle overwrites title and persists title generation context', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'codex', title: 'codex-test' })

      const updated = await manager.updateSessionTitle(session.id, 'Investigate runtime leak', {
        prompt: 'investigate the runtime leak in pty cleanup',
        assistantSnippet: 'I found the stale process handle in shutdown cleanup.',
        contextUpdatedAt: '2026-05-18T08:00:00.000Z',
        autoGeneratedTurnEpoch: 1
      })

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Investigate runtime leak')
      expect(updated?.titleGenerationContext).toEqual({
        prompt: 'investigate the runtime leak in pty cleanup',
        assistantSnippet: 'I found the stale process handle in shutdown cleanup.',
        contextUpdatedAt: '2026-05-18T08:00:00.000Z',
        autoGeneratedTurnEpoch: 1
      })

      const persisted = await readProjectSessions(projectDir)
      expect(persisted.sessions[0]?.title).toBe('Investigate runtime leak')
      expect(persisted.sessions[0]?.title_generation).toEqual({
        prompt: 'investigate the runtime leak in pty cleanup',
        assistantSnippet: 'I found the stale process handle in shutdown cleanup.',
        contextUpdatedAt: '2026-05-18T08:00:00.000Z',
        autoGeneratedTurnEpoch: 1
      })
    })

    test('updateSessionTitleGenerationContext persists prompt and assistant snippet without changing title', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'Claude Session' })

      const updated = await manager.updateSessionTitleGenerationContext(session.id, {
        prompt: 'summarize the first valid user request',
        assistantSnippet: 'Patched the session restart race and added coverage.',
        contextUpdatedAt: '2026-05-18T08:10:00.000Z'
      })

      expect(updated?.title).toBe('Claude Session')
      expect(updated?.titleGenerationContext).toEqual({
        prompt: 'summarize the first valid user request',
        assistantSnippet: 'Patched the session restart race and added coverage.',
        contextUpdatedAt: '2026-05-18T08:10:00.000Z',
        autoGeneratedTurnEpoch: null
      })

      const reloaded = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      expect(reloaded.snapshot().sessions[0]?.titleGenerationContext).toEqual({
        prompt: 'summarize the first valid user request',
        assistantSnippet: 'Patched the session restart race and added coverage.',
        contextUpdatedAt: '2026-05-18T08:10:00.000Z',
        autoGeneratedTurnEpoch: null
      })
    })

    test('markRuntimeStarting resets stale agent state and unseen completion', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'S1' })

      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        intent: 'runtime.alive',
        source: 'runtime',
        summary: 'alive'
      })
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.turn_completed',
        source: 'provider',
        summary: 'complete'
      })
      await manager.markRuntimeExited(session.id, 1, 'failed')

      await manager.markRuntimeStarting(session.id, 'starting again', 'claude-real-123')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.runtimeState).toBe('starting')
      expect(updated.turnState).toBe('idle')
      expect(updated.lastTurnOutcome).toBe('none')
      expect(updated.hasUnseenCompletion).toBe(false)
      expect(updated.runtimeExitCode).toBeNull()
      expect(updated.runtimeExitReason).toBeNull()
      expect(updated.blockingReason).toBeNull()
      expect(updated.externalSessionId).toBe('claude-real-123')
      expect(updated.summary).toBe('starting again')
      expect(updated.lastStateSequence).toBe(4)
    })

    test('markRuntimeAlive does not set agent working', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.markRuntimeAlive(session.id, 'opencode-real-123')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.runtimeState).toBe('alive')
      expect(updated.turnState).toBe('idle')
      expect(updated.lastTurnOutcome).toBe('none')
      expect(updated.hasUnseenCompletion).toBe(false)
      expect(updated.externalSessionId).toBe('opencode-real-123')
      expect(updated.summary).toBe('Session running')
      expect(updated.lastStateSequence).toBe(1)
    })

    test('applySessionStatePatch turns Claude completion into idle plus unseen completion', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'S1' })

      await manager.markRuntimeAlive(session.id, 'claude-real-123')
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.turn_completed',
        source: 'provider',
        sourceEventType: 'Stop',
        turnEpoch: 1,
        summary: 'Claude completed'
      })

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.turnState).toBe('idle')
      expect(updated.lastTurnOutcome).toBe('completed')
      expect(updated.hasUnseenCompletion).toBe(true)
      expect(updated.summary).toBe('Claude completed')
      expect(updated.lastStateSequence).toBe(2)
    })

    test('setActiveSession marks complete sessions as seen', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const first = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'S1' })
      const second = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S2' })

      await manager.markRuntimeAlive(first.id, 'claude-real-123')
      await manager.applySessionStatePatch({
        sessionId: first.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.turn_completed',
        source: 'provider',
        turnEpoch: 1,
        summary: 'Claude completed'
      })
      await manager.setActiveSession(second.id)

      await manager.setActiveSession(first.id)

      const updated = manager.snapshot().sessions.find(s => s.id === first.id)!
      expect(updated.turnState).toBe('idle')
      expect(updated.lastTurnOutcome).toBe('completed')
      expect(updated.hasUnseenCompletion).toBe(false)
      expect(updated.summary).toBe('Completion seen')
      expect(updated.lastStateSequence).toBe(3)
    })

    test('persists project session schema v7 without legacy status', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markRuntimeStarting(session.id, 'starting...', null)

      const diskSessions = await readProjectSessions(projectDir)
      expect(diskSessions.version).toBe(7)
      expect(diskSessions.sessions[0]).toMatchObject({
        runtime_state: 'starting',
        turn_state: 'idle',
        turn_epoch: 0,
        last_turn_outcome: 'none',
        failure_reason: null,
        has_unseen_completion: false,
        runtime_exit_code: null,
        runtime_exit_reason: null,
        last_state_sequence: 1,
        blocking_reason: null,
        last_summary: 'starting...'
      })
      const legacyStatusField = ['last', 'known', 'status'].join('_')
      expect(Object.prototype.hasOwnProperty.call(diskSessions.sessions[0]!, legacyStatusField)).toBe(false)
    })

    test('markRuntimeStarting updates runtime state and summary', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markRuntimeStarting(session.id, '正在启动 shell', null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.runtimeState).toBe('starting')
      expect(updated.summary).toBe('正在启动 shell')
    })

    test('markRuntimeAlive preserves null externalSessionId for fresh shell starts', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markRuntimeAlive(session.id, null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.runtimeState).toBe('alive')
      expect(updated.externalSessionId).toBeNull()
      expect(updated.summary).toBe('Session running')
    })

    test('markRuntimeAlive does not invent a session id for shell sessions', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'test', path: 'D:/test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markRuntimeAlive(session.id, null)

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.externalSessionId).toBeNull()
    })

    test('markRuntimeAlive preserves idle agent state when runtime becomes active again', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.markRuntimeAlive(session.id, 'opencode-real-123')
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.recovered',
        source: 'provider',
        summary: 'session.idle'
      })
      await manager.markRuntimeAlive(session.id, 'opencode-real-456')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.runtimeState).toBe('alive')
      expect(updated.turnState).toBe('idle')
      expect(updated.lastTurnOutcome).toBe('none')
      expect(updated.summary).toBe('Session running')
      expect(updated.externalSessionId).toBe('opencode-real-456')
    })

    test('markRuntimeAlive preserves blocked and failed states while refreshing externalSessionId', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const blockedSession = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'blocked' })
      const failedSession = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'failed' })

      await manager.markRuntimeAlive(blockedSession.id, 'claude-real-123')
      await manager.markRuntimeAlive(failedSession.id, 'claude-real-456')
      await manager.applySessionStatePatch({
        sessionId: blockedSession.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.permission_requested',
        source: 'provider',
        turnEpoch: 1,
        summary: 'PermissionRequest',
        blockingReason: 'permission'
      })
      await manager.applySessionStatePatch({
        sessionId: failedSession.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.turn_failed',
        source: 'provider',
        turnEpoch: 1,
        failureReason: 'provider_error',
        summary: 'Provider error'
      })
      await manager.markRuntimeAlive(blockedSession.id, 'claude-real-789')
      await manager.markRuntimeAlive(failedSession.id, 'claude-real-999')

      const updatedBlocked = manager.snapshot().sessions.find(s => s.id === blockedSession.id)!
      const updatedFailed = manager.snapshot().sessions.find(s => s.id === failedSession.id)!
      expect(updatedBlocked.turnState).toBe('running')
      expect(updatedBlocked.blockingReason).toBe('permission')
      expect(updatedBlocked.summary).toBe('PermissionRequest')
      expect(updatedBlocked.externalSessionId).toBe('claude-real-789')
      expect(updatedFailed.turnState).toBe('idle')
      expect(updatedFailed.lastTurnOutcome).toBe('failed')
      expect(updatedFailed.failureReason).toBe('provider_error')
      expect(updatedFailed.summary).toBe('Provider error')
      expect(updatedFailed.externalSessionId).toBe('claude-real-999')
    })

    test('markRuntimeExited updates runtime state and summary', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markRuntimeExited(session.id, 0, 'shell exited (0)')

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.runtimeState).toBe('exited')
      expect(updated.runtimeExitCode).toBe(0)
      expect(updated.runtimeExitReason).toBe('clean')
      expect(updated.summary).toBe('shell exited (0)')
    })

    test('applySessionStatePatch assigns externalSessionId on first provider patch', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        intent: 'runtime.alive',
        source: 'provider',
        summary: 'Running',
        externalSessionId: 'opencode-abc'
      })

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.externalSessionId).toBe('opencode-abc')
    })

    test('applySessionStatePatch reconciles externalSessionId when provider switches sessions', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'claude-code', title: 'S1' })

      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        intent: 'runtime.alive',
        source: 'provider',
        summary: 'Running',
        externalSessionId: 'original-id'
      })
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'runtime.alive',
        source: 'provider',
        summary: 'Running',
        externalSessionId: 'new-id-after-resume'
      })

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.externalSessionId).toBe('new-id-after-resume')
    })

    test('applySessionStatePatch preserves matching externalSessionId across later provider patches', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        intent: 'runtime.alive',
        source: 'provider',
        summary: 'Running',
        externalSessionId: 'stable-id'
      })
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.turn_completed',
        source: 'provider',
        summary: 'Stop',
        externalSessionId: 'stable-id',
        turnEpoch: 1
      })

      const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
      expect(updated.externalSessionId).toBe('stable-id')
    })

    test('applySessionStatePatch preserves omitted externalSessionId and allows explicit null clearing', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'opencode', title: 'S1' })

      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        intent: 'runtime.alive',
        source: 'provider',
        summary: 'Running',
        externalSessionId: 'original-id'
      })
      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 2,
        occurredAt: '2026-04-24T00:00:01.000Z',
        intent: 'agent.turn_completed',
        source: 'provider',
        summary: 'Stop',
        turnEpoch: 1
      })
      expect(manager.snapshot().sessions.find(s => s.id === session.id)!.externalSessionId).toBe('original-id')

      await manager.applySessionStatePatch({
        sessionId: session.id,
        sequence: 3,
        occurredAt: '2026-04-24T00:00:02.000Z',
        intent: 'runtime.alive',
        source: 'provider',
        summary: 'Running',
        externalSessionId: null
      })
      expect(manager.snapshot().sessions.find(s => s.id === session.id)!.externalSessionId).toBeNull()
    })

    test('lifecycle methods are no-ops for unknown session IDs', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      await expect(manager.markRuntimeStarting('nonexistent', 'x', null)).resolves.toBeUndefined()
      await expect(manager.markRuntimeAlive('nonexistent', null)).resolves.toBeUndefined()
      await expect(manager.markRuntimeExited('nonexistent', null, 'x')).resolves.toBeUndefined()
      await expect(manager.markRuntimeFailedToStart('nonexistent', 'x')).resolves.toBeUndefined()
      await expect(manager.markCompletionSeen('nonexistent')).resolves.toBeUndefined()
    })

    test('markRuntimeStarting persists to project sessions file', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const project = await manager.createProject({ path: projectDir, name: 'test' })
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

      await manager.markRuntimeStarting(session.id, 'starting...', null)

      const diskSessions = await readProjectSessions(projectDir)
      expect(diskSessions.sessions[0]!.runtime_state).toBe('starting')
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
      expect(manager.snapshot().activeSessionId).toBeNull()
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

    test('deleteProject clears dangling activeSessionId after switching active project', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const dir1 = await createTempProjectDir()
      const dir2 = await createTempProjectDir()
      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      const p1 = await manager.createProject({ path: dir1, name: 'P1' })
      const p2 = await manager.createProject({ path: dir2, name: 'P2' })
      const s1 = await manager.createSession({ projectId: p1.id, type: 'shell', title: 'S1' })
      await manager.createSession({ projectId: p2.id, type: 'shell', title: 'S2' })

      await manager.setActiveSession(s1.id)
      await manager.setActiveProject(p2.id)
      await manager.deleteProject(p1.id)

      const snapshot = manager.snapshot()
      expect(snapshot.activeProjectId).toBe(p2.id)
      expect(snapshot.activeSessionId).toBeNull()
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

    test('archiveSession archives the full subtree', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })
      const child = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const grandchild = await manager.createSession({
        projectId: project.id,
        type: 'claude-code',
        title: 'grandchild',
        parentSessionId: child.id,
        createdBySessionId: child.id
      })

      await manager.archiveSession(root.id)

      const snapshot = manager.snapshot()
      expect(snapshot.sessions.find((session) => session.id === root.id)?.archived).toBe(true)
      expect(snapshot.sessions.find((session) => session.id === child.id)?.archived).toBe(true)
      expect(snapshot.sessions.find((session) => session.id === grandchild.id)?.archived).toBe(true)
      expect(manager.snapshot().activeSessionId).toBeNull()
    })

    test('archiveSession on a child archives only the requested subtree', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })
      const child = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const sibling = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'sibling',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const grandchild = await manager.createSession({
        projectId: project.id,
        type: 'claude-code',
        title: 'grandchild',
        parentSessionId: child.id,
        createdBySessionId: child.id
      })

      await manager.archiveSession(child.id)

      const snapshot = manager.snapshot()
      expect(snapshot.sessions.find((session) => session.id === root.id)?.archived).toBe(false)
      expect(snapshot.sessions.find((session) => session.id === child.id)?.archived).toBe(true)
      expect(snapshot.sessions.find((session) => session.id === sibling.id)?.archived).toBe(false)
      expect(snapshot.sessions.find((session) => session.id === grandchild.id)?.archived).toBe(true)
    })

    test('restoreSession restores only the requested subtree and activates the requested session', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })
      const child = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const grandchild = await manager.createSession({
        projectId: project.id,
        type: 'claude-code',
        title: 'grandchild',
        parentSessionId: child.id,
        createdBySessionId: child.id
      })

      await manager.archiveSession(root.id)
      await manager.restoreSession(child.id)

      const snapshot = manager.snapshot()
      expect(snapshot.sessions.find((session) => session.id === root.id)?.archived).toBe(true)
      expect(snapshot.sessions.find((session) => session.id === child.id)?.archived).toBe(false)
      expect(snapshot.sessions.find((session) => session.id === grandchild.id)?.archived).toBe(false)
      expect(snapshot.activeProjectId).toBe(project.id)
      expect(snapshot.activeSessionId).toBe(child.id)
    })

    test('restoreSession does not restore archived ancestors outside the requested subtree', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({ projectId: project.id, type: 'shell', title: 'root' })
      const child = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const sibling = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'sibling',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })

      await manager.archiveSession(root.id)
      await manager.restoreSession(child.id)

      const snapshot = manager.snapshot()
      expect(snapshot.sessions.find((session) => session.id === root.id)?.archived).toBe(true)
      expect(snapshot.sessions.find((session) => session.id === child.id)?.archived).toBe(false)
      expect(snapshot.sessions.find((session) => session.id === sibling.id)?.archived).toBe(true)
    })

    test('buildBootstrapRecoveryPlan orders parents before descendants and excludes archived subtrees', async () => {
      const manager = ProjectSessionManager.createForTest()
      const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
      const root = await manager.createSession({
        projectId: project.id,
        type: 'claude-code',
        title: 'root'
      })
      const child = await manager.createSession({
        projectId: project.id,
        type: 'codex',
        title: 'child',
        parentSessionId: root.id,
        createdBySessionId: root.id
      })
      const grandchild = await manager.createSession({
        projectId: project.id,
        type: 'shell',
        title: 'grandchild',
        parentSessionId: child.id,
        createdBySessionId: child.id
      })
      const siblingRoot = await manager.createSession({
        projectId: project.id,
        type: 'opencode',
        title: 'sibling',
        externalSessionId: 'sibling-ext'
      })

      await manager.archiveSession(siblingRoot.id)

      const plan = manager.buildBootstrapRecoveryPlan()
      expect(plan.map((entry) => entry.sessionId)).toEqual([root.id, child.id, grandchild.id])
      expect(plan).toEqual([
        {
          sessionId: root.id,
          action: 'resume-external',
          externalSessionId: root.externalSessionId
        },
        {
          sessionId: child.id,
          action: 'fresh-shell'
        },
        {
          sessionId: grandchild.id,
          action: 'fresh-shell'
        }
      ])
    })

    test('buildBootstrapRecoveryPlan includes orphan sessions as additional roots', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const now = new Date().toISOString()

      await stateStore.writeGlobalState({
        version: 4,
        active_project_id: 'project_real',
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
        version: 7,
        project_id: 'project_real',
        sessions: [
          {
            session_id: 'session_orphan',
            project_id: 'project_real',
            parent_session_id: 'session_missing_parent',
            created_by_session_id: 'session_missing_parent',
            type: 'shell',
            title: 'orphan',
            runtime_state: 'created',
            turn_state: 'idle',
            turn_epoch: 0,
            last_turn_outcome: 'none',
            blocking_reason: null,
            failure_reason: null,
            has_unseen_completion: false,
            runtime_exit_code: null,
            runtime_exit_reason: null,
            last_state_sequence: 0,
            last_summary: 'Waiting',
            external_session_id: null,
            title_generation: {
              prompt: null,
              assistantSnippet: null,
              contextUpdatedAt: null,
              autoGeneratedTurnEpoch: null
            },
            created_at: now,
            updated_at: now,
            last_activated_at: now,
            recovery_mode: 'fresh-shell',
            archived: false
          }
        ]
      })

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
      expect(manager.buildBootstrapRecoveryPlan()).toEqual([
        { sessionId: 'session_orphan', action: 'fresh-shell' }
      ])
      expect(manager.getSessionNodeSnapshot('session_orphan')).toMatchObject({
        tree: {
          rootSessionId: 'session_orphan',
          depth: 0,
          childCount: 0,
          descendantCount: 0
        }
      })
    })

    test('tree traversal helpers tolerate lineage cycles without infinite loops', async () => {
      const globalStatePath = await createTempGlobalStatePath()
      const projectDir = await createTempProjectDir()
      const now = new Date().toISOString()

      await stateStore.writeGlobalState({
        version: 4,
        active_project_id: 'project_real',
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
        version: 7,
        project_id: 'project_real',
        sessions: [
          {
            session_id: 'session_a',
            project_id: 'project_real',
            parent_session_id: 'session_b',
            created_by_session_id: 'session_b',
            type: 'shell',
            title: 'A',
            runtime_state: 'created',
            turn_state: 'idle',
            turn_epoch: 0,
            last_turn_outcome: 'none',
            blocking_reason: null,
            failure_reason: null,
            has_unseen_completion: false,
            runtime_exit_code: null,
            runtime_exit_reason: null,
            last_state_sequence: 0,
            last_summary: 'Waiting',
            external_session_id: null,
            title_generation: {
              prompt: null,
              assistantSnippet: null,
              contextUpdatedAt: null,
              autoGeneratedTurnEpoch: null
            },
            created_at: now,
            updated_at: now,
            last_activated_at: now,
            recovery_mode: 'fresh-shell',
            archived: false
          },
          {
            session_id: 'session_b',
            project_id: 'project_real',
            parent_session_id: 'session_a',
            created_by_session_id: 'session_a',
            type: 'shell',
            title: 'B',
            runtime_state: 'created',
            turn_state: 'idle',
            turn_epoch: 0,
            last_turn_outcome: 'none',
            blocking_reason: null,
            failure_reason: null,
            has_unseen_completion: false,
            runtime_exit_code: null,
            runtime_exit_reason: null,
            last_state_sequence: 0,
            last_summary: 'Waiting',
            external_session_id: null,
            title_generation: {
              prompt: null,
              assistantSnippet: null,
              contextUpdatedAt: null,
              autoGeneratedTurnEpoch: null
            },
            created_at: now,
            updated_at: now,
            last_activated_at: now,
            recovery_mode: 'fresh-shell',
            archived: false
          }
        ]
      })

      const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })

      const plan = manager.buildBootstrapRecoveryPlan()
      expect(plan.map((entry) => entry.sessionId).sort()).toEqual(['session_a', 'session_b'])

      expect(manager.getSessionNodeSnapshot('session_a')).toMatchObject({
        tree: {
          childCount: 1,
          descendantCount: 1
        }
      })
      expect(manager.getSessionNodeSnapshot('session_b')).toMatchObject({
        tree: {
          childCount: 1,
          descendantCount: 1
        }
      })
      expect(['session_a', 'session_b']).toContain(manager.getSessionNodeSnapshot('session_a')?.tree.rootSessionId)
      expect(['session_a', 'session_b']).toContain(manager.getSessionNodeSnapshot('session_b')?.tree.rootSessionId)
    })
  })
})
