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
    const stoaMock: RendererApi = {
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
      getTerminalReplay: vi.fn().mockResolvedValue(''),
      sendSessionInput: vi.fn().mockResolvedValue(undefined),
      sendSessionResize: vi.fn().mockResolvedValue(undefined),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onSessionEvent: vi.fn().mockReturnValue(() => {}),
      getSessionPresence: vi.fn().mockResolvedValue(null),
      getProjectObservability: vi.fn().mockResolvedValue(null),
      getAppObservability: vi.fn().mockResolvedValue({
        blockedProjectCount: 0,
        failedProjectCount: 0,
        degradedProjectCount: 0,
        totalUnreadTurns: 0,
        projectsNeedingAttention: [],
        providerHealthSummary: {},
        lastGlobalEventAt: null,
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
      onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
      onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
      onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
      getSettings: vi.fn().mockResolvedValue({
        shellPath: '',
        terminalFontSize: 14,
        terminalFontFamily: 'JetBrains Mono',
        providers: {},
        claudeDangerouslySkipPermissions: false,
        locale: 'en'
      }),
      setSetting: vi.fn().mockResolvedValue(undefined),
      pickFolder: vi.fn().mockResolvedValue(null),
      pickFile: vi.fn().mockResolvedValue(null),
      detectShell: vi.fn().mockResolvedValue(null),
      detectProvider: vi.fn().mockResolvedValue(null),
      minimizeWindow: vi.fn().mockResolvedValue(undefined),
      maximizeWindow: vi.fn().mockResolvedValue(undefined),
      closeWindow: vi.fn().mockResolvedValue(undefined),
      isWindowMaximized: vi.fn().mockResolvedValue(false),
      onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
      getUpdateState: vi.fn().mockResolvedValue({
        phase: 'idle',
        currentVersion: '0.1.0',
        availableVersion: null,
        downloadedVersion: null,
        downloadProgressPercent: null,
        lastCheckedAt: null,
        message: null,
        requiresSessionWarning: false
      }),
      checkForUpdates: vi.fn().mockResolvedValue({
        phase: 'up-to-date',
        currentVersion: '0.1.0',
        availableVersion: null,
        downloadedVersion: null,
        downloadProgressPercent: null,
        lastCheckedAt: null,
        message: 'You are up to date.',
        requiresSessionWarning: false
      }),
      downloadUpdate: vi.fn().mockResolvedValue({
        phase: 'downloaded',
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
        downloadedVersion: '0.2.0',
        downloadProgressPercent: 100,
        lastCheckedAt: null,
        message: 'Update 0.2.0 is ready to install.',
        requiresSessionWarning: false
      }),
      quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
      dismissUpdate: vi.fn().mockResolvedValue(undefined),
      onUpdateState: vi.fn().mockReturnValue(() => {})
    }

    window.stoa = stoaMock
  })

  it('shows all top-level activity items and defaults to command view', () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null
      }
    })

    const labels = wrapper.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))
    const navigation = wrapper.get('nav[aria-label="Global activity"]')
    const commandButton = wrapper.get('button[aria-label="Command panel"]')
    const archiveButton = wrapper.get('button[aria-label="Archive"]')
    const settingsButton = wrapper.get('button[aria-label="Settings"]')

    expect(labels).toEqual(['command', 'archive', 'settings'])
    expect(navigation).toBeTruthy()
    expect(commandButton.attributes('aria-current')).toBe('true')
    expect(archiveButton.attributes('aria-current')).toBeUndefined()
    expect(settingsButton.attributes('aria-current')).toBeUndefined()
    expect(wrapper.find('[data-command-surface="true"]').exists()).toBe(true)
    expect(wrapper.find('[data-surface="command"][aria-label="Command surface"]').exists()).toBe(true)
    expect(wrapper.find('.terminal-empty-state').exists()).toBe(true)
  })

  it('keeps stable command and active-session surface hooks when a session is selected', () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [{
          ...baseProject,
          active: true,
          archivedSessions: [],
          sessions: [{
            ...baseSession,
            active: true
          }]
        }],
        activeProjectId: baseProject.id,
        activeSessionId: baseSession.id,
        activeProject: baseProject,
        activeSession: baseSession
      }
    })

    expect(wrapper.find('[data-surface="command"]').exists()).toBe(true)
    expect(wrapper.find('[data-command-surface="true"]').exists()).toBe(true)
    expect(wrapper.find('.terminal-empty-state').exists()).toBe(false)
    expect(wrapper.find('[data-testid="terminal-xterm"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="terminal-status-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="terminal-viewport"] [data-testid="terminal-status-bar"]').exists()).toBe(false)
  })

  it('switches to archive surface when the archive activity is selected', async () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [{
          ...baseProject,
          active: false,
          sessions: [],
          archivedSessions: [{
            ...baseSession,
            id: 'session-archived',
            archived: true,
            active: false
          }]
        }],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null
      }
    })

    await wrapper.get('button[aria-label="Archive"]').trigger('click')

    expect(wrapper.get('[data-surface="archive"][aria-label="Archive surface"]')).toBeTruthy()
    expect(wrapper.get('button[aria-label="Archive"]').attributes('aria-current')).toBe('true')
    expect(wrapper.find('[data-surface="command"][aria-label="Command surface"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Archived sessions')
  })

  it('switches to a named settings surface when the settings activity is selected', async () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null
      }
    })

    await wrapper.get('button[aria-label="Settings"]').trigger('click')

    expect(wrapper.get('[data-surface="settings"][aria-label="Settings surface"]')).toBeTruthy()
    expect(wrapper.get('button[aria-label="Settings"]').attributes('aria-current')).toBe('true')
    expect(wrapper.find('[data-surface="command"][aria-label="Command surface"]').exists()).toBe(false)
  })

  it('keeps activity icons rendered while switching surfaces', async () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null
      }
    })

    const expectStableIcons = () => {
      const items = wrapper.findAll('[data-activity-item]')
      const icons = wrapper.findAll('[data-activity-icon]')

      expect(items).toHaveLength(3)
      expect(icons).toHaveLength(3)
      expect(wrapper.get('[data-activity-item="command"]').find('[data-activity-icon]').exists()).toBe(true)
      expect(wrapper.get('[data-activity-item="archive"]').find('[data-activity-icon]').exists()).toBe(true)
      expect(wrapper.get('[data-activity-item="settings"]').find('[data-activity-icon]').exists()).toBe(true)
    }

    expectStableIcons()

    await wrapper.get('button[aria-label="Settings"]').trigger('click')
    expectStableIcons()

    await wrapper.get('button[aria-label="Archive"]').trigger('click')
    expectStableIcons()

    await wrapper.get('button[aria-label="Command panel"]').trigger('click')
    expectStableIcons()
  })

  it('forwards restoreSession from archive surface', async () => {
    const wrapper = mount(AppShell, {
      global: { plugins: [createPinia()] },
      props: {
        hierarchy: [{
          ...baseProject,
          active: false,
          sessions: [],
          archivedSessions: [{
            ...baseSession,
            id: 'session-archived',
            archived: true,
            active: false
          }]
        }],
        activeProjectId: null,
        activeSessionId: null,
        activeProject: null,
        activeSession: null
      }
    })

    await wrapper.get('button[aria-label="Archive"]').trigger('click')
    await wrapper.get('[data-archive-restore="session-archived"]').trigger('click')

    expect(wrapper.emitted('restoreSession')).toEqual([['session-archived']])
  })
})
