import { defineTopology } from '../contracts/testing-contracts'

export const archiveTopology = defineTopology({
  surface: 'archive',
  testIds: {
    root: 'surface.archive',
    sessionRow: 'archive.session.row',
    restoreButton: 'archive.session.restore'
  }
})
