import { describe, expect, it } from 'vitest'
import {
  sessionPresenceBlockedBehavior,
  sessionPresenceCompleteBehavior,
  sessionPresenceFailureBehavior,
  sessionPresenceReadyBehavior,
  sessionPresenceRunningBehavior,
  sessionTelemetryBlockedBehavior,
  sessionRestoreBehavior,
  sessionTelemetryCompleteBehavior,
  workspaceQuickAccessBehavior
} from '../behavior/session.behavior'
import { metaSessionReadFullContextAndGatePromptBehavior } from '../behavior/meta-session.behavior'
import {
  stoactlDisableCleanup,
  stoactlEnvStrippedWhenDisabled,
  stoactlHttp503WhenDisabled
} from '../behavior/stoactl-lifecycle'
import {
  mobileDrilldownBehavior,
  mobileHealthBehavior,
  mobileSearchBehavior,
  mobileSessionCreationBehavior,
  mobileTerminalControlsBehavior
} from '../behavior/mobile.behavior'
import { defineGeneratedTestMeta } from '../contracts/testing-contracts'
import {
  metaSessionReadFullContextAndGatePromptJourney
} from '../journeys/meta-session.journey'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import {
  stoactlDisableCleanupJourney,
  stoactlEnvStrippedJourney
} from '../journeys/stoactl-lifecycle.journey'
import { workspaceQuickAccessJourney } from '../journeys/workspace-quick-access.journey'
import {
  mobileHealthJourney,
  mobileSearchJourney,
  mobileSessionCreationJourney,
  mobileTerminalControlsJourney,
  mobileUiV1Journey
} from '../journeys/mobile-ui-v1.journey'
import {
  sessionPresenceBlockedJourney,
  sessionPresenceFailureJourney,
  sessionPresenceReadyJourney,
  sessionPresenceRunningJourney,
  sessionTelemetryClaudeLifecycleJourney,
  sessionTelemetryBlockedJourney,
  sessionTelemetryCompleteJourney
} from '../journeys/session-telemetry.journey'
import { buildBehaviorCoverageReport } from './behavior-coverage'

