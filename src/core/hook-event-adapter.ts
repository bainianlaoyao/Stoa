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
    hookEventName === 'SessionStart'
      || hookEventName === 'UserPromptSubmit'
      || hookEventName === 'PreToolUse'
      ? 'running'
      : hookEventName === 'Stop'
      ? 'turn_complete'
      : hookEventName === 'PermissionRequest'
        ? 'needs_confirmation'
        : hookEventName === 'StopFailure'
          ? 'error'
          : null

  if (!status) {
    return null
  }
  const snippet = stringField(body.last_assistant_message)
  const toolName = stringField(body.tool_name)
  const error = hookEventName === 'StopFailure'
    ? stringField(body.stop_hook_active) ?? 'api_error'
    : null

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
      summary: hookEventName,
      ...(snippet ? { snippet } : {}),
      ...(toolName ? { toolName } : {}),
      ...(error ? { error } : {}),
      ...(hookEventName === 'PermissionRequest' ? { blockingReason: 'permission' } : {}),
      ...(body.session_id ? { externalSessionId: String(body.session_id) } : {})
    }
  }
}

export function adaptCodexHook(
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
    hookEventName === 'SessionStart'
      || hookEventName === 'UserPromptSubmit'
      || hookEventName === 'PreToolUse'
      || hookEventName === 'PostToolUse'
    ? 'running'
    : hookEventName === 'Stop'
      ? 'turn_complete'
      : null

  if (!status) {
    return null
  }

  const turnId = stringField(body.turn_id)
  const model = stringField(body.model)
  const toolName = stringField(body.tool_name)
  const toolUseId = stringField(body.tool_use_id)

  return {
    event_version: 1,
    event_id: turnId ?? randomUUID(),
    event_type: `codex.${hookEventName}`,
    timestamp: new Date().toISOString(),
    session_id: context.sessionId,
    project_id: context.projectId,
    source: 'provider-adapter',
    payload: {
      status,
      summary: hookEventName,
      ...(model ? { model } : {}),
      ...(toolName ? { toolName } : {}),
      ...(toolUseId ? { toolUseId } : {})
    }
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
