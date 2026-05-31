import { describe, expect, it } from 'vitest'
import { metaSessionReadFullContextAndGatePromptBehavior } from './meta-session.behavior'

describe('meta session behavior assets', () => {
  it('declares full-context reads and prompt gating as a critical meta session control behavior', () => {
    expect(metaSessionReadFullContextAndGatePromptBehavior.id).toBe('meta-session.read-full-context-and-gate-prompt')
    expect(metaSessionReadFullContextAndGatePromptBehavior.coverageBudget).toBe('critical')
    expect(metaSessionReadFullContextAndGatePromptBehavior.expects).toContain('ctl.context.fullTextReturned')
    expect(metaSessionReadFullContextAndGatePromptBehavior.expects).toContain('ctl.context.toolPayloadExcluded')
    expect(metaSessionReadFullContextAndGatePromptBehavior.expects).toContain('ctl.prompt.highRiskRequiresApproval')
    expect(metaSessionReadFullContextAndGatePromptBehavior.invalidPreconditions).toContain('ctl.invalidSecret')
    expect(metaSessionReadFullContextAndGatePromptBehavior.interruptions).toContain('proposal.dispatch.afterStaleContext')
    expect(metaSessionReadFullContextAndGatePromptBehavior.observationLayers).toEqual([
      'main-debug-state',
      'persisted-state'
    ])
  })
})
