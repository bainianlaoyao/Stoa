import { defineBehavior } from '../contracts/testing-contracts'

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
    'session.status in [starting, running]'
  ],
  invalidPreconditions: ['session.notArchived', 'session.missing', 'project.missing'],
  interruptions: ['duplicateAction', 'app.relaunch.duringAction', 'webhook.lateStatusEvent'],
  recovery: ['noDuplicateSession', 'activeSessionRemainsValid', 'persistedStateRemainsConsistent'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})

export const sessionTelemetryTurnCompleteBehavior = defineBehavior({
  id: 'session.telemetry.turn-complete',
  actor: 'system',
  goal: 'project provider turn completion into the active session UI without collapsing the live terminal',
  entities: ['project', 'session', 'provider-telemetry', 'renderer-status'],
  usageModes: ['active_workflow'],
  preconditions: ['project.exists', 'session.providerManaged', 'session.active'],
  action: 'telemetry.turnComplete',
  expects: [
    'session.status=turn_complete',
    'terminal.liveSessionPreserved',
    'command.sessionStatusVisible',
    'persisted.sessionStatusUpdated'
  ],
  invalidPreconditions: ['session.missing', 'webhook.invalidSecret'],
  interruptions: ['provider.runningEvent.afterTurnComplete', 'app.relaunch.duringTelemetry'],
  recovery: ['statusRemainsTurnComplete', 'externalSessionIdentityPreserved'],
  observationLayers: ['ui', 'main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})
