// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandSurface from './CommandSurface.vue'

describe('CommandSurface', () => {
  it('uses the style-h command panel wrapper structure', () => {
    const wrapper = mount(CommandSurface, {
      props: {
        hierarchy: [
          {
            id: 'group-1',
            title: 'infra-control',
            pathLabel: 'D:/infra-control',
            children: [
              {
                workspaceId: 'ws_1',
                name: 'infra-control',
                label: 'deploy gateway',
                status: 'running',
                summary: 'running',
                metaLabel: '1h',
                active: true,
                statusLabel: 'running',
                providerId: 'opencode',
                path: 'D:/infra-control',
                cliSessionId: 'sess_1',
                isProvisional: false
              }
            ]
          }
        ],
        activeWorkspaceId: 'ws_1',
        activeWorkspace: {
          workspaceId: 'ws_1',
          name: 'infra-control',
          path: 'D:/infra-control',
          providerId: 'opencode',
          status: 'running',
          summary: 'running',
          cliSessionId: 'sess_1',
          isProvisional: false,
          workspaceSecret: 'secret',
          providerPort: 43128
        }
      },
      global: {
        stubs: {
          TerminalViewport: {
            template: '<div class="terminal-viewport-stub" />'
          }
        }
      }
    })

    expect(wrapper.find('.command-panel').exists()).toBe(true)
    expect(wrapper.find('.command-body').exists()).toBe(true)
    expect(wrapper.find('.command-layout').exists()).toBe(true)
    expect(wrapper.find('.route-column').exists()).toBe(true)
    expect(wrapper.find('.terminal-screen').exists()).toBe(true)
    expect(wrapper.find('.terminal-meta').exists()).toBe(true)
  })

  it('groups terminal meta into left and right clusters for richer screen chrome', () => {
    const wrapper = mount(CommandSurface, {
      props: {
        hierarchy: [],
        activeWorkspaceId: 'ws_1',
        activeWorkspace: {
          workspaceId: 'ws_1',
          name: 'infra-control',
          path: 'D:/infra-control',
          providerId: 'opencode',
          status: 'running',
          summary: 'running',
          cliSessionId: 'sess_1',
          isProvisional: false,
          workspaceSecret: 'secret',
          providerPort: 43128
        }
      },
      global: {
        stubs: {
          TerminalViewport: {
            template: '<div class="terminal-viewport-stub" />'
          }
        }
      }
    })

    expect(wrapper.find('.terminal-meta__group--primary').exists()).toBe(true)
    expect(wrapper.find('.terminal-meta__group--secondary').exists()).toBe(true)
  })
})
