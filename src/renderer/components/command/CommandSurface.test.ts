// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CommandSurface from './CommandSurface.vue'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import { useWorkspaceStore } from '@renderer/stores/workspaces'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { SessionPresenceSnapshot } from '@shared/observability'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const hierarchy: ProjectHierarchyNode[] = [
  {
    id: 'project_alpha',
    name: 'infra-control',
    path: 'D:/infra-control',
    createdAt: 'a',
    updatedAt: 'a',
    active: true,
    archivedSessions: [],
    sessions: [
      {
        id: 'session_1',
        projectId: 'project_alpha',
        type: 'opencode',
        status: 'running',
        title: 'deploy gateway',
        summary: 'running',
        recoveryMode: 'resume-external',
        externalSessionId: 'sess_1',
        createdAt: 'a',
        updatedAt: 'a',
        lastActivatedAt: 'a',
        archived: false,
        active: true
      }
    ]
  }
]

const activeProject: ProjectSummary = {
  id: 'project_alpha',
  name: 'infra-control',
  path: 'D:/infra-control',
  createdAt: 'a',
  updatedAt: 'a'
}

const activeSession: SessionSummary = {
  id: 'session_1',
  projectId: 'project_alpha',
  type: 'opencode',
  status: 'running',
  title: 'deploy gateway',
  summary: 'running',
  recoveryMode: 'resume-external',
  externalSessionId: 'sess_1',
  createdAt: 'a',
  updatedAt: 'a',
  lastActivatedAt: 'a',
  archived: false
}

function createPresenceSnapshot(overrides: Partial<SessionPresenceSnapshot> = {}): SessionPresenceSnapshot {
  return {
    sessionId: 'session_1',
    projectId: 'project_alpha',
    providerId: 'opencode',
    providerLabel: 'OpenCode',
    modelLabel: 'GPT-5',
    phase: 'working',
    canonicalStatus: 'running',
    confidence: 'authoritative',
    health: 'healthy',
    blockingReason: null,
    lastAssistantSnippet: null,
    lastEventAt: '2026-04-24T08:00:00.000Z',
    lastEvidenceType: null,
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    sourceSequence: 1,
    updatedAt: '2026-04-24T08:00:00.000Z',
    ...overrides
  }
}

describe('CommandSurface', () => {
  it('uses the command panel wrapper structure', () => {
    const wrapper = mount(CommandSurface, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy,
        activeProject,
        activeSession,
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1',
      }
    })

    expect(wrapper.find('[data-testid="command-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="command-body"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="command-layout"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="workspace-hierarchy-panel"]').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport').exists()).toBe(true)
  })

  it('derives a visible running status from session state before observability snapshots arrive', () => {
    const wrapper = mount(CommandSurface, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy,
        activeProject,
        activeSession,
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1',
      }
    })

    const statusDot = wrapper.find('[data-testid="session-status-dot"]')

    expect(statusDot.attributes('data-status')).toBe('running')
    expect(statusDot.attributes('data-phase')).toBe('working')
    expect(statusDot.attributes('data-tone')).toBe('success')
  })

  it('renders blocked observability in the row dot without adding a terminal top bar', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore(pinia)
    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_1',
      terminalWebhookPort: 0,
      projects: [activeProject],
      sessions: [activeSession]
    })
    store.sessionPresenceById = {
      session_1: createPresenceSnapshot({
        phase: 'blocked',
        canonicalStatus: 'needs_confirmation',
        blockingReason: 'permission',
        sourceSequence: 3
      })
    }

    const wrapper = mount(CommandSurface, {
      global: { plugins: [pinia] },
      props: {
        hierarchy,
        activeProject,
        activeSession,
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1'
      }
    })

    const statusDot = wrapper.find('[data-testid="session-status-dot"]')
    const terminalViewport = wrapper.find('[data-testid="terminal-viewport"]')

    expect(statusDot.attributes('data-status')).toBe('running')
    expect(statusDot.attributes('data-phase')).toBe('blocked')
    expect(statusDot.attributes('data-tone')).toBe('warning')
    expect(wrapper.find('[data-testid="terminal-status-bar"]').exists()).toBe(false)
    expect(terminalViewport.find('[data-testid="terminal-status-bar"]').exists()).toBe(false)
  })

  it('forwards archiveSession from WorkspaceHierarchyPanel', async () => {
    const wrapper = mount(CommandSurface, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy,
        activeProject,
        activeSession,
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1'
      }
    })

    await wrapper.findComponent(WorkspaceHierarchyPanel).vm.$emit('archiveSession', 'session_1')

    expect(wrapper.emitted('archiveSession')).toEqual([['session_1']])
  })
})
