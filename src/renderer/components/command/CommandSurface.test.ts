// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import CommandSurface from './CommandSurface.vue'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const hierarchy: ProjectHierarchyNode[] = [
  {
    id: 'project_alpha',
    name: 'infra-control',
    path: 'D:/infra-control',
    createdAt: 'a',
    updatedAt: 'a',
    active: true,
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

    expect(wrapper.find('.command-panel').exists()).toBe(true)
    expect(wrapper.find('.command-body').exists()).toBe(true)
    expect(wrapper.find('.command-layout').exists()).toBe(true)
    expect(wrapper.find('.workspace-hierarchy-panel').exists()).toBe(true)
    expect(wrapper.find('.terminal-viewport').exists()).toBe(true)
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
