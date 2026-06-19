import { describe, expect, it } from 'vitest'
import {
  mobileDrilldownBehavior,
  mobileHealthBehavior,
  mobileSearchBehavior,
  mobileSessionCreationBehavior,
  mobileTerminalControlsBehavior
} from './mobile.behavior'

describe('mobile behavior assets', () => {
  it('declares mobile drill-down as a critical phone workflow', () => {
    expect(mobileDrilldownBehavior.id).toBe('mobile.drilldown')
    expect(mobileDrilldownBehavior.coverageBudget).toBe('critical')
    expect(mobileDrilldownBehavior.expects).toContain('mobile.workspaceHomeVisibleAtStartup')
    expect(mobileDrilldownBehavior.expects).toContain('desktop.rightSidebarAbsent')
  })

  it('declares lightweight global search across sessions and workspaces', () => {
    expect(mobileSearchBehavior.id).toBe('mobile.search')
    expect(mobileSearchBehavior.expects).toContain('mobile.searchGroupsSessionsAndWorkspaces')
    expect(mobileSearchBehavior.recovery).toContain('returnsToOpeningSurface')
  })

  it('declares session creation through desktop-backed type icons', () => {
    expect(mobileSessionCreationBehavior.id).toBe('mobile.session.create')
    expect(mobileSessionCreationBehavior.expects).toContain('mobile.typeGridUsesDesktopProviders')
    expect(mobileSessionCreationBehavior.recovery).toContain('noSessionCreatedUntilTypeSelected')
  })

  it('declares key rail and display preferences as terminal controls', () => {
    expect(mobileTerminalControlsBehavior.id).toBe('mobile.terminal.controls')
    expect(mobileTerminalControlsBehavior.expects).toContain('mobile.keysRailOverlayNoResize')
    expect(mobileTerminalControlsBehavior.expects).toContain('mobile.displayPrefsPersistPerSession')
  })

  it('declares backend health as a critical mobile input gate', () => {
    expect(mobileHealthBehavior.id).toBe('mobile.health')
    expect(mobileHealthBehavior.coverageBudget).toBe('critical')
    expect(mobileHealthBehavior.expects).toContain('xterm.inputFrozen')
    expect(mobileHealthBehavior.recovery).toContain('noOfflineQueue')
  })
})
