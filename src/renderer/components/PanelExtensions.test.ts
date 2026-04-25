// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import PanelExtensions from './PanelExtensions.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import type { PanelExtensionDefinition } from '@extensions/panels'

const stubPanels: PanelExtensionDefinition[] = [
  {
    panelId: 'workspace-debug-summary',
    title: 'Workspace Debug Summary',
    renderSummary(context) {
      const active = context.activeWorkspaceId ?? 'none'
      return `workspaces=${context.workspaceCount}; active=${active}`
    }
  }
]

let mockListPanelsResult: PanelExtensionDefinition[] = stubPanels

vi.mock('@extensions/panels', () => ({
  listPanels: () => mockListPanelsResult
}))

const mockSession: SessionSummary = {
  id: 's1',
  projectId: 'p1',
  type: 'shell',
  status: 'running',
  runtimeState: 'alive',
  agentState: 'unknown',
  hasUnseenCompletion: false,
  runtimeExitCode: null,
  runtimeExitReason: null,
  lastStateSequence: 0,
  blockingReason: null,
  title: 'Test',
  summary: '',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: 't',
  updatedAt: 't',
  lastActivatedAt: 't',
  archived: false
}

function mountPanel(
  props: Partial<{
    activeProject: ProjectSummary | null
    activeSession: SessionSummary | null
    sessionCount: number
  }> = {}
) {
  return mount(PanelExtensions, {
    props: {
      activeProject: null,
      activeSession: null,
      sessionCount: 0,
      ...props
    }
  })
}

describe('PanelExtensions', () => {
  test('renders panel cards from listPanels registry', () => {
    mockListPanelsResult = stubPanels
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('White-box panels')
    expect(wrapper.text()).toContain('Workspace Debug Summary')
    expect(wrapper.text()).toContain('workspaces=0')
  })

  test('passes activeSession.id to renderSummary when session is active', () => {
    mockListPanelsResult = stubPanels
    const wrapper = mountPanel({ activeSession: mockSession })

    expect(wrapper.text()).toContain('active=s1')
  })

  test('passes null activeWorkspaceId when no active session', () => {
    mockListPanelsResult = stubPanels
    const wrapper = mountPanel({ activeSession: null })

    expect(wrapper.text()).toContain('active=none')
  })

  test('passes sessionCount to renderSummary', () => {
    mockListPanelsResult = stubPanels
    const wrapper = mountPanel({ sessionCount: 5 })

    expect(wrapper.text()).toContain('workspaces=5')
  })

  test('renders no panel cards if registry is empty', () => {
    mockListPanelsResult = []
    const wrapper = mountPanel()

    expect(wrapper.findAll('article.panel-extension-card')).toHaveLength(0)
  })
})
