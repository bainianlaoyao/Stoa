import { describe, expect, it } from 'vitest'
import { workspaceQuickAccessJourney } from './workspace-quick-access.journey'

describe('workspace quick access journey', () => {
  it('links active terminal shortcuts to workspace quick access behavior', () => {
    expect(workspaceQuickAccessJourney.id).toBe('journey.workspace.quick-access.actions')
    expect(workspaceQuickAccessJourney.behavior).toBe('workspace.quickAccess')
    expect(workspaceQuickAccessJourney.setup).toContain('session.selectedInCommandSurface')
    expect(workspaceQuickAccessJourney.act).toEqual(['click.workspace.openIde', 'click.workspace.openFileManager'])
    expect(workspaceQuickAccessJourney.assert).toContain('ipc.workspaceOpenRequested')
    expect(workspaceQuickAccessJourney.variants).toEqual(['vscode', 'file-manager'])
  })
})
