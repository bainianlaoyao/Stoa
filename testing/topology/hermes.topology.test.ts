import { describe, expect, it } from 'vitest'
import { hermesTopology } from './hermes.topology'

describe('hermes topology', () => {
  it('declares stable Hermes surface test ids', () => {
    expect(hermesTopology.surface).toBe('hermes')
    expect(hermesTopology.testIds.root).toBe('surface.hermes')
    expect(hermesTopology.testIds.sessionList).toBe('hermes-session-list')
    expect(hermesTopology.testIds.sessionCreate).toBe('hermes.session.create')
    expect(hermesTopology.testIds.sessionItem).toBe('hermes.session.item')
    expect(hermesTopology.testIds.terminalDeck).toBe('hermes-terminal-deck')
    expect(hermesTopology.testIds.inspectorPanel).toBe('hermes-inspector-panel')
    expect(hermesTopology.testIds.actionPanel).toBe('hermes-action-panel')
  })
})
