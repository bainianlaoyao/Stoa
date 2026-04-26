import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { CanonicalSessionEvent } from '@shared/project-session'
import { adaptClaudeCodeHook, adaptCodexHook } from './hook-event-adapter'

const WEBHOOK_DEBUG = process.env.VIBECODING_E2E === '1'

const VALID_SOURCES = new Set(['hook-sidecar', 'provider-adapter', 'system-recovery'])
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
  'agent.completion_seen',
  'agent.permission_requested',
  'agent.permission_resolved',
  'agent.turn_failed',
  'agent.recovered'
])
const VALID_RUNTIME_STATES = new Set(['created', 'starting', 'alive', 'exited', 'failed_to_start'])
const VALID_AGENT_STATES = new Set(['unknown', 'idle', 'working', 'blocked', 'error'])
const VALID_RUNTIME_EXIT_REASONS = new Set(['clean', 'failed'])
const VALID_BLOCKING_REASONS = new Set(['permission', 'elicitation', 'resume-confirmation', 'provider-error'])
const OPTIONAL_STRING_FIELDS = ['model', 'snippet', 'toolName', 'error'] as const

export interface LocalWebhookServerOptions {
  onEvent?: (event: CanonicalSessionEvent) => Promise<void> | void
  getSessionSecret?: (sessionId: string) => string | null
  port?: number
}

export interface LocalWebhookServer {
  app: Express
  port: number
  start: () => Promise<number>
  stop: () => Promise<void>
}

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

  if (payload.agentState !== undefined && !VALID_AGENT_STATES.has(payload.agentState as string)) {
    return false
  }

  if (payload.hasUnseenCompletion !== undefined && typeof payload.hasUnseenCompletion !== 'boolean') {
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

  if (payload.intent === 'agent.permission_resolved' && payload.agentState === 'blocked') {
    return false
  }

  return true
}

export function createLocalWebhookServer(options: LocalWebhookServerOptions = {}): LocalWebhookServer {
  const app = express()
  app.use(express.json())

  let server: import('node:http').Server | null = null
  const port = options.port ?? 0

  app.get('/health', (_request, response) => {
    response.json({ ok: true })
  })

  app.post('/events', async (request, response) => {
    if (!isCanonicalSessionEvent(request.body)) {
      response.status(400).json({ accepted: false, reason: 'invalid_event' })
      return
    }

    const expectedSecret = options.getSessionSecret?.(request.body.session_id) ?? null
    if (!expectedSecret || request.header('x-stoa-secret') !== expectedSecret) {
      response.status(401).json({ accepted: false, reason: 'invalid_secret' })
      return
    }

    await options.onEvent?.(request.body)
    response.status(202).json({ accepted: true })
  })

  app.post('/hooks/claude-code', async (request, response) => {
    const sessionId = request.header('x-stoa-session-id')
    const projectId = request.header('x-stoa-project-id')

    if (!sessionId || !projectId) {
      response.status(400).json({ accepted: false, reason: 'invalid_hook_context' })
      return
    }

    const expectedSecret = options.getSessionSecret?.(sessionId) ?? null
    if (!expectedSecret || request.header('x-stoa-secret') !== expectedSecret) {
      response.status(401).json({ accepted: false, reason: 'invalid_secret' })
      return
    }

    const body = request.body
    if (!body || typeof body !== 'object') {
      response.status(400).json({ accepted: false, reason: 'invalid_hook_event' })
      return
    }

    const event = adaptClaudeCodeHook(body as Record<string, unknown>, {
      sessionId,
      projectId
    })
    if (!event) {
      response.status(202).json({ accepted: true, ignored: true })
      return
    }

    await options.onEvent?.(event)
    response.status(202).json({ accepted: true })
  })

  app.post('/hooks/codex', async (request, response) => {
    const sessionId = request.header('x-stoa-session-id')
    const projectId = request.header('x-stoa-project-id')

    if (WEBHOOK_DEBUG) {
      console.log('[webhook-debug] codex hook request', {
        sessionId,
        projectId,
        hookEventName:
          request.body && typeof request.body === 'object' && 'hook_event_name' in request.body
            ? (request.body as Record<string, unknown>).hook_event_name
            : null
      })
    }

    if (!sessionId || !projectId) {
      response.status(400).json({ accepted: false, reason: 'invalid_hook_context' })
      return
    }

    const expectedSecret = options.getSessionSecret?.(sessionId) ?? null
    if (!expectedSecret || request.header('x-stoa-secret') !== expectedSecret) {
      if (WEBHOOK_DEBUG) {
        console.log('[webhook-debug] codex hook secret rejected', { sessionId, projectId })
      }
      response.status(401).json({ accepted: false, reason: 'invalid_secret' })
      return
    }

    const body = request.body
    if (!body || typeof body !== 'object') {
      response.status(400).json({ accepted: false, reason: 'invalid_hook_event' })
      return
    }

    const event = adaptCodexHook(body as Record<string, unknown>, {
      sessionId,
      projectId
    })
    if (!event) {
      if (WEBHOOK_DEBUG) {
        console.log('[webhook-debug] codex hook ignored', {
          sessionId,
          projectId,
          hookEventName:
            body && typeof body === 'object' && 'hook_event_name' in body
              ? (body as Record<string, unknown>).hook_event_name
              : null
        })
      }
      response.status(202).json({ accepted: true, ignored: true })
      return
    }

    if (WEBHOOK_DEBUG) {
      console.log('[webhook-debug] codex hook accepted', {
        sessionId,
        projectId,
        eventType: event.event_type,
        intent: event.payload.intent
      })
    }
    await options.onEvent?.(event)
    response.status(202).json({ accepted: true })
  })

  return {
    app,
    port,
    async start() {
      if (server) {
        return (server.address() as AddressInfo).port
      }

      const started = await new Promise<import('node:http').Server>((resolve) => {
        const httpServer = app.listen(port, '127.0.0.1', () => resolve(httpServer))
      })

      server = started
      return (started.address() as AddressInfo).port
    },
    async stop() {
      if (!server) {
        return
      }

      const active = server
      server = null
      await new Promise<void>((resolve, reject) => {
        active.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}
