import { describe, expect, it } from 'vitest'
import {
  sessionPresenceBlockedBehavior,
  sessionPresenceCompleteBehavior,
  sessionPresenceFailedBehavior,
  sessionPresenceReadyBehavior,
  sessionPresenceRunningBehavior,
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

  it('declares ready presence as calm non-accent renderer status', () => {
    expect(sessionPresenceReadyBehavior.id).toBe('session.presence.ready')
    expect(sessionPresenceReadyBehavior.expects).toContain('session.presence.phase=ready')
    expect(sessionPresenceReadyBehavior.expects).toContain('session.presence.tone=neutral')
    expect(sessionPresenceReadyBehavior.expects).toContain('command.sessionStatusNonAccent')
    expect(sessionPresenceReadyBehavior.recovery).toContain('readyDoesNotImplyWorking')
  })

  it('declares running presence as active but medium priority', () => {
    expect(sessionPresenceRunningBehavior.id).toBe('session.presence.running')
    expect(sessionPresenceRunningBehavior.expects).toContain('session.presence.phase=running')
    expect(sessionPresenceRunningBehavior.expects).toContain('session.presence.priority=medium')
    expect(sessionPresenceRunningBehavior.invalidPreconditions).toContain('session.agentState=blocked')
  })

  it('declares complete presence as UI-only unread completion', () => {
    expect(sessionPresenceCompleteBehavior.id).toBe('session.presence.complete')
    expect(sessionPresenceCompleteBehavior.coverageBudget).toBe('critical')
    expect(sessionPresenceCompleteBehavior.expects).toContain('session.presence.phase=complete')
    expect(sessionPresenceCompleteBehavior.expects).toContain('session.presence.uiOnly=true')
    expect(sessionPresenceCompleteBehavior.recovery).toContain('visitedCompletionBecomesReady')
  })

  it('declares blocked presence as requiring user intervention', () => {
    expect(sessionPresenceBlockedBehavior.id).toBe('session.presence.blocked')
    expect(sessionPresenceBlockedBehavior.expects).toContain('session.presence.phase=blocked')
    expect(sessionPresenceBlockedBehavior.expects).toContain('session.presence.requiresUserIntervention=true')
    expect(sessionPresenceBlockedBehavior.interruptions).toContain('provider.permissionResolved')
  })

  it('declares failed presence as highest priority over complete and blocked', () => {
    expect(sessionPresenceFailedBehavior.id).toBe('session.presence.failed')
    expect(sessionPresenceFailedBehavior.expects).toContain('session.presence.phase=failed')
    expect(sessionPresenceFailedBehavior.expects).toContain('session.presence.priority=highest')
    expect(sessionPresenceFailedBehavior.expects).toContain('session.presence.overrides=complete')
    expect(sessionPresenceFailedBehavior.expects).toContain('session.presence.overrides=blocked')
  })
})
