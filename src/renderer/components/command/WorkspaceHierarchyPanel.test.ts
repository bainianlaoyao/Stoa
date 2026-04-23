// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import NewProjectModal from './NewProjectModal.vue'
import ProviderFloatingCard from './ProviderFloatingCard.vue'
import ProviderRadialMenu from './ProviderRadialMenu.vue'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'

afterEach(() => {
  vi.useRealTimers()
})

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
          status: 'running',
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
          status: 'awaiting_input',
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
          status: 'running',
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
          status: 'exited',
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

describe('WorkspaceHierarchyPanel', () => {
  describe('render', () => {
    it('renders .workspace-hierarchy-panel aside element', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('.workspace-hierarchy-panel').exists()).toBe(true)
      expect(wrapper.find('.workspace-hierarchy-panel').element.tagName).toBe('ASIDE')
    })

    it('renders .route-body container', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('.route-body').exists()).toBe(true)
    })

    it('renders "New Project" button in .route-actions', () => {
      const wrapper = mountPanel()
      const btn = wrapper.find('.route-actions .route-action')
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

    it('renders project path in .route-path', () => {
      const wrapper = mountPanel()
      const path = wrapper.find('.route-project .route-item--parent .route-path')
      expect(path.text()).toBe('D:/infra-control')
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

    it('renders session type in child .route-time', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const types = children.map(c => c.find('.route-time').text())
      expect(types).toContain('opencode')
      expect(types).toContain('shell')
    })

    it('renders .route-dot with session.status as CSS class', () => {
      const wrapper = mountPanel()
      const children = wrapper.findAll('.route-item.child')
      const dot1 = children[0].find('.route-dot')
      expect(dot1.classes()).toContain('running')
      const dot2 = children[1].find('.route-dot')
      expect(dot2.classes()).toContain('awaiting_input')
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
      const addButton = wrapper.find('.route-add-session')

      Object.defineProperty(addButton.element, 'getBoundingClientRect', {
        value: () => ({ left: 24, top: 36, width: 24, height: 24, right: 48, bottom: 60, x: 24, y: 36, toJSON: () => ({}) })
      })

      await addButton.trigger('mousedown')
      await addButton.trigger('mouseup')

      const floatingCard = wrapper.findComponent(ProviderFloatingCard)
      const radialMenu = wrapper.findComponent(ProviderRadialMenu)

      expect(floatingCard.props('visible')).toBe(true)
      expect(radialMenu.props('visible')).toBe(false)
    })

    it('second quick click on same "+" closes floating card', async () => {
      const wrapper = mountPanel()
      const addButton = wrapper.find('.route-add-session')

      Object.defineProperty(addButton.element, 'getBoundingClientRect', {
        value: () => ({ left: 24, top: 36, width: 24, height: 24, right: 48, bottom: 60, x: 24, y: 36, toJSON: () => ({}) })
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
      const addButton = wrapper.find('.route-add-session')

      Object.defineProperty(addButton.element, 'getBoundingClientRect', {
        value: () => ({ left: 24, top: 36, width: 24, height: 24, right: 48, bottom: 60, x: 24, y: 36, toJSON: () => ({}) })
      })

      await addButton.trigger('mousedown')
      await addButton.trigger('mouseup')

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
        value: () => ({ left: 24, top: 36, width: 24, height: 24, right: 48, bottom: 60, x: 24, y: 36, toJSON: () => ({}) })
      })

      await addButton.trigger('mousedown')
      await vi.advanceTimersByTimeAsync(220)

      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(true)
      expect(wrapper.findComponent(ProviderFloatingCard).props('visible')).toBe(false)

      await addButton.trigger('mouseup')

      expect(wrapper.findComponent(ProviderRadialMenu).props('visible')).toBe(false)
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

      const paths = projects.map(p => p.find('.route-item--parent .route-path').text())
      expect(paths).toEqual(['D:/infra-control', 'D:/data-pipeline'])
    })
  })
})
