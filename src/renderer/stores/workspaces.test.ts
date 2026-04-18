import { beforeEach, describe, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from './workspaces'
import type { WorkspaceEvent } from '@shared/workspace'

describe('workspace store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('hydrates bootstrap state and active workspace', () => {
    const store = useWorkspaceStore()

    store.hydrate({
      activeWorkspaceId: 'ws_demo_001',
      terminalWebhookPort: 43127,
      workspaces: [
        {
          workspaceId: 'ws_demo_001',
          name: 'demo',
          path: 'D:/demo',
          providerId: 'opencode',
          status: 'bootstrapping',
          summary: 'bootstrapping',
          cliSessionId: null,
          isProvisional: true,
          workspaceSecret: null,
          providerPort: null
        }
      ]
    })

    expect(store.activeWorkspaceId).toBe('ws_demo_001')
    expect(store.workspaces).toHaveLength(1)
    expect(store.activeWorkspace?.summary).toBe('bootstrapping')
  })

  test('applies workspace event updates without creating backend truth drift', () => {
    const store = useWorkspaceStore()
    store.hydrate({
      activeWorkspaceId: 'ws_demo_001',
      terminalWebhookPort: 43127,
      workspaces: [
        {
          workspaceId: 'ws_demo_001',
          name: 'demo',
          path: 'D:/demo',
          providerId: 'opencode',
          status: 'bootstrapping',
          summary: 'bootstrapping',
          cliSessionId: null,
          isProvisional: true,
          workspaceSecret: null,
          providerPort: null
        }
      ]
    })

    const event: WorkspaceEvent = {
      event_version: 1,
      event_id: 'evt_1',
      event_type: 'workspace.status_changed',
      timestamp: new Date().toISOString(),
      workspace_id: 'ws_demo_001',
      provider_id: 'opencode',
      session_id: 'chat-1',
      source: 'hook-sidecar',
      payload: {
        status: 'running',
        summary: 'Agent 已连接',
        is_provisional: false
      }
    }

    store.applyEvent(event)

    expect(store.activeWorkspace?.status).toBe('running')
    expect(store.activeWorkspace?.summary).toBe('Agent 已连接')
    expect(store.activeWorkspace?.cliSessionId).toBe('chat-1')
    expect(store.activeWorkspace?.isProvisional).toBe(false)
  })

  test('adds a new workspace to the projection without changing the active selection implicitly', () => {
    const store = useWorkspaceStore()
    store.hydrate({
      activeWorkspaceId: 'ws_demo_001',
      terminalWebhookPort: 43127,
      workspaces: [
        {
          workspaceId: 'ws_demo_001',
          name: 'demo',
          path: 'D:/demo',
          providerId: 'local-shell',
          status: 'running',
          summary: 'running',
          cliSessionId: 'shell-1',
          isProvisional: false,
          workspaceSecret: null,
          providerPort: null
        }
      ]
    })

    store.addWorkspace({
      workspaceId: 'ws_demo_002',
      name: 'second',
      path: 'D:/second',
      providerId: 'opencode',
      status: 'bootstrapping',
      summary: 'waiting',
      cliSessionId: null,
      isProvisional: true,
      workspaceSecret: null,
      providerPort: 43128
    })

    expect(store.workspaces).toHaveLength(2)
    expect(store.activeWorkspaceId).toBe('ws_demo_001')
    expect(store.workspaces[1]?.workspaceId).toBe('ws_demo_002')
  })
})
