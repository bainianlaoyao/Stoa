// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { SessionRowViewModel } from '@shared/observability'
import { buildSessionPresenceSnapshot, buildSessionRowViewModel } from '@shared/observability-projection'

const workspaceHierarchyPanelPath = resolve(dirname(fileURLToPath(import.meta.url)), 'WorkspaceHierarchyPanel.vue')

afterEach(() => {
  vi.useRealTimers()
})

const mockAddButtonRect = {
  left: 24,
  top: 36,
  width: 24,
  height: 24,
  right: 48,
  bottom: 60,
  x: 24,
  y: 36,
  toJSON: () => ({})
}

function createHierarchy(): ProjectHierarchyNode[] {
  return [
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
          runtimeState: 'alive',
          agentState: 'working',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 1,
          blockingReason: null,
          title: 'deploy gateway',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false,
          active: false
        },
        {
          id: 'session_2',
          projectId: 'project_alpha',
          type: 'shell',
          runtimeState: 'alive',
          agentState: 'idle',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 1,
          blockingReason: null,
          title: 'need confirmation',
          summary: 'awaiting',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_2',
          createdAt: 'b',
          updatedAt: 'b',
          lastActivatedAt: 'b',
          archived: false,
          active: true
        }
      ]
    }
  ]
}

function createTwoProjectHierarchy(): ProjectHierarchyNode[] {
  return [
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
          runtimeState: 'alive',
          agentState: 'working',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 1,
          blockingReason: null,
          title: 'deploy gateway',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'sess_1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false,
          active: false
        }
      ]
    },
    {
      id: 'project_beta',
      name: 'data-pipeline',
      path: 'D:/data-pipeline',
      createdAt: 'c',
      updatedAt: 'c',
      active: false,
      archivedSessions: [],
      sessions: [
        {
          id: 'session_3',
          projectId: 'project_beta',
          type: 'shell',
          runtimeState: 'exited',
          agentState: 'idle',
          hasUnseenCompletion: false,
          runtimeExitCode: 0,
          runtimeExitReason: 'clean',
          lastStateSequence: 1,
          blockingReason: null,
          title: 'etl run',
          summary: 'done',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'c',
          updatedAt: 'c',
          lastActivatedAt: 'c',
          archived: false,
          active: false
        }
      ]
    }
  ]
}

function mountPanel(overrides: { hierarchy?: ProjectHierarchyNode[]; activeProjectId?: string | null; activeSessionId?: string | null } = {}) {
  return mount(WorkspaceHierarchyPanel, {
    global: { plugins: [createPinia()] },
    props: {
      hierarchy: overrides.hierarchy ?? createHierarchy(),
      activeProjectId: overrides.activeProjectId !== undefined ? overrides.activeProjectId : 'project_alpha',
      activeSessionId: overrides.activeSessionId !== undefined ? overrides.activeSessionId : 'session_2'
    }
  })
}

function createSessionRowViewModels(
  overrides: Partial<Record<string, Partial<SessionRowViewModel>>> = {}
): Record<string, SessionRowViewModel> {
  return {
    session_1: {
      sessionId: 'session_1',
      title: 'deploy gateway',
      phase: 'running',
      primaryLabel: 'Running',
      secondaryLabel: 'OpenCode / GPT-5',
      tone: 'success',
      hasUnreadTurn: false,
      needsAttention: false,
      attentionReason: null,
      updatedAgoLabel: '10s ago',
      ...overrides.session_1
    },
    session_2: {
      sessionId: 'session_2',
      title: 'need confirmation',
      phase: 'ready',
      primaryLabel: 'Ready',
      secondaryLabel: 'Claude Code / Sonnet',
      tone: 'neutral',
      hasUnreadTurn: false,
      needsAttention: false,
      attentionReason: null,
      updatedAgoLabel: '20s ago',
      ...overrides.session_2
    }
  }
}

