import { describe, expect, it } from 'vitest'
import {
  sessionRestoreBehavior,
  sessionTelemetryTurnCompleteBehavior
} from '../behavior/session.behavior'
import { defineGeneratedTestMeta } from '../contracts/testing-contracts'
import { sessionRestoreJourney } from '../journeys/session-restore.journey'
import { sessionTelemetryTurnCompleteJourney } from '../journeys/session-telemetry.journey'
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

  it('marks turn_complete telemetry as Hardened when canonical and hook coverage reach UI and persistence', () => {
    const report = buildBehaviorCoverageReport({
      behaviors: [sessionTelemetryTurnCompleteBehavior],
      journeys: [sessionTelemetryTurnCompleteJourney],
      generatedTests: [
        defineGeneratedTestMeta({
          id: 'journey.session.telemetry.turn-complete',
          behaviorIds: ['session.telemetry.turn-complete'],
          entities: ['session', 'provider-telemetry', 'renderer-status'],
          statesCovered: ['session.turn_complete', 'session.externalSessionId'],
          interruptionsCovered: ['provider.runningEvent.afterTurnComplete'],
          observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
          riskBudget: 'critical',
          regressionSources: ['claude.raw-hook', 'canonical.webhook']
        })
      ]
    })

    expect(report.behaviors['session.telemetry.turn-complete']?.maturity).toBe('Hardened')
    expect(report.behaviors['session.telemetry.turn-complete']?.missingObservationLayers).toEqual([])
    expect(report.behaviors['session.telemetry.turn-complete']?.missingInterruptions).toEqual([
      'app.relaunch.duringTelemetry'
    ])
  })
})
