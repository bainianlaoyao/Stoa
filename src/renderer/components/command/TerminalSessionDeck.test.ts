// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import TerminalSessionDeck from './TerminalSessionDeck.vue'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import { createSessionSummaryFixture, createTitleGenerationContext } from '@shared/test-fixtures'

vi.mock('@renderer/components/TerminalViewport.vue', () => {
  return {
    default: defineComponent({
      name: 'TerminalViewport',
      props: {
        project: {
          type: Object,
          default: null
        },
        session: {
          type: Object,
          default: null
        },
        visible: {
          type: Boolean,
          default: true
        }
      },
      emits: ['openWorkspace'],
      setup(props, { emit }) {
        return () => h(
          'button',
          {
            type: 'button',
            'data-testid': 'terminal-viewport-stub',
            'data-project-id': props.project?.id ?? '',
            'data-session-id': props.session?.id ?? '',
            'data-visible': String(props.visible),
            onClick: () => emit('openWorkspace', {
              sessionId: props.session?.id ?? 'empty-session',
              target: 'ide'
            })
          },
          props.session?.id ?? 'empty-session'
        )
      }
    })
  }
})

const projectAlpha: ProjectSummary = {
  id: 'project_alpha',
  name: 'alpha',
  path: 'D:/alpha',
  createdAt: 'a',
  updatedAt: 'a'
}

function sessionFixture(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return createSessionSummaryFixture({
    id: 'session_1',
    projectId: 'project_alpha',
    type: 'opencode',
    runtimeState: 'alive',
    turnState: 'running',
    turnEpoch: 1,
    lastTurnOutcome: 'none',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 1,
    blockingReason: null,
    failureReason: null,
    title: 'session',
    summary: 'ready',
    recoveryMode: 'resume-external',
    externalSessionId: 'ext-1',
    createdAt: 'a',
    updatedAt: 'a',
    lastActivatedAt: 'a',
    archived: false,
    ...overrides,
    titleGenerationContext: overrides.titleGenerationContext ?? createTitleGenerationContext()
  })
}

function hierarchyFixture(
  sessions: SessionSummary[],
  activeSessionId: string | null
): ProjectHierarchyNode[] {
  return [
    {
      ...projectAlpha,
      active: true,
      sessions: sessions.map((session) => ({
        ...session,
        active: session.id === activeSessionId
      })),
      archivedSessions: []
    }
  ]
}

