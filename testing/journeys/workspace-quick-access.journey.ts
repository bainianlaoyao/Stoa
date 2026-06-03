import { defineJourney } from '../contracts/testing-contracts'

export const workspaceQuickAccessJourney = defineJourney({
  id: 'journey.workspace.quick-access.actions',
  behavior: 'workspace.quickAccess',
  usageMode: 'active_workflow',
  setup: ['project.withShellSession', 'session.selectedInCommandSurface'],
  act: ['click.workspace.openIde', 'click.workspace.openFileManager', 'click.workspace.sidebarToggle'],
  assert: ['terminal.workspaceQuickActionsVisible', 'ipc.workspaceOpenRequested', 'sidebar.visible'],
  variants: ['vscode', 'file-manager', 'sidebar']
})
