// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkspaceQuickActions from './WorkspaceQuickActions.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const workspaceQuickActionsPath = resolve(dirname(fileURLToPath(import.meta.url)), 'WorkspaceQuickActions.vue')

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

  it('renders icon-only quick action buttons with accessible names', () => {
    const wrapper = mount(WorkspaceQuickActions, {
      props: { project, session }
    })

    const openIde = wrapper.get('[data-testid="workspace.open-ide"]')
    const openFileManager = wrapper.get('[data-testid="workspace.open-file-manager"]')

    expect(openIde.text()).toBe('')
    expect(openIde.attributes('aria-label')).toBe('Open workspace in VS Code')
    expect(openIde.get('img.workspace-quick-actions__icon').attributes('src')).toContain('vscode.svg')
    expect(openIde.get('img.workspace-quick-actions__icon').attributes('alt')).toBe('')
    expect(openIde.get('img.workspace-quick-actions__icon').attributes('aria-hidden')).toBe('true')

    expect(openFileManager.text()).toBe('')
    expect(openFileManager.attributes('aria-label')).toBe('Reveal workspace in file browser')
    expect(openFileManager.get('svg.workspace-quick-actions__icon').attributes('aria-hidden')).toBe('true')
  })

  it('sizes the file manager icon 50 percent larger than the base action icon', () => {
    const wrapper = mount(WorkspaceQuickActions, {
      props: { project, session }
    })
    const source = readFileSync(workspaceQuickActionsPath, 'utf8')

    expect(
      wrapper.get('[data-testid="workspace.open-file-manager"] svg').classes()
    ).toContain('workspace-quick-actions__icon--file-manager')
    expect(source).toMatch(/\.workspace-quick-actions__icon\s*{[^}]*width:\s*18px;[^}]*height:\s*18px;/s)
    expect(source).toMatch(/\.workspace-quick-actions__icon--file-manager\s*{[^}]*width:\s*27px;[^}]*height:\s*27px;/s)
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
