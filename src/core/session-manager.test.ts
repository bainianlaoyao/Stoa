import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'vitest'
import { SessionManager } from './session-manager'
import type { CanonicalWorkspaceEvent } from '@shared/workspace'

const tempDirs: string[] = []

async function createTempStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vibecoding-session-manager-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

describe('SessionManager', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.splice(0).map(async (dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
  })

  test('creates default local shell workspace and persists active workspace state', async () => {
    const stateFilePath = await createTempStatePath()

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    const snapshot = manager.snapshot()

    expect(snapshot.activeWorkspaceId).toBe('ws_local_shell')
    expect(snapshot.terminalWebhookPort).toBe(43127)
    expect(snapshot.workspaces).toHaveLength(1)
    expect(snapshot.workspaces[0]?.path).toBe('D:/Data/DEV/ultra_simple_panel')

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      active_workspace_id: string
      workspaces: Array<{ workspace_id: string }>
    }

    expect(persisted.active_workspace_id).toBe('ws_local_shell')
    expect(persisted.workspaces[0]?.workspace_id).toBe('ws_local_shell')
  })

  test('re-hydrates persisted workspace state and updates cli session on events', async () => {
    const stateFilePath = await createTempStatePath()

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    await manager.markWorkspaceStarting('ws_local_shell', 'starting shell', null)
    await manager.markWorkspaceRunning('ws_local_shell', 'shell-123')

    const restored = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    const snapshot = restored.snapshot()

    expect(snapshot.workspaces[0]?.cliSessionId).toBe('shell-123')
    expect(snapshot.workspaces[0]?.status).toBe('running')
    expect(snapshot.workspaces[0]?.isProvisional).toBe(true)
  })

  test('deduplicates events by event_id and preserves the first accepted transition', async () => {
    const stateFilePath = await createTempStatePath()

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    const event: CanonicalWorkspaceEvent = {
      event_version: 1,
      event_id: 'evt_dedupe_1',
      event_type: 'workspace.status_changed',
      timestamp: '2026-04-18T10:00:00.000Z',
      workspace_id: 'ws_local_shell',
      provider_id: 'local-shell',
      session_id: null,
      source: 'provider-adapter',
      payload: {
        status: 'starting',
        summary: 'first event wins',
        is_provisional: false
      }
    }

    await manager.handleWebhookEvent(event)
    await manager.handleWebhookEvent({
      ...event,
      session_id: 'shell-dup-1',
      payload: {
        status: 'running',
        summary: 'duplicate should be ignored',
        is_provisional: false
      }
    })

    const snapshot = manager.snapshot()
    expect(snapshot.workspaces[0]?.status).toBe('starting')
    expect(snapshot.workspaces[0]?.summary).toBe('first event wins')
    expect(snapshot.workspaces[0]?.cliSessionId).toBe(null)
  })

  test('rejects illegal state transitions and keeps the last legal state', async () => {
    const stateFilePath = await createTempStatePath()

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    await manager.handleWebhookEvent({
      event_version: 1,
      event_id: 'evt_starting_1',
      event_type: 'workspace.status_changed',
      timestamp: '2026-04-18T10:00:00.000Z',
      workspace_id: 'ws_local_shell',
      provider_id: 'local-shell',
      session_id: 'shell-legal-1',
      source: 'provider-adapter',
      payload: {
        status: 'starting',
        summary: 'starting legally',
        is_provisional: false
      }
    })

    await manager.handleWebhookEvent({
      event_version: 1,
      event_id: 'evt_bad_1',
      event_type: 'workspace.status_changed',
      timestamp: '2026-04-18T10:01:00.000Z',
      workspace_id: 'ws_local_shell',
      provider_id: 'local-shell',
      session_id: 'shell-legal-1',
      source: 'provider-adapter',
      payload: {
        status: 'awaiting_input',
        summary: 'illegal jump from starting',
        is_provisional: false
      }
    })

    const snapshot = manager.snapshot()
    expect(snapshot.workspaces[0]?.status).toBe('starting')
    expect(snapshot.workspaces[0]?.summary).toBe('starting legally')
  })

  test('stores runtime-only workspace metadata without leaking it into persisted state', async () => {
    const stateFilePath = await createTempStatePath()

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    await manager.configureWorkspaceRuntime('ws_local_shell', {
      workspaceSecret: 'secret-qa-1',
      providerPort: 43128
    })

    const snapshot = manager.snapshot()
    expect(snapshot.workspaces[0]?.workspaceSecret).toBe('secret-qa-1')
    expect(snapshot.workspaces[0]?.providerPort).toBe(43128)
    expect(manager.getWorkspaceSecret('ws_local_shell')).toBe('secret-qa-1')

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      workspaces: Array<Record<string, unknown>>
    }

    expect(persisted.workspaces[0]?.workspaceSecret).toBeUndefined()
    expect(persisted.workspaces[0]?.providerPort).toBeUndefined()
  })

  test('filters persisted workspaces whose paths no longer exist during recovery', async () => {
    const stateFilePath = await createTempStatePath()
    const validWorkspacePath = join(tempDirs[0]!, 'valid-workspace')
    await mkdir(validWorkspacePath, { recursive: true })

    await writeFile(stateFilePath, JSON.stringify({
      version: 1,
      active_workspace_id: 'ws_alive',
      workspaces: [
        {
          workspace_id: 'ws_alive',
          path: validWorkspacePath,
          name: 'alive',
          provider_id: 'opencode',
          last_cli_session_id: 'chat-live',
          last_known_status: 'running',
          updated_at: '2026-04-18T10:00:00.000Z'
        },
        {
          workspace_id: 'ws_dead',
          path: 'D:/definitely/missing/workspace',
          name: 'dead',
          provider_id: 'opencode',
          last_cli_session_id: 'chat-dead',
          last_known_status: 'running',
          updated_at: '2026-04-18T10:00:00.000Z'
        }
      ]
    }, null, 2), 'utf-8')

    const restored = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    const snapshot = restored.snapshot()
    expect(snapshot.workspaces).toHaveLength(1)
    expect(snapshot.workspaces[0]?.workspaceId).toBe('ws_alive')
    expect(snapshot.activeWorkspaceId).toBe('ws_alive')
  })

  test('degrades recovered running workspace to needs_confirmation when resume must be confirmed', async () => {
    const stateFilePath = await createTempStatePath()
    const validWorkspacePath = join(tempDirs[0]!, 'resume-workspace')
    await mkdir(validWorkspacePath, { recursive: true })

    await writeFile(stateFilePath, JSON.stringify({
      version: 1,
      active_workspace_id: 'ws_resume',
      workspaces: [
        {
          workspace_id: 'ws_resume',
          path: validWorkspacePath,
          name: 'resume',
          provider_id: 'opencode',
          last_cli_session_id: null,
          last_known_status: 'running',
          updated_at: '2026-04-18T10:00:00.000Z'
        }
      ]
    }, null, 2), 'utf-8')

    const restored = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    const snapshot = restored.snapshot()
    expect(snapshot.workspaces[0]?.status).toBe('needs_confirmation')
    expect(snapshot.workspaces[0]?.summary).toContain('确认')
    expect(snapshot.workspaces[0]?.isProvisional).toBe(true)
  })

  test('adds and persists a second workspace without replacing the active one unless requested', async () => {
    const stateFilePath = await createTempStatePath()
    const workspacePath = join(tempDirs[0]!, 'second-workspace')
    await mkdir(workspacePath, { recursive: true })

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    const created = await manager.addWorkspace({
      path: workspacePath,
      name: 'second',
      providerId: 'opencode'
    })

    const snapshot = manager.snapshot()
    expect(snapshot.workspaces).toHaveLength(2)
    expect(snapshot.activeWorkspaceId).toBe('ws_local_shell')
    expect(created.workspaceId).not.toBe('ws_local_shell')
    expect(snapshot.workspaces[1]?.providerId).toBe('opencode')
    expect(snapshot.workspaces[1]?.status).toBe('bootstrapping')

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      workspaces: Array<{ workspace_id: string; provider_id: string }>
    }
    expect(persisted.workspaces).toHaveLength(2)
    expect(persisted.workspaces[1]?.provider_id).toBe('opencode')
  })

  test('rejects creating a workspace for a missing path', async () => {
    const stateFilePath = await createTempStatePath()

    const manager = await SessionManager.create({
      projectPath: 'D:/Data/DEV/ultra_simple_panel',
      webhookPort: 43127,
      stateFilePath
    })

    await expect(manager.addWorkspace({
      path: 'D:/definitely/missing/workspace',
      name: 'missing',
      providerId: 'local-shell'
    })).rejects.toThrow('Workspace path does not exist')
  })
})
