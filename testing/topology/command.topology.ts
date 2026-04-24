import { defineTopology } from '../contracts/testing-contracts'

export const commandTopology = defineTopology({
  surface: 'command',
  testIds: {
    appViewport: 'app-viewport',
    commandPanel: 'command-panel',
    commandBody: 'command-body',
    commandLayout: 'command-layout',
    workspacePanel: 'workspace-hierarchy-panel',
    routeBody: 'route-body',
    routeActions: 'route-actions',
    newProjectButton: 'workspace.new-project',
    projectRow: 'project-row',
    addSessionButton: 'workspace.add-session',
    sessionRow: 'session-row',
    sessionStatusDot: 'session-status-dot',
    terminalStatusBar: 'terminal-status-bar',
    archiveSessionButton: 'workspace.archive-session'
  }
})
