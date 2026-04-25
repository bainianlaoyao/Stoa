import { defineTopology } from '../contracts/testing-contracts'

export const sessionStatusTopology = defineTopology({
  surface: 'command-route-status',
  testIds: {
    root: 'workspace-hierarchy-panel',
    routeBody: 'route-body',
    routeActions: 'route-actions',
    ready: 'session-status-ready',
    running: 'session-status-running',
    complete: 'session-status-complete',
    blocked: 'session-status-blocked',
    failed: 'session-status-failed',
    exited: 'session-status-exited'
  }
})
