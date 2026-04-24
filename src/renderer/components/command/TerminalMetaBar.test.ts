import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TerminalMetaBar from './TerminalMetaBar.vue'
import { buildSessionPresenceSnapshot } from '@shared/observability-projection'
import { toActiveSessionViewModel } from '@renderer/stores/observability-view-models'
import type { ActiveSessionViewModel } from '@shared/observability'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'

const terminalMetaBarPath = resolve(dirname(fileURLToPath(import.meta.url)), 'TerminalMetaBar.vue')

const mockProject: ProjectSummary = {
  id: 'project_1', name: 'test-project', path: '/tmp/test', createdAt: 'a', updatedAt: 'a'
}

const mockSession: SessionSummary = {
  id: 'session_1', projectId: 'project_1', type: 'opencode', status: 'running',
  title: 'test session', summary: 'running', recoveryMode: 'resume-external',
  externalSessionId: 'ext-1', createdAt: 'a', updatedAt: 'a', lastActivatedAt: 'a', archived: false
}

const activeViewModel: ActiveSessionViewModel = {
  sessionId: 'session_1',
  title: 'Investigate webhook retries',
  providerLabel: 'Claude Code',
  modelLabel: 'Sonnet',
  phaseLabel: 'Ready',
  confidenceLabel: 'Live',
  tone: 'accent',
  lastUpdatedLabel: '10s ago',
  snippet: 'Approval granted. Proceeding with the patch.',
  explanation: 'Provider is waiting for permission.'
}

describe('TerminalMetaBar', () => {
  it('renders the active session view model summary when provided', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: mockSession, activeViewModel } })

    expect(wrapper.find('.terminal-meta').exists()).toBe(true)
    expect(wrapper.text()).toContain('Investigate webhook retries')
    expect(wrapper.text()).toContain('Claude Code')
    expect(wrapper.text()).toContain('Sonnet')
    expect(wrapper.text()).toContain('Ready')
    expect(wrapper.text()).toContain('Live')
    expect(wrapper.text()).toContain('10s ago')
    expect(wrapper.text()).toContain('Approval granted. Proceeding with the patch.')
    expect(wrapper.text()).toContain('Provider is waiting for permission.')
  })

  it('renders the real blocked active session explanation for resume confirmation', () => {
    const blockedSession: SessionSummary = {
      ...mockSession,
      type: 'claude-code',
      status: 'needs_confirmation',
      summary: 'waiting for resume confirmation'
    }
    const blockedPresence = buildSessionPresenceSnapshot(blockedSession, {
      activeSessionId: blockedSession.id,
      nowIso: '2026-04-24T08:00:00.000Z',
      modelLabel: 'Sonnet'
    })
    const blockedViewModel = toActiveSessionViewModel(
      blockedSession,
      blockedPresence,
      '2026-04-24T08:00:00.000Z'
    )

    const wrapper = mount(TerminalMetaBar, {
      props: {
        project: mockProject,
        session: blockedSession,
        activeViewModel: blockedViewModel
      }
    })

    expect(blockedViewModel.phaseLabel).toBe('Blocked')
    expect(wrapper.text()).toContain('Blocked')
    expect(wrapper.text()).toContain('Provider is waiting for confirmation.')
  })

  it('falls back to existing raw props when no active view model is available', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: mockSession, activeViewModel: null } })

    expect(wrapper.find('.terminal-meta').exists()).toBe(true)
    expect(wrapper.text()).toContain('project_1')
    expect(wrapper.text()).toContain('session_1')
    expect(wrapper.text()).toContain('opencode')
    expect(wrapper.text()).toContain('running')
  })

  it('with project null: renders nothing', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: null, session: mockSession, activeViewModel: null } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('with session null: renders nothing', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: mockProject, session: null, activeViewModel: null } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('with both null: renders nothing', () => {
    const wrapper = mount(TerminalMetaBar, { props: { project: null, session: null, activeViewModel: null } })
    expect(wrapper.find('.terminal-meta').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('uses token-based metadata color instead of hardcoded text literal', () => {
    const source = readFileSync(terminalMetaBarPath, 'utf8')

    expect(source).not.toContain('text-[#64748b]')
    expect(source).not.toContain('999px')
  })
})
