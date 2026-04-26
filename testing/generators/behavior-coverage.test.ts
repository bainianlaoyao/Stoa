import { describe, expect, it } from 'vitest'
import {
  sessionPresenceBlockedBehavior,
  sessionPresenceCompleteBehavior,
  sessionPresenceFailedBehavior,
  sessionPresenceReadyBehavior,
  sessionPresenceRunningBehavior,
  sessionTelemetryBlockedBehavior,
  sessionRestoreBehavior,
  sessionTelemetryCompleteBehavior,
  workspaceQuickAccessBehavior
} from '../behavior/session.behavior'
import { defineGeneratedTestMeta } from '../contracts/testing-contracts'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { workspaceQuickAccessJourney } from '../journeys/workspace-quick-access.journey'
import {
  sessionPresenceBlockedJourney,
  sessionPresenceFailedJourney,
  sessionPresenceReadyJourney,
  sessionPresenceRunningJourney,
  sessionTelemetryClaudeLifecycleJourney,
  sessionTelemetryBlockedJourney,
  sessionTelemetryCompleteJourney
} from '../journeys/session-telemetry.journey'
import { buildBehaviorCoverageReport } from './behavior-coverage'

describe('behavior coverage report', () => {
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
          statesCovered: ['workspace.open.ide', 'workspace.open.file-manager'],
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

  it('covers layered session presence behaviors with lifecycle generated metadata', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [
        sessionPresenceReadyBehavior,
        sessionPresenceRunningBehavior,
        sessionPresenceCompleteBehavior,
        sessionPresenceBlockedBehavior,
        sessionPresenceFailedBehavior
      ],
      journeys: [
        sessionPresenceReadyJourney,
        sessionPresenceRunningJourney,
        sessionTelemetryClaudeLifecycleJourney,
        sessionPresenceBlockedJourney,
        sessionPresenceFailedJourney
      ],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.telemetry.claude-lifecycle',
          behaviorIds: [
            'session.presence.ready',
            'session.presence.running',
            'session.presence.complete',
            'session.presence.blocked',
            'session.presence.failed'
          ],
          entities: ['session', 'provider-telemetry', 'renderer-status'],
          statesCovered: [
            'presence.ready',
            'presence.running',
            'presence.blocked',
            'presence.complete',
            'presence.failed'
          ],
          interruptionsCovered: [
            'runtime.alive.withoutAgentTelemetry',
            'provider.permissionRequest.duringRunning',
            'user.visitsCompletedSession',
            'provider.permissionResolved',
            'runtime.exitedFailed.afterCompletion'
          ],
          observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: ['claude.raw-hook', 'session-state-reducer']
        })
      ]
    })

    expect(report.behaviors['session.presence.ready']?.maturity).toBe('Verified')
    expect(report.behaviors['session.presence.running']?.maturity).toBe('Verified')
    expect(report.behaviors['session.presence.complete']?.maturity).toBe('Hardened')
    expect(report.behaviors['session.presence.blocked']?.maturity).toBe('Hardened')
    expect(report.behaviors['session.presence.failed']?.maturity).toBe('Hardened')
    expect(report.behaviors['session.presence.failed']?.missingObservationLayers).toEqual([])
  })
})
