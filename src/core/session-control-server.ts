import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { SessionNodeSnapshot, SessionSummary, SessionType } from '@shared/project-session'
import type { SessionSupervisorDeps } from './session-supervisor'
import { SessionSupervisor, type CallerIdentity, type CreateChildSessionRequest } from './session-supervisor'
import { SubagentSupervisor, type SubagentSupervisorDeps } from './subagent-supervisor'

export interface SessionControlServerDeps extends SessionSupervisorDeps, SubagentSupervisorDeps {
  ctlSecret?: string
  sessionTokenRegistry: Map<string, string>
  isCtlEnabled?: () => boolean
}

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
  deps: SessionControlServerDeps
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

export function createSessionControlServer(deps: SessionControlServerDeps): {
  app: Express
  start: () => Promise<number>
  stop: () => Promise<void>
} {
  const supervisor = new SessionSupervisor(deps)
  const subagentSupervisor = new SubagentSupervisor(deps)
  const isCtlEnabled = deps.isCtlEnabled ?? (() => true)
  const app = express()
  app.use(express.json())

  app.use('/ctl', (req, res, next) => {
    if (!isCtlEnabled()) {
      res.status(503).json(jsonEnvelope(null, {
        code: 'disabled',
        message: 'stoa-ctl is disabled in settings',
        details: {}
      }))
      return
    }
    next()
  })

  app.use('/ctl', (req, res, next) => {
    const caller = resolveCaller({
      'x-stoa-secret': req.header('x-stoa-secret') ?? undefined,
      'x-stoa-session-id': req.header('x-stoa-session-id') ?? undefined,
      'x-stoa-session-token': req.header('x-stoa-session-token') ?? undefined
    }, deps)

    if (!caller) {
      res.status(401).json(jsonEnvelope(null, {
        code: 'invalid_secret',
        message: 'Invalid control credentials.',
        details: {}
      }))
      return
    }

    ;(req as any)._caller = caller
    next()
  })

  app.get('/ctl/health', (_req, res) => {
    res.json(jsonEnvelope({ ok: true }))
  })

  app.get('/ctl/whoami', (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    if (caller.type === 'local-user') {
      res.json(jsonEnvelope({ caller: 'local-user' }))
    } else {
      res.json(jsonEnvelope({ caller: 'session', sessionId: caller.sessionId }))
    }
  })

  app.get('/ctl/capabilities', (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const isChildSession = caller.type === 'session'
      ? !!deps.getSnapshot().find(n => n.session.id === caller.sessionId && n.session.parentSessionId !== null)
      : false

    res.json(jsonEnvelope({
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

  app.get('/ctl/session/list', (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const nodes = supervisor.listSessions(caller)
    res.json(jsonEnvelope({ nodes }))
  })

  app.get('/ctl/session/:id/inspect', (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const node = supervisor.inspectSession(caller, req.params.id)
    if (!node) {
      res.status(404).json(jsonEnvelope(null, {
        code: 'unknown_session',
        message: `Unknown session: ${req.params.id}`,
        details: {}
      }))
      return
    }
    res.json(jsonEnvelope({ node }))
  })

  app.get('/ctl/session/:id/status', (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    try {
      const status = supervisor.getSessionStatus(caller, req.params.id)
      res.json(jsonEnvelope({ status }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  app.get('/ctl/session/:id/output', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    try {
      const output = await supervisor.getSessionOutput(caller, req.params.id)
      res.json(jsonEnvelope({ output }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  app.get('/ctl/session/:id/completion-report', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    try {
      const report = await supervisor.getCompletionReport(caller, req.params.id)
      res.json(jsonEnvelope({ report }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  app.get('/ctl/session/:id/wait', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const timeoutMs = parseOptionalPositiveIntegerString(req.query.timeoutMs)
    if (timeoutMs === null) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'timeoutMs must be a positive integer when provided.',
        details: {}
      }))
      return
    }
    try {
      const result = await supervisor.waitForSession(caller, req.params.id, {
        timeoutMs
      })
      res.json(jsonEnvelope({ result }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  // ── Session input (replaces prompt) ──

  app.post('/ctl/session/:id/input', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    try {
      const result = await supervisor.inputSession(caller, req.params.id, text)
      res.json(jsonEnvelope(result))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  // ── Session prompt is deleted (breaking change) ──
  // POST /ctl/session/:id/prompt must NOT exist as a success path

  app.post('/ctl/session/:id/destroy', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    try {
      await supervisor.destroySession(caller, req.params.id)
      res.json(jsonEnvelope({ kind: 'destroyed' }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  app.post('/ctl/session/create', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : ''
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : ''
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : ''
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const externalSessionId = typeof req.body?.externalSessionId === 'string'
      ? req.body.externalSessionId.trim()
      : req.body?.externalSessionId === null
        ? null
        : undefined
    const initialCols = parseOptionalPositiveInteger(req.body?.initialCols)
    const initialRows = parseOptionalPositiveInteger(req.body?.initialRows)

    if (!type || !isSessionType(type)) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing or invalid type.',
        details: {}
      }))
      return
    }

    if (initialCols === null || initialRows === null) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'initialCols and initialRows must be positive integers when provided.',
        details: {}
      }))
      return
    }

    if (caller.type === 'local-user') {
      const isRootCreate = !parentId
      if (!projectId) {
        res.status(400).json(jsonEnvelope(null, {
          code: 'invalid_request',
          message: 'Missing projectId.',
          details: {}
        }))
        return
      }
      if (!isRootCreate && !parentId) {
        res.status(400).json(jsonEnvelope(null, {
          code: 'invalid_request',
          message: 'Missing parentId.',
          details: {}
        }))
        return
      }
    }

    if (caller.type === 'local-user' && projectId && !parentId) {
      try {
        const session = await supervisor.createChildSession(caller, {
          parentId,
          projectId,
          type,
          title,
          externalSessionId,
          initialCols,
          initialRows
        })
        res.json(jsonEnvelope({ session }))
        return
      } catch (error: any) {
        const status = errorCodeToHttpStatus(error.code)
        res.status(status).json(jsonEnvelope(null, {
          code: error.code,
          message: error.message,
          details: {}
        }))
        return
      }
    }

    if (caller.type === 'local-user' && !parentId) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing parentId.',
        details: {}
      }))
      return
    }

    try {
      const session = await supervisor.createChildSession(caller, {
        parentId,
        projectId,
        type,
        title,
        externalSessionId,
        initialCols,
        initialRows
      })
      res.json(jsonEnvelope({ session }))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      res.status(status).json(jsonEnvelope(null, {
        code: error.code,
        message: error.message,
        details: {}
      }))
    }
  })

  // ── Subagent routes ──

  app.get('/ctl/subagent/list', (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    try {
      const subagents = subagentSupervisor.list(caller)
      res.json(jsonEnvelope({ subagents }))
    } catch (error: any) {
      res.status(500).json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        details: {}
      }))
    }
  })

  app.post('/ctl/subagent/dispatch', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId.trim() : undefined
    const initialCols = parseOptionalPositiveInteger(req.body?.initialCols)
    const initialRows = parseOptionalPositiveInteger(req.body?.initialRows)

    if (!type || !isSessionType(type)) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing or invalid type.',
        nextSteps: null
      }))
      return
    }

    if (initialCols === null || initialRows === null) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'initialCols and initialRows must be positive integers when provided.',
        nextSteps: null
      }))
      return
    }

    try {
      const result = await subagentSupervisor.dispatch(caller, {
        type: type as SessionType,
        text,
        title,
        name,
        parentId,
        initialCols: initialCols ?? undefined,
        initialRows: initialRows ?? undefined
      })
      res.json(jsonEnvelope(result))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      const nextSteps = error.code === 'duplicate_subagent_name'
        ? ['Choose a different --name.', 'Run `stoa-ctl subagent list` or `stoa-ctl session list --include-archived` to inspect.']
        : error.code === 'invalid_input_source'
          ? ['Provide exactly one of --text, --file, or --stdin.']
          : null
      res.status(status).json(jsonEnvelope(null, {
        code: error.code ?? 'internal_error',
        message: error.message ?? String(error),
        nextSteps
      }))
    }
  })

  app.post('/ctl/subagent/wait', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const targets = req.body?.targets
    const mode = req.body?.mode
    const timeoutMs = req.body?.timeoutMs

    if (!Array.isArray(targets) || targets.length === 0) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'targets must be a non-empty array of subagent names or IDs.',
        nextSteps: null
      }))
      return
    }

    if (mode !== undefined && mode !== 'all' && mode !== 'any') {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'mode must be "all" or "any".',
        nextSteps: null
      }))
      return
    }

    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs < 0)) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'timeoutMs must be a non-negative number.',
        nextSteps: null
      }))
      return
    }

    try {
      const result = await subagentSupervisor.wait(
        caller,
        targets,
        mode ?? 'all',
        timeoutMs ?? null
      )
      // wait/stop always return ok:true with aggregate data
      res.json(jsonEnvelope({ result }))
    } catch (error: any) {
      // Only internal errors reach here; aggregate errors are in the data
      res.status(500).json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        nextSteps: null
      }))
    }
  })

  app.post('/ctl/subagent/input', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const target = typeof req.body?.target === 'string' ? req.body.target.trim() : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : ''

    if (!target) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing target.',
        nextSteps: null
      }))
      return
    }

    try {
      const result = await subagentSupervisor.input(caller, target, text)
      res.json(jsonEnvelope(result))
    } catch (error: any) {
      const status = errorCodeToHttpStatus(error.code)
      const nextSteps = error.code === 'unknown_subagent'
        ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with a visible name or formal ID.']
        : error.code === 'ambiguous_subagent_name'
          ? ['Run `stoa-ctl subagent list` to see available subagents.', 'Retry with the formal session ID.']
          : error.code === 'invalid_input_source'
            ? ['Provide exactly one of --text, --file, or --stdin.']
            : null
      res.status(status).json(jsonEnvelope(null, {
        code: error.code ?? 'internal_error',
        message: error.message ?? String(error),
        nextSteps
      }))
    }
  })

  app.post('/ctl/subagent/stop', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const targets = req.body?.targets
    const mode = req.body?.mode

    if (!Array.isArray(targets) || targets.length === 0) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'targets must be a non-empty array of subagent names or IDs.',
        nextSteps: null
      }))
      return
    }

    if (mode !== undefined && mode !== 'interrupt' && mode !== 'destroy') {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'mode must be "interrupt" or "destroy".',
        nextSteps: null
      }))
      return
    }

    try {
      const result = await subagentSupervisor.stop(caller, targets, mode ?? 'interrupt')
      // wait/stop always return ok:true with aggregate data
      res.json(jsonEnvelope({ result }))
    } catch (error: any) {
      res.status(500).json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        nextSteps: null
      }))
    }
  })

  app.post('/ctl/subagent/result', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined

    if (!status) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing status.',
        nextSteps: null
      }))
      return
    }

    const validStatuses = ['completed', 'failed', 'blocked', 'cancelled']
    if (!validStatuses.includes(status)) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_result_status',
        message: `Invalid result status: ${status}. Use completed, failed, blocked, or cancelled.`,
        nextSteps: ['Use completed, failed, blocked, or cancelled.']
      }))
      return
    }

    try {
      const result = await subagentSupervisor.result(caller, {
        status: status as 'completed' | 'failed' | 'blocked' | 'cancelled',
        text,
        title
      })
      res.json(jsonEnvelope({ result }))
    } catch (error: any) {
      const httpStatus = errorCodeToHttpStatus(error.code)
      const nextSteps = error.code === 'subagent_result_forbidden'
        ? ['Call subagent result only from the child/subagent session itself.']
        : error.code === 'invalid_input_source'
          ? ['Provide exactly one of --text, --file, or --stdin.']
          : null
      res.status(httpStatus).json(jsonEnvelope(null, {
        code: error.code ?? 'internal_error',
        message: error.message ?? String(error),
        nextSteps
      }))
    }
  })

  let server: import('node:http').Server | null = null
  return {
    app,
    async start() {
      if (server) {
        return (server.address() as AddressInfo).port
      }
      server = await new Promise<import('node:http').Server>((resolve) => {
        const started = app.listen(0, '127.0.0.1', () => resolve(started))
      })
      return (server.address() as AddressInfo).port
    },
    async stop() {
      if (!server) return
      const active = server
      server = null
      await new Promise<void>((resolve, reject) => {
        active.close((error) => {
          if (error) { reject(error); return }
          resolve()
        })
      })
    }
  }
}
