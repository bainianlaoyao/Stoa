/**
 * Webhook routes — Hono sub-app for session event hooks.
 * Converted from Express (src/core/webhook-server.ts) as part of Phase 2b.
 *
 * Routes:
 *   POST /events              — canonical session events
 *   POST /hooks/claude-code   — Claude Code provider adapter
 *   POST /hooks/codex         — Codex provider adapter
 *   POST /hooks/opencode      — OpenCode provider adapter
 *   POST /memory-notifications — memory runtime notifications
 *
 * Health is handled by the main health route, not here.
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import type {
  CanonicalSessionEvent,
  MemoryNotificationEvent,
  MemoryNotificationKind,
  MemoryNotificationStatus
} from 'stoa-shared'
import {
  adaptClaudeCodeHook,
  adaptCodexHook,
  adaptOpenCodeHook,
  InvalidHookEvidenceError
} from '../services/hook-event-adapter'

// ---------------------------------------------------------------------------
// Configuration interface — callers inject event handlers and auth callbacks
// ---------------------------------------------------------------------------

export interface HookLease {
  sessionId: string
  projectId: string
  provider: 'claude-code' | 'codex' | 'opencode'
}

export interface HookAuthorizationSuccess {
  ok: true
  lease: HookLease
}

export interface HookAuthorizationFailure {
  ok: false
  reason: 'invalid_secret' | 'invalid_hook_context'
}

export type HookAuthorizationResult = HookAuthorizationSuccess | HookAuthorizationFailure

export interface WebhookRouteDeps {
  onEvent?: (event: CanonicalSessionEvent) => Promise<unknown> | unknown
  onMemoryNotification?: (notification: {
    sessionId: string
    projectId: string
    kind: MemoryNotificationKind
    status: MemoryNotificationStatus
    title: string
    message: string
  }) => Promise<unknown> | unknown
  getSessionSecret?: (sessionId: string) => string | null
  authorizeHookRequest?: (input: {
    sessionId: string
    projectId: string
    provider: 'claude-code' | 'codex' | 'opencode'
    secret: string | null
  }) => Promise<HookAuthorizationResult> | HookAuthorizationResult
}

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set(['hook-sidecar', 'provider-adapter', 'system-recovery'])
const VALID_MEMORY_RUNTIME_PROVIDERS = new Set(['claude-code', 'codex', 'opencode'])
const VALID_MEMORY_RUNTIME_CHANNELS = new Set(['hook', 'notify'])
const VALID_INTENTS = new Set([
  'runtime.created',
  'runtime.starting',
  'runtime.alive',
  'runtime.exited_clean',
  'runtime.exited_failed',
  'runtime.failed_to_start',
  'agent.turn_started',
  'agent.tool_started',
  'agent.tool_completed',
  'agent.turn_completed',
  'agent.turn_interrupted',
  'agent.permission_requested',
  'agent.permission_resolved',
  'agent.turn_cancelled',
  'agent.turn_failed',
  'agent.completion_seen',
  'agent.recovered'
])
const VALID_RUNTIME_STATES = new Set(['created', 'starting', 'alive', 'exited', 'failed_to_start'])
const VALID_RUNTIME_EXIT_REASONS = new Set(['clean', 'failed'])
const VALID_BLOCKING_REASONS = new Set(['permission', 'elicitation', 'denied', 'provider_wait'])
const VALID_FAILURE_REASONS = new Set([
  'rate_limit',
  'authentication_failed',
  'billing_error',
  'invalid_request',
  'server_error',
  'max_output_tokens',
  'permission_denied',
  'tool_error',
  'provider_error',
  'runtime_crash',
  'failed_to_start',
  'unknown'
])
const LEGACY_PAYLOAD_FIELDS = ['agentState', 'hasUnseenCompletion'] as const
const OPTIONAL_STRING_FIELDS = ['model', 'snippet', 'toolName', 'error'] as const
const OPTIONAL_EVIDENCE_STRING_FIELDS = [
  'hookEventName',
  'providerSessionId',
  'turnId',
  'transcriptPath',
  'lastAssistantMessage',
  'promptText',
  'toolName',
  'toolUseId',
  'cwd',
  'model'
] as const
const VALID_CODEX_SESSION_START_SOURCES = new Set(['startup', 'resume', 'clear'])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isCanonicalSessionEvent(value: unknown): value is CanonicalSessionEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const event = value as Record<string, unknown>
  const payload = event.payload as Record<string, unknown> | null
  if (!(event.event_version === 1
    && typeof event.event_id === 'string'
    && typeof event.event_type === 'string'
    && typeof event.timestamp === 'string'
    && typeof event.session_id === 'string'
    && typeof event.project_id === 'string'
    && (event.correlation_id === undefined || typeof event.correlation_id === 'string')
    && typeof event.source === 'string'
    && VALID_SOURCES.has(event.source)
    && !!payload
    && typeof payload === 'object'
    && typeof payload.intent === 'string'
    && VALID_INTENTS.has(payload.intent)
    && typeof payload.summary === 'string')) {
    return false
  }

  if (payload.runtimeState !== undefined && !VALID_RUNTIME_STATES.has(payload.runtimeState as string)) {
    return false
  }

  if (payload.turnEpoch !== undefined && typeof payload.turnEpoch !== 'number') {
    return false
  }

  if (
    payload.runtimeExitCode !== undefined
    && payload.runtimeExitCode !== null
    && typeof payload.runtimeExitCode !== 'number'
  ) {
    return false
  }

  if (
    payload.runtimeExitReason !== undefined
    && payload.runtimeExitReason !== null
    && !VALID_RUNTIME_EXIT_REASONS.has(payload.runtimeExitReason as string)
  ) {
    return false
  }

  if (
    payload.blockingReason !== undefined
    && payload.blockingReason !== null
    && !VALID_BLOCKING_REASONS.has(payload.blockingReason as string)
  ) {
    return false
  }

  if (
    payload.failureReason !== undefined
    && payload.failureReason !== null
    && !VALID_FAILURE_REASONS.has(payload.failureReason as string)
  ) {
    return false
  }

  for (const field of LEGACY_PAYLOAD_FIELDS) {
    if (payload[field] !== undefined) {
      return false
    }
  }

  if (payload.toolUseId !== undefined) {
    return false
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (payload[field] !== undefined && typeof payload[field] !== 'string') {
      return false
    }
  }

  if (
    payload.externalSessionId !== undefined
    && payload.externalSessionId !== null
    && typeof payload.externalSessionId !== 'string'
  ) {
    return false
  }

  if (
    payload.sourceTurnId !== undefined
    && payload.sourceTurnId !== null
    && typeof payload.sourceTurnId !== 'string'
  ) {
    return false
  }

  if (event.evidence !== undefined && !isMemoryRuntimeEvidence(event.evidence)) {
    return false
  }

  return true
}

function isMemoryRuntimeEvidence(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const evidence = value as Record<string, unknown>
  const rawSource = evidence.rawSource
  if (typeof rawSource !== 'object' || rawSource === null) {
    return false
  }

  const rawSourceRecord = rawSource as Record<string, unknown>
  if (
    typeof rawSourceRecord.provider !== 'string'
    || !VALID_MEMORY_RUNTIME_PROVIDERS.has(rawSourceRecord.provider)
    || typeof rawSourceRecord.channel !== 'string'
    || !VALID_MEMORY_RUNTIME_CHANNELS.has(rawSourceRecord.channel)
    || !isNonEmptyString(rawSourceRecord.rawEventName)
  ) {
    return false
  }

  for (const field of OPTIONAL_EVIDENCE_STRING_FIELDS) {
    if (evidence[field] !== undefined && !isNonEmptyString(evidence[field])) {
      return false
    }
  }

  if (
    evidence.sessionStartSource !== undefined
    && evidence.sessionStartSource !== null
    && (
      typeof evidence.sessionStartSource !== 'string'
      || !VALID_CODEX_SESSION_START_SOURCES.has(evidence.sessionStartSource)
    )
  ) {
    return false
  }

  if (
    evidence.inputMessages !== undefined
    && (!Array.isArray(evidence.inputMessages) || evidence.inputMessages.some((entry) => typeof entry !== 'string'))
  ) {
    return false
  }

  return true
}

function isMemoryNotificationPayload(value: unknown): value is Pick<
  MemoryNotificationEvent,
  'kind' | 'status' | 'title' | 'message'
> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const notification = value as Record<string, unknown>
  return (
    typeof notification.kind === 'string'
    && ['recall', 'solidify', 'distill'].includes(notification.kind)
    && typeof notification.status === 'string'
    && ['success', 'info', 'error'].includes(notification.status)
    && isNonEmptyString(notification.title)
    && isNonEmptyString(notification.message)
  )
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createWebhookRoutes(deps: WebhookRouteDeps = {}): Hono {
  const routes = new Hono()

  // POST /events — canonical session events
  routes.post('/events', async (c: Context) => {
    const body = await c.req.json()

    if (!isCanonicalSessionEvent(body)) {
      return c.json({ accepted: false, reason: 'invalid_event' }, 400)
    }

    const expectedSecret = deps.getSessionSecret?.(body.session_id) ?? null
    if (!expectedSecret || c.req.header('x-stoa-secret') !== expectedSecret) {
      return c.json({ accepted: false, reason: 'invalid_secret' }, 401)
    }

    const result = await deps.onEvent?.(body)
    if (result === undefined || result === null) {
      return c.json({ accepted: true }, 202)
    }

    return c.json(result, 200)
  })

  // Factory for provider-specific hook endpoints
  function createHookHandler(
    adapt: (body: Record<string, unknown>, context: { sessionId: string; projectId: string }) => CanonicalSessionEvent | null,
    provider: 'claude-code' | 'codex' | 'opencode'
  ) {
    return async (c: Context) => {
      const sessionId = c.req.header('x-stoa-session-id')
      const projectId = c.req.header('x-stoa-project-id')

      if (!sessionId || !projectId) {
        return c.json({ accepted: false, reason: 'invalid_hook_context' }, 400)
      }

      const hookSecret = c.req.header('x-stoa-secret') ?? null
      const authorization = await deps.authorizeHookRequest?.({
        sessionId,
        projectId,
        provider,
        secret: hookSecret
      })

      if (authorization) {
        if (!authorization.ok) {
          const status = authorization.reason === 'invalid_hook_context' ? 400 : 401
          return c.json({ accepted: false, reason: authorization.reason }, status)
        }

        if (authorization.lease.projectId !== projectId || authorization.lease.provider !== provider) {
          return c.json({ accepted: false, reason: 'invalid_secret' }, 401)
        }
      } else {
        const expectedSecret = deps.getSessionSecret?.(sessionId) ?? null
        if (!expectedSecret || hookSecret !== expectedSecret) {
          return c.json({ accepted: false, reason: 'invalid_secret' }, 401)
        }
      }

      const body = await c.req.json()
      if (!body || typeof body !== 'object') {
        return c.json({ accepted: false, reason: 'invalid_hook_event' }, 400)
      }

      let event: CanonicalSessionEvent | null
      try {
        event = adapt(body as Record<string, unknown>, {
          sessionId,
          projectId
        })
      } catch (error) {
        if (error instanceof InvalidHookEvidenceError) {
          return c.json({ accepted: false, reason: 'invalid_hook_event' }, 400)
        }

        throw error
      }

      if (!event) {
        return c.body(null, 204)
      }

      if (!isCanonicalSessionEvent(event)) {
        return c.json({ accepted: false, reason: 'invalid_hook_event' }, 400)
      }

      const result = await deps.onEvent?.(event)
      if (result === undefined || result === null) {
        return c.body(null, 204)
      }

      return c.json(result, 200)
    }
  }

  // POST /hooks/claude-code
  routes.post('/hooks/claude-code', createHookHandler(adaptClaudeCodeHook, 'claude-code'))

  // POST /hooks/codex
  routes.post('/hooks/codex', createHookHandler(adaptCodexHook, 'codex'))

  // POST /hooks/opencode
  routes.post('/hooks/opencode', createHookHandler(adaptOpenCodeHook, 'opencode'))

  // POST /memory-notifications
  routes.post('/memory-notifications', async (c: Context) => {
    const sessionId = c.req.header('x-stoa-session-id')
    const projectId = c.req.header('x-stoa-project-id')

    if (!sessionId || !projectId) {
      return c.json({ accepted: false, reason: 'invalid_hook_context' }, 400)
    }

    const expectedSecret = deps.getSessionSecret?.(sessionId) ?? null
    if (!expectedSecret || c.req.header('x-stoa-secret') !== expectedSecret) {
      return c.json({ accepted: false, reason: 'invalid_secret' }, 401)
    }

    const body = await c.req.json()

    if (!isMemoryNotificationPayload(body)) {
      return c.json({ accepted: false, reason: 'invalid_memory_notification' }, 400)
    }

    const result = await deps.onMemoryNotification?.({
      sessionId,
      projectId,
      kind: body.kind,
      status: body.status,
      title: body.title,
      message: body.message
    })
    if (result === undefined || result === null) {
      return c.json({ accepted: true }, 202)
    }

    return c.json(result, 200)
  })

  return routes
}

/** Default exported sub-app with no deps wired (for mounting at /hooks). */
export const webhookRoutes = createWebhookRoutes()
