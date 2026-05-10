import { defineBehavior } from '../contracts/testing-contracts'

export const metaSessionSurfaceSessionFlowBehavior = defineBehavior({
  id: 'meta-session.surface.session-flow',
  actor: 'user',
  goal: 'use the meta session surface to create a meta session by selecting a backend and switch between meta sessions while preserving the embedded terminal workspace',
  entities: ['meta-session', 'meta-session-surface', 'meta-session-terminal', 'meta-session-inspector'],
  usageModes: ['active_workflow'],
  preconditions: ['meta-session.surface.available', 'bridge.meta-session.bootstrap.ready'],
  action: 'meta-session.session.selectBackendCreateAndActivate',
  expects: [
    'activity.metaSessionVisible',
    'meta-session.providerPickerVisible',
    'meta-session.sessionCreated',
    'meta-session.sessionActivated',
    'meta-session.terminalDeckVisible',
    'meta-session.inspectorVisible'
  ],
  invalidPreconditions: ['bridge.meta-session.bootstrap.missing'],
  interruptions: ['app.relaunch.duringMetaSession', 'meta-session.runtime.failedToStart'],
  recovery: ['meta-session.resumePointerPreserved', 'meta-session.surfaceRehydrates'],
  observationLayers: ['ui', 'renderer-store'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const metaSessionReadFullContextAndGatePromptBehavior = defineBehavior({
  id: 'meta-session.read-full-context-and-gate-prompt',
  actor: 'system',
  goal: 'allow a meta session to read large human-readable work-session context and gate high-risk prompt injection through approval',
  entities: ['meta-session', 'work-session', 'context-full-text', 'proposal'],
  usageModes: ['active_workflow'],
  preconditions: ['ctl.authenticated', 'work-session.exists', 'meta-session.session.running'],
  action: 'meta-session.readContextAndPrompt',
  expects: [
    'ctl.context.fullTextReturned',
    'ctl.context.toolPayloadExcluded',
    'ctl.prompt.highRiskRequiresApproval',
    'ctl.proposal.pendingApprovalVisible'
  ],
  invalidPreconditions: ['ctl.invalidSecret', 'work-session.missing'],
  interruptions: ['proposal.dispatch.afterStaleContext', 'app.relaunch.duringPromptGate'],
  recovery: ['proposal.remainsPendingUntilApproved', 'context.canBeReadAgainAfterRecovery'],
  observationLayers: ['main-debug-state', 'persisted-state'],
  risk: 'high',
  coverageBudget: 'critical'
})
