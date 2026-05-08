import { defineJourney } from '../contracts/testing-contracts'

export const hermesSurfaceSessionFlowJourney = defineJourney({
  id: 'journey.hermes.surface.session-flow',
  behavior: 'hermes.surface.session-flow',
  usageMode: 'active_workflow',
  setup: ['app.launch', 'select.hermes.surface'],
  act: ['click.hermes.createSession', 'click.hermes.sessionItem'],
  assert: ['hermes.sessionCreated', 'hermes.sessionActivated', 'hermes.terminalDeckVisible', 'hermes.inspectorVisible'],
  variants: ['single-session']
})

export const hermesReadFullContextAndGatePromptJourney = defineJourney({
  id: 'journey.hermes.read-full-context-and-gate-prompt',
  behavior: 'hermes.read-full-context-and-gate-prompt',
  usageMode: 'active_workflow',
  setup: ['hermes.session.running', 'work-session.exists', 'ctl.authenticated'],
  act: ['ctl.readContext.full', 'ctl.prompt.highRisk'],
  assert: ['ctl.context.fullTextReturned', 'ctl.context.toolPayloadExcluded', 'ctl.proposal.pendingApprovalVisible'],
  variants: ['loopback-http']
})
