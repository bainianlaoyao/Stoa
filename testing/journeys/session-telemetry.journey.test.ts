import { describe, expect, it } from 'vitest'
import {
  sessionPresenceBlockedJourney,
  sessionPresenceFailedJourney,
  sessionPresenceReadyJourney,
  sessionPresenceRunningJourney,
  sessionTelemetryClaudeLifecycleJourney,
  sessionTelemetryBlockedJourney,
  sessionTelemetryCompleteJourney
} from './session-telemetry.journey'

describe('session telemetry journey', () => {
  it('links the completion journey to telemetry behavior coverage', () => {
    expect(sessionTelemetryCompleteJourney.id).toBe('journey.session.telemetry.complete')
    expect(sessionTelemetryCompleteJourney.behavior).toBe('session.telemetry.complete')
    expect(sessionTelemetryCompleteJourney.usageMode).toBe('active_workflow')
    expect(sessionTelemetryCompleteJourney.act).toEqual(['post.session.complete', 'post.claude.stopHook'])
    expect(sessionTelemetryCompleteJourney.assert).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryCompleteJourney.variants).toContain('claude-hook')
  })

  it('links the blocked journey to telemetry behavior coverage', () => {
    expect(sessionTelemetryBlockedJourney.id).toBe('journey.session.telemetry.blocked')
    expect(sessionTelemetryBlockedJourney.behavior).toBe('session.telemetry.blocked')
    expect(sessionTelemetryBlockedJourney.usageMode).toBe('active_workflow')
    expect(sessionTelemetryBlockedJourney.act).toEqual(['post.claude.permissionRequestHook'])
    expect(sessionTelemetryBlockedJourney.assert).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryBlockedJourney.variants).toEqual(['claude-hook'])
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
