import { describe, expect, it } from 'vitest'
import {
  sessionTelemetryNeedsConfirmationJourney,
  sessionTelemetryTurnCompleteJourney
} from './session-telemetry.journey'

describe('session telemetry journey', () => {
  it('links the turn_complete journey to telemetry behavior coverage', () => {
    expect(sessionTelemetryTurnCompleteJourney.id).toBe('journey.session.telemetry.turn-complete')
    expect(sessionTelemetryTurnCompleteJourney.behavior).toBe('session.telemetry.turn-complete')
    expect(sessionTelemetryTurnCompleteJourney.usageMode).toBe('active_workflow')
    expect(sessionTelemetryTurnCompleteJourney.act).toEqual(['post.session.turnComplete', 'post.claude.stopHook'])
    expect(sessionTelemetryTurnCompleteJourney.assert).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryTurnCompleteJourney.variants).toContain('claude-hook')
  })

  it('links the needs_confirmation journey to telemetry behavior coverage', () => {
    expect(sessionTelemetryNeedsConfirmationJourney.id).toBe('journey.session.telemetry.needs-confirmation')
    expect(sessionTelemetryNeedsConfirmationJourney.behavior).toBe('session.telemetry.needs-confirmation')
    expect(sessionTelemetryNeedsConfirmationJourney.usageMode).toBe('active_workflow')
    expect(sessionTelemetryNeedsConfirmationJourney.act).toEqual(['post.claude.permissionRequestHook'])
    expect(sessionTelemetryNeedsConfirmationJourney.assert).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryNeedsConfirmationJourney.variants).toEqual(['claude-hook'])
  })
})
