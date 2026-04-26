import { defineJourney } from '../contracts/testing-contracts'

export const workspaceQuickAccessJourney = defineJourney({
  id: 'journey.workspace.quick-access.actions',
  behavior: 'workspace.quickAccess',
  usageMode: 'active_workflow',
  setup: ['project.withShellSession', 'session.selectedInCommandSurface'],
  act: ['click.workspace.openIde', 'click.workspace.openFileManager'],
  assert: ['terminal.workspaceQuickActionsVisible', 'ipc.workspaceOpenRequested'],
  variants: ['vscode', 'file-manager']
})
