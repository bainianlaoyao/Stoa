// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HermesSurface from './HermesSurface.vue'
import type { RendererApi } from '@shared/project-session'
import { useHermesStore } from '@renderer/stores/hermes'

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
    getHermesBootstrapState: vi.fn().mockResolvedValue({
      activeHermesSessionId: 'hermes_1',
      sessions: [{
        id: 'hermes_1',
        title: 'global-triage',
        status: 'running',
        capabilityLevel: 2,
        pendingProposalCount: 1,
        activeTargetCount: 3,
        lastSummary: 'Collecting blocked sessions.',
        lastRisk: 'Two sessions are editing the same module.',
        resumeSessionId: 'resume-hermes-1',
        createdAt: '2026-05-07T08:00:00.000Z',
        updatedAt: '2026-05-07T08:05:00.000Z',
        lastActivatedAt: '2026-05-07T08:05:00.000Z'
      }],
      inspectorTarget: {
        kind: 'app'
      }
    }),
    createHermesSession: vi.fn().mockResolvedValue(null),
    setActiveHermesSession: vi.fn().mockResolvedValue(undefined),
    closeHermesSession: vi.fn().mockResolvedValue(undefined),
    setHermesInspectorTarget: vi.fn().mockResolvedValue(undefined),
    listHermesProposals: vi.fn().mockResolvedValue([{
      id: 'proposal_1',
      hermesSessionId: 'hermes_1',
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
    getHermesProposal: vi.fn().mockResolvedValue(null),
    approveHermesProposal: vi.fn().mockResolvedValue(null),
    rejectHermesProposal: vi.fn().mockResolvedValue(null),
    dispatchHermesProposal: vi.fn().mockResolvedValue(null),
    onHermesSessionEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

describe('HermesSurface', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    window.stoa = createStoaMock()
    const store = useHermesStore()
    await store.bootstrapFromBridge()
  })

  test('renders Hermes session list, persistent Hermes terminal deck, and native inspector rail', () => {
    const wrapper = mount(HermesSurface, {
      global: {
        plugins: [pinia]
      }
    })

    expect(wrapper.find('[data-testid="hermes-session-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hermes-terminal-deck"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hermes-inspector-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hermes-action-panel"]').exists()).toBe(true)
  })

  test('renders native proposal approval controls in the right rail and lets the user select a proposal target', async () => {
    const wrapper = mount(HermesSurface, {
      global: {
        plugins: [pinia]
      }
    })

    await flushPromises()

    const proposalItem = wrapper.get('[data-testid="hermes.proposal.item"]')
    await proposalItem.trigger('click')

    expect(window.stoa.setHermesInspectorTarget).toHaveBeenCalledWith({
      kind: 'proposal',
      proposalId: 'proposal_1'
    })
    expect(wrapper.get('[data-testid="hermes.action.approve"]').text()).toContain('Approve')
    expect(wrapper.get('[data-testid="hermes.action.reject"]').text()).toContain('Reject')
    expect(wrapper.get('[data-testid="hermes.action.dispatch"]').text()).toContain('Approve and Execute')
  })
})
