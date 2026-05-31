import { defineBehavior } from '../contracts/testing-contracts'

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
