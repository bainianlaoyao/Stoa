import { randomUUID } from 'node:crypto'
import type { CanonicalSessionEvent } from '@shared/project-session'
import type { MemoryRuntimeEvidence, MemoryRuntimeEvidenceProvider } from '@shared/memory-runtime'

export class InvalidHookEvidenceError extends Error {
  constructor(provider: MemoryRuntimeEvidenceProvider) {
    super(`Invalid ${provider === 'codex' ? 'Codex' : 'Claude'} hook evidence`)
  }
}

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

  const evidence = buildClaudeHookEvidence(body, hookEventName)
  const error = hookEventName === 'StopFailure'
    ? stringField(body.stop_hook_active) ?? stringField(body.error_details) ?? stringField(body.error) ?? 'api_error'
    : stringField(body.error_details) ?? stringField(body.error)
  const externalSessionId = evidence.providerSessionId

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
      ...(error ? { error } : {}),
      ...(externalSessionId ? { externalSessionId } : {})
    },
    evidence
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

  const patch = mapCodexHookToPatch(hookEventName)
  if (!patch) {
    return null
  }

  const evidence = buildCodexHookEvidence(body, hookEventName)
  const turnId = evidence.turnId
  const externalSessionId =
    evidence.providerSessionId
    ?? requiredOptionalStringField(body, 'thread_id', 'codex')
    ?? requiredOptionalStringField(body, 'thread-id', 'codex')

  return {
    event_version: 1,
    event_id: turnId ?? randomUUID(),
    event_type: `codex.${hookEventName}`,
    timestamp: new Date().toISOString(),
    session_id: context.sessionId,
    project_id: context.projectId,
    source: 'provider-adapter',
    payload: {
      ...patch,
      summary: hookEventName,
      ...(externalSessionId ? { externalSessionId } : {})
    },
    evidence
  }
}

function buildClaudeHookEvidence(
  body: Record<string, unknown>,
  hookEventName: string
): MemoryRuntimeEvidence {
  return compactEvidence({
    rawSource: {
      provider: 'claude-code',
      channel: 'hook',
      rawEventName: hookEventName
    },
    hookEventName,
    providerSessionId: requiredOptionalStringField(body, 'session_id', 'claude-code'),
    transcriptPath: requiredOptionalStringField(body, 'transcript_path', 'claude-code'),
    lastAssistantMessage:
      requiredOptionalStringField(body, 'last_assistant_message', 'claude-code')
      ?? requiredOptionalStringField(body, 'assistant_message', 'claude-code'),
    promptText: requiredOptionalStringField(body, 'prompt', 'claude-code'),
    toolName: requiredOptionalStringField(body, 'tool_name', 'claude-code'),
    toolUseId: requiredOptionalStringField(body, 'tool_use_id', 'claude-code'),
    cwd: requiredOptionalStringField(body, 'cwd', 'claude-code'),
    model: requiredOptionalStringField(body, 'model', 'claude-code')
  })
}

function buildCodexHookEvidence(
  body: Record<string, unknown>,
  hookEventName: string
): MemoryRuntimeEvidence {
  return compactEvidence({
    rawSource: {
      provider: 'codex',
      channel: 'hook',
      rawEventName: hookEventName
    },
    hookEventName,
    providerSessionId: requiredOptionalStringField(body, 'session_id', 'codex'),
    turnId: requiredOptionalStringField(body, 'turn_id', 'codex'),
    transcriptPath: nullableOptionalStringField(body, 'transcript_path', 'codex'),
    lastAssistantMessage: nullableOptionalStringField(body, 'last_assistant_message', 'codex'),
    promptText: requiredOptionalStringField(body, 'prompt', 'codex'),
    toolName: requiredOptionalStringField(body, 'tool_name', 'codex'),
    toolUseId: requiredOptionalStringField(body, 'tool_use_id', 'codex'),
    cwd: requiredOptionalStringField(body, 'cwd', 'codex'),
    model: requiredOptionalStringField(body, 'model', 'codex')
  })
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

function mapCodexHookToPatch(hookEventName: string): {
  intent: NonNullable<CanonicalSessionEvent['payload']['intent']>
  agentState: NonNullable<CanonicalSessionEvent['payload']['agentState']>
  hasUnseenCompletion?: boolean
} | null {
  switch (hookEventName) {
    case 'SessionStart':
    case 'UserPromptSubmit':
      return { intent: 'agent.turn_started', agentState: 'working' }
    case 'PreToolUse':
    case 'PostToolUse':
      return { intent: 'agent.tool_started', agentState: 'working' }
    case 'Stop':
      return { intent: 'agent.turn_completed', agentState: 'idle', hasUnseenCompletion: true }
    default:
      return null
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function requiredOptionalStringField(
  body: Record<string, unknown>,
  key: string,
  provider: MemoryRuntimeEvidenceProvider
): string | undefined {
  if (!(key in body) || body[key] === undefined) {
    return undefined
  }

  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidHookEvidenceError(provider)
  }

  return value
}

function nullableOptionalStringField(
  body: Record<string, unknown>,
  key: string,
  provider: MemoryRuntimeEvidenceProvider
): string | undefined {
  if (!(key in body) || body[key] === undefined || body[key] === null) {
    return undefined
  }

  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidHookEvidenceError(provider)
  }

  return value
}

function compactEvidence(evidence: MemoryRuntimeEvidence): MemoryRuntimeEvidence {
  return Object.fromEntries(
    Object.entries(evidence).filter(([, value]) => value !== undefined)
  ) as MemoryRuntimeEvidence
}
