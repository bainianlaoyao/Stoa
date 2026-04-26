import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { nextTick } from 'vue'
import WorkspaceList from './WorkspaceList.vue'
import type { SessionPresenceSnapshot } from '@shared/observability'

const sessionPresenceMap: Record<string, SessionPresenceSnapshot> = {
  session_op_1: {
    sessionId: 'session_op_1',
    projectId: 'project_alpha',
    providerId: 'opencode',
    providerLabel: 'OpenCode',
    modelLabel: null,
    phase: 'running',
    runtimeState: 'alive',
    agentState: 'working',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    confidence: 'authoritative',
    health: 'healthy',
    blockingReason: null,
    lastAssistantSnippet: null,
    lastEventAt: '2026-04-26T00:00:00.000Z',
    lastEvidenceType: null,
    hasUnreadTurn: false,
    recoveryPointerState: 'trusted',
    evidenceSequence: 1,
    sourceSequence: 1,
    updatedAt: '2026-04-26T00:00:00.000Z'
  }
}

describe('WorkspaceList', () => {
  test('renders project to session hierarchy and emits session creation target', async () => {
    const wrapper = mount(WorkspaceList, {
      props: {
        hierarchy: [
          {
            id: 'project_alpha',
            name: 'alpha',
            path: 'D:/alpha',
            createdAt: 'a',
            updatedAt: 'a',
            active: true,
            archivedSessions: [],
            sessions: [
              {
                id: 'session_op_1',
                projectId: 'project_alpha',
                type: 'opencode',
                runtimeState: 'alive',
                agentState: 'working',
                hasUnseenCompletion: false,
                runtimeExitCode: null,
                runtimeExitReason: null,
                lastStateSequence: 1,
                blockingReason: null,
                title: 'Deploy',
                summary: 'ready',
                recoveryMode: 'resume-external',
                externalSessionId: 'ext-1',
                createdAt: 'a',
                updatedAt: 'a',
                lastActivatedAt: 'a',
                archived: false,
                active: true
              }
            ]
          }
        ],
        activeProjectId: 'project_alpha',
        activeSessionId: 'session_op_1',
        projectName: 'alpha',
        projectPath: 'D:/alpha',
        sessionTitle: 'Deploy',
        sessionType: 'opencode',
        sessionPresenceMap
      }
    })

    expect(wrapper.text()).toContain('alpha')
    expect(wrapper.text()).toContain('Deploy')

    // Selected session type shows in the listbox button
    expect(wrapper.text()).toContain('OpenCode')

    // Open the listbox to verify all session type options are available
    const button = wrapper.find('[data-testid="glass-listbox-button"]')
    await button.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('Codex')
    expect(wrapper.text()).toContain('Claude Code')
    expect(wrapper.text()).toContain('Shell')

    await wrapper.get('[data-project-create-session="project_alpha"]').trigger('click')

    expect(wrapper.emitted('createSession')).toEqual([['project_alpha']])
  })
})
