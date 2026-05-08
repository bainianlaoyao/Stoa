import { describe, expect, it } from 'vitest'
import {
  hermesReadFullContextAndGatePromptJourney,
  hermesSurfaceSessionFlowJourney
} from './hermes.journey'

describe('hermes journey assets', () => {
  it('links Hermes surface session flow to a reachable UI journey', () => {
    expect(hermesSurfaceSessionFlowJourney.id).toBe('journey.hermes.surface.session-flow')
    expect(hermesSurfaceSessionFlowJourney.behavior).toBe('hermes.surface.session-flow')
    expect(hermesSurfaceSessionFlowJourney.setup).toContain('select.hermes.surface')
    expect(hermesSurfaceSessionFlowJourney.act).toEqual([
      'click.hermes.createSession',
      'click.hermes.sessionItem'
    ])
    expect(hermesSurfaceSessionFlowJourney.assert).toContain('hermes.terminalDeckVisible')
    expect(hermesSurfaceSessionFlowJourney.variants).toEqual(['single-session'])
  })

  it('links Hermes full-context reads and prompt gating to a control-plane journey', () => {
    expect(hermesReadFullContextAndGatePromptJourney.id).toBe(
      'journey.hermes.read-full-context-and-gate-prompt'
    )
    expect(hermesReadFullContextAndGatePromptJourney.behavior).toBe(
      'hermes.read-full-context-and-gate-prompt'
    )
    expect(hermesReadFullContextAndGatePromptJourney.act).toEqual([
      'ctl.readContext.full',
      'ctl.prompt.highRisk'
    ])
    expect(hermesReadFullContextAndGatePromptJourney.assert).toContain(
      'ctl.proposal.pendingApprovalVisible'
    )
    expect(hermesReadFullContextAndGatePromptJourney.variants).toEqual(['loopback-http'])
  })
})
