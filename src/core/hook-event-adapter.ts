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

  const patch = mapClaudeHookToPatch(hookEventName)
  if (!patch) {
    return null
  }

  const model = stringField(body.model)
  const snippet = stringField(body.last_assistant_message) ?? stringField(body.assistant_message) ?? stringField(body.summary)
  const toolName = stringField(body.tool_name)
  const error = stringField(body.error_details) ?? stringField(body.error)

  return {
    event_version: 1,
    event_id: randomUUID(),
    event_type: `claude-code.${hookEventName}`,
    timestamp: new Date().toISOString(),
    session_id: context.sessionId,
    project_id: context.projectId,
    source: 'provider-adapter',
    payload: {
      ...patch,
      summary: hookEventName,
      ...(model ? { model } : {}),
      ...(snippet ? { snippet } : {}),
      ...(toolName ? { toolName } : {}),
      ...(error ? { error } : {})
    }
  }
}

function mapClaudeHookToPatch(hookEventName: string): {
  intent: NonNullable<CanonicalSessionEvent['payload']['intent']>
  agentState: NonNullable<CanonicalSessionEvent['payload']['agentState']>
  hasUnseenCompletion?: boolean
  blockingReason?: NonNullable<CanonicalSessionEvent['payload']['blockingReason']>
} | null {
  switch (hookEventName) {
    case 'UserPromptSubmit':
      return { intent: 'agent.turn_started', agentState: 'working' }
    case 'PreToolUse':
      return { intent: 'agent.tool_started', agentState: 'working' }
    case 'PermissionRequest':
      return { intent: 'agent.permission_requested', agentState: 'blocked', blockingReason: 'permission' }
    case 'Stop':
      return { intent: 'agent.turn_completed', agentState: 'idle', hasUnseenCompletion: true }
    case 'StopFailure':
      return { intent: 'agent.turn_failed', agentState: 'error' }
    default:
      return null
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