async function openFloatingCard(wrapper: ReturnType<typeof mountPanel>) {
  const addButton = wrapper.find('.route-add-session')
  Object.defineProperty(addButton.element, 'getBoundingClientRect', {
    value: () => mockAddButtonRect
  })
  await addButton.trigger('mousedown')
  await addButton.trigger('mouseup')
}

async function openRadialMenu(wrapper: ReturnType<typeof mountPanel>) {
  vi.useFakeTimers()
  const addButton = wrapper.find('.route-add-session')
  Object.defineProperty(addButton.element, 'getBoundingClientRect', {
    value: () => mockAddButtonRect
  })
  await addButton.trigger('mousedown')
  await vi.advanceTimersByTimeAsync(220)
}

describe('WorkspaceHierarchyPanel', () => {
  describe('render', () => {
    it('renders workspace-hierarchy-panel aside element', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('[data-testid="workspace-hierarchy-panel"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="workspace-hierarchy-panel"]').element.tagName).toBe('ASIDE')
    })

    it('renders route-body container', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('[data-testid="route-body"]').exists()).toBe(true)
    })

    it('renders "New Project" button in route-actions', () => {
      const wrapper = mountPanel()
      const btn = wrapper.find('[data-testid="route-actions"] .route-action')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toContain('New Project')
    })

    it('renders "Projects" .group-label text', () => {
      const wrapper = mountPanel()
      const label = wrapper.find('.group-label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('Projects')
    })

    it('renders one .route-project div per project', () => {
      const wrapper = mountPanel()
      expect(wrapper.findAll('.route-project')).toHaveLength(1)

      const wrapper2 = mountPanel({ hierarchy: createTwoProjectHierarchy() })
      expect(wrapper2.findAll('.route-project')).toHaveLength(2)
    })

    it('renders project name in .route-name inside .route-project', () => {
      const wrapper = mountPanel()
      const project = wrapper.find('.route-project')
      const names = project.findAll('.route-item--parent .route-name')
      expect(names[0].text()).toBe('infra-control')
    })

    it('renders project detail trigger instead of .route-path', () => {
      const wrapper = mountPanel()
      const path = wrapper.find('.route-project .route-item--parent .route-path')
      expect(path.exists()).toBe(false)
      const trigger = wrapper.find('.route-project .route-item--parent .route-detail-trigger')
      expect(trigger.exists()).toBe(true)
    })

    it('renders one .route-item.child button per session', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      expect(children).toHaveLength(2)
      expect(children.every(c => c.element.tagName === 'BUTTON')).toBe(true)
    })

    it('renders session title in child .route-name', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const titles = children.map(c => c.find('.route-name').text())
      expect(titles).toContain('deploy gateway')
      expect(titles).toContain('need confirmation')
    })

    it('renders state-first secondary label from the row view model', () => {
      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy: createHierarchy(),
          activeProjectId: 'project_alpha',
          activeSessionId: 'session_2',
          sessionRowViewModels: createSessionRowViewModels()
        }
      })

      const children = wrapper.findAll('.route-item.child')
      const types = children.map(c => c.find('.route-time').text())
      expect(types).toContain('Ready · Claude Code / Sonnet')
      expect(types).toContain('Running · OpenCode / GPT-5')
    })

    it('uses a real projected row view model without duplicating labels', () => {
      const session = createHierarchy()[0]!.sessions[1]!
      const projectedViewModel = buildSessionRowViewModel(
        session,
        buildSessionPresenceSnapshot(session, {
          activeSessionId: session.id,
          nowIso: '2026-04-24T08:00:00.000Z',
          modelLabel: 'Sonnet'
        }),
        '2026-04-24T08:00:00.000Z'
      )

      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy: createHierarchy(),
          activeProjectId: 'project_alpha',
          activeSessionId: 'session_2',
          sessionRowViewModels: {
            session_2: projectedViewModel
          }
        }
      })

      const secondaryLabels = wrapper.findAll('.route-time').map(node => node.text())
      expect(secondaryLabels).toContain('Ready · Shell / Sonnet')
      expect(projectedViewModel.secondaryLabel).toBe('Shell / Sonnet')
      expect(secondaryLabels.join(' | ')).not.toContain('Ready · Ready')
      expect(secondaryLabels.join(' | ')).not.toContain('Running · Running')
    })

    it('uses tone and phase data attributes from the row view model instead of status group styling', () => {
      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy: createHierarchy(),
          activeProjectId: 'project_alpha',
          activeSessionId: 'session_2',
          sessionRowViewModels: createSessionRowViewModels()
        }
      })

      const children = wrapper.findAll('.route-item.child')
      const dot1 = children[0].find('.route-dot')
      expect(dot1.attributes('data-tone')).toBe('success')
      expect(dot1.attributes('data-phase')).toBe('running')
      expect(dot1.attributes('data-session-status-testid')).toBe('session-status-running')
      const dot2 = children[1].find('.route-dot')
      expect(dot2.attributes('data-tone')).toBe('neutral')
      expect(dot2.attributes('data-phase')).toBe('ready')
      expect(dot2.attributes('data-session-status-testid')).toBe('session-status-ready')
    })

    it('renders running session with medium active tone', () => {
      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy: createHierarchy(),
          activeProjectId: 'project_alpha',
          activeSessionId: 'session_1',
          sessionRowViewModels: createSessionRowViewModels()
        }
      })

      const dot = wrapper.findAll('.route-item.child')[0]!.find('.route-dot')
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')
      const runningRule = source.match(/\.route-dot--tone-success\s*\{[^}]*\}/)?.[0] ?? ''

      expect(dot.attributes('data-tone')).toBe('success')
      expect(dot.attributes('data-phase')).toBe('running')
      expect(dot.attributes('data-session-status-testid')).toBe('session-status-running')
      expect(dot.classes()).toContain('route-dot--tone-success')
      expect(runningRule).toContain('var(--color-success)')
    })

    it('renders ready session with neutral status tone and no accent class', () => {
      const hierarchy: ProjectHierarchyNode[] = [{
        id: 'project_1',
        name: 'infra-control',
        path: 'D:/infra-control',
        active: true,
        archivedSessions: [],
        createdAt: '2026-04-22T12:00:00.000Z',
        updatedAt: '2026-04-22T12:00:00.000Z',
        sessions: [{
          id: 'session_complete',
          title: 'complete turn',
          type: 'opencode',
          runtimeState: 'alive',
          agentState: 'idle',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 2,
          blockingReason: null,
          active: true,
          summary: 'waiting for user',
          projectId: 'project_1',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: '2026-04-22T12:00:00.000Z',
          updatedAt: '2026-04-22T12:00:00.000Z',
          lastActivatedAt: '2026-04-22T12:00:00.000Z',
          archived: false
        }]
      }]

      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy,
          activeProjectId: 'project_1',
          activeSessionId: 'session_complete',
          sessionRowViewModels: {
            session_complete: {
              sessionId: 'session_complete',
              title: 'complete turn',
              phase: 'ready',
              primaryLabel: 'Ready',
              secondaryLabel: 'Claude Code / Sonnet',
              tone: 'neutral',
              hasUnreadTurn: false,
              needsAttention: false,
              attentionReason: null,
              updatedAgoLabel: '4s ago'
            }
          }
        }
      })

      const row = wrapper.find('.route-item.child')
      const dot = row.find('.route-dot')
      const classNames = `${row.classes().join(' ')} ${dot.classes().join(' ')}`
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')
      const readyRule = source.match(/\.route-dot--tone-neutral\s*\{[^}]*\}/)?.[0] ?? ''

      expect(row.find('.route-time').text()).toBe('Ready · Claude Code / Sonnet')
      expect(dot.attributes('data-tone')).toBe('neutral')
      expect(dot.attributes('data-phase')).toBe('ready')
      expect(dot.attributes('data-session-status-testid')).toBe('session-status-ready')
      expect(dot.classes()).toContain('route-dot--tone-neutral')
      expect(classNames).not.toMatch(/accent|blue/i)
      expect(readyRule).toContain('var(--color-subtle)')
      expect(readyRule).not.toMatch(/accent|blue/i)
    })

    it('renders blocked permission state with a distinct approval label and warning tone', () => {
      const hierarchy: ProjectHierarchyNode[] = [{
        id: 'project_1',
        name: 'infra-control',
        path: 'D:/infra-control',
        active: true,
        archivedSessions: [],
        createdAt: '2026-04-24T12:00:00.000Z',
        updatedAt: '2026-04-24T12:00:00.000Z',
        sessions: [{
          id: 'session_permission_request',
          title: 'permission request',
          type: 'claude-code',
          runtimeState: 'alive',
          agentState: 'blocked',
          hasUnseenCompletion: false,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 3,
          blockingReason: 'resume-confirmation',
          active: true,
          summary: 'PermissionRequest',
          projectId: 'project_1',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: '2026-04-24T12:00:00.000Z',
          updatedAt: '2026-04-24T12:00:00.000Z',
          lastActivatedAt: '2026-04-24T12:00:00.000Z',
          archived: false
        }]
      }]

      const blockedSession = hierarchy[0]!.sessions[0]!
      const blockedViewModel = buildSessionRowViewModel(
        blockedSession,
        buildSessionPresenceSnapshot(blockedSession, {
          activeSessionId: blockedSession.id,
          nowIso: '2026-04-24T12:00:00.000Z',
          modelLabel: 'Sonnet'
        }),
        '2026-04-24T12:00:00.000Z'
      )

      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy,
          activeProjectId: 'project_1',
          activeSessionId: 'session_permission_request',
          sessionRowViewModels: {
            session_permission_request: blockedViewModel
          }
        }
      })

      const row = wrapper.find('.route-item.child')
      expect(blockedViewModel.primaryLabel).toBe('Blocked')
      expect(blockedViewModel.phase).toBe('blocked')
      expect(blockedViewModel.attentionReason).toBe('resume-confirmation')
      expect(row.find('.route-time').text()).toBe('Blocked · Claude Code / Sonnet')
      expect(row.find('.route-dot').attributes('data-tone')).toBe('warning')
      expect(row.find('.route-dot').attributes('data-phase')).toBe('blocked')
      expect(row.find('.route-dot').attributes('data-session-status-testid')).toBe('session-status-blocked')
      expect(row.find('.route-dot').attributes('data-attention-reason')).toBe('resume-confirmation')
      expect(row.find('.route-dot').classes()).toContain('route-dot--tone-warning')
      expect(row.find('.route-dot').classes()).toContain('route-dot--attention-blocked')
    })

    it('renders complete session with non-error attention tone', () => {
      const hierarchy: ProjectHierarchyNode[] = [{
        id: 'project_1',
        name: 'infra-control',
        path: 'D:/infra-control',
        active: true,
        archivedSessions: [],
        createdAt: '2026-04-24T12:00:00.000Z',
        updatedAt: '2026-04-24T12:00:00.000Z',
        sessions: [{
          id: 'session_complete',
          title: 'turn complete',
          type: 'claude-code',
          runtimeState: 'alive',
          agentState: 'idle',
          hasUnseenCompletion: true,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 4,
          blockingReason: null,
          active: true,
          summary: 'turn complete',
          projectId: 'project_1',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: '2026-04-24T12:00:00.000Z',
          updatedAt: '2026-04-24T12:00:00.000Z',
          lastActivatedAt: '2026-04-24T12:00:00.000Z',
          archived: false
        }]
      }]

      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy,
          activeProjectId: 'project_1',
          activeSessionId: 'session_complete',
          sessionRowViewModels: {
            session_complete: {
              sessionId: 'session_complete',
              title: 'turn complete',
              phase: 'complete',
              primaryLabel: 'Complete',
              secondaryLabel: 'Claude Code / Sonnet',
              tone: 'warning',
              hasUnreadTurn: false,
              needsAttention: true,
              attentionReason: 'turn-complete',
              updatedAgoLabel: '3s ago'
            }
          }
        }
      })

      const row = wrapper.find('.route-item.child')
      const dot = row.find('.route-dot')
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')
      const completeRule = source.match(/\.route-dot--attention-complete\s*\{[^}]*\}/)?.[0] ?? ''

      expect(row.find('.route-time').text()).toBe('Complete · Claude Code / Sonnet')
      expect(dot.attributes('data-tone')).toBe('warning')
      expect(dot.attributes('data-phase')).toBe('complete')
      expect(dot.attributes('data-session-status-testid')).toBe('session-status-complete')
      expect(dot.attributes('data-attention-reason')).toBe('turn-complete')
      expect(dot.classes()).toContain('route-dot--tone-warning')
      expect(dot.classes()).toContain('route-dot--attention-complete')
      expect(dot.classes()).not.toContain('route-dot--tone-danger')
      expect(completeRule).toContain('var(--color-warning)')
      expect(completeRule).not.toContain('var(--color-error)')
    })

    it('renders failed session with danger tone before other attention states', () => {
      const hierarchy: ProjectHierarchyNode[] = [{
        id: 'project_1',
        name: 'infra-control',
        path: 'D:/infra-control',
        active: true,
        archivedSessions: [],
        createdAt: '2026-04-24T12:00:00.000Z',
        updatedAt: '2026-04-24T12:00:00.000Z',
        sessions: [{
          id: 'session_failed',
          title: 'provider failed',
          type: 'claude-code',
          runtimeState: 'alive',
          agentState: 'error',
          hasUnseenCompletion: true,
          runtimeExitCode: null,
          runtimeExitReason: null,
          lastStateSequence: 5,
          blockingReason: null,
          active: true,
          summary: 'provider failed',
          projectId: 'project_1',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: '2026-04-24T12:00:00.000Z',
          updatedAt: '2026-04-24T12:00:00.000Z',
          lastActivatedAt: '2026-04-24T12:00:00.000Z',
          archived: false
        }]
      }]

      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy,
          activeProjectId: 'project_1',
          activeSessionId: 'session_failed',
          sessionRowViewModels: {
            session_failed: {
              sessionId: 'session_failed',
              title: 'provider failed',
              phase: 'failed',
              primaryLabel: 'Failed',
              secondaryLabel: 'Claude Code / Sonnet',
              tone: 'danger',
              hasUnreadTurn: false,
              needsAttention: true,
              attentionReason: 'provider-error',
              updatedAgoLabel: '3s ago'
            }
          }
        }
      })

      const row = wrapper.find('.route-item.child')
      const dot = row.find('.route-dot')
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')
      const dangerRule = source.match(/\.route-dot--tone-danger\s*\{[^}]*\}/)?.[0] ?? ''

      expect(row.find('.route-time').text()).toBe('Failed · Claude Code / Sonnet')
      expect(dot.attributes('data-tone')).toBe('danger')
      expect(dot.attributes('data-phase')).toBe('failed')
      expect(dot.attributes('data-session-status-testid')).toBe('session-status-failed')
      expect(dot.attributes('data-attention-reason')).toBe('provider-error')
      expect(dot.classes()).toContain('route-dot--tone-danger')
      expect(dot.classes()).toContain('route-dot--attention-failed')
      expect(dot.classes()).not.toContain('route-dot--tone-warning')
      expect(dot.classes()).not.toContain('route-dot--attention-complete')
      expect(dot.classes()).not.toContain('route-dot--attention-blocked')
      expect(dangerRule).toContain('var(--color-error)')
    })

    it('does not show the raw session.type when a row view model exists', () => {
      const wrapper = mount(WorkspaceHierarchyPanel, {
        global: { plugins: [createPinia()] },
        props: {
          hierarchy: createHierarchy(),
          activeProjectId: 'project_alpha',
          activeSessionId: 'session_2',
          sessionRowViewModels: createSessionRowViewModels()
        }
      })

      const secondaryLabels = wrapper.findAll('.route-time').map(node => node.text())
      expect(secondaryLabels.join(' | ')).not.toContain('opencode')
      expect(secondaryLabels.join(' | ')).not.toContain('shell')
    })

    it('renders "+" .route-add-session button per project', () => {
      const wrapper = mountPanel()
      const btns = wrapper.findAll('.route-add-session')
      expect(btns).toHaveLength(1)
      expect(btns[0].text()).toBe('+')
      expect(btns[0].classes()).toContain('route-icon-button')
    })
  })

  describe('empty hierarchy', () => {
    it('renders "New Project" button even with empty hierarchy', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.find('.route-action').exists()).toBe(true)
      expect(wrapper.find('.route-action').text()).toContain('New Project')
    })

    it('renders "Projects" group label', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.find('.group-label').text()).toBe('Projects')
    })

    it('renders zero .route-project divs', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.findAll('.route-project')).toHaveLength(0)
    })

    it('does NOT crash with empty hierarchy', () => {
      expect(() => mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })).not.toThrow()
    })
  })

  describe('active states', () => {
    it('project matching activeProjectId has .route-item--active class', () => {
      const wrapper = mountPanel()
      const parentItem = wrapper.find('.route-item--parent')
      expect(parentItem.classes()).toContain('route-item--active')
    })

    it('session matching activeSessionId has .route-item--active class', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const activeSession = children.find(c => c.classes().includes('route-item--active'))
      expect(activeSession).toBeDefined()
      expect(activeSession!.text()).toContain('need confirmation')
    })

    it('only ONE .route-item--active project when multiple exist', () => {
      const wrapper = mountPanel({
        hierarchy: createTwoProjectHierarchy(),
        activeProjectId: 'project_beta',
        activeSessionId: 'session_3'
      })
      const parentItems = wrapper.findAll('.route-item--parent')
      const activeParents = parentItems.filter(p => p.classes().includes('route-item--active'))
      expect(activeParents).toHaveLength(1)
      expect(activeParents[0].find('.route-name').text()).toBe('data-pipeline')
    })

    it('no active class when activeProjectId is null', () => {
      const wrapper = mountPanel({ activeProjectId: null, activeSessionId: null })
      const parentItems = wrapper.findAll('.route-item--parent')
      const activeParents = parentItems.filter(p => p.classes().includes('route-item--active'))
      expect(activeParents).toHaveLength(0)
    })

    it('no active class when activeSessionId is null', () => {
      const wrapper = mountPanel({ activeProjectId: null, activeSessionId: null })
      const children = wrapper.findAll('.route-item.child')
      const activeChildren = children.filter(c => c.classes().includes('route-item--active'))
      expect(activeChildren).toHaveLength(0)
    })
  })

  describe('project selection', () => {
    it('clicking project row emits selectProject with project id', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-item--parent').trigger('click')
      expect(wrapper.emitted('selectProject')).toEqual([['project_alpha']])
    })

    it('clicking inactive project emits correct id', async () => {
      const wrapper = mountPanel({
        hierarchy: createTwoProjectHierarchy(),
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1'
      })
      const parents = wrapper.findAll('.route-item--parent')
      await parents[1].trigger('click')
      expect(wrapper.emitted('selectProject')).toEqual([['project_beta']])
    })
  })

  describe('session selection', () => {
    it('clicking session row emits selectSession with session id', async () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      await children[0].trigger('click')
      expect(wrapper.emitted('selectSession')).toEqual([['session_1']])
    })

    it('does not render archived sessions in the hierarchy panel', async () => {
      const wrapper = mountPanel({
        hierarchy: [{
          ...createHierarchy()[0]!,
          sessions: [createHierarchy()[0]!.sessions[0]!],
          archivedSessions: [{
            ...createHierarchy()[0]!.sessions[1]!,
            id: 'session_archived',
            title: 'old shell',
            archived: true,
            active: false
          }]
        }]
      })

      expect(wrapper.find('[data-archived-group="project_alpha"]').exists()).toBe(false)
      expect(wrapper.find('[data-archived-session="session_archived"]').exists()).toBe(false)
    })

    it('clicking archive action emits archiveSession without selecting the row', async () => {
      const wrapper = mountPanel()

      await wrapper.find('[data-row-archive="session_1"]').trigger('click')

      expect(wrapper.emitted('archiveSession')).toEqual([['session_1']])
      expect(wrapper.emitted('selectSession')).toBeUndefined()
      expect(wrapper.find('[data-row-archive="session_1"] svg').exists()).toBe(true)
    })
  })

  describe('add session button', () => {
    it('clicking "+" button does NOT emit selectProject (click.stop works)', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-add-session').trigger('click')
      expect(wrapper.emitted('selectProject')).toBeUndefined()
    })

    it('clicking "+" does NOT directly emit createSession', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-add-session').trigger('click')
      expect(wrapper.emitted('createSession')).toBeUndefined()
    })

    it('quick click on "+" opens floating card', async () => {
      const wrapper = mountPanel()
      await openFloatingCard(wrapper)

      const floatingCard = wrapper.findComponent(ProviderFloatingCard)
      const radialMenu = wrapper.findComponent(ProviderRadialMenu)

      expect(floatingCard.props('visible')).toBe(true)
      expect(radialMenu.props('visible')).toBe(false)
    })

    it('second quick click on same "+" closes floating card', async () => {
      const wrapper = mountPanel()
      const addButton = wrapper.find('.route-add-session')

      Object.defineProperty(addButton.element, 'getBoundingClientRect', {
        value: () => mockAddButtonRect
      })

      await addButton.trigger('mousedown')
      await addButton.trigger('mouseup')
      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(true)

      await addButton.trigger('mousedown')
      await addButton.trigger('mouseup')

      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(false)
      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(false)
    })

    it('clicking outside closes floating card opened by quick click', async () => {
      const wrapper = mountPanel()
      await openFloatingCard(wrapper)

      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(true)

      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(false)
    })

    it('long press opens radial menu and closes it on mouseup', async () => {
      vi.useFakeTimers()
      const wrapper = mountPanel()
      const addButton = wrapper.find('.route-add-session')

      Object.defineProperty(addButton.element, 'getBoundingClientRect', {
        value: () => mockAddButtonRect
      })

      await addButton.trigger('mousedown')
      await vi.advanceTimersByTimeAsync(220)

      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(true)
      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(false)

      await addButton.trigger('mouseup')

      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(false)
    })

    it('releasing on a radial item after long press creates a session', async () => {
      vi.useFakeTimers()
      const wrapper = mountPanel()

      await openRadialMenu(wrapper)

      const codexButton = document.body.querySelector('button[aria-label="Create Codex session"]')
      expect(codexButton).toBeTruthy()

      codexButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('createSession')).toContainEqual([{
        projectId: 'project_alpha',
        type: 'codex',
        title: 'codex-infra-control'
      }])
      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(false)
    })

    it('releasing outside after long press closes radial menu', async () => {
      vi.useFakeTimers()
      const wrapper = mountPanel()

      await openRadialMenu(wrapper)
      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(true)

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(false)
    })

    it('creating codex from floating card auto-generates codex project title', async () => {
      const wrapper = mountPanel()
      await openFloatingCard(wrapper)
      await wrapper.findComponent(ProviderFloatingCard).vm.$emit('create', { type: 'codex' })
      expect(wrapper.emitted('createSession')).toContainEqual([{
        projectId: 'project_alpha',
        type: 'codex',
        title: 'codex-infra-control'
      }])
    })

    it('creating claude-code from radial menu auto-generates claude project title', async () => {
      const wrapper = mountPanel()
      await openRadialMenu(wrapper)
      await wrapper.findComponent(ProviderRadialMenu).vm.$emit('create', { type: 'claude-code' })
      expect(wrapper.emitted('createSession')).toContainEqual([{
        projectId: 'project_alpha',
        type: 'claude-code',
        title: 'claude-infra-control'
      }])
    })
  })

  describe('new project button', () => {
    it('clicking "New Project" button renders (component mounts without error)', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-action').trigger('click')
      expect(wrapper.find('.route-action').exists()).toBe(true)
    })
  })

  describe('component integration', () => {
    it('NewProjectModal component is rendered in the wrapper', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(NewProjectModal).exists()).toBe(true)
    })

    it('ProviderFloatingCard component is rendered in the wrapper', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(ProviderFloatingCard).exists()).toBe(true)
    })

    it('ProviderRadialMenu component is rendered in the wrapper', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(ProviderRadialMenu).exists()).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('project with zero sessions renders project row but no session buttons', () => {
      const hierarchy: ProjectHierarchyNode[] = [
        {
          id: 'project_empty',
          name: 'empty-project',
          path: 'D:/empty',
          createdAt: 'a',
          updatedAt: 'a',
          active: true,
          archivedSessions: [],
          sessions: []
        }
      ]
      const wrapper = mountPanel({ hierarchy, activeProjectId: 'project_empty', activeSessionId: null })
      expect(wrapper.findAll('.route-project')).toHaveLength(1)
      expect(wrapper.find('.route-item--parent').exists()).toBe(true)
      expect(wrapper.findAll('.route-item.child')).toHaveLength(0)
    })

    it('hierarchy with multiple projects renders all with correct data', () => {
      const wrapper = mountPanel({
        hierarchy: createTwoProjectHierarchy(),
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_1'
      })
      const projects = wrapper.findAll('.route-project')
      expect(projects).toHaveLength(2)

      const names = projects.map(p => p.find('.route-item--parent .route-name').text())
      expect(names).toEqual(['infra-control', 'data-pipeline'])

      const paths = projects.map(p => p.find('.route-item--parent .route-path'))
      expect(paths.every(p => !p.exists())).toBe(true)
    })
  })

  describe('style contracts', () => {
    it('does not keep hardcoded hover colors and status neutrals in component source', () => {
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')

      expect(source).not.toContain('hover:bg-[#f8f9fb]')
      expect(source).not.toContain('focus-visible:bg-[#f8f9fb]')
      expect(source).not.toContain('background: rgba(255, 255, 255, 0.5);')
      expect(source).not.toContain('background: #cbd5e1;')
      expect(source).not.toContain('box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);')
      expect(source).not.toContain('border-radius: 8px;')
      expect(source).not.toContain('border-radius: 4px;')
      expect(source).not.toContain('rounded-lg')
      expect(source).not.toContain('rounded-full')
      expect(source).not.toContain('backdrop-filter: blur(24px)')
      expect(source).not.toContain('-webkit-backdrop-filter: blur(24px)')
    })

    it('keeps secondary text and popover path truncation rules in source', () => {
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')

      expect(source).toContain('.route-time')
      expect(source).toContain('overflow: hidden;')
      expect(source).toContain('white-space: nowrap;')
      expect(source).toContain('text-overflow: ellipsis;')
      expect(source).toContain('min-width: 0;')
    })
  })
})
