/**
 * Session control routes — Hono port of the legacy Express server.
 *
 * Skips GET /ctl/health (handled by main health).
 * Preserves validation, error handling, and response envelope from the
 * original Express implementation. All service methods are injected via
 * the `createControlRoutes` factory so the router is fully decoupled
 * from concrete service wiring.
 */
import { Hono } from 'hono'
import type { SessionType } from 'stoa-shared'
import type { SessionNodeSnapshot } from 'stoa-shared'
import { AppError } from '../shared/errors'
import { SessionSupervisor, type CallerIdentity, type CreateChildSessionRequest } from '../services/session-supervisor'
import { SubagentSupervisor } from '../services/subagent-supervisor'
import type { SessionSupervisorDeps } from '../services/session-supervisor'
import type { SubagentSupervisorDeps } from '../services/subagent-supervisor'

// ---------------------------------------------------------------------------
// Dependency interfaces
// ---------------------------------------------------------------------------

export interface RuntimeBridgeClient {
  /** Send a text input string to a session's PTY. */
  sendInput(sessionId: string, text: string): Promise<void>
  /** Create + launch a child session. */
  createChildSession(request: CreateChildSessionRequest): Promise<unknown>
  /** Destroy a session. */
  destroySession(sessionId: string): Promise<void>
  /** Dispatch a subagent (create + initial input). */
  dispatchSubagent(request: {
    parentId: string
    type: SessionType
    text: string
    title?: string
    name?: string
    initialCols?: number
    initialRows?: number
  }): Promise<unknown>
  /** Send text input to a subagent. */
  sendSubagentInput(target: string, text: string): Promise<unknown>
  /** Stop / interrupt a subagent. */
  stopSubagent(target: string, mode: 'interrupt' | 'destroy'): Promise<unknown>
  /** Is the runtime bridge currently connected? */
  isConnected(): boolean
}

export interface ControlDeps extends SessionSupervisorDeps, SubagentSupervisorDeps {
  ctlSecret?: string
  sessionTokenRegistry: Map<string, string>
  isCtlEnabled?: () => boolean
  runtimeBridge: RuntimeBridgeClient
}

// ---------------------------------------------------------------------------
// Helpers — JSON envelope, error mapping, auth resolution
// ---------------------------------------------------------------------------

function jsonEnvelope(data: unknown, error: unknown = null) {
  return { ok: error === null, data, error }
}

const SESSION_TYPES: SessionType[] = ['shell', 'opencode', 'codex', 'claude-code']

function isSessionType(value: string): value is SessionType {
  return SESSION_TYPES.includes(value as SessionType)
}

function parseOptionalPositiveInteger(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null
  }
  return value
}

function parseOptionalPositiveIntegerString(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null
  }
  return Number.parseInt(value, 10)
}

function resolveCaller(
  headers: { 'x-stoa-secret'?: string; 'x-stoa-session-id'?: string; 'x-stoa-session-token'?: string },
  deps: ControlDeps
): CallerIdentity | null {
  const secret = headers['x-stoa-secret']
  if (secret && deps.ctlSecret && secret === deps.ctlSecret) {
    return { type: 'local-user' }
  }

  const sessionId = headers['x-stoa-session-id']
  const sessionToken = headers['x-stoa-session-token']
  if (sessionId && sessionToken) {
    const expected = deps.sessionTokenRegistry.get(sessionId)
    if (expected && expected === sessionToken) {
      return { type: 'session', sessionId }
    }
  }

  return null
}

function errorCodeToHttpStatus(code: string): number {
  switch (code) {
    case 'unknown_session':
    case 'unknown_subagent':
    case 'ambiguous_subagent_name':
      return 404
    case 'forbidden_authority_scope':
    case 'subagent_result_forbidden':
      return 403
    case 'duplicate_subagent_name':
    case 'invalid_input_source':
    case 'invalid_result_status':
    case 'invalid_request':
    case 'invalid_parent_session':
      return 400
    case 'wait_timeout':
      return 408
    case 'no_completion_yet':
      return 409
    case 'interrupt_unsupported':
      return 501
    default:
      return 500
  }
}

function runtimeBridgeError(): never {
  throw new AppError({
    code: 'internal_error' as never,
    message: 'Runtime bridge not connected.',
    statusCode: 503,
    details: {}
  })
}

