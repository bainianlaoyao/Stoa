import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import TerminalViewport from './TerminalViewport.vue'

describe('TerminalViewport', () => {
  test('renders canonical project and session details', () => {
    const wrapper = mount(TerminalViewport, {
      props: {
        project: {
          id: 'project_alpha',
          name: 'alpha',
          path: 'D:/alpha',
          createdAt: 'a',
          updatedAt: 'a'
        },
        session: {
          id: 'session_op_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'running',
          title: 'Deploy',
          summary: 'ready',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-123',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a'
        }
      }
    })

    expect(wrapper.text()).toContain('Deploy')
    expect(wrapper.text()).toContain('alpha')
    expect(wrapper.text()).toContain('resume-external')
    expect(wrapper.text()).toContain('ext-123')
  })
})
