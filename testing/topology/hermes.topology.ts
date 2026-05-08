import { defineTopology } from '../contracts/testing-contracts'

export const hermesTopology = defineTopology({
  surface: 'hermes',
  testIds: {
    root: 'surface.hermes',
    sessionList: 'hermes-session-list',
    sessionCreate: 'hermes.session.create',
    sessionItem: 'hermes.session.item',
    terminalDeck: 'hermes-terminal-deck',
    inspectorPanel: 'hermes-inspector-panel',
    actionPanel: 'hermes-action-panel'
  }
})
