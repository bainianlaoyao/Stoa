// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createSessionSummaryFixture } from '@shared/test-fixtures'
import MobileAppShell from './MobileAppShell.vue'
import type { ProjectSummary } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

vi.mock('./MobileSessionTerminal.vue', () => ({
  default: defineComponent({
    name: 'MobileSessionTerminal',
    props: {
      openDisplaySheet: { type: Boolean, default: false }
    },
    setup(props) {
      return () => h('section', { 'data-testid': 'mobile-session-terminal-stub' }, [
        'terminal',
        props.openDisplaySheet
          ? h('div', { 'data-testid': 'mobile-terminal-display-sheet' }, 'display')
          : null
      ])
    }
  })
}))

const project: ProjectSummary = {
  id: 'project-1',
  name: 'Alpha',
  path: 'D:/alpha',
  createdAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z'
}

const session = createSessionSummaryFixture({
  id: 'session-1',
  projectId: project.id,
  type: 'codex',
  title: 'Implement mobile shell',
  summary: 'Last output should stay hidden',
  updatedAt: '2026-06-19T00:00:00.000Z'
})

const archivedSession = createSessionSummaryFixture({
  id: 'archived-session-1',
  projectId: project.id,
  type: 'claude-code',
  title: 'Archived mobile session',
  summary: 'Archived',
  archived: true,
  updatedAt: '2026-06-18T00:00:00.000Z'
})

const hierarchy: ProjectHierarchyNode[] = [{
  ...project,
  active: true,
  archivedSessions: [{
    ...archivedSession,
    active: false
  }],
  sessions: [{
    ...session,
    active: true
  }]
}]

const searchHierarchy: ProjectHierarchyNode[] = [{
  ...project,
  name: 'Mobile Workspace',
  active: true,
  archivedSessions: [],
  sessions: [{
    ...session,
    active: true
  }]
}]

function mountShell(customHierarchy: ProjectHierarchyNode[] = hierarchy) {
  return mount(MobileAppShell, {
    props: {
      hierarchy: customHierarchy,
      activeProjectId: project.id,
      activeSessionId: session.id,
      activeProject: project,
      activeSession: session,
      healthStatus: 'connected'
    }
  })
}