function requireConnectedBridge(deps: ControlDeps): void {
  if (!deps.runtimeBridge.isConnected()) {
    runtimeBridgeError()
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

type ControlVariables = { caller: CallerIdentity }

export function createControlRoutes(deps: ControlDeps): Hono<{ Variables: ControlVariables }> {
  const supervisor = new SessionSupervisor(deps)
  const subagentSupervisor = new SubagentSupervisor(deps)
  const isCtlEnabled = deps.isCtlEnabled ?? (() => true)

  const app = new Hono<{ Variables: ControlVariables }>()

  // Auth: every /ctl request must resolve to a known caller (secret or session token).
  // The caller identity is attached to the context under `c.set('caller', ...)`.
  app.use('*', async (c, next) => {
    if (!isCtlEnabled()) {
      return c.json(jsonEnvelope(null, {
        code: 'disabled',
        message: 'stoa-ctl is disabled in settings',
        details: {}
      }), 503)
    }

    const caller = resolveCaller({
      'x-stoa-secret': c.req.header('x-stoa-secret') ?? undefined,
      'x-stoa-session-id': c.req.header('x-stoa-session-id') ?? undefined,
      'x-stoa-session-token': c.req.header('x-stoa-session-token') ?? undefined
    }, deps)

    if (!caller) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_secret',
        message: 'Invalid control credentials.',
        details: {}
      }), 401)
    }

    c.set('caller', caller)
    await next()
  })

  // 1. GET /ctl/health → skipped (handled by main health route)

  // 2. GET /ctl/whoami
  app.get('/whoami', (c) => {
    const caller = c.get('caller') as CallerIdentity
    if (caller.type === 'local-user') {
      return c.json(jsonEnvelope({ caller: 'local-user' }))
    }
    return c.json(jsonEnvelope({ caller: 'session', sessionId: caller.sessionId }))
  })

  // 3. GET /ctl/capabilities
  app.get('/capabilities', (c) => {
    const caller = c.get('caller') as CallerIdentity
    const isChildSession = caller.type === 'session'
      ? !!deps.getSnapshot().find(n => n.session.id === caller.sessionId && n.session.parentSessionId !== null)
      : false

    return c.json(jsonEnvelope({
      controlTransport: 'loopback-http',
      supports: {
        health: true,
        sessionList: true,
        sessionInspect: true,
        sessionStatus: true,
        sessionInput: true,
        sessionCreate: true,
        sessionDestroy: true,
        sessionWait: true,
        sessionOutput: true,
        sessionCompletionReport: true,
        subagentList: true,
        subagentDispatch: true,
        subagentWait: true,
        subagentInput: true,
        subagentStop: true,
        subagentResult: isChildSession ? true : undefined
      }
    }))
  })

  // 4. GET /ctl/session/list
  app.get('/session/list', (c) => {
    const caller = c.get('caller') as CallerIdentity
    const nodes = supervisor.listSessions(caller)
    return c.json(jsonEnvelope({ nodes }))
  })

  // 5. GET /ctl/session/:id/inspect
  app.get('/session/:id/inspect', (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    const node = supervisor.inspectSession(caller, id)
    if (!node) {
      return c.json(jsonEnvelope(null, {
        code: 'unknown_session',
        message: `Unknown session: ${id}`,
        details: {}
      }), 404)
    }
    return c.json(jsonEnvelope({ node }))
  })

  // 6. GET /ctl/session/:id/status
  app.get('/session/:id/status', (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    try {
      const status = supervisor.getSessionStatus(caller, id)
      return c.json(jsonEnvelope({ status }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // 7. GET /ctl/session/:id/output
  app.get('/session/:id/output', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    try {
      const output = await supervisor.getSessionOutput(caller, id)
      return c.json(jsonEnvelope({ output }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // 8. GET /ctl/session/:id/completion-report
  app.get('/session/:id/completion-report', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    try {
      const report = await supervisor.getCompletionReport(caller, id)
      return c.json(jsonEnvelope({ report }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // 9. GET /ctl/session/:id/wait
  app.get('/session/:id/wait', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    const timeoutMs = parseOptionalPositiveIntegerString(c.req.query('timeoutMs'))
    if (timeoutMs === null) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'timeoutMs must be a positive integer when provided.',
        details: {}
      }), 400)
    }
    try {
      const result = await supervisor.waitForSession(caller, id, { timeoutMs })
      return c.json(jsonEnvelope({ result }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // ── Session input (replaces prompt) ──

  // 10. POST /ctl/session/:id/input — requires runtime bridge
  app.post('/session/:id/input', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown }
    const text = typeof body.text === 'string' ? body.text : ''
    try {
      const result = await supervisor.inputSession(caller, id, text)
      return c.json(jsonEnvelope(result))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // ── Session prompt is deleted (breaking change) ──
  // POST /ctl/session/:id/prompt must NOT exist as a success path

  // 11. POST /ctl/session/:id/destroy — requires runtime bridge
  app.post('/session/:id/destroy', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const id = c.req.param('id')
    try {
      requireConnectedBridge(deps)
      await supervisor.destroySession(caller, id)
      return c.json(jsonEnvelope({ kind: 'destroyed' }))
    } catch (error: any) {
      if (error instanceof AppError) throw error
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // 12. POST /ctl/session/create — requires runtime bridge
  app.post('/session/create', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const parentId = typeof body.parentId === 'string' ? body.parentId.trim() : ''
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    const type = typeof body.type === 'string' ? body.type.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const externalSessionId = typeof body.externalSessionId === 'string'
      ? body.externalSessionId.trim()
      : body.externalSessionId === null
        ? null
        : undefined
    const initialCols = parseOptionalPositiveInteger(body.initialCols)
    const initialRows = parseOptionalPositiveInteger(body.initialRows)

    if (!type || !isSessionType(type)) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing or invalid type.',
        details: {}
      }), 400)
    }

    if (initialCols === null || initialRows === null) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'initialCols and initialRows must be positive integers when provided.',
        details: {}
      }), 400)
    }

    if (caller.type === 'local-user') {
      const isRootCreate = !parentId
      if (!projectId) {
        return c.json(jsonEnvelope(null, {
          code: 'invalid_request',
          message: 'Missing projectId.',
          details: {}
        }), 400)
      }
      if (!isRootCreate && !parentId) {
        return c.json(jsonEnvelope(null, {
          code: 'invalid_request',
          message: 'Missing parentId.',
          details: {}
        }), 400)
      }
    }

    if (caller.type === 'local-user' && projectId && !parentId) {
      try {
        requireConnectedBridge(deps)
        const session = await supervisor.createChildSession(caller, {
          parentId,
          projectId,
          type,
          title,
          externalSessionId,
          initialCols,
          initialRows
        })
        return c.json(jsonEnvelope({ session }))
      } catch (error: any) {
        if (error instanceof AppError) throw error
        const status = errorCodeToHttpStatus(error.code)
        return c.json(jsonEnvelope(null, {
          code: error.code,
          message: error.message,
          details: {}
        }), status as 400)
      }
    }

    if (caller.type === 'local-user' && !parentId) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing parentId.',
        details: {}
      }), 400)
    }

    try {
      requireConnectedBridge(deps)
      const session = await supervisor.createChildSession(caller, {
        parentId,
        projectId,
        type,
        title,
        externalSessionId,
        initialCols,
        initialRows
      })
      return c.json(jsonEnvelope({ session }))
    } catch (error: any) {
      if (error instanceof AppError) throw error
      const status = errorCodeToHttpStatus(error.code)
      return c.json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }), status as 400)
    }
  })

  // ── Subagent routes ──

  // 13. GET /ctl/subagent/list
  app.get('/subagent/list', (c) => {
    const caller = c.get('caller') as CallerIdentity
    try {
      const subagents = subagentSupervisor.list(caller)
      return c.json(jsonEnvelope({ subagents }))
    } catch (error: any) {
      return c.json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        details: {}
      }), 500)
    }
  })

  // 14. POST /ctl/subagent/dispatch — requires runtime bridge
  app.post('/subagent/dispatch', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const type = typeof body.type === 'string' ? body.type.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    const name = typeof body.name === 'string' ? body.name.trim() : undefined
    const parentId = typeof body.parentId === 'string' ? body.parentId.trim() : undefined
    const initialCols = parseOptionalPositiveInteger(body.initialCols)
    const initialRows = parseOptionalPositiveInteger(body.initialRows)

    if (!type || !isSessionType(type)) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing or invalid type.',
        nextSteps: null
      }), 400)
    }

    if (initialCols === null || initialRows === null) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'initialCols and initialRows must be positive integers when provided.',
        nextSteps: null
      }), 400)
    }

    try {
      requireConnectedBridge(deps)
      const result = await subagentSupervisor.dispatch(caller, {
        type: type as SessionType,
        text,
        title,
        name,
        parentId,
        initialCols: initialCols ?? undefined,
        initialRows: initialRows ?? undefined
      })
      return c.json(jsonEnvelope(result))
    } catch (error: any) {
      if (error instanceof AppError) throw error
      const status = errorCodeToHttpStatus(error.code)
      const nextSteps = error.code === 'duplicate_subagent_name'
        ? ['Choose a different --name.', 'Run `stoa-ctl subagent list` or `stoa-ctl session list --include-archived` to inspect.']
        : error.code === 'invalid_input_source'
          ? ['Provide exactly one of --text, --file, or --stdin.']
          : null
      return c.json(jsonEnvelope(null, {
        code: error.code ?? 'internal_error',
        message: error.message ?? String(error),
        nextSteps
      }), status as 400)
    }
  })

  // 15. POST /ctl/subagent/wait
  app.post('/subagent/wait', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const targets = body.targets
    const mode = body.mode
    const timeoutMs = body.timeoutMs

    if (!Array.isArray(targets) || targets.length === 0) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'targets must be a non-empty array of subagent names or IDs.',
        nextSteps: null
      }), 400)
    }

    if (mode !== undefined && mode !== 'all' && mode !== 'any') {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'mode must be "all" or "any".',
        nextSteps: null
      }), 400)
    }

    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs < 0)) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'timeoutMs must be a non-negative number.',
        nextSteps: null
      }), 400)
    }

    try {
      const result = await subagentSupervisor.wait(
        caller,
        targets as string[],
        (mode ?? 'all') as 'all' | 'any',
        (timeoutMs as number | null) ?? null
      )
      // wait/stop always return ok:true with aggregate data
      return c.json(jsonEnvelope({ result }))
    } catch (error: any) {
      // Only internal errors reach here; aggregate errors are in the data
      return c.json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        nextSteps: null
      }), 500)
    }
  })

  // 16. POST /ctl/subagent/input — requires runtime bridge
  app.post('/subagent/input', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const target = typeof body.target === 'string' ? body.target.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''

    if (!target) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing target.',
        nextSteps: null
      }), 400)
    }

    try {
      requireConnectedBridge(deps)
      const result = await subagentSupervisor.input(caller, target, text)
      return c.json(jsonEnvelope(result))
    } catch (error: any) {
      if (error instanceof AppError) throw error
      const status = errorCodeToHttpStatus(error.code)
      const nextSteps = error.code === 'unknown_subagent'
        ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with a visible name or formal ID.']
        : error.code === 'ambiguous_subagent_name'
          ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with the formal session ID.']
          : error.code === 'invalid_input_source'
            ? ['Provide exactly one of --text, --file, or --stdin.']
            : null
      return c.json(jsonEnvelope(null, {
        code: error.code ?? 'internal_error',
        message: error.message ?? String(error),
        nextSteps
      }), status as 400)
    }
  })

  // 17. POST /ctl/subagent/stop — requires runtime bridge
  app.post('/subagent/stop', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const targets = body.targets
    const mode = body.mode

    if (!Array.isArray(targets) || targets.length === 0) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'targets must be a non-empty array of subagent names or IDs.',
        nextSteps: null
      }), 400)
    }

    if (mode !== undefined && mode !== 'interrupt' && mode !== 'destroy') {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'mode must be "interrupt" or "destroy".',
        nextSteps: null
      }), 400)
    }

    try {
      requireConnectedBridge(deps)
      const result = await subagentSupervisor.stop(caller, targets as string[], (mode ?? 'interrupt') as 'interrupt' | 'destroy')
      // wait/stop always return ok:true with aggregate data
      return c.json(jsonEnvelope({ result }))
    } catch (error: any) {
      return c.json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        nextSteps: null
      }), 500)
    }
  })

  // 18. POST /ctl/subagent/result
  app.post('/subagent/result', async (c) => {
    const caller = c.get('caller') as CallerIdentity
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const status = typeof body.status === 'string' ? body.status.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''
    const title = typeof body.title === 'string' ? body.title.trim() : undefined

    if (!status) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing status.',
        nextSteps: null
      }), 400)
    }

    const validStatuses = ['completed', 'failed', 'blocked', 'cancelled']
    if (!validStatuses.includes(status)) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_result_status',
        message: `Invalid result status: ${status}. Use completed, failed, blocked, or cancelled.`,
        nextSteps: ['Use completed, failed, blocked, or cancelled.']
      }), 400)
    }

    try {
      const result = await subagentSupervisor.result(caller, {
        status: status as 'completed' | 'failed' | 'blocked' | 'cancelled',
        text,
        title
      })
      return c.json(jsonEnvelope({ result }))
    } catch (error: any) {
      const httpStatus = errorCodeToHttpStatus(error.code)
      const nextSteps = error.code === 'subagent_result_forbidden'
        ? ['Call subagent result only from the child/subagent session itself.']
        : error.code === 'invalid_input_source'
          ? ['Provide exactly one of --text, --file, or --stdin.']
          : null
      return c.json(jsonEnvelope(null, {
        code: error.code ?? 'internal_error',
        message: error.message ?? String(error),
        nextSteps
      }), httpStatus as 400)
    }
  })

  return app
}
