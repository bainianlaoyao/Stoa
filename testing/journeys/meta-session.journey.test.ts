import { describe, expect, it } from 'vitest'
import { metaSessionReadFullContextAndGatePromptJourney } from './meta-session.journey'

describe('meta session journey assets', () => {
  it('links meta session full-context reads and prompt gating to a control-plane journey', () => {
    expect(metaSessionReadFullContextAndGatePromptJourney.id).toBe(
      'journey.meta-session.read-full-context-and-gate-prompt'
    )
    expect(metaSessionReadFullContextAndGatePromptJourney.behavior).toBe(
      'meta-session.read-full-context-and-gate-prompt'
    )
    expect(metaSessionReadFullContextAndGatePromptJourney.act).toEqual([
      'ctl.readContext.full',
      'ctl.prompt.highRisk'
    ])
    expect(metaSessionReadFullContextAndGatePromptJourney.assert).toContain(
      'ctl.proposal.pendingApprovalVisible'
    )
    expect(metaSessionReadFullContextAndGatePromptJourney.variants).toEqual(['loopback-http'])
  })
})