describe('MobileAppShell', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts on Workspace Home and navigates workspace -> session list -> session view', async () => {
    const wrapper = mountShell()

    expect(wrapper.find('[data-testid="mobile-workspace-home"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="mobile-recent-session"]').text()).toContain('Recent session')

    await wrapper.get('[data-testid="mobile-workspace-row"]').trigger('click')

    expect(wrapper.emitted('selectProject')).toEqual([[project.id]])
    expect(wrapper.find('[data-testid="mobile-session-list"]').exists()).toBe(true)

    await wrapper.get('[data-testid="mobile-session-row"]').trigger('click')

    expect(wrapper.emitted('selectSession')).toEqual([[session.id]])
    expect(wrapper.find('[data-testid="mobile-session-view"]').exists()).toBe(true)
  })

  it('searches workspaces and sessions with light dismissal', async () => {
    const wrapper = mountShell(searchHierarchy)

    await wrapper.get('[data-testid="mobile-global-search-trigger"]').trigger('click')
    await wrapper.get('[data-testid="mobile-global-search-input"]').setValue('mobile')

    const sessionResults = wrapper.findAll('[data-testid="mobile-global-search-session-result"]')
    const workspaceResults = wrapper.findAll('[data-testid="mobile-global-search-workspace-result"]')
    expect(sessionResults).toHaveLength(1)
    expect(workspaceResults).toHaveLength(1)
    const groupLabels = wrapper.findAll('.mobile-search__group-label').map((node) => node.text())
    expect(groupLabels).toEqual(['Sessions', 'Workspaces'])

    await sessionResults[0].trigger('click')

    expect(wrapper.emitted('selectSession')).toEqual([[session.id]])
    expect(wrapper.find('[data-testid="mobile-global-search-layer"]').exists()).toBe(false)
  })

  it('creates sessions only from the session list type grid and opens after success', async () => {
    const wrapper = mountShell()

    expect(wrapper.find('[data-testid="mobile-new-session"]').exists()).toBe(false)

    await wrapper.get('[data-testid="mobile-workspace-row"]').trigger('click')
    await wrapper.get('[data-testid="mobile-new-session"]').trigger('click')
    expect(wrapper.find('[data-testid="mobile-new-session-sheet"]').exists()).toBe(true)

    await wrapper.get('.mobile-sheet-layer').trigger('click')
    expect(wrapper.find('[data-testid="mobile-new-session-sheet"]').exists()).toBe(false)

    await wrapper.get('[data-testid="mobile-new-session"]').trigger('click')
    await wrapper.get('[data-provider-type="codex"]').trigger('click')

    const createPayload = wrapper.emitted('createSession')?.[0]
    expect(createPayload?.[0]).toEqual({ projectId: project.id, type: 'codex', title: '' })
    expect(wrapper.find('[data-testid="mobile-session-view"]').exists()).toBe(false)

    const finishCreate = createPayload?.[1] as ((sessionId: string | null) => void) | undefined
    finishCreate?.('session-created')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('selectSession')).toContainEqual(['session-created'])
    expect(wrapper.find('[data-testid="mobile-session-view"]').exists()).toBe(true)
  })

  it('keeps session rows on status metadata instead of last output summaries', async () => {
    const wrapper = mountShell()

    await wrapper.get('[data-testid="mobile-workspace-row"]').trigger('click')

    const rowText = wrapper.get('[data-testid="mobile-session-row"]').text()
    expect(rowText).toContain('Ready')
    expect(rowText).toContain('Codex')
    expect(rowText).not.toContain('Last output should stay hidden')
  })

  it('shows mobile health banner and emits retry without mutating session state', async () => {
    const wrapper = mount(MobileAppShell, {
      props: {
        hierarchy,
        activeProjectId: project.id,
        activeSessionId: session.id,
        activeProject: project,
        activeSession: session,
        healthStatus: 'offline',
        healthMessage: 'Backend unavailable'
      }
    })

    expect(wrapper.get('[data-testid="mobile-health-dot"]').attributes('data-health-status')).toBe('offline')
    expect(wrapper.get('[data-testid="mobile-health-banner"]').text()).toContain('Backend unavailable')

    await wrapper.get('[data-testid="mobile-health-retry"]').trigger('click')

    expect(wrapper.emitted('retryHealth')).toEqual([[]])
    expect(wrapper.find('[data-testid="mobile-session-view"]').exists()).toBe(false)
  })

  it('opens display preferences from session More rather than a persistent terminal bar', async () => {
    const wrapper = mountShell()

    await wrapper.get('[data-testid="mobile-workspace-row"]').trigger('click')
    await wrapper.get('[data-testid="mobile-session-row"]').trigger('click')
    expect(wrapper.find('[data-testid="mobile-terminal-display-sheet"]').exists()).toBe(false)

    await wrapper.get('[data-testid="mobile-session-more"]').trigger('click')
    await wrapper.get('[data-testid="mobile-session-actions-sheet"]').find('button').trigger('click')

    expect(wrapper.find('[data-testid="mobile-terminal-display-sheet"]').exists()).toBe(true)
  })

  it('uses a native mobile archive list and restores directly into the session', async () => {
    const wrapper = mountShell()

    await wrapper.get('[data-testid="mobile-tool-archive"]').trigger('click')

    expect(wrapper.find('[data-testid="mobile-archive"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="mobile-archive-row"]').text()).toContain('Archived mobile session')

    await wrapper.get('[data-testid="mobile-archive-restore"]').trigger('click')

    expect(wrapper.emitted('restoreSession')).toEqual([[archivedSession.id]])
    expect(wrapper.emitted('selectSession')).toEqual([[archivedSession.id]])
    expect(wrapper.find('[data-testid="mobile-session-view"]').exists()).toBe(true)
  })

  it('renders memory notifications as a lightweight in-flow mobile banner', () => {
    const wrapper = mount(MobileAppShell, {
      props: {
        hierarchy,
        activeProjectId: project.id,
        activeSessionId: session.id,
        activeProject: project,
        activeSession: session,
        healthStatus: 'connected',
        memoryNotifications: [{
          id: 'memory-1',
          projectId: project.id,
          sessionId: session.id,
          kind: 'recall',
          status: 'info',
          title: 'Memory updated',
          message: 'Relevant context is available.',
          createdAt: '2026-06-19T00:00:00.000Z'
        }]
      }
    })

    const banner = wrapper.get('[data-testid="mobile-memory-banner"]')
    expect(banner.text()).toContain('Memory updated')
    expect(banner.text()).toContain('Relevant context is available.')
  })
})
