import { defineTopology } from '../contracts/testing-contracts'

export const terminalTopology = defineTopology({
  surface: 'terminal',
  testIds: {
    viewport: 'terminal-viewport',
    xterm: 'terminal-xterm',
    shell: 'terminal-shell',
    xtermMount: 'terminal-xterm-mount',
    emptyState: 'terminal-empty-state',
    workspaceQuickActions: 'workspace.quick-actions',
    openIde: 'workspace.open-ide',
    openFileManager: 'workspace.open-file-manager'
  }
})
