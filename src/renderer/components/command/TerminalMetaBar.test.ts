import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalMetaBar from './TerminalMetaBar.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const mockProject: ProjectSummary = {
  id: 'project_1', name: 'test-project', path: '/tmp/test', createdAt: 'a', updatedAt: 'a'
}

const mockSession: SessionSummary = {
  id: 'session_1', projectId: 'project_1', type: 'opencode', status: 'running',
  title: 'test session', summary: 'running', recoveryMode: 'resume-external',
  externalSessionId: 'ext-1', createdAt: 'a', updatedAt: 'a', lastActivatedAt: 'a'
}

describe('TerminalMetaBar', () => {
  it('with project + session: renders .terminal-meta', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: mockSession } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(true)
  })

  it('with project + session: renders primary group with project.id and session.id text', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: mockSession } })
    const group = wrapper.find('.terminal-meta__group--primary')
    expect(group.text()).toContain('project_1')
    expect(group.text()).toContain('session_1')
  })

  it('with project + session: renders secondary group with session.type and session.status', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: mockSession } })
    const group = wrapper.find('.terminal-meta__group--secondary')
    expect(group.text()).toContain('opencode')
    expect(group.text()).toContain('running')
  })

  it('with project null: renders nothing', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: null, session: mockSession } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('with session null: renders nothing', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: null } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('with both null: renders nothing', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: null, session: null } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })
})
