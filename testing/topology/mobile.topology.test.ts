import { describe, expect, it } from 'vitest'
import { mobileTopology } from './mobile.topology'

describe('mobile topology', () => {
  it('declares stable hooks for the approved mobile V1 IA', () => {
    expect(mobileTopology.surface).toBe('mobile')
    expect(mobileTopology.testIds.shell).toBe('mobile-shell')
    expect(mobileTopology.testIds.workspaceHome).toBe('mobile-workspace-home')
    expect(mobileTopology.testIds.sessionList).toBe('mobile-session-list')
    expect(mobileTopology.testIds.sessionView).toBe('mobile-session-view')
    expect(mobileTopology.testIds.keysRail).toBe('mobile-keys-rail')
    expect(mobileTopology.testIds.keysDismiss).toBe('mobile-keys-dismiss')
    expect(mobileTopology.testIds.healthRetry).toBe('mobile-health-retry')
  })
})
