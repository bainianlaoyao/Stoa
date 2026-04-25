import { describe, expect, it } from 'vitest'
import {
  sessionPresenceBlockedJourney,
  sessionPresenceFailedJourney,
  sessionPresenceReadyJourney,
  sessionPresenceRunningJourney,
  sessionTelemetryClaudeLifecycleJourney,
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

  it('maps the Claude lifecycle from ready through running blocked complete and back to ready', () => {
    expect(sessionTelemetryClaudeLifecycleJourney.id).toBe('journey.session.telemetry.claude-lifecycle')
    expect(sessionTelemetryClaudeLifecycleJourney.behavior).toBe('session.presence.complete')
    expect(sessionTelemetryClaudeLifecycleJourney.setup).toContain('session.runtimeAlive')
    expect(sessionTelemetryClaudeLifecycleJourney.act).toEqual([
      'assert.presence.ready',
      'post.claude.userPromptSubmitHook',
      'assert.presence.running',
      'post.claude.permissionRequestHook',
      'assert.presence.blocked',
      'post.claude.permissionResolved',
      'assert.presence.running',
      'post.claude.stopHook',
      'assert.presence.complete',
      'select.completedSession'
    ])
    expect(sessionTelemetryClaudeLifecycleJourney.assert).toContain('command.sessionStatusReadyVisible.afterVisit')
    expect(sessionTelemetryClaudeLifecycleJourney.variants).toEqual(['claude-hook-lifecycle'])
  })

  it('links each presence phase behavior to a reachable journey', () => {
    expect(sessionPresenceReadyJourney.behavior).toBe('session.presence.ready')
    expect(sessionPresenceReadyJourney.assert).toContain('command.sessionStatusNonAccent')

    expect(sessionPresenceRunningJourney.behavior).toBe('session.presence.running')
    expect(sessionPresenceRunningJourney.act).toContain('post.claude.userPromptSubmitHook')

    expect(sessionPresenceBlockedJourney.behavior).toBe('session.presence.blocked')
    expect(sessionPresenceBlockedJourney.assert).toContain('command.sessionRequiresUserIntervention')

    expect(sessionPresenceFailedJourney.behavior).toBe('session.presence.failed')
    expect(sessionPresenceFailedJourney.assert).toContain('command.sessionStatusFailedOverridesComplete')
  })
})
