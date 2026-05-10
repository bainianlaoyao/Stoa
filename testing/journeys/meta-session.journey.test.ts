import { describe, expect, it } from 'vitest'
import {
  metaSessionReadFullContextAndGatePromptJourney,
  metaSessionSurfaceSessionFlowJourney
} from './meta-session.journey'

describe('meta session journey assets', () => {
  it('links meta session surface session flow to a reachable UI journey', () => {
    expect(metaSessionSurfaceSessionFlowJourney.id).toBe('journey.meta-session.surface.session-flow')
    expect(metaSessionSurfaceSessionFlowJourney.behavior).toBe('meta-session.surface.session-flow')
    expect(metaSessionSurfaceSessionFlowJourney.setup).toContain('select.meta-session.surface')
    expect(metaSessionSurfaceSessionFlowJourney.act).toEqual([
      'click.meta-session.createSession',
      'select.meta-session.backendProvider',
      'click.meta-session.sessionItem'
    ])
    expect(metaSessionSurfaceSessionFlowJourney.assert).toContain('meta-session.providerPickerVisible')
    expect(metaSessionSurfaceSessionFlowJourney.assert).toContain('meta-session.terminalDeckVisible')
    expect(metaSessionSurfaceSessionFlowJourney.variants).toEqual(['single-session'])
  })

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
