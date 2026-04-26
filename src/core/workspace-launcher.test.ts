import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { AppSettings, ProjectSummary, SessionSummary } from '@shared/project-session'
import { DEFAULT_SETTINGS } from '@shared/project-session'

const mockDetectVscode = vi.hoisted(() => vi.fn<() => Promise<string | null>>().mockResolvedValue(null))
vi.mock('@core/settings-detector', async () => {
  const actual = await vi.importActual<typeof import('@core/settings-detector')>('@core/settings-detector')
  return { ...actual, detectVscode: mockDetectVscode }
})

import { openWorkspace, validateOpenWorkspaceRequest } from './workspace-launcher'

function projectFixture(path: string, patch: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project_1',
    name: 'Alpha',
    path,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

function sessionFixture(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'shell',
    runtimeState: 'alive',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 0,
    blockingReason: null,
    title: 'shell-1',
    summary: 'Shell',
    recoveryMode: 'fresh-shell',
    externalSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastActivatedAt: null,
    archived: false,
    ...patch
  }
}

function settingsFixture(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...patch.providers
    },
    workspaceIde: {
      ...DEFAULT_SETTINGS.workspaceIde,
      ...patch.workspaceIde
    }
  }
}

describe('workspace launcher', () => {
  test('rejects invalid IPC payloads before resolving state', () => {
    expect(() => validateOpenWorkspaceRequest(null)).toThrow('Invalid workspace open request.')
    expect(() => validateOpenWorkspaceRequest({ sessionId: '', target: 'ide' })).toThrow('Invalid workspace open request.')
    expect(() => validateOpenWorkspaceRequest({ sessionId: 'session_1', target: 'unknown' })).toThrow('Invalid workspace open target.')
  })

  test('rejects missing session before touching the filesystem', async () => {
    await expect(openWorkspace({
      request: { sessionId: 'missing_session', target: 'file-manager' },
      projects: [projectFixture('D:/missing')],
      sessions: [sessionFixture()],
      settings: settingsFixture(),
      shellOpenPath: vi.fn(),
      spawnProcess: vi.fn()
    })).rejects.toThrow('Unable to open workspace: session was not found.')
  })

  test('rejects missing parent project', async () => {
    await expect(openWorkspace({
      request: { sessionId: 'session_1', target: 'file-manager' },
      projects: [],
      sessions: [sessionFixture()],
      settings: settingsFixture(),
      shellOpenPath: vi.fn(),
      spawnProcess: vi.fn()
    })).rejects.toThrow('Unable to open workspace: project was not found.')
  })

  test('rejects project paths that are not directories', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-file-'))
    const filePath = join(tempDir, 'not-a-directory.txt')
    await writeFile(filePath, 'not a directory', 'utf8')

    await expect(openWorkspace({
      request: { sessionId: 'session_1', target: 'file-manager' },
      projects: [projectFixture(filePath)],
      sessions: [sessionFixture()],
      settings: settingsFixture(),
      shellOpenPath: vi.fn(),
      spawnProcess: vi.fn()
    })).rejects.toThrow('Unable to open workspace: project path is not a directory.')
  })

  test('opens the project directory through the OS file browser', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-open-'))
    const shellOpenPath = vi.fn().mockResolvedValue('')

    await openWorkspace({
      request: { sessionId: 'session_1', target: 'file-manager' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture(),
      shellOpenPath,
      spawnProcess: vi.fn()
    })

    expect(shellOpenPath).toHaveBeenCalledWith(workspaceDir)
  })

  test('surfaces OS file browser failures', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-open-error-'))

    await expect(openWorkspace({
      request: { sessionId: 'session_1', target: 'file-manager' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture(),
      shellOpenPath: vi.fn().mockResolvedValue('access denied'),
      spawnProcess: vi.fn()
    })).rejects.toThrow('Unable to open workspace in file browser: access denied')
  })

  test('launches VS Code with structured detached spawn options', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-code-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'stoa-code-bin-'))
    const executablePath = join(executableDir, 'code.cmd')
    await writeFile(executablePath, '@echo off', 'utf8')
    const child = { unref: vi.fn() }
    const spawnProcess = vi.fn().mockReturnValue(child)

    await openWorkspace({
      request: { sessionId: 'session_1', target: 'ide' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture({ workspaceIde: { id: 'vscode', executablePath } }),
      shellOpenPath: vi.fn(),
      spawnProcess
    })

    expect(spawnProcess).toHaveBeenCalledWith(executablePath, [workspaceDir], expect.objectContaining({
      cwd: workspaceDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    }))
    expect(child.unref).toHaveBeenCalledOnce()
  })

  test('rejects configured VS Code directories before spawn', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-code-dir-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'stoa-code-dir-'))
    const spawnProcess = vi.fn()

    await expect(openWorkspace({
      request: { sessionId: 'session_1', target: 'ide' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture({ workspaceIde: { id: 'vscode', executablePath: executableDir } }),
      shellOpenPath: vi.fn(),
      spawnProcess
    })).rejects.toThrow('Unable to open workspace in VS Code. Configure the VS Code executable path in settings.')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  test('uses configured VS Code path before auto-detect candidates', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-code-configured-'))
    const executableDir = await mkdtemp(join(tmpdir(), 'stoa-code-configured-'))
    const executablePath = join(executableDir, 'custom-code.cmd')
    await writeFile(executablePath, '@echo off', 'utf8')
    const spawnProcess = vi.fn().mockReturnValue({ unref: vi.fn() })

    await openWorkspace({
      request: { sessionId: 'session_1', target: 'ide' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture({ workspaceIde: { id: 'vscode', executablePath } }),
      shellOpenPath: vi.fn(),
      spawnProcess
    })

    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(spawnProcess).toHaveBeenCalledWith(executablePath, [workspaceDir], expect.any(Object))
  })

  test('tries VS Code auto-detect candidates when executable path is empty', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-code-auto-'))
    const spawnProcess = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('missing code')
      })
      .mockReturnValueOnce({ unref: vi.fn() })

    await openWorkspace({
      request: { sessionId: 'session_1', target: 'ide' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture({ workspaceIde: { id: 'vscode', executablePath: '' } }),
      shellOpenPath: vi.fn(),
      spawnProcess
    })

    expect(spawnProcess).toHaveBeenNthCalledWith(1, 'code', [workspaceDir], expect.any(Object))
    expect(spawnProcess).toHaveBeenNthCalledWith(2, 'code.cmd', [workspaceDir], expect.any(Object))
  })

  test('surfaces VS Code spawn failures', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-code-fail-'))

    await expect(openWorkspace({
      request: { sessionId: 'session_1', target: 'ide' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: settingsFixture({ workspaceIde: { id: 'vscode', executablePath: '' } }),
      shellOpenPath: vi.fn(),
      spawnProcess: vi.fn().mockImplementation(() => {
        throw new Error('spawn failed')
      })
    })).rejects.toThrow('Unable to open workspace in VS Code. Configure the VS Code executable path in settings.')
  })
})
