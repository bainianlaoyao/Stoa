// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import MetaSessionSurface from './MetaSessionSurface.vue'
import type { RendererApi } from '@shared/project-session'
import { useMetaSessionStore } from '@renderer/stores/meta-session'

function createStoaMock(overrides: Partial<RendererApi> = {}): RendererApi {
  return {
    windowsBuildNumber: undefined,
    getBootstrapState: vi.fn().mockResolvedValue({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }),
    createProject: vi.fn().mockResolvedValue(null),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(null),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    setActiveProject: vi.fn().mockResolvedValue(undefined),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    regenerateSessionTitle: vi.fn().mockResolvedValue(null),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    getTerminalReplay: vi.fn().mockResolvedValue(''),
    sendSessionInput: vi.fn(),
    sendSessionBinaryInput: vi.fn(),
    sendSessionResize: vi.fn().mockResolvedValue(undefined),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onMemoryNotification: vi.fn().mockReturnValue(() => {}),
    onSessionEvent: vi.fn().mockReturnValue(() => {}),
    getSessionPresence: vi.fn().mockResolvedValue(null),
    getProjectObservability: vi.fn().mockResolvedValue(null),
    getAppObservability: vi.fn().mockResolvedValue(null),
    listSessionObservationEvents: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    onSessionPresenceChanged: vi.fn().mockReturnValue(() => {}),
    onProjectObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    onAppObservabilityChanged: vi.fn().mockReturnValue(() => {}),
    getSettings: vi.fn().mockResolvedValue({
      shellPath: '',
      terminal: {},
      providers: {},
      titleGeneration: {
        enabled: false,
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4-mini'
      },
      evolverInferenceProvider: 'claude-code',
      evolverExecutionMode: 'workspace-shell',
      workspaceIde: { id: 'vscode', executablePath: '' },
      claudeDangerouslySkipPermissions: false,
      locale: 'en'
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    pickFolder: vi.fn().mockResolvedValue(null),
    pickFile: vi.fn().mockResolvedValue(null),
    detectShell: vi.fn().mockResolvedValue(null),
    detectProvider: vi.fn().mockResolvedValue(null),
    detectVscode: vi.fn().mockResolvedValue(null),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
    maximizeWindow: vi.fn().mockResolvedValue(undefined),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    isWindowMaximized: vi.fn().mockResolvedValue(false),
    onWindowMaximizeChange: vi.fn().mockReturnValue(() => {}),
    getUpdateState: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    checkForUpdates: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    downloadUpdate: vi.fn().mockResolvedValue({
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false
    }),
    quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    dismissUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockReturnValue(() => {}),
    uninstallSidecars: vi.fn().mockResolvedValue(undefined),
    listSessionEvidence: vi.fn().mockResolvedValue([]),
    contextExportFullText: vi.fn().mockResolvedValue({ text: '', truncated: false, totalTurns: 0 }),
    contextExportSlimText: vi.fn().mockResolvedValue({ text: '', truncated: false, totalTurns: 0 }),
    getMetaSessionBootstrapState: vi.fn().mockResolvedValue({
      activeMetaSessionId: 'meta_session_1',
      sessions: [{
        id: 'meta_session_1',
        title: 'global-triage',
        status: 'running',
        backendSessionType: 'claude-code',
        capabilityLevel: 2,
        pendingProposalCount: 1,
        activeTargetCount: 3,
        lastSummary: 'Collecting blocked sessions.',
        lastRisk: 'Two sessions are editing the same module.',
        backendSessionId: 'backend-session-1',
        createdAt: '2026-05-07T08:00:00.000Z',
        updatedAt: '2026-05-07T08:05:00.000Z',
        lastActivatedAt: '2026-05-07T08:05:00.000Z',
        archived: false
      }],
      inspectorTarget: {
        kind: 'app'
      }
    }),
    createMetaSession: vi.fn().mockResolvedValue(null),
    setActiveMetaSession: vi.fn().mockResolvedValue(undefined),
    archiveMetaSession: vi.fn().mockResolvedValue(undefined),
    restoreMetaSession: vi.fn().mockResolvedValue(undefined),
    setMetaSessionInspectorTarget: vi.fn().mockResolvedValue(undefined),
    listMetaSessionProposals: vi.fn().mockResolvedValue([{
      id: 'proposal_1',
      metaSessionId: 'meta_session_1',
      kind: 'prompt',
      targetSessionIds: ['session_1'],
      riskLevel: 3,
      status: 'pending_approval',
      summary: 'Prompt injection for session_1',
      reason: 'Freeform prompt injection requires explicit approval.',
      promptText: 'Refactor and edit the code now.',
      presetName: null,
      snapshot: {
        sessions: [{
          sessionId: 'session_1',
          lastStateSequence: 17,
          turnEpoch: 4,
          updatedAt: '2026-05-07T08:05:00.000Z'
        }]
      },
      createdAt: '2026-05-07T08:05:00.000Z',
      updatedAt: '2026-05-07T08:05:00.000Z',
      approvedAt: null,
      rejectedAt: null,
      executedAt: null,
      executionResult: null
    }]),
    getMetaSessionProposal: vi.fn().mockResolvedValue(null),
    approveMetaSessionProposal: vi.fn().mockResolvedValue(null),
    rejectMetaSessionProposal: vi.fn().mockResolvedValue(null),
    dispatchMetaSessionProposal: vi.fn().mockResolvedValue(null),
    onMetaSessionEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
    restartSession: overrides.restartSession ?? vi.fn().mockResolvedValue(undefined)
  }
}

describe('MetaSessionSurface', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    window.stoa = createStoaMock()
    const store = useMetaSessionStore()
    await store.bootstrapFromBridge()
  })

  test('renders meta session list, persistent meta session terminal deck, and native inspector rail', () => {
    const wrapper = mount(MetaSessionSurface, {
      global: {
        plugins: [pinia]
      }
    })

    expect(wrapper.find('[data-testid="meta-session-session-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="meta-session-terminal-deck"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="meta-session-inspector-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="meta-session-action-panel"]').exists()).toBe(true)
  })

  test('renders native proposal approval controls in the right rail and lets the user select a proposal target', async () => {
    const wrapper = mount(MetaSessionSurface, {
      global: {
        plugins: [pinia]
      }
    })

    await flushPromises()

    const proposalItem = wrapper.get('[data-testid="meta-session.proposal.item"]')
    await proposalItem.trigger('click')

    expect(window.stoa.setMetaSessionInspectorTarget).toHaveBeenCalledWith({
      kind: 'proposal',
      proposalId: 'proposal_1'
    })
    expect(wrapper.get('[data-testid="meta-session.action.approve"]').text()).toContain('Approve')
    expect(wrapper.get('[data-testid="meta-session.action.reject"]').text()).toContain('Reject')
    expect(wrapper.get('[data-testid="meta-session.action.dispatch"]').text()).toContain('Approve and Execute')
  })

  test('creating a meta session from the left rail targets the meta session store with an explicit backendSessionType', async () => {
    const createMetaSession = vi.fn().mockResolvedValue({
      id: 'meta_session_2',
      title: 'meta-session-2',
      status: 'created',
      backendSessionType: 'codex',
      capabilityLevel: 3,
      pendingProposalCount: 0,
      activeTargetCount: 0,
      lastSummary: 'Waiting for meta session backend to start',
      lastRisk: null,
      backendSessionId: null,
      createdAt: '2026-05-07T08:10:00.000Z',
      updatedAt: '2026-05-07T08:10:00.000Z',
      lastActivatedAt: null,
      archived: false
    })
    window.stoa = createStoaMock({ createMetaSession })
    const store = useMetaSessionStore()
    await store.bootstrapFromBridge()

    const wrapper = mount(MetaSessionSurface, {
      global: {
        plugins: [pinia],
        stubs: {
          TerminalViewport: defineComponent({
            name: 'TerminalViewport',
            template: '<div data-testid="terminal-viewport-stub" />'
          })
        }
      }
    })

    await wrapper.get('[data-testid="meta-session.session.create"]').trigger('mousedown')
    const sessionList = wrapper.findComponent({ name: 'MetaSessionSessionList' })
    sessionList.findComponent({ name: 'ProviderFloatingCard' }).vm.$emit('create', { type: 'codex' })
    await flushPromises()

    expect(createMetaSession).toHaveBeenCalledWith({
      title: 'meta-session-2',
      backendSessionType: 'codex',
      capabilityLevel: 3
    })
  })

  test('meta session backend picker only exposes supported meta backends', async () => {
    const wrapper = mount(MetaSessionSurface, {
      global: {
        plugins: [pinia]
      }
    })

    await wrapper.get('[data-testid="meta-session.session.create"]').trigger('mousedown')
    await flushPromises()

    const providerButtons = Array.from(document.body.querySelectorAll('[data-testid="provider-card.item"]'))
      .map((node) => node.getAttribute('data-provider-type'))

    expect(providerButtons).toEqual(['opencode', 'codex', 'claude-code'])
    expect(providerButtons).not.toContain('shell')
  })
})