describe('behavior coverage report', () => {
  it('marks meta session full-context reads and prompt gating as hardened when context and approval evidence are covered', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [metaSessionReadFullContextAndGatePromptBehavior],
      journeys: [metaSessionReadFullContextAndGatePromptJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.meta-session.read-full-context-and-gate-prompt',
          behaviorIds: ['meta-session.read-full-context-and-gate-prompt'],
          entities: ['meta-session', 'work-session', 'context-full-text', 'proposal'],
          statesCovered: ['ctl.context.full', 'ctl.prompt.approval-required'],
          interruptionsCovered: ['proposal.dispatch.afterStaleContext'],
          observationLayers: ['main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: ['meta-session-control-server', 'meta-session-command-dispatcher']
        })
      ]
    })

    expect(report.behaviors['meta-session.read-full-context-and-gate-prompt']?.maturity).toBe('Hardened')
    expect(report.behaviors['meta-session.read-full-context-and-gate-prompt']?.missingObservationLayers).toEqual([])
    expect(report.behaviors['meta-session.read-full-context-and-gate-prompt']?.missingInterruptions).toEqual([
      'app.relaunch.duringPromptGate'
    ])
  })

  it('marks behavior as Declared when no journey exists', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [],
      generatedTests: []
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Declared')
  })

  it('marks behavior as Reachable when a journey exists without generated test metadata', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [sessionRestoreJourney],
      generatedTests: []
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Reachable')
  })

  it('marks workspace quick access as verified by generated Playwright metadata', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [workspaceQuickAccessBehavior],
      journeys: [workspaceQuickAccessJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.workspace.quick-access.actions',
          behaviorIds: ['workspace.quickAccess'],
          entities: ['project', 'session', 'workspace-path', 'ide-settings'],
          statesCovered: ['workspace.open.ide', 'workspace.open.file-manager', 'sidebar.open'],
          interruptionsCovered: [],
          observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
          riskBudget: 'high',
          regressionSources: ['workspace-open-ipc', 'terminal-quick-actions']
        })
      ]
    })

    expect(report.behaviors['workspace.quickAccess']?.maturity).toBe('Verified')
    expect(report.behaviors['workspace.quickAccess']?.journeyIds).toEqual([
      'journey.workspace.quick-access.actions'
    ])
    expect(report.behaviors['workspace.quickAccess']?.generatedTestIds).toEqual([
      'journey.workspace.quick-access.actions'
    ])
  })

  it('marks critical behavior as Verified with generated metadata but no interruption coverage', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [sessionRestoreJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.restore.base',
          behaviorIds: ['session.restore'],
          entities: ['session', 'archive'],
          statesCovered: ['session.archived', 'session.running'],
          interruptionsCovered: [],
          observationLayers: ['ui', 'main-debug-state'],
          riskBudget: 'critical',
          regressionSources: []
        })
      ]
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Verified')
  })

  it('marks critical behavior as Hardened when interruptions and persistence are covered', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionRestoreBehavior],
      journeys: [sessionRestoreJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.restore.relaunch',
          behaviorIds: ['session.restore'],
          entities: ['session', 'archive', 'recovery'],
          statesCovered: ['session.archived', 'session.running'],
          interruptionsCovered: ['app.relaunch.duringAction'],
          observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: []
        })
      ]
    })

    expect(report.behaviors['session.restore']?.maturity).toBe('Hardened')
    expect(report.summary.hardened).toBe(1)
  })

  it('marks completion telemetry as Hardened when canonical and hook coverage reach UI and persistence', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionTelemetryCompleteBehavior],
      journeys: [sessionTelemetryCompleteJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.telemetry.complete',
          behaviorIds: ['session.telemetry.complete'],
          entities: ['session', 'provider-telemetry', 'renderer-status'],
          statesCovered: ['presence.complete', 'session.externalSessionId'],
          interruptionsCovered: ['provider.runningEvent.afterCompletion'],
          observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: ['claude.raw-hook', 'canonical.webhook']
        })
      ]
    })

    expect(report.behaviors['session.telemetry.complete']?.maturity).toBe('Hardened')
    expect(report.behaviors['session.telemetry.complete']?.missingObservationLayers).toEqual([])
    expect(report.behaviors['session.telemetry.complete']?.missingInterruptions).toEqual([
      'app.relaunch.duringTelemetry'
    ])
  })

  it('marks blocked telemetry as Hardened when hook coverage reaches UI and persistence', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionTelemetryBlockedBehavior],
      journeys: [sessionTelemetryBlockedJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.telemetry.blocked',
          behaviorIds: ['session.telemetry.blocked'],
          entities: ['session', 'provider-telemetry', 'renderer-status'],
          statesCovered: ['presence.blocked', 'session.externalSessionId'],
          interruptionsCovered: ['provider.runningEvent.afterPermissionRequest'],
          observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: ['claude.raw-hook']
        })
      ]
    })

    expect(report.behaviors['session.telemetry.blocked']?.maturity).toBe('Hardened')
    expect(report.behaviors['session.telemetry.blocked']?.missingObservationLayers).toEqual([])
    expect(report.behaviors['session.telemetry.blocked']?.missingInterruptions).toEqual([
      'app.relaunch.duringTelemetry'
    ])
  })

  it('marks presence-ready journey metadata as Verified', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionPresenceReadyBehavior],
      journeys: [sessionPresenceReadyJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.presence.ready',
          behaviorIds: ['session.presence.ready'],
          entities: ['session', 'renderer-status'],
          statesCovered: ['presence.ready'],
          interruptionsCovered: [],
          observationLayers: ['ui'],
          riskBudget: 'standard',
          regressionSources: ['presence-projection']
        })
      ]
    })

    expect(report.behaviors['session.presence.ready']?.maturity).toBe('Verified')
  })

  it('marks presence-running journey metadata as Verified', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionPresenceRunningBehavior],
      journeys: [sessionPresenceRunningJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.presence.running',
          behaviorIds: ['session.presence.running'],
          entities: ['session', 'renderer-status'],
          statesCovered: ['presence.running'],
          interruptionsCovered: [],
          observationLayers: ['ui'],
          riskBudget: 'standard',
          regressionSources: ['presence-projection']
        })
      ]
    })

    expect(report.behaviors['session.presence.running']?.maturity).toBe('Verified')
  })

  it('marks presence-blocked journey metadata as Verified', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionPresenceBlockedBehavior],
      journeys: [sessionPresenceBlockedJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.presence.blocked',
          behaviorIds: ['session.presence.blocked'],
          entities: ['session', 'renderer-status'],
          statesCovered: ['presence.blocked'],
          interruptionsCovered: [],
          observationLayers: ['ui'],
          riskBudget: 'standard',
          regressionSources: ['presence-projection']
        })
      ]
    })

    expect(report.behaviors['session.presence.blocked']?.maturity).toBe('Verified')
  })

  it('marks presence-complete journey metadata as Verified', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionPresenceCompleteBehavior],
      journeys: [sessionTelemetryClaudeLifecycleJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.presence.complete',
          behaviorIds: ['session.presence.complete'],
          entities: ['session', 'renderer-status'],
          statesCovered: ['presence.complete'],
          interruptionsCovered: [],
          observationLayers: ['ui'],
          riskBudget: 'standard',
          regressionSources: ['presence-projection']
        })
      ]
    })

    expect(report.behaviors['session.presence.complete']?.maturity).toBe('Verified')
  })

  it('marks presence-failure journey metadata as Verified', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionPresenceFailureBehavior],
      journeys: [sessionPresenceFailureJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.presence.failure',
          behaviorIds: ['session.presence.failure'],
          entities: ['session', 'renderer-status'],
          statesCovered: ['presence.failure'],
          interruptionsCovered: [],
          observationLayers: ['ui'],
          riskBudget: 'standard',
          regressionSources: ['presence-projection']
        })
      ]
    })

    expect(report.behaviors['session.presence.failure']?.maturity).toBe('Verified')
  })

  it('marks Claude lifecycle telemetry metadata as Reachable or better', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionPresenceCompleteBehavior],
      journeys: [sessionTelemetryClaudeLifecycleJourney],
      generatedTests: []
    })

    expect(['Reachable', 'Verified', 'Hardened']).toContain(report.behaviors['session.presence.complete']?.maturity)
  })

  it('marks stoactl disableCleanup as Reachable when journey exists', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [stoactlDisableCleanup],
      journeys: [stoactlDisableCleanupJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.stoactl.disableCleanup',
          behaviorIds: ['stoactl.disableCleanup', 'stoactl.envStrippedWhenDisabled'],
          entities: ['settings', 'shim', 'path', 'http-control-plane', 'session-env'],
          statesCovered: ['shim.absent', 'path.binDirUnregistered', 'http.ctlReturns503'],
          interruptionsCovered: [],
          observationLayers: ['main-debug-state'],
          riskBudget: 'high',
          regressionSources: ['stoa-ctl-feature-gate', 'session-control-server']
        })
      ]
    })

    expect(report.behaviors['stoactl.disableCleanup']?.maturity).toBe('Verified')
    expect(report.behaviors['stoactl.disableCleanup']?.journeyIds).toEqual(['stoactl.disableCleanup'])
  })

  it('marks stoactl envStripped as Reachable when journey exists', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [stoactlEnvStrippedWhenDisabled],
      journeys: [stoactlEnvStrippedJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.stoactl.disableCleanup',
          behaviorIds: ['stoactl.disableCleanup', 'stoactl.envStrippedWhenDisabled'],
          entities: ['settings', 'shim', 'path', 'http-control-plane', 'session-env'],
          statesCovered: ['env.STOA_CTL_COMMAND.absent', 'env.STOA_CTL_SESSION_TOKEN.absent', 'env.STOA_CTL_BASE_URL.present'],
          interruptionsCovered: [],
          observationLayers: ['main-debug-state'],
          riskBudget: 'standard',
          regressionSources: ['stoa-ctl-feature-gate', 'session-command-env']
        })
      ]
    })

    expect(report.behaviors['stoactl.envStrippedWhenDisabled']?.maturity).toBe('Verified')
    expect(report.behaviors['stoactl.envStrippedWhenDisabled']?.journeyIds).toEqual(['stoactl.envStrippedWhenDisabled'])
  })

  it('marks stoactl http503 as Declared when no journey or test exists', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [stoactlHttp503WhenDisabled],
      journeys: [],
      generatedTests: []
    })

    expect(report.behaviors['stoactl.http503WhenDisabled']?.maturity).toBe('Declared')
  })

  it('marks mobile UI V1 critical behavior as covered by generated mobile metadata', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [
        mobileDrilldownBehavior,
        mobileSearchBehavior,
        mobileSessionCreationBehavior,
        mobileTerminalControlsBehavior,
        mobileHealthBehavior
      ],
      journeys: [
        mobileUiV1Journey,
        mobileSearchJourney,
        mobileSessionCreationJourney,
        mobileTerminalControlsJourney,
        mobileHealthJourney
      ],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.mobile.ui-v1',
          behaviorIds: [
            'mobile.drilldown',
            'mobile.search',
            'mobile.session.create',
            'mobile.terminal.controls',
            'mobile.health'
          ],
          entities: ['mobile-shell', 'workspace', 'session', 'xterm', 'backend-health'],
          statesCovered: [
            'mobile.workspace-home',
            'mobile.session-list',
            'mobile.session-view',
            'mobile.keys-rail',
            'mobile.fixed-wide-terminal',
            'mobile.health-connected'
          ],
          interruptionsCovered: [
            'viewport.rotates.landscape',
            'sheet.dismissedBeforeSelection',
            'tapOutsideKeyRail',
            'backend.failureLongerThan15s'
          ],
          observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
          riskBudget: 'critical',
          regressionSources: ['mobile-ui-v1-design-spec', 'backend-health-ipc']
        })
      ]
    })

    expect(report.behaviors['mobile.drilldown']?.maturity).toBe('Hardened')
    expect(report.behaviors['mobile.session.create']?.maturity).toBe('Hardened')
    expect(report.behaviors['mobile.terminal.controls']?.maturity).toBe('Hardened')
    expect(report.behaviors['mobile.health']?.maturity).toBe('Hardened')
    expect(report.behaviors['mobile.search']?.maturity).toBe('Verified')
  })
})
