import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { SessionPresenceSnapshot } from '@shared/observability'
import type { BootstrapState } from '@shared/project-session'
import { HermesDispatchError, type HermesCommandDispatcher } from './hermes-command-dispatcher'
import type { HermesContextAssembler } from './hermes-context-assembler'
import type { HermesProposalStore } from './hermes-proposal-store'

interface SnapshotSource {
  snapshot(): BootstrapState
}

interface HermesControlServerOptions {
  getSessionSecret: (sessionId: string) => string | null
  snapshotSource: SnapshotSource
  getSessionPresence: (sessionId: string) => SessionPresenceSnapshot | null
  contextAssembler: HermesContextAssembler
  dispatcher: HermesCommandDispatcher
  proposals: HermesProposalStore
  app?: Express
}

function jsonEnvelope(data: unknown, error: unknown = null) {
  return {
    ok: error === null,
    data,
    error
  }
}

function getErrorStatus(error: unknown): number {
  if (error instanceof HermesDispatchError) {
    if (error.code === 'unknown_session' || error.code === 'unknown_proposal') {
      return 404
    }

    if (error.code === 'stale_proposal') {
      return 409
    }

    if (error.code === 'proposal_not_approved' || error.code === 'proposal_invalid') {
      return 400
    }
  }

  return 500
}

function getErrorBody(error: unknown): { code: string; message: string; details: Record<string, unknown> } {
  if (error instanceof HermesDispatchError) {
    return {
      code: error.code,
      message: error.message,
      details: {}
    }
  }

  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    details: {}
  }
}

function authorize(
  getSessionSecret: (sessionId: string) => string | null,
  sessionId: string | undefined,
  providedSecret: string | undefined
): boolean {
  if (!sessionId || !providedSecret) {
    return false
  }

  const expectedSecret = getSessionSecret(sessionId)
  return !!expectedSecret && expectedSecret === providedSecret
}

export function createHermesControlServer(options: HermesControlServerOptions): {
  app: Express
  start: () => Promise<number>
  stop: () => Promise<void>
} {
  const app = options.app ?? express()
  app.use(express.json())

  app.use('/ctl', (request, response, next) => {
    const sessionId = request.header('x-stoa-session-id') ?? undefined
    const secret = request.header('x-stoa-secret') ?? undefined
    if (!authorize(options.getSessionSecret, sessionId, secret)) {
      response.status(401).json(jsonEnvelope(null, {
        code: 'invalid_secret',
        message: 'Invalid Hermes control credentials.',
        details: {}
      }))
      return
    }
    next()
  })

  app.get('/ctl/health', (_request, response) => {
    response.json(jsonEnvelope({ ok: true }))
  })

  app.get('/ctl/state/brief', (_request, response) => {
    const snapshot = options.snapshotSource.snapshot()
    const sessions = snapshot.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      type: session.type,
      presence: options.getSessionPresence(session.id)?.phase ?? session.runtimeState,
      summary: session.summary
    }))

    response.json(jsonEnvelope({
      activeProjectId: snapshot.activeProjectId,
      activeSessionId: snapshot.activeSessionId,
      sessions
    }))
  })

  app.get('/ctl/work-sessions/:sessionId/context', async (request, response) => {
    const level = typeof request.query.level === 'string' ? request.query.level : 'status'
    const sessionId = request.params.sessionId

    if (level === 'full') {
      const result = await options.contextAssembler.getFullContext(sessionId, {
        maxChars: request.query.maxChars ? Number(request.query.maxChars) : undefined,
        cursor: typeof request.query.cursor === 'string' ? request.query.cursor : null
      })
      response.type('text/plain; charset=utf-8').send(result.text)
      return
    }

    if (level === 'bundle') {
      response.json(jsonEnvelope(options.contextAssembler.getBundle(sessionId)))
      return
    }

    response.json(jsonEnvelope(options.contextAssembler.getStatus(sessionId)))
  })

  app.post('/ctl/work-sessions/:sessionId/prompt', async (request, response) => {
    try {
      const hermesSessionId = request.header('x-stoa-session-id')!
      const text = typeof request.body?.text === 'string' ? request.body.text : ''
      const result = await options.dispatcher.promptWorkSession({
        hermesSessionId,
        targetSessionId: request.params.sessionId,
        text
      })

      const statusCode = result.kind === 'approval_required' ? 409 : 200
      response.status(statusCode).json(jsonEnvelope(result.kind === 'approval_required' ? null : result, result.kind === 'approval_required'
        ? {
            code: 'approval_required',
            message: 'Prompt injection requires approval.',
            details: { proposal: result.proposal }
          }
        : null))
    } catch (error) {
      response.status(getErrorStatus(error)).json(jsonEnvelope(null, getErrorBody(error)))
    }
  })

  app.get('/ctl/proposals', (_request, response) => {
    response.json(jsonEnvelope(options.proposals.list()))
  })

  app.get('/ctl/proposals/:proposalId', (request, response) => {
    response.json(jsonEnvelope(options.proposals.get(request.params.proposalId)))
  })

  app.post('/ctl/proposals/:proposalId/approve', async (request, response) => {
    const proposal = await options.proposals.markApproved(request.params.proposalId)
    if (!proposal) {
      response.status(404).json(jsonEnvelope(null, {
        code: 'unknown_proposal',
        message: `Unknown proposal: ${request.params.proposalId}`,
        details: {}
      }))
      return
    }
    response.json(jsonEnvelope(proposal))
  })

  app.post('/ctl/proposals/:proposalId/reject', async (request, response) => {
    const reason = typeof request.body?.reason === 'string' && request.body.reason.trim().length > 0
      ? request.body.reason
      : 'Proposal rejected.'
    const proposal = await options.proposals.markRejected(request.params.proposalId, reason)
    if (!proposal) {
      response.status(404).json(jsonEnvelope(null, {
        code: 'unknown_proposal',
        message: `Unknown proposal: ${request.params.proposalId}`,
        details: {}
      }))
      return
    }
    response.json(jsonEnvelope(proposal))
  })

  app.post('/ctl/dispatch/proposal/:proposalId', async (request, response) => {
    try {
      response.json(jsonEnvelope(await options.dispatcher.dispatchProposal(request.params.proposalId)))
    } catch (error) {
      response.status(getErrorStatus(error)).json(jsonEnvelope(null, getErrorBody(error)))
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
