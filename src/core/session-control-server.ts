import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { SessionNodeSnapshot, SessionSummary, SessionType } from '@shared/project-session'
import type { SessionSupervisorDeps } from './session-supervisor'
import { SessionSupervisor, type CallerIdentity, type CreateChildSessionRequest } from './session-supervisor'

export interface SessionControlServerDeps extends SessionSupervisorDeps {
  ctlSecret?: string
  sessionTokenRegistry: Map<string, string>
}

function jsonEnvelope(data: unknown, error: unknown = null) {
  return { ok: error === null, data, error }
}

const SESSION_TYPES: SessionType[] = ['shell', 'opencode', 'codex', 'claude-code']

function isSessionType(value: string): value is SessionType {
  return SESSION_TYPES.includes(value as SessionType)
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

export function createSessionControlServer(deps: SessionControlServerDeps): {
  app: Express
  start: () => Promise<number>
  stop: () => Promise<void>
} {
  const supervisor = new SessionSupervisor(deps)
  const app = express()
  app.use(express.json())

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

  app.get('/ctl/capabilities', (_req, res) => {
    res.json(jsonEnvelope({
      controlTransport: 'loopback-http',
      supports: {
        health: true,
        sessionList: true,
        sessionInspect: true,
        sessionPrompt: true,
        sessionCreate: true,
        sessionDestroy: true
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

  app.post('/ctl/session/:id/prompt', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    try {
      const result = await supervisor.promptSession(caller, req.params.id, text)
      res.json(jsonEnvelope(result))
    } catch (error: any) {
      if (error.code === 'unknown_session') {
        res.status(404).json(jsonEnvelope(null, {
          code: 'unknown_session',
          message: error.message,
          details: {}
        }))
        return
      }
      if (error.code === 'forbidden_authority_scope') {
        res.status(403).json(jsonEnvelope(null, {
          code: 'forbidden_authority_scope',
          message: error.message,
          details: {}
        }))
        return
      }
      res.status(500).json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        details: {}
      }))
    }
  })

  app.post('/ctl/session/:id/destroy', async (req, res) => {
    const caller = (req as any)._caller as CallerIdentity
    try {
      await supervisor.destroySession(caller, req.params.id)
      res.json(jsonEnvelope({ kind: 'destroyed' }))
    } catch (error: any) {
      if (error.code === 'forbidden_authority_scope') {
        res.status(403).json(jsonEnvelope(null, {
          code: 'forbidden_authority_scope',
          message: error.message,
          details: {}
        }))
        return
      }
      if (error.code === 'unknown_session') {
        res.status(404).json(jsonEnvelope(null, {
          code: 'unknown_session',
          message: error.message,
          details: {}
        }))
        return
      }
      res.status(500).json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
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

    if (!type || !isSessionType(type)) {
      res.status(400).json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: 'Missing or invalid type.',
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
        const session = await supervisor.createChildSession(caller, { parentId, projectId, type, title })
        res.json(jsonEnvelope({ session }))
        return
      } catch (error: any) {
        if (error.code === 'unknown_session') {
          res.status(404).json(jsonEnvelope(null, {
            code: 'unknown_session',
            message: error.message,
            details: {}
          }))
          return
        }
        if (error.code === 'forbidden_authority_scope') {
          res.status(403).json(jsonEnvelope(null, {
            code: 'forbidden_authority_scope',
            message: error.message,
            details: {}
          }))
          return
        }
        res.status(500).json(jsonEnvelope(null, {
          code: 'internal_error',
          message: error.message ?? String(error),
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
      const session = await supervisor.createChildSession(caller, { parentId, projectId, type, title })
      res.json(jsonEnvelope({ session }))
    } catch (error: any) {
      if (error.code === 'unknown_session') {
        res.status(404).json(jsonEnvelope(null, {
          code: 'unknown_session',
          message: error.message,
          details: {}
        }))
        return
      }
      if (error.code === 'forbidden_authority_scope') {
        res.status(403).json(jsonEnvelope(null, {
          code: 'forbidden_authority_scope',
          message: error.message,
          details: {}
        }))
        return
      }
      res.status(500).json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error.message ?? String(error),
        details: {}
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
