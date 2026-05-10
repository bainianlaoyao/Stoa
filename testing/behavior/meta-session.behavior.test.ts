import { describe, expect, it } from 'vitest'
import {
  metaSessionReadFullContextAndGatePromptBehavior,
  metaSessionSurfaceSessionFlowBehavior
} from './meta-session.behavior'

describe('meta session behavior assets', () => {
  it('declares meta session surface session flow as a high-value active workflow', () => {
    expect(metaSessionSurfaceSessionFlowBehavior.id).toBe('meta-session.surface.session-flow')
    expect(metaSessionSurfaceSessionFlowBehavior.entities).toEqual([
      'meta-session',
      'meta-session-surface',
      'meta-session-terminal',
      'meta-session-inspector'
    ])
    expect(metaSessionSurfaceSessionFlowBehavior.goal).toContain('selecting a backend')
    expect(metaSessionSurfaceSessionFlowBehavior.action).toBe('meta-session.session.selectBackendCreateAndActivate')
    expect(metaSessionSurfaceSessionFlowBehavior.expects).toContain('meta-session.providerPickerVisible')
    expect(metaSessionSurfaceSessionFlowBehavior.expects).toContain('meta-session.sessionCreated')
    expect(metaSessionSurfaceSessionFlowBehavior.expects).toContain('meta-session.terminalDeckVisible')
    expect(metaSessionSurfaceSessionFlowBehavior.interruptions).toContain('meta-session.runtime.failedToStart')
    expect(metaSessionSurfaceSessionFlowBehavior.recovery).toContain('meta-session.surfaceRehydrates')
    expect(metaSessionSurfaceSessionFlowBehavior.observationLayers).toEqual(['ui', 'renderer-store'])
  })

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
