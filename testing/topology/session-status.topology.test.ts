import { describe, expect, it } from 'vitest'
import { sessionStatusTopology } from './session-status.topology'

describe('session status topology', () => {
  it('declares stable command route test ids for telemetry status assertions', () => {
    expect(sessionStatusTopology.surface).toBe('command-route-status')
    expect(sessionStatusTopology.testIds.root).toBe('workspace-hierarchy-panel')
    expect(sessionStatusTopology.testIds.routeBody).toBe('route-body')
    expect(sessionStatusTopology.testIds.routeActions).toBe('route-actions')
    expect(sessionStatusTopology.testIds.ready).toBe('session-status-ready')
    expect(sessionStatusTopology.testIds.running).toBe('session-status-running')
    expect(sessionStatusTopology.testIds.complete).toBe('session-status-complete')
    expect(sessionStatusTopology.testIds.blocked).toBe('session-status-blocked')
    expect(sessionStatusTopology.testIds.failed).toBe('session-status-failed')
    expect(sessionStatusTopology.testIds.exited).toBe('session-status-exited')
  })
})
