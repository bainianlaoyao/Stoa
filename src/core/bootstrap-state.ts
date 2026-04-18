import type { AppBootstrapState } from '@shared/workspace'

export function createBootstrapState(): AppBootstrapState {
  return {
    activeWorkspaceId: 'ws_demo_001',
    terminalWebhookPort: null,
    workspaces: [
      {
        workspaceId: 'ws_demo_001',
        name: 'demo-workspace',
        path: 'D:/demo-workspace',
        providerId: 'opencode',
        status: 'bootstrapping',
        summary: '等待后端真实事件回填',
        cliSessionId: null,
        isProvisional: true
      }
    ]
  }
}
