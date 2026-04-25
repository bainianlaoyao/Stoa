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
          type: 'claude-code',
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

function mountPanel(
  overrides: {
    hierarchy?: ProjectHierarchyNode[]
    activeProjectId?: string | null
    activeSessionId?: string | null
    sessionRowViewModels?: Record<string, SessionRowViewModel>
  } = {}
) {
  return mount(WorkspaceHierarchyPanel, {
    global: { plugins: [createPinia()] },
    props: {
      hierarchy: overrides.hierarchy ?? createHierarchy(),
      activeProjectId: overrides.activeProjectId !== undefined ? overrides.activeProjectId : 'project_alpha',
      activeSessionId: overrides.activeSessionId !== undefined ? overrides.activeSessionId : 'session_2',
      sessionRowViewModels: overrides.sessionRowViewModels
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
      secondaryLabel: 'GPT-5',
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
      secondaryLabel: 'Sonnet',
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
      const button = wrapper.find('[data-testid="route-actions"] .route-action')
      expect(button.exists()).toBe(true)
      expect(button.text()).toContain('New Project')
    })

    it('renders project names in parent rows', () => {
      const wrapper = mountPanel({ hierarchy: createTwoProjectHierarchy() })
      const names = wrapper.findAll('.route-item--parent .route-name').map((node) => node.text())
      expect(names).toEqual(['infra-control', 'data-pipeline'])
    })

    it('renders detail trigger for project rows', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('.route-project .route-item--parent .route-detail-trigger').exists()).toBe(true)
      expect(wrapper.find('.route-project .route-item--parent .route-path').exists()).toBe(false)
    })

    it('renders one child session button per active session', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      expect(children).toHaveLength(2)
      expect(children.every((node) => node.element.tagName === 'BUTTON')).toBe(true)
    })

    it('renders provider icons for session rows', () => {
      const wrapper = mountPanel()
      const icons = wrapper.findAll('.route-provider-icon')
      expect(icons).toHaveLength(2)
      expect(icons.map((node) => node.attributes('alt'))).toEqual(['opencode', 'claude-code'])
    })

    it('renders status label from row view models in the main branch structure', () => {
      const wrapper = mountPanel({
        sessionRowViewModels: createSessionRowViewModels()
      })

      const labels = wrapper.findAll('.route-session-label').map((node) => node.text())
      expect(labels).toContain('Running 10s ago')
      expect(labels).toContain('Ready 20s ago')
    })

    it('uses a real projected row view model without duplicating the status label', () => {
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

      const wrapper = mountPanel({
        sessionRowViewModels: {
          session_2: projectedViewModel
        }
      })

      const labels = wrapper.findAll('.route-session-label').map((node) => node.text())
      expect(labels).toContain('Ready Just now')
      expect(projectedViewModel.secondaryLabel).toBe('Sonnet')
      expect(labels.join(' | ')).not.toContain('Ready Ready')
      expect(labels.join(' | ')).not.toContain('Running Running')
    })

    it('projects tone, phase and topology attributes onto the status dot', () => {
      const wrapper = mountPanel({
        sessionRowViewModels: createSessionRowViewModels()
      })

      const dots = wrapper.findAll('.route-dot')
      expect(dots[0]?.attributes('data-tone')).toBe('success')
      expect(dots[0]?.attributes('data-phase')).toBe('running')
      expect(dots[0]?.attributes('data-session-status-testid')).toBe('session-status-running')
      expect(dots[1]?.attributes('data-tone')).toBe('neutral')
      expect(dots[1]?.attributes('data-phase')).toBe('ready')
      expect(dots[1]?.attributes('data-session-status-testid')).toBe('session-status-ready')
    })

    it('renders blocked attention metadata without introducing style-class coupling', () => {
      const blockedSession = createHierarchy()[0]!.sessions[1]!
      const blockedViewModel = buildSessionRowViewModel(
        blockedSession,
        buildSessionPresenceSnapshot(
          {
            ...blockedSession,
            agentState: 'blocked',
            blockingReason: 'resume-confirmation'
          },
          {
            activeSessionId: blockedSession.id,
            nowIso: '2026-04-24T08:00:00.000Z',
            modelLabel: 'Sonnet'
          }
        ),
        '2026-04-24T08:00:00.000Z'
      )

      const wrapper = mountPanel({
        activeSessionId: blockedSession.id,
        sessionRowViewModels: {
          session_2: blockedViewModel
        }
      })

      const dot = wrapper.findAll('.route-dot')[1]
      expect(dot?.attributes('data-tone')).toBe('warning')
      expect(dot?.attributes('data-phase')).toBe('blocked')
      expect(dot?.attributes('data-session-status-testid')).toBe('session-status-blocked')
      expect(dot?.attributes('data-attention-reason')).toBe('resume-confirmation')
    })

    it('renders complete and failed attention phases through data attributes', () => {
      const wrapper = mountPanel({
        sessionRowViewModels: createSessionRowViewModels({
          session_1: {
            phase: 'failed',
            primaryLabel: 'Failed',
            tone: 'danger',
            needsAttention: true,
            attentionReason: 'provider-error'
          },
          session_2: {
            phase: 'complete',
            primaryLabel: 'Complete',
            tone: 'warning',
            needsAttention: true,
            attentionReason: 'turn-complete'
          }
        })
      })

      const dots = wrapper.findAll('.route-dot')
      expect(dots[0]?.attributes('data-phase')).toBe('failed')
      expect(dots[0]?.attributes('data-session-status-testid')).toBe('session-status-failed')
      expect(dots[0]?.attributes('data-attention-reason')).toBe('provider-error')
      expect(dots[1]?.attributes('data-phase')).toBe('complete')
      expect(dots[1]?.attributes('data-session-status-testid')).toBe('session-status-complete')
      expect(dots[1]?.attributes('data-attention-reason')).toBe('turn-complete')
    })

    it('uses session title for archive button aria-label to preserve restore journeys', () => {
      const wrapper = mountPanel()
      const labels = wrapper.findAll('[data-testid="workspace.archive-session"]').map((node) => node.attributes('aria-label'))
      expect(labels).toEqual(['Archive deploy gateway', 'Archive need confirmation'])
    })

    it('does not show archived sessions in the hierarchy panel', () => {
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
  })

  describe('empty hierarchy', () => {
    it('renders empty hierarchy without crashing', () => {
      const wrapper = mountPanel({ hierarchy: [], activeProjectId: null, activeSessionId: null })
      expect(wrapper.find('.route-action').exists()).toBe(true)
      expect(wrapper.findAll('.route-project')).toHaveLength(0)
    })
  })

  describe('active states', () => {
    it('project matching activeProjectId has .route-item--active class', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('.route-item--parent').classes()).toContain('route-item--active')
    })

    it('session matching activeSessionId has .route-item--active class', () => {
      const wrapper = mountPanel()
      const activeSession = wrapper.findAll('.route-item.child').find((node) => node.classes().includes('route-item--active'))
      expect(activeSession).toBeDefined()
    })
  })

  describe('selection and archive events', () => {
    it('clicking project row emits selectProject with project id', async () => {
      const wrapper = mountPanel()
      await wrapper.find('.route-item--parent').trigger('click')
      expect(wrapper.emitted('selectProject')).toEqual([['project_alpha']])
    })

    it('clicking session row emits selectSession with session id', async () => {
      const wrapper = mountPanel()
      await wrapper.findAll('.route-item.child')[0]!.trigger('click')
      expect(wrapper.emitted('selectSession')).toEqual([['session_1']])
    })

    it('clicking archive action emits archiveSession without selecting the row', async () => {
      const wrapper = mountPanel()
      await wrapper.find('[data-row-archive="session_1"]').trigger('click')
      expect(wrapper.emitted('archiveSession')).toEqual([['session_1']])
      expect(wrapper.emitted('selectSession')).toBeUndefined()
    })
  })

  describe('add session button', () => {
    it('quick click opens floating card', async () => {
      const wrapper = mountPanel()
      await openFloatingCard(wrapper)
      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(true)
      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(false)
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

      await addButton.trigger('mouseup')
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

  describe('component integration', () => {
    it('renders integrated modal and provider controls', () => {
      const wrapper = mountPanel()
      expect(wrapper.findComponent(NewProjectModal).exists()).toBe(true)
      expect(wrapper.findComponent(ProviderFloatingCard).exists()).toBe(true)
      expect(wrapper.findComponent(ProviderRadialMenu).exists()).toBe(true)
    })
  })

  describe('style contracts', () => {
    it('keeps main-branch tokenized styling and avoids hardcoded visual regressions', () => {
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

    it('keeps route session label truncation rules in source', () => {
      const source = readFileSync(workspaceHierarchyPanelPath, 'utf8')
      expect(source).toContain('.route-session-label')
      expect(source).toContain('overflow: hidden;')
      expect(source).toContain('white-space: nowrap;')
      expect(source).toContain('text-overflow: ellipsis;')
      expect(source).toContain('min-width: 0;')
    })
  })
})
