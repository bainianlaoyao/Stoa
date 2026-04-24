import type { ObservabilityService } from '@core/observability-service'
import type { ProjectSessionManager } from '@core/project-session-manager'

export function syncObservabilitySessionsFromManager(
  manager: ProjectSessionManager,
  observability: ObservabilityService
): void {
  const snapshot = manager.snapshot()
  observability.syncSessions(snapshot.sessions, snapshot.activeSessionId)
}
