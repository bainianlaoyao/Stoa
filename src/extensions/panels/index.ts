export interface PanelExtensionContext {
  activeWorkspaceId: string | null
  workspaceCount: number
}

export interface PanelExtensionDefinition {
  panelId: string
  title: string
  renderSummary(context: PanelExtensionContext): string
}

const defaultPanels: PanelExtensionDefinition[] = [
  {
    panelId: 'workspace-debug-summary',
    title: 'Workspace Debug Summary',
    renderSummary(context) {
      const active = context.activeWorkspaceId ?? 'none'
      return `workspaces=${context.workspaceCount}; active=${active}`
    }
  }
]

export function listPanels(): PanelExtensionDefinition[] {
  return [...defaultPanels]
}
