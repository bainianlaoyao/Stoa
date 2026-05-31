import { defineTopology } from '../contracts/testing-contracts'

export const archiveTopology = defineTopology({
  surface: 'command',
  testIds: {
    root: 'command-panel',
    sessionRow: 'archive.session.row',
    restoreButton: 'archive.session.restore'
  }
})
