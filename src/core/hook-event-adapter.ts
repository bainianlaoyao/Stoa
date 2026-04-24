import { randomUUID } from 'node:crypto'
import type { CanonicalSessionEvent } from '@shared/project-session'

export function adaptClaudeCodeHook(
  body: Record<string, unknown>,
  context: {
    sessionId: string
    projectId: string
  }
): CanonicalSessionEvent | null {
  const hookEventName = typeof body.hook_event_name === 'string' ? body.hook_event_name : null
  if (!hookEventName) {
    return null
  }

  const status =
    hookEventName === 'Stop'
      ? 'turn_complete'
      : hookEventName === 'PermissionRequest'
        ? 'needs_confirmation'
        : null

  if (!status) {
    return null
  }

  return {
    event_version: 1,
    event_id: randomUUID(),
    event_type: `claude-code.${hookEventName}`,
    timestamp: new Date().toISOString(),
    session_id: context.sessionId,
    project_id: context.projectId,
    source: 'provider-adapter',
    payload: {
      status,
      summary: hookEventName
    }
  }
}
