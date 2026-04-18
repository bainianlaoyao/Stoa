import type { CanonicalWorkspaceEvent } from '@shared/workspace'

export function createBootstrappingEvent(workspaceId: string): CanonicalWorkspaceEvent {
  return {
    event_version: 1,
    event_id: `evt_bootstrap_${workspaceId}`,
    event_type: 'workspace.status_changed',
    timestamp: new Date().toISOString(),
    workspace_id: workspaceId,
    provider_id: 'system',
    session_id: null,
    source: 'system-recovery',
    payload: {
      status: 'bootstrapping',
      summary: '等待状态通道连接',
      is_provisional: true
    }
  }
}
