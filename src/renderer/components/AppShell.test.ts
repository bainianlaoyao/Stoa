// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import AppShell from './AppShell.vue'
import type { ProjectSummary, RendererApi, SessionSummary } from '@shared/project-session'

const baseProject: ProjectSummary = {
  id: 'project-1',
  name: 'Alpha',
  path: 'D:/workspace/alpha',
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z'
}

const baseSession: SessionSummary = {
  id: 'session-1',
  projectId: 'project-1',
  type: 'shell',
  status: 'starting',
  title: 'Alpha shell',
  summary: 'Preparing the terminal session.',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
  lastActivatedAt: '2026-04-21T00:00:00.000Z',
  archived: false
}

describe('AppShell', () => {
  beforeEach(() => {
    const vibecodingMock: RendererApi = {
      getBootstrapState: vi.fn().mockResolvedValue({
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: 0,
        projects: [],
        sessions: []
      }),
      createProject: vi.fn().mockResolvedValue(baseProject),
      createSession: vi.fn().mockResolvedValue(baseSession),
      archiveSession: vi.fn().mockResolvedValue(undefined),
      restoreSession: vi.fn().mockResolvedValue(undefined),
      listArchivedSessions: vi.fn().mockResolvedValue([]),
      setActiveProject: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn().mockResolvedValue(undefined),
      sendSessionInput: vi.fn().mockResolvedValue(undefined),
      sendSessionResize: vi.fn().mockResolvedValue(undefined),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onSessionEvent: vi.fn().mockReturnValue(() => {})
    }

    window.vibecoding = vibecodingMock
  })

  it('shows all top-level activity items and defaults to command view', () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null,
        archivedSessions: []
      }
    })

    const labels = wrapper.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))
    const navigation = wrapper.get('nav[aria-label="Global activity"]')
    const commandButton = wrapper.get('button[aria-label="Command panel"]')
    const settingsButton = wrapper.get('button[aria-label="Settings"]')

    expect(labels).toEqual(['command', 'archive', 'settings'])
    expect(navigation).toBeTruthy()
    expect(commandButton.attributes('aria-current')).toBe('true')
    expect(settingsButton.attributes('aria-current')).toBeUndefined()
    expect(wrapper.find('[data-command-surface="true"]').exists()).toBe(true)
    expect(wrapper.find('[data-surface="command"][aria-label="Command surface"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Terminal empty state"]').exists()).toBe(true)
  })

  it('keeps stable command and active-session surface hooks when a session is selected', () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [{
          ...baseProject,
          active: true,
          sessions: [{
            ...baseSession,
            active: true
          }]
        }],
        activeProjectId: baseProject.id,
        activeSessionId: baseSession.id,
        activeProject: baseProject,
        activeSession: baseSession,
        archivedSessions: []
      }
    })

    expect(wrapper.find('[data-surface="command"]').exists()).toBe(true)
    expect(wrapper.find('[data-command-surface="true"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Terminal empty state"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Session details"]').exists()).toBe(true)
  })

  it('switches to a named settings surface when the settings activity is selected', async () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null,
        archivedSessions: []
      }
    })

    await wrapper.get('button[aria-label="Settings"]').trigger('click')

    expect(wrapper.get('[data-surface="settings"][aria-label="Settings surface"]')).toBeTruthy()
    expect(wrapper.get('button[aria-label="Settings"]').attributes('aria-current')).toBe('true')
    expect(wrapper.find('[data-surface="command"][aria-label="Command surface"]').exists()).toBe(false)
  })

  it('switches to archive surface when archive activity is selected', async () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null,
        archivedSessions: []
      }
    })

    await wrapper.get('button[aria-label="Archive"]').trigger('click')

    expect(wrapper.find('[data-surface="archive"][aria-label="Archive surface"]').exists()).toBe(true)
    expect(wrapper.find('[data-surface="command"]').exists()).toBe(false)
  })
})
