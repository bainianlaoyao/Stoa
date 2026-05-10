import { describe, expect, it } from 'vitest'
import {
  hermesReadFullContextAndGatePromptBehavior,
  hermesSurfaceSessionFlowBehavior
} from './hermes.behavior'

describe('hermes behavior assets', () => {
  it('declares Hermes surface session flow as a high-value active workflow', () => {
    expect(hermesSurfaceSessionFlowBehavior.id).toBe('hermes.surface.session-flow')
    expect(hermesSurfaceSessionFlowBehavior.entities).toEqual([
      'hermes-session',
      'hermes-surface',
      'hermes-terminal',
      'hermes-inspector'
    ])
    expect(hermesSurfaceSessionFlowBehavior.goal).toContain('selecting a backend')
    expect(hermesSurfaceSessionFlowBehavior.action).toBe('hermes.session.selectBackendCreateAndActivate')
    expect(hermesSurfaceSessionFlowBehavior.expects).toContain('hermes.providerPickerVisible')
    expect(hermesSurfaceSessionFlowBehavior.expects).toContain('hermes.sessionCreated')
    expect(hermesSurfaceSessionFlowBehavior.expects).toContain('hermes.terminalDeckVisible')
    expect(hermesSurfaceSessionFlowBehavior.interruptions).toContain('hermes.runtime.failedToStart')
    expect(hermesSurfaceSessionFlowBehavior.recovery).toContain('hermes.surfaceRehydrates')
    expect(hermesSurfaceSessionFlowBehavior.observationLayers).toEqual(['ui', 'renderer-store'])
  })

  it('declares full-context reads and prompt gating as a critical Hermes control behavior', () => {
    expect(hermesReadFullContextAndGatePromptBehavior.id).toBe('hermes.read-full-context-and-gate-prompt')
    expect(hermesReadFullContextAndGatePromptBehavior.coverageBudget).toBe('critical')
    expect(hermesReadFullContextAndGatePromptBehavior.expects).toContain('ctl.context.fullTextReturned')
    expect(hermesReadFullContextAndGatePromptBehavior.expects).toContain('ctl.context.toolPayloadExcluded')
    expect(hermesReadFullContextAndGatePromptBehavior.expects).toContain('ctl.prompt.highRiskRequiresApproval')
    expect(hermesReadFullContextAndGatePromptBehavior.invalidPreconditions).toContain('ctl.invalidSecret')
    expect(hermesReadFullContextAndGatePromptBehavior.interruptions).toContain('proposal.dispatch.afterStaleContext')
    expect(hermesReadFullContextAndGatePromptBehavior.observationLayers).toEqual([
      'main-debug-state',
      'persisted-state'
    ])
  })
})
