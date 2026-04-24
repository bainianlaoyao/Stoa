import { describe, expect, it } from 'vitest'
import { sessionStatusTopology } from './session-status.topology'

describe('session status topology', () => {
  it('declares stable command route test ids for telemetry status assertions', () => {
    expect(sessionStatusTopology.surface).toBe('command-route-status')
    expect(sessionStatusTopology.testIds.root).toBe('workspace-hierarchy-panel')
    expect(sessionStatusTopology.testIds.routeBody).toBe('route-body')
    expect(sessionStatusTopology.testIds.routeActions).toBe('route-actions')
  })
})
