import { defineBehavior } from '../contracts/testing-contracts'

export const hermesSurfaceSessionFlowBehavior = defineBehavior({
  id: 'hermes.surface.session-flow',
  actor: 'user',
  goal: 'use the Hermes surface to create a Hermes session by selecting a backend and switch between Hermes sessions while preserving the embedded terminal workspace',
  entities: ['hermes-session', 'hermes-surface', 'hermes-terminal', 'hermes-inspector'],
  usageModes: ['active_workflow'],
  preconditions: ['hermes.surface.available', 'bridge.hermes.bootstrap.ready'],
  action: 'hermes.session.selectBackendCreateAndActivate',
  expects: [
    'activity.hermesVisible',
    'hermes.providerPickerVisible',
    'hermes.sessionCreated',
    'hermes.sessionActivated',
    'hermes.terminalDeckVisible',
    'hermes.inspectorVisible'
  ],
  invalidPreconditions: ['bridge.hermes.bootstrap.missing'],
  interruptions: ['app.relaunch.duringHermesSession', 'hermes.runtime.failedToStart'],
  recovery: ['hermes.resumePointerPreserved', 'hermes.surfaceRehydrates'],
  observationLayers: ['ui', 'renderer-store'],
  risk: 'medium',
  coverageBudget: 'high'
})

export const hermesReadFullContextAndGatePromptBehavior = defineBehavior({
  id: 'hermes.read-full-context-and-gate-prompt',
  actor: 'system',
  goal: 'allow Hermes to read large human-readable work-session context and gate high-risk prompt injection through approval',
  entities: ['hermes-session', 'work-session', 'context-full-text', 'proposal'],
  usageModes: ['active_workflow'],
  preconditions: ['ctl.authenticated', 'work-session.exists', 'hermes.session.running'],
  action: 'hermes.readContextAndPrompt',
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
