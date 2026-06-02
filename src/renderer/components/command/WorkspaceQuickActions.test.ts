// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkspaceQuickActions from './WorkspaceQuickActions.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import { createSessionSummaryFixture } from '@shared/test-fixtures'

const workspaceQuickActionsPath = resolve(dirname(fileURLToPath(import.meta.url)), 'WorkspaceQuickActions.vue')

const project: ProjectSummary = {
  id: 'project_1',
  name: 'Alpha',
  path: 'D:/workspace/alpha',
  createdAt: '2026-04-26T00:00:00.000Z',
  updatedAt: '2026-04-26T00:00:00.000Z'
}

const session: SessionSummary = createSessionSummaryFixture({
  id: 'session_1',
  projectId: 'project_1',
  type: 'shell',
  runtimeState: 'alive',
  turnState: 'idle',
  turnEpoch: 0,
  lastTurnOutcome: 'none',
  hasUnseenCompletion: false,
  runtimeExitCode: null,
  runtimeExitReason: null,
  lastStateSequence: 1,
  blockingReason: null,
  failureReason: null,
  title: 'Shell',
  summary: 'Ready',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: '2026-04-26T00:00:00.000Z',
  updatedAt: '2026-04-26T00:00:00.000Z',
  lastActivatedAt: '2026-04-26T00:00:00.000Z',
  archived: false
})

describe('WorkspaceQuickActions', () => {
  function mountActions(props: { project: ProjectSummary | null; session: SessionSummary | null }) {
    const pinia = createPinia()
    return mount(WorkspaceQuickActions, {
      global: { plugins: [pinia] },
      props
    })
  }

  it('does not render quick access buttons without both project and session', () => {
    const wrapper = mountActions({ project, session: null })

    expect(wrapper.find('[data-testid="workspace.open-ide"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workspace.open-file-manager"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workspace.copy-selection"]').exists()).toBe(false)
  })

  it('emits an IDE workspace open request for the active session', async () => {
    const wrapper = mountActions({ project, session })

    await wrapper.get('[data-testid="workspace.open-ide"]').trigger('click')

    expect(wrapper.emitted('openWorkspace')).toEqual([
      [{ sessionId: 'session_1', target: 'ide' }]
    ])
  })

  it('renders icon-only quick action buttons with accessible names', () => {
    const wrapper = mountActions({ project, session })

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
    const wrapper = mountActions({ project, session })
    const source = readFileSync(workspaceQuickActionsPath, 'utf8')

    expect(
      wrapper.get('[data-testid="workspace.open-file-manager"] svg').classes()
    ).toContain('workspace-quick-actions__icon--file-manager')
    expect(source).toMatch(/\.workspace-quick-actions__icon\s*{[^}]*width:\s*18px;[^}]*height:\s*18px;/s)
    expect(source).toMatch(/\.workspace-quick-actions__icon--file-manager\s*{[^}]*width:\s*27px;[^}]*height:\s*27px;/s)
  })

  it('emits a file manager workspace open request for the active session', async () => {
    const wrapper = mountActions({ project, session })

    await wrapper.get('[data-testid="workspace.open-file-manager"]').trigger('click')

    expect(wrapper.emitted('openWorkspace')).toEqual([
      [{ sessionId: 'session_1', target: 'file-manager' }]
    ])
  })

  it('renders a copy button that emits copySelection when clicked', async () => {
    const wrapper = mountActions({ project, session })

    const copyButton = wrapper.get('[data-testid="workspace.copy-selection"]')
    expect(copyButton.attributes('aria-label')).toBe('Copy selection to clipboard')

    await copyButton.trigger('click')
    expect(wrapper.emitted('copySelection')).toHaveLength(1)
  })

  it('renders a sidebar toggle button that toggles the sidebar store', async () => {
    const wrapper = mountActions({ project, session })

    const toggle = wrapper.find('[data-testid="workspace.sidebar-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await toggle.trigger('click')

    expect(toggle.attributes('aria-pressed')).toBe('true')
  })
})
