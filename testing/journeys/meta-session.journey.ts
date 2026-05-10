import { defineJourney } from '../contracts/testing-contracts'

export const metaSessionSurfaceSessionFlowJourney = defineJourney({
  id: 'journey.meta-session.surface.session-flow',
  behavior: 'meta-session.surface.session-flow',
  usageMode: 'active_workflow',
  setup: ['app.launch', 'select.meta-session.surface'],
  act: ['click.meta-session.createSession', 'select.meta-session.backendProvider', 'click.meta-session.sessionItem'],
  assert: [
    'meta-session.providerPickerVisible',
    'meta-session.sessionCreated',
    'meta-session.sessionActivated',
    'meta-session.terminalDeckVisible',
    'meta-session.inspectorVisible'
  ],
  variants: ['single-session']
})

export const metaSessionReadFullContextAndGatePromptJourney = defineJourney({
  id: 'journey.meta-session.read-full-context-and-gate-prompt',
  behavior: 'meta-session.read-full-context-and-gate-prompt',
  usageMode: 'active_workflow',
  setup: ['meta-session.session.running', 'work-session.exists', 'ctl.authenticated'],
  act: ['ctl.readContext.full', 'ctl.prompt.highRisk'],
  assert: ['ctl.context.fullTextReturned', 'ctl.context.toolPayloadExcluded', 'ctl.proposal.pendingApprovalVisible'],
  variants: ['loopback-http']
})
