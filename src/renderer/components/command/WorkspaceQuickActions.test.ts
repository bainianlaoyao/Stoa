// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkspaceQuickActions from './WorkspaceQuickActions.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const project: ProjectSummary = {
  id: 'project_1',
  name: 'Alpha',
  path: 'D:/workspace/alpha',
  createdAt: '2026-04-26T00:00:00.000Z',
  updatedAt: '2026-04-26T00:00:00.000Z'
}

const session: SessionSummary = {
  id: 'session_1',
  projectId: 'project_1',
  type: 'shell',
  runtimeState: 'alive',
  agentState: 'idle',
  hasUnseenCompletion: false,
  runtimeExitCode: null,
  runtimeExitReason: null,
  lastStateSequence: 1,
  blockingReason: null,
  title: 'Shell',
  summary: 'Ready',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: '2026-04-26T00:00:00.000Z',
  updatedAt: '2026-04-26T00:00:00.000Z',
  lastActivatedAt: '2026-04-26T00:00:00.000Z',
  archived: false
}

describe('WorkspaceQuickActions', () => {
  it('does not render quick access buttons without both project and session', () => {
    const wrapper = mount(WorkspaceQuickActions, {
      props: { project, session: null }
    })

    expect(wrapper.find('[data-testid="workspace.open-ide"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workspace.open-file-manager"]').exists()).toBe(false)
  })

  it('emits an IDE workspace open request for the active session', async () => {
    const wrapper = mount(WorkspaceQuickActions, {
      props: { project, session }
    })

    await wrapper.get('[data-testid="workspace.open-ide"]').trigger('click')

    expect(wrapper.emitted('openWorkspace')).toEqual([
      [{ sessionId: 'session_1', target: 'ide' }]
    ])
  })

  it('renders localized quick action labels and accessible names', () => {
    const wrapper = mount(WorkspaceQuickActions, {
      props: { project, session }
    })

    expect(wrapper.get('[data-testid="workspace.open-ide"]').text()).toBe('Open in VS Code')
    expect(wrapper.get('[data-testid="workspace.open-ide"]').attributes('aria-label')).toBe('Open workspace in VS Code')
    expect(wrapper.get('[data-testid="workspace.open-file-manager"]').text()).toBe('Reveal in File Browser')
    expect(wrapper.get('[data-testid="workspace.open-file-manager"]').attributes('aria-label')).toBe('Reveal workspace in file browser')
  })

  it('emits a file manager workspace open request for the active session', async () => {
    const wrapper = mount(WorkspaceQuickActions, {
      props: { project, session }
    })

    await wrapper.get('[data-testid="workspace.open-file-manager"]').trigger('click')

    expect(wrapper.emitted('openWorkspace')).toEqual([
      [{ sessionId: 'session_1', target: 'file-manager' }]
    ])
  })
})
