import { describe, expect, it } from 'vitest'
import {
  sessionRestoreBehavior,
  sessionTelemetryNeedsConfirmationBehavior,
  sessionTelemetryTurnCompleteBehavior
} from './session.behavior'

describe('session behavior assets', () => {
  it('marks session.restore as critical and recovery-oriented', () => {
    expect(sessionRestoreBehavior.id).toBe('session.restore')
    expect(sessionRestoreBehavior.coverageBudget).toBe('critical')
    expect(sessionRestoreBehavior.entities).toEqual(['project', 'session', 'archive', 'recovery'])
    expect(sessionRestoreBehavior.expects).toContain('persisted.sessionRestored')
    expect(sessionRestoreBehavior.interruptions).toContain('app.relaunch.duringAction')
    expect(sessionRestoreBehavior.invalidPreconditions).toContain('session.notArchived')
    expect(sessionRestoreBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
  })

  it('declares turn_complete telemetry as a critical active-workflow behavior', () => {
    expect(sessionTelemetryTurnCompleteBehavior.id).toBe('session.telemetry.turn-complete')
    expect(sessionTelemetryTurnCompleteBehavior.actor).toBe('system')
    expect(sessionTelemetryTurnCompleteBehavior.coverageBudget).toBe('critical')
    expect(sessionTelemetryTurnCompleteBehavior.entities).toEqual([
      'project',
      'session',
      'provider-telemetry',
      'renderer-status'
    ])
    expect(sessionTelemetryTurnCompleteBehavior.expects).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryTurnCompleteBehavior.invalidPreconditions).toContain('webhook.invalidSecret')
    expect(sessionTelemetryTurnCompleteBehavior.interruptions).toContain('provider.runningEvent.afterTurnComplete')
    expect(sessionTelemetryTurnCompleteBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
  })

  it('declares needs_confirmation telemetry as a critical active-workflow behavior', () => {
    expect(sessionTelemetryNeedsConfirmationBehavior.id).toBe('session.telemetry.needs-confirmation')
    expect(sessionTelemetryNeedsConfirmationBehavior.actor).toBe('system')
    expect(sessionTelemetryNeedsConfirmationBehavior.coverageBudget).toBe('critical')
    expect(sessionTelemetryNeedsConfirmationBehavior.expects).toContain('session.status=needs_confirmation')
    expect(sessionTelemetryNeedsConfirmationBehavior.expects).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryNeedsConfirmationBehavior.invalidPreconditions).toContain('webhook.invalidSecret')
    expect(sessionTelemetryNeedsConfirmationBehavior.interruptions).toContain(
      'provider.runningEvent.afterPermissionRequest'
    )
    expect(sessionTelemetryNeedsConfirmationBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
  })
})
