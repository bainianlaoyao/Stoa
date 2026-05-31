import { defineJourney } from '../contracts/testing-contracts'

export const metaSessionReadFullContextAndGatePromptJourney = defineJourney({
  id: 'journey.meta-session.read-full-context-and-gate-prompt',
  behavior: 'meta-session.read-full-context-and-gate-prompt',
  usageMode: 'active_workflow',
  setup: ['meta-session.session.running', 'work-session.exists', 'ctl.authenticated'],
  act: ['ctl.readContext.full', 'ctl.prompt.highRisk'],
  assert: ['ctl.context.fullTextReturned', 'ctl.context.toolPayloadExcluded', 'ctl.proposal.pendingApprovalVisible'],
  variants: ['loopback-http']
})
