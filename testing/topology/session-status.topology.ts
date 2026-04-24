import { defineTopology } from '../contracts/testing-contracts'

export const sessionStatusTopology = defineTopology({
  surface: 'command-route-status',
  testIds: {
    root: 'workspace-hierarchy-panel',
    routeBody: 'route-body',
    routeActions: 'route-actions'
  }
})