describe('TerminalSessionDeck', () => {
  it('persists one terminal viewport per activated AI session and keeps only the active one visible', async () => {
    const firstAiSession = sessionFixture({
      id: 'session_op_1',
      type: 'opencode',
      title: 'OpenCode 1',
      externalSessionId: 'ext-op-1'
    })
    const secondAiSession = sessionFixture({
      id: 'session_codex_2',
      type: 'codex',
      title: 'Codex 2',
      externalSessionId: 'ext-codex-2'
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([firstAiSession, secondAiSession], firstAiSession.id),
        activeProject: projectAlpha,
        activeSession: firstAiSession,
        visible: true
      }
    })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="terminal-session-deck-item"]').attributes('data-session-id')).toBe('session_op_1')
    expect(wrapper.findAll('[data-testid="terminal-viewport-stub"]')).toHaveLength(1)

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstAiSession, secondAiSession], secondAiSession.id),
      activeSession: secondAiSession
    })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(2)
    expect(
      wrapper.get('[data-testid="terminal-session-deck-item"][data-session-id="session_op_1"]').attributes('style')
    ).toContain('display: none;')
    expect(
      wrapper.get('[data-testid="terminal-session-deck-item"][data-session-id="session_codex_2"]').attributes('style')
    ).toBeUndefined()
    expect(wrapper.findAll('[data-testid="terminal-viewport-stub"]')).toHaveLength(2)
    expect(
      wrapper.get('[data-testid="terminal-viewport-stub"][data-session-id="session_op_1"]').attributes('data-visible')
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="terminal-viewport-stub"][data-session-id="session_codex_2"]').attributes('data-visible')
    ).toBe('true')
  })

  it('keeps shell sessions on the non-persistent active-session path', async () => {
    const firstShellSession = sessionFixture({
      id: 'session_shell_1',
      type: 'shell',
      turnState: 'idle',
      turnEpoch: 0,
      title: 'Shell 1',
      recoveryMode: 'fresh-shell',
      externalSessionId: null
    })
    const secondShellSession = sessionFixture({
      id: 'session_shell_2',
      type: 'shell',
      turnState: 'idle',
      turnEpoch: 0,
      title: 'Shell 2',
      recoveryMode: 'fresh-shell',
      externalSessionId: null
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([firstShellSession, secondShellSession], firstShellSession.id),
        activeProject: projectAlpha,
        activeSession: firstShellSession
      }
    })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="terminal-session-deck-ephemeral"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="terminal-viewport-stub"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="terminal-viewport-stub"]').attributes('data-session-id')).toBe('session_shell_1')

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstShellSession, secondShellSession], secondShellSession.id),
      activeSession: secondShellSession
    })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="terminal-session-deck-ephemeral"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="terminal-viewport-stub"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="terminal-viewport-stub"]').attributes('data-session-id')).toBe('session_shell_2')
  })

  it('keeps cached AI terminals mounted but hidden when the active session becomes null', async () => {
    const firstAiSession = sessionFixture({
      id: 'session_op_1',
      type: 'opencode',
      title: 'OpenCode 1',
      externalSessionId: 'ext-op-1'
    })
    const secondAiSession = sessionFixture({
      id: 'session_codex_2',
      type: 'codex',
      title: 'Codex 2',
      externalSessionId: 'ext-codex-2'
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([firstAiSession, secondAiSession], firstAiSession.id),
        activeProject: projectAlpha,
        activeSession: firstAiSession
      }
    })

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstAiSession, secondAiSession], secondAiSession.id),
      activeSession: secondAiSession
    })

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstAiSession, secondAiSession], null),
      activeSession: null
    })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(2)
    expect(
      wrapper.get('[data-testid="terminal-session-deck-item"][data-session-id="session_op_1"]').attributes('style')
    ).toContain('display: none;')
    expect(
      wrapper.get('[data-testid="terminal-session-deck-item"][data-session-id="session_codex_2"]').attributes('style')
    ).toContain('display: none;')
  })

  it('hides mounted terminals without unmounting them when deck visibility turns off', async () => {
    const firstAiSession = sessionFixture({
      id: 'session_op_1',
      type: 'opencode',
      title: 'OpenCode 1',
      externalSessionId: 'ext-op-1'
    })
    const secondAiSession = sessionFixture({
      id: 'session_codex_2',
      type: 'codex',
      title: 'Codex 2',
      externalSessionId: 'ext-codex-2'
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([firstAiSession, secondAiSession], firstAiSession.id),
        activeProject: projectAlpha,
        activeSession: firstAiSession,
        visible: true
      }
    })

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstAiSession, secondAiSession], secondAiSession.id),
      activeSession: secondAiSession
    })

    await wrapper.setProps({ visible: false })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(2)
    expect(
      wrapper.get('[data-testid="terminal-session-deck-item"][data-session-id="session_op_1"]').attributes('style')
    ).toContain('display: none;')
    expect(
      wrapper.get('[data-testid="terminal-session-deck-item"][data-session-id="session_codex_2"]').attributes('style')
    ).toContain('display: none;')
    expect(
      wrapper.get('[data-testid="terminal-viewport-stub"][data-session-id="session_op_1"]').attributes('data-visible')
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="terminal-viewport-stub"][data-session-id="session_codex_2"]').attributes('data-visible')
    ).toBe('false')
  })

  it('prunes cached AI terminals when sessions disappear from the hierarchy', async () => {
    const firstAiSession = sessionFixture({
      id: 'session_op_1',
      type: 'opencode',
      title: 'OpenCode 1',
      externalSessionId: 'ext-op-1'
    })
    const secondAiSession = sessionFixture({
      id: 'session_codex_2',
      type: 'codex',
      title: 'Codex 2',
      externalSessionId: 'ext-codex-2'
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([firstAiSession, secondAiSession], firstAiSession.id),
        activeProject: projectAlpha,
        activeSession: firstAiSession
      }
    })

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstAiSession, secondAiSession], secondAiSession.id),
      activeSession: secondAiSession
    })

    await wrapper.setProps({
      hierarchy: hierarchyFixture([firstAiSession], firstAiSession.id),
      activeSession: firstAiSession
    })

    expect(wrapper.findAll('[data-testid="terminal-session-deck-item"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="terminal-session-deck-item"][data-session-id="session_codex_2"]').exists()).toBe(false)
  })

  it('resolves shell projects from hierarchy when the activeProject prop is unavailable', () => {
    const shellSession = sessionFixture({
      id: 'session_shell_1',
      type: 'shell',
      turnState: 'idle',
      turnEpoch: 0,
      title: 'Shell 1',
      recoveryMode: 'fresh-shell',
      externalSessionId: null
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([shellSession], shellSession.id),
        activeProject: null,
        activeSession: shellSession
      }
    })

    expect(wrapper.get('[data-testid="terminal-viewport-stub"]').attributes('data-project-id')).toBe('project_alpha')
  })

  it('forwards openWorkspace from the active terminal viewport', async () => {
    const aiSession = sessionFixture({
      id: 'session_claude_1',
      type: 'claude-code',
      title: 'Claude 1',
      externalSessionId: 'ext-claude-1'
    })

    const wrapper = mount(TerminalSessionDeck, {
      props: {
        hierarchy: hierarchyFixture([aiSession], aiSession.id),
        activeProject: projectAlpha,
        activeSession: aiSession,
        visible: true
      }
    })

    await wrapper.get('[data-testid="terminal-viewport-stub"]').trigger('click')

    expect(wrapper.emitted('openWorkspace')).toEqual([
      [{ sessionId: 'session_claude_1', target: 'ide' }]
    ])
  })
})
