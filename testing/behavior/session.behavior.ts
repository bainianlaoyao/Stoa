import { defineBehavior } from '../contracts/testing-contracts'

export const workspaceQuickAccessBehavior = defineBehavior({
  id: 'workspace.quickAccess',
  actor: 'user',
  goal: 'open the active session workspace from the terminal surface in the configured IDE or the OS file browser',
  entities: ['project', 'session', 'workspace-path', 'ide-settings'],
  usageModes: ['active_workflow'],
  preconditions: ['project.exists', 'session.active', 'workspace.path.exists'],
  action: 'workspace.open',
  expects: [
    'terminal.workspaceQuickActionsVisible',
    'ipc.workspaceOpenRequested',
    'workspace.ide=vscode',
    'workspace.fileManagerUsesOsExplorer'
  ],
  invalidPreconditions: ['session.missing', 'project.missing', 'workspace.path.missing'],
  interruptions: ['workspace.pathDeletedBeforeOpen', 'ide.executableMissing'],
  recovery: ['surfaceErrorInWorkspaceStore', 'terminalSessionRemainsMounted'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const sessionRestoreBehavior = defineBehavior({
  id: 'session.restore',
  actor: 'user',
  goal: 'restore an archived session so it can be used again from the command surface',
  entities: ['project', 'session', 'archive', 'recovery'],
  usageModes: ['active_workflow', 'recovery_workflow'],
  preconditions: ['project.exists', 'session.archived'],
  action: 'archive.restoreSession',
  expects: [
    'archive.sessionRemoved',
    'command.sessionVisible',
    'persisted.sessionRestored',
    'session.archived=false',
    'session.runtimeState in [starting, alive]'
  ],
  invalidPreconditions: ['session.notArchived', 'session.missing', 'project.missing'],
  interruptions: ['duplicateAction', 'app.relaunch.duringAction', 'webhook.lateStatusEvent'],
  recovery: ['noDuplicateSession', 'activeSessionRemainsValid', 'persistedStateRemainsConsistent'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const sessionTelemetryCompleteBehavior = defineBehavior({
  id: 'session.telemetry.complete',
  actor: 'system',
  goal: 'project provider completion events into the active session UI without collapsing the live terminal',
  entities: ['project', 'session', 'provider-telemetry', 'renderer-status'],
  usageModes: ['active_workflow'],
  preconditions: ['project.exists', 'session.providerManaged', 'session.active'],
  action: 'telemetry.complete',
  expects: [
    'session.presence.phase=complete',
    'terminal.liveSessionPreserved',
    'command.sessionStatusCompleteVisible',
    'persisted.sessionPresenceUpdated'
  ],
  invalidPreconditions: ['session.missing', 'webhook.invalidSecret'],
  interruptions: ['provider.runningEvent.afterCompletion', 'app.relaunch.duringTelemetry'],
  recovery: ['completeRemainsVisibleUntilVisited', 'externalSessionIdentityPreserved'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const sessionTelemetryBlockedBehavior = defineBehavior({
  id: 'session.telemetry.blocked',
  actor: 'system',
  goal: 'project provider permission requests into the active session UI without replacing the live terminal',
  entities: ['project', 'session', 'provider-telemetry', 'renderer-status'],
  usageModes: ['active_workflow'],
  preconditions: ['project.exists', 'session.providerManaged', 'session.active'],
  action: 'telemetry.permissionRequest',
  expects: [
    'session.presence.phase=blocked',
    'terminal.liveSessionPreserved',
    'command.sessionStatusBlockedVisible',
    'persisted.sessionPresenceUpdated'
  ],
  invalidPreconditions: ['session.missing', 'webhook.invalidSecret'],
  interruptions: ['provider.runningEvent.afterPermissionRequest', 'app.relaunch.duringTelemetry'],
  recovery: ['blockedRemainsVisibleUntilResolved', 'externalSessionIdentityPreserved'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const sessionPresenceReadyBehavior = defineBehavior({
  id: 'session.presence.ready',
  actor: 'system',
  goal: 'present an alive provider session with unknown or idle agent state as calm ready status',
  entities: ['project', 'session', 'runtime-state', 'agent-state', 'renderer-status'],
  usageModes: ['active_workflow', 'recovery_workflow'],
  preconditions: ['session.runtimeState=alive', 'session.agentState in [unknown,idle]', 'session.hasUnseenCompletion=false'],
  action: 'presence.deriveReady',
  expects: [
    'session.presence.phase=ready',
    'session.presence.tone=neutral',
    'session.presence.priority=calm',
    'command.sessionStatusReadyVisible',
    'command.sessionStatusNonAccent'
  ],
  invalidPreconditions: ['session.runtimeState=created', 'session.runtimeState=starting', 'session.agentState=working'],
  interruptions: ['app.relaunch.duringPresenceSync', 'runtime.alive.withoutAgentTelemetry'],
  recovery: ['readyDoesNotImplyWorking', 'backendPresenceRemainsAuthoritative'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const sessionPresenceRunningBehavior = defineBehavior({
  id: 'session.presence.running',
  actor: 'system',
  goal: 'present active agent work as running without treating it as a high-attention interruption',
  entities: ['project', 'session', 'runtime-state', 'agent-state', 'renderer-status'],
  usageModes: ['active_workflow'],
  preconditions: ['session.runtimeState=alive', 'session.agentState=working'],
  action: 'presence.deriveRunning',
  expects: [
    'session.presence.phase=running',
    'session.presence.priority=medium',
    'session.presence.active=true',
    'command.sessionStatusRunningVisible'
  ],
  invalidPreconditions: ['session.runtimeState=starting', 'session.agentState=blocked', 'session.agentState=error'],
  interruptions: ['provider.permissionRequest.duringRunning', 'provider.stopHook.duringRunning'],
  recovery: ['runningDoesNotOverrideBlocked', 'runningDoesNotOverrideFailed'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const sessionPresenceCompleteBehavior = defineBehavior({
  id: 'session.presence.complete',
  actor: 'system',
  goal: 'surface an unread agent completion as a UI-only complete phase until the user visits it',
  entities: ['project', 'session', 'agent-state', 'renderer-status', 'completion'],
  usageModes: ['active_workflow'],
  preconditions: ['session.agentState=idle', 'session.hasUnseenCompletion=true'],
  action: 'presence.deriveComplete',
  expects: [
    'session.presence.phase=complete',
    'session.presence.uiOnly=true',
    'session.agentState=idle',
    'session.hasUnseenCompletion=true',
    'command.sessionStatusCompleteVisible'
  ],
  invalidPreconditions: ['session.agentState=working', 'session.agentState=blocked', 'session.hasUnseenCompletion=false'],
  interruptions: ['user.visitsCompletedSession', 'runtime.exitedFailed.afterCompletion'],
  recovery: ['visitedCompletionBecomesReady', 'failedPriorityOverridesComplete'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const sessionPresenceBlockedBehavior = defineBehavior({
  id: 'session.presence.blocked',
  actor: 'system',
  goal: 'surface provider permission or elicitation requests as blocked status requiring user intervention',
  entities: ['project', 'session', 'agent-state', 'blocking-reason', 'renderer-status'],
  usageModes: ['active_workflow'],
  preconditions: ['session.runtimeState=alive', 'session.agentState=blocked', 'session.blockingReason.exists'],
  action: 'presence.deriveBlocked',
  expects: [
    'session.presence.phase=blocked',
    'session.presence.priority=high',
    'session.presence.requiresUserIntervention=true',
    'command.sessionStatusBlockedVisible'
  ],
  invalidPreconditions: ['session.runtimeState=starting', 'session.agentState=working', 'session.agentState=idle'],
  interruptions: ['provider.permissionResolved', 'runtime.exitedFailed.whileBlocked'],
  recovery: ['resolvedPermissionReturnsRunningOrReady', 'failedPriorityOverridesBlocked'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const sessionPresenceFailedBehavior = defineBehavior({
  id: 'session.presence.failed',
  actor: 'system',
  goal: 'surface failed runtime or agent outcomes as the highest-priority session status',
  entities: ['project', 'session', 'runtime-state', 'agent-state', 'renderer-status'],
  usageModes: ['active_workflow', 'recovery_workflow'],
  preconditions: ['session.runtimeState=failed_to_start OR session.runtimeExitReason=failed OR session.agentState=error'],
  action: 'presence.deriveFailed',
  expects: [
    'session.presence.phase=failed',
    'session.presence.priority=highest',
    'session.presence.overrides=complete',
    'session.presence.overrides=blocked',
    'command.sessionStatusFailedVisible'
  ],
  invalidPreconditions: ['session.runtimeExitReason=clean', 'session.agentState=idle', 'session.agentState=working'],
  interruptions: ['runtime.exitedFailed.afterCompletion', 'runtime.exitedFailed.whileBlocked'],
  recovery: ['failedPriorityRemainsHighest', 'backendPresenceRemainsAuthoritative'],
  observationLayers: ['ui', 'renderer-store', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})
