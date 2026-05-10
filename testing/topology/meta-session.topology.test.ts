import { describe, expect, it } from 'vitest'
import { metaSessionTopology } from './meta-session.topology'

describe('meta session topology', () => {
  it('declares stable meta session surface test ids', () => {
    expect(metaSessionTopology.surface).toBe('meta-session')
    expect(metaSessionTopology.testIds.root).toBe('surface.meta-session')
    expect(metaSessionTopology.testIds.sessionList).toBe('meta-session-session-list')
    expect(metaSessionTopology.testIds.sessionCreate).toBe('meta-session.session.create')
    expect(metaSessionTopology.testIds.sessionItem).toBe('meta-session.session.item')
    expect(metaSessionTopology.testIds.providerCard).toBe('provider-card')
    expect(metaSessionTopology.testIds.providerCardItem).toBe('provider-card.item')
    expect(metaSessionTopology.testIds.terminalDeck).toBe('meta-session-terminal-deck')
    expect(metaSessionTopology.testIds.inspectorPanel).toBe('meta-session-inspector-panel')
    expect(metaSessionTopology.testIds.actionPanel).toBe('meta-session-action-panel')
  })
})
