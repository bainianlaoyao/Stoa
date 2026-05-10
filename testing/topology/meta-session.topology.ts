import { defineTopology } from '../contracts/testing-contracts'

export const metaSessionTopology = defineTopology({
  surface: 'meta-session',
  testIds: {
    root: 'surface.meta-session',
    sessionList: 'meta-session-session-list',
    sessionCreate: 'meta-session.session.create',
    sessionItem: 'meta-session.session.item',
    providerCard: 'provider-card',
    providerCardItem: 'provider-card.item',
    terminalDeck: 'meta-session-terminal-deck',
    inspectorPanel: 'meta-session-inspector-panel',
    actionPanel: 'meta-session-action-panel'
  }
})
