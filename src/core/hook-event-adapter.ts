import { randomUUID } from 'node:crypto'
import type { CanonicalSessionEvent } from '@shared/project-session'
import type { MemoryRuntimeEvidence, MemoryRuntimeEvidenceProvider } from '@shared/memory-runtime'

export class InvalidHookEvidenceError extends Error {
  constructor(provider: MemoryRuntimeEvidenceProvider) {
    const label =
      provider === 'codex' ? 'Codex' :
      provider === 'opencode' ? 'OpenCode' :
      'Claude'
    super(`Invalid ${label} hook evidence`)
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

  const toolName = typeof body.tool_name === 'string' ? body.tool_name : undefined
  const patch = mapClaudeHookToPatch(hookEventName, toolName)
  if (!patch) {
    return null
  }

  const model = stringField(body.model)
  const snippet = stringField(body.last_assistant_message) ?? stringField(body.assistant_message) ?? stringField(body.summary)
  const evidence = buildClaudeHookEvidence(body, hookEventName)
  const error = stringField(body.error_details) ?? stringField(body.error)
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
      ...withSourceTurnId(patch, evidence.turnId),
      summary: hookEventName,
      ...(model ? { model } : {}),
      ...(snippet ? { snippet } : {}),
      ...(evidence.toolName ? { toolName: evidence.toolName } : {}),
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
  const externalSessionId = evidence.providerSessionId

  return {
    event_version: 1,
    event_id: randomUUID(),
    event_type: `codex.${hookEventName}`,
    timestamp: new Date().toISOString(),
    session_id: context.sessionId,
    project_id: context.projectId,
    source: 'provider-adapter',
    payload: {
      ...withSourceTurnId(patch, evidence.turnId),
      summary: hookEventName,
      ...(evidence.model ? { model: evidence.model } : {}),
      ...(evidence.toolName ? { toolName: evidence.toolName } : {}),
      ...(externalSessionId ? { externalSessionId } : {})
    },
    evidence
  }
}

export function adaptOpenCodeHook(
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

  const hasError = 'error' in body && body.error !== undefined && body.error !== null
  const patch = mapOpenCodeHookToPatch(hookEventName, hasError)
  if (!patch) {
    return null
  }

  const evidence = buildOpenCodeHookEvidence(body, hookEventName)
  const snippet = stringField(body.last_assistant_message)
  const externalSessionId = evidence.providerSessionId
  const error = stringField(body.error)

  return {
    event_version: 1,
    event_id: randomUUID(),
    event_type: `opencode.${hookEventName}`,
    timestamp: new Date().toISOString(),
    session_id: context.sessionId,
    project_id: context.projectId,
    source: 'provider-adapter',
    payload: {
      ...withSourceTurnId(patch, evidence.turnId),
      summary: hookEventName,
      ...(evidence.model ? { model: evidence.model } : {}),
      ...(snippet ? { snippet } : {}),
      ...(evidence.toolName ? { toolName: evidence.toolName } : {}),
      ...(error ? { error } : {}),
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
    turnId:
      requiredOptionalStringField(body, 'turn_id', 'claude-code')
      ?? requiredOptionalStringField(body, 'conversation_turn_id', 'claude-code'),
    transcriptPath: requiredOptionalStringField(body, 'transcript_path', 'claude-code'),
    lastAssistantMessage:
      requiredOptionalStringField(body, 'last_assistant_message', 'claude-code')
      ?? requiredOptionalStringField(body, 'assistant_message', 'claude-code'),
    promptText: requiredOptionalStringField(body, 'prompt', 'claude-code'),
    toolName: requiredOptionalStringField(body, 'tool_name', 'claude-code'),
    toolUseId: requiredOptionalStringField(body, 'tool_use_id', 'claude-code'),
    toolInput: isRecord(body.tool_input) ? body.tool_input : undefined,
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
    sessionStartSource: codexSessionStartSource(body, hookEventName),
    turnId: requiredOptionalStringField(body, 'turn_id', 'codex'),
    transcriptPath: nullableOptionalStringField(body, 'transcript_path', 'codex'),
    lastAssistantMessage: nullableOptionalStringField(body, 'last_assistant_message', 'codex'),
    promptText: requiredOptionalStringField(body, 'prompt', 'codex'),
    toolName: requiredOptionalStringField(body, 'tool_name', 'codex'),
    toolUseId: requiredOptionalStringField(body, 'tool_use_id', 'codex'),
    toolInput: isRecord(body.tool_input) ? body.tool_input : undefined,
    cwd: requiredOptionalStringField(body, 'cwd', 'codex'),
    model: requiredOptionalStringField(body, 'model', 'codex')
  })
}

function buildOpenCodeHookEvidence(
  body: Record<string, unknown>,
  hookEventName: string
): MemoryRuntimeEvidence {
  return compactEvidence({
    rawSource: {
      provider: 'opencode',
      channel: 'hook',
      rawEventName: hookEventName
    },
    hookEventName,
    providerSessionId: requiredOptionalStringField(body, 'provider_session_id', 'opencode'),
    turnId:
      requiredOptionalStringField(body, 'turn_id', 'opencode')
      ?? requiredOptionalStringField(body, 'message_id', 'opencode'),
    lastAssistantMessage: requiredOptionalStringField(body, 'last_assistant_message', 'opencode'),
    promptText: requiredOptionalStringField(body, 'prompt_text', 'opencode'),
    toolName: requiredOptionalStringField(body, 'tool_name', 'opencode'),
    toolInput: isRecord(body.tool_input) ? body.tool_input : undefined,
    model: requiredOptionalStringField(body, 'model', 'opencode')
  })
}

type HookPatch = Pick<
  CanonicalSessionEvent['payload'],
  'intent' | 'blockingReason' | 'failureReason' | 'sourceTurnId'
>

function mapClaudeHookToPatch(hookEventName: string, toolName?: string): HookPatch | null {
  switch (hookEventName) {
    case 'SessionStart':
      return { intent: 'runtime.alive' }
    case 'UserPromptSubmit':
      return { intent: 'agent.turn_started' }
    case 'PreToolUse':
      if (toolName === 'AskUserQuestion') {
        return { intent: 'agent.permission_requested', blockingReason: 'elicitation' }
      }
      return { intent: 'agent.tool_started' }
    case 'PostToolUse':
      return { intent: 'agent.tool_completed' }
    case 'PermissionRequest':
      return { intent: 'agent.permission_requested', blockingReason: 'permission' }
    case 'Elicitation':
      return { intent: 'agent.permission_requested', blockingReason: 'elicitation' }
    case 'ElicitationResult':
      return { intent: 'agent.permission_resolved' }
    case 'Stop':
      return { intent: 'agent.turn_completed' }
    case 'StopFailure':
      return { intent: 'agent.turn_failed', failureReason: 'provider_error' }
    case 'SessionEnd':
      return { intent: 'runtime.exited_clean' }
    default:
      return null
  }
}

function mapCodexHookToPatch(hookEventName: string): HookPatch | null {
  switch (hookEventName) {
    case 'SessionStart':
      return { intent: 'runtime.alive' }
    case 'UserPromptSubmit':
      return { intent: 'agent.turn_started' }
    case 'PreToolUse':
      return { intent: 'agent.tool_started' }
    case 'PostToolUse':
      return { intent: 'agent.tool_completed' }
    case 'Stop':
      return { intent: 'agent.turn_completed' }
    default:
      return null
  }
}

function mapOpenCodeHookToPatch(hookEventName: string, hasError: boolean): HookPatch | null {
  switch (hookEventName) {
    case 'tool.execute.before':
      return { intent: 'agent.tool_started' }
    case 'tool.execute.after':
      return { intent: 'agent.tool_completed' }
    case 'session.idle':
      return { intent: 'agent.turn_completed' }
    case 'permission.asked':
      return { intent: 'agent.permission_requested', blockingReason: 'permission' }
    case 'permission.replied':
      return hasError
        ? { intent: 'agent.turn_failed', failureReason: 'provider_error' }
        : { intent: 'agent.permission_resolved' }
    case 'session.error':
      return { intent: 'agent.turn_failed', failureReason: 'provider_error' }
    case 'session.created':
      return { intent: 'runtime.alive' }
    case 'message.updated':
      return { intent: 'agent.turn_started' }
    default:
      return null
  }
}

function withSourceTurnId(
  patch: HookPatch,
  sourceTurnId: string | undefined
): HookPatch {
  if (!sourceTurnId) {
    return patch
  }

  return {
    ...patch,
    sourceTurnId
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

function codexSessionStartSource(
  body: Record<string, unknown>,
  hookEventName: string
): 'startup' | 'resume' | 'clear' | undefined {
  if (hookEventName !== 'SessionStart') {
    return undefined
  }

  const value = requiredOptionalStringField(body, 'source', 'codex')
  if (value === undefined) {
    return undefined
  }

  if (value === 'startup' || value === 'resume' || value === 'clear') {
    return value
  }

  throw new InvalidHookEvidenceError('codex')
}

function compactEvidence(evidence: MemoryRuntimeEvidence): MemoryRuntimeEvidence {
  return Object.fromEntries(
    Object.entries(evidence).filter(([, value]) => value !== undefined)
  ) as MemoryRuntimeEvidence
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
