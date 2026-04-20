// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkspaceHierarchyPanel from './WorkspaceHierarchyPanel.vue'

describe('WorkspaceHierarchyPanel', () => {
  it('renders parent and child rows with the active child selected', () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
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
                metaLabel: 'sess_1',
                active: false,
                statusLabel: 'running',
                providerId: 'opencode',
                path: 'D:/infra-control',
                cliSessionId: 'sess_1',
                isProvisional: false
              },
              {
                workspaceId: 'ws_2',
                name: 'infra-control',
                label: 'need confirmation',
                status: 'awaiting_input',
                summary: 'awaiting',
                metaLabel: 'sess_2',
                active: true,
                statusLabel: 'awaiting_input',
                providerId: 'opencode',
                path: 'D:/infra-control',
                cliSessionId: 'sess_2',
                isProvisional: false
              }
            ]
          }
        ]
      }
    })

    expect(wrapper.find('[data-parent-group="group-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-workspace-id="ws_2"]').attributes('data-active')).toBe('true')
  })

  it('collapses and expands group children', async () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
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
                metaLabel: 'sess_1',
                active: true,
                statusLabel: 'running',
                providerId: 'opencode',
                path: 'D:/infra-control',
                cliSessionId: 'sess_1',
                isProvisional: false
              }
            ]
          }
        ]
      }
    })

    await wrapper.get('[data-collapse-toggle="group-1"]').trigger('click')
    expect(wrapper.find('[data-workspace-id="ws_1"]').exists()).toBe(false)

    await wrapper.get('[data-collapse-toggle="group-1"]').trigger('click')
    expect(wrapper.find('[data-workspace-id="ws_1"]').exists()).toBe(true)
  })

  it('renders parent meta and a separate session affordance like the style-h route column', () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
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
        ]
      }
    })

    expect(wrapper.find('.route-item--parent .route-time').text()).toBe('1h')
    expect(wrapper.find('[data-session-affordance="group-1"]').exists()).toBe(true)
  })

  it('separates the parent row main copy from trailing actions', () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
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
        ]
      }
    })

    expect(wrapper.find('.route-item--parent .route-item__main').exists()).toBe(true)
    expect(wrapper.find('.route-item--parent .route-project-actions').exists()).toBe(true)
  })

  it('keeps child rows visually compact without route summary text', () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
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
        ]
      }
    })

    expect(wrapper.find('.route-summary').exists()).toBe(false)
    expect(wrapper.find('.hierarchy-node__pill').exists()).toBe(false)
    expect(wrapper.find('[data-workspace-id="ws_1"] .route-time').text()).toBe('1h')
  })

  it('renders the Projects group label only once for the whole rail', () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
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
          },
          {
            id: 'group-2',
            title: 'apps-shell',
            pathLabel: 'D:/apps-shell',
            children: [
              {
                workspaceId: 'ws_2',
                name: 'apps-shell',
                label: 'fix sidebar',
                status: 'awaiting_input',
                summary: 'awaiting',
                metaLabel: '2h',
                active: false,
                statusLabel: 'awaiting_input',
                providerId: 'opencode',
                path: 'D:/apps-shell',
                cliSessionId: 'sess_2',
                isProvisional: false
              }
            ]
          }
        ]
      }
    })

    expect(wrapper.findAll('.group-label')).toHaveLength(1)
    expect(wrapper.find('.group-label').text()).toContain('Projects')
  })
})
