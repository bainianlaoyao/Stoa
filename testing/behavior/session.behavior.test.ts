import { describe, expect, it } from 'vitest'
import {
  sessionPresenceBlockedBehavior,
  sessionPresenceCompleteBehavior,
  sessionPresenceFailedBehavior,
  sessionPresenceReadyBehavior,
  sessionPresenceRunningBehavior,
  sessionRestoreBehavior,
  sessionTelemetryBlockedBehavior,
  sessionTelemetryCompleteBehavior,
  workspaceQuickAccessBehavior
} from './session.behavior'

describe('session behavior assets', () => {
  it('declares workspace quick access from the active terminal surface', () => {
    expect(workspaceQuickAccessBehavior.id).toBe('workspace.quickAccess')
    expect(workspaceQuickAccessBehavior.entities).toEqual(['project', 'session', 'workspace-path', 'ide-settings'])
    expect(workspaceQuickAccessBehavior.expects).toContain('workspace.ide=vscode')
    expect(workspaceQuickAccessBehavior.expects).toContain('workspace.fileManagerUsesOsExplorer')
    expect(workspaceQuickAccessBehavior.invalidPreconditions).toContain('workspace.path.missing')
    expect(workspaceQuickAccessBehavior.recovery).toContain('terminalSessionRemainsMounted')
  })

  it('marks session.restore as critical and recovery-oriented', () => {
    expect(sessionRestoreBehavior.id).toBe('session.restore')
    expect(sessionRestoreBehavior.coverageBudget).toBe('critical')
    expect(sessionRestoreBehavior.entities).toEqual(['project', 'session', 'archive', 'recovery'])
    expect(sessionRestoreBehavior.expects).toContain('persisted.sessionRestored')
    expect(sessionRestoreBehavior.interruptions).toContain('app.relaunch.duringAction')
    expect(sessionRestoreBehavior.invalidPreconditions).toContain('session.notArchived')
    expect(sessionRestoreBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
  })

  it('declares completion telemetry as a critical active-workflow behavior', () => {
    expect(sessionTelemetryCompleteBehavior.id).toBe('session.telemetry.complete')
    expect(sessionTelemetryCompleteBehavior.actor).toBe('system')
    expect(sessionTelemetryCompleteBehavior.coverageBudget).toBe('critical')
    expect(sessionTelemetryCompleteBehavior.entities).toEqual([
      'project',
      'session',
      'provider-telemetry',
      'renderer-status'
    ])
    expect(sessionTelemetryCompleteBehavior.expects).toContain('session.presence.phase=complete')
    expect(sessionTelemetryCompleteBehavior.expects).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryCompleteBehavior.invalidPreconditions).toContain('webhook.invalidSecret')
    expect(sessionTelemetryCompleteBehavior.interruptions).toContain('provider.runningEvent.afterCompletion')
    expect(sessionTelemetryCompleteBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
  })

  it('declares blocked telemetry as a critical active-workflow behavior', () => {
    expect(sessionTelemetryBlockedBehavior.id).toBe('session.telemetry.blocked')
    expect(sessionTelemetryBlockedBehavior.actor).toBe('system')
    expect(sessionTelemetryBlockedBehavior.coverageBudget).toBe('critical')
    expect(sessionTelemetryBlockedBehavior.expects).toContain('session.presence.phase=blocked')
    expect(sessionTelemetryBlockedBehavior.expects).toContain('terminal.liveSessionPreserved')
    expect(sessionTelemetryBlockedBehavior.invalidPreconditions).toContain('webhook.invalidSecret')
    expect(sessionTelemetryBlockedBehavior.interruptions).toContain(
      'provider.runningEvent.afterPermissionRequest'
    )
    expect(sessionTelemetryBlockedBehavior.observationLayers).toEqual(['ui', 'main-debug-state', 'persisted-state'])
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
