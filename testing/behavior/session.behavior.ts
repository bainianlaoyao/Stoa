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
