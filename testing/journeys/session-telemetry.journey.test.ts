import { describe, expect, it } from 'vitest'
import { sessionTelemetryTurnCompleteJourney } from './session-telemetry.journey'

describe('session telemetry journey', () => {
  it('links the turn_complete journey to telemetry behavior coverage', () => {
    expect(sessionTelemetryTurnCompleteJourney.id).toBe('journey.session.telemetry.turn-complete')
    expect(sessionTelemetryTurnCompleteJourney.behavior).toBe('session.telemetry.turn-complete')
    expect(sessionTelemetryTurnCompleteJourney.usageMode).toBe('active_workflow')
    expect(sessionTelemetryTurnCompleteJourney.act).toEqual(['post.session.turnComplete', 'post.claude.stopHook'])
    expect(sessionTelemetryTurnCompleteJourney.assert).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryTurnCompleteJourney.variants).toContain('claude-hook')
  })
})
