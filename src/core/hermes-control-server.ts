import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { SessionPresenceSnapshot } from '@shared/observability'
import type { BootstrapState } from '@shared/project-session'
import type { CreateHermesSessionRequest, HermesBootstrapState, HermesSessionSummary } from '@shared/hermes'
import { HermesDispatchError, type HermesCommandDispatcher } from './hermes-command-dispatcher'
import type { HermesContextAssembler } from './hermes-context-assembler'
import type { HermesProposalStore } from './hermes-proposal-store'

interface SnapshotSource {
  snapshot(): BootstrapState
}

interface HermesSessionSource {
  snapshot(): HermesBootstrapState
  getSession(sessionId: string): HermesSessionSummary | null
  createSession(request: CreateHermesSessionRequest): Promise<HermesSessionSummary>
  setActiveSession(sessionId: string): Promise<void>
  closeSession(sessionId: string): Promise<void>
}

interface HermesControlServerOptions {
  getSessionSecret: (sessionId: string) => string | null
  hermesSessionSource: HermesSessionSource
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

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return fallback
  }
  const parsed = Number(value)
  return parsed > 0 ? parsed : fallback
}

function parseBooleanQuery(value: unknown): boolean {
  return value === '1' || value === 'true'
}

function attentionReasonForPresence(presence: SessionPresenceSnapshot): string | null {
  if (presence.phase === 'failure') {
    return presence.failureReason ?? 'failure'
  }
  if (presence.phase === 'complete') {
    return 'turn-complete'
  }
  if (presence.phase === 'blocked') {
    return presence.blockingReason ?? 'blocked'
  }
  if (presence.hasUnreadTurn) {
    return 'unread-turn'
  }
  return null
}

function attentionPriorityForPresence(presence: SessionPresenceSnapshot): number {
  switch (presence.phase) {
    case 'failure':
      return 5
    case 'complete':
    case 'blocked':
      return 4
    case 'running':
      return 1
    default:
      return 0
  }
}

function invalidRequest(response: express.Response, message: string): void {
  response.status(400).json(jsonEnvelope(null, {
    code: 'invalid_request',
    message,
    details: {}
  }))
}

function notFound(response: express.Response, code: string, message: string): void {
  response.status(404).json(jsonEnvelope(null, {
    code,
    message,
    details: {}
  }))
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

  app.get('/ctl/whoami', (request, response) => {
    const hermesSessionId = request.header('x-stoa-session-id')!
    const session = options.hermesSessionSource.getSession(hermesSessionId)
    if (!session) {
      notFound(response, 'unknown_session', `Unknown Hermes session: ${hermesSessionId}`)
      return
    }

    response.json(jsonEnvelope({
      sessionId: session.id,
      title: session.title,
      status: session.status,
      capabilityLevel: session.capabilityLevel,
      pendingProposalCount: session.pendingProposalCount,
      activeTargetCount: session.activeTargetCount,
      lastSummary: session.lastSummary
    }))
  })

  app.get('/ctl/capabilities', (request, response) => {
    const hermesSessionId = request.header('x-stoa-session-id')!
    const session = options.hermesSessionSource.getSession(hermesSessionId)
    if (!session) {
      notFound(response, 'unknown_session', `Unknown Hermes session: ${hermesSessionId}`)
      return
    }

    response.json(jsonEnvelope({
      capabilityLevel: session.capabilityLevel,
      controlTransport: 'loopback-http',
      supports: {
        health: true,
        workSessionList: true,
        workSessionContext: true,
        workSessionPrompt: true,
        hermesSessionManage: true,
        proposalDispatch: true
      },
      requiresApproval: {
        freeformPrompt: true
      }
    }))
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

  app.get('/ctl/state/attention-queue', (_request, response) => {
    const snapshot = options.snapshotSource.snapshot()
    const sessionsNeedingAttention = snapshot.sessions
      .filter((session) => !session.archived)
      .map((session) => {
        const presence = options.getSessionPresence(session.id)
        if (!presence) {
          return null
        }
        const attentionReason = attentionReasonForPresence(presence)
        if (!attentionReason) {
          return null
        }
        return {
          sessionId: session.id,
          projectId: session.projectId,
          title: session.title,
          phase: presence.phase,
          attentionReason,
          updatedAt: presence.updatedAt
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => {
        const leftPresence = options.getSessionPresence(left.sessionId)!
        const rightPresence = options.getSessionPresence(right.sessionId)!
        const priority = attentionPriorityForPresence(rightPresence) - attentionPriorityForPresence(leftPresence)
        if (priority !== 0) {
          return priority
        }
        return right.updatedAt.localeCompare(left.updatedAt)
      })

    response.json(jsonEnvelope({
      sessions: sessionsNeedingAttention
    }))
  })

  app.get('/ctl/state/conflicts', (_request, response) => {
    response.json(jsonEnvelope({
      conflicts: []
    }))
  })

  app.get('/ctl/work-sessions', (_request, response) => {
    const snapshot = options.snapshotSource.snapshot()
    response.json(jsonEnvelope({
      activeProjectId: snapshot.activeProjectId,
      activeSessionId: snapshot.activeSessionId,
      sessions: snapshot.sessions
        .filter((session) => !session.archived)
        .map((session) => ({
          ...session,
          presence: options.getSessionPresence(session.id)
        }))
    }))
  })

  app.get('/ctl/work-sessions/:sessionId', (request, response) => {
    try {
      response.json(jsonEnvelope(options.contextAssembler.getStatus(request.params.sessionId)))
    } catch (error) {
      notFound(
        response,
        'unknown_session',
        error instanceof Error ? error.message : `Unknown session: ${request.params.sessionId}`
      )
    }
  })

  app.get('/ctl/work-sessions/:sessionId/events', (request, response) => {
    try {
      response.json(jsonEnvelope(options.contextAssembler.getEvents(request.params.sessionId, {
        limit: parsePositiveInt(request.query.limit, 50),
        cursor: typeof request.query.cursor === 'string' ? request.query.cursor : undefined,
        includeEphemeral: parseBooleanQuery(request.query.includeEphemeral)
      })))
    } catch (error) {
      notFound(
        response,
        'unknown_session',
        error instanceof Error ? error.message : `Unknown session: ${request.params.sessionId}`
      )
    }
  })

  app.get('/ctl/work-sessions/:sessionId/context', async (request, response) => {
    const level = typeof request.query.level === 'string' ? request.query.level : 'status'
    const sessionId = request.params.sessionId

    try {
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
    } catch (error) {
      notFound(
        response,
        'unknown_session',
        error instanceof Error ? error.message : `Unknown session: ${request.params.sessionId}`
      )
    }
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

  app.get('/ctl/hermes-sessions', (_request, response) => {
    const snapshot = options.hermesSessionSource.snapshot()
    response.json(jsonEnvelope({
      activeHermesSessionId: snapshot.activeHermesSessionId,
      sessions: snapshot.sessions
    }))
  })

  app.post('/ctl/hermes-sessions', async (request, response) => {
    const title = typeof request.body?.title === 'string' ? request.body.title.trim() : ''
    const capabilityLevel = request.body?.capabilityLevel

    if (!title) {
      invalidRequest(response, 'Missing Hermes session title.')
      return
    }

    if (![0, 1, 2, 3].includes(capabilityLevel)) {
      invalidRequest(response, 'Invalid capabilityLevel.')
      return
    }

    const created = await options.hermesSessionSource.createSession({
      title,
      capabilityLevel
    })
    response.json(jsonEnvelope(created))
  })

  app.get('/ctl/hermes-sessions/:sessionId', (request, response) => {
    const session = options.hermesSessionSource.getSession(request.params.sessionId)
    if (!session) {
      notFound(response, 'unknown_session', `Unknown Hermes session: ${request.params.sessionId}`)
      return
    }
    response.json(jsonEnvelope({ session }))
  })

  app.post('/ctl/hermes-sessions/:sessionId/activate', async (request, response) => {
    const session = options.hermesSessionSource.getSession(request.params.sessionId)
    if (!session) {
      notFound(response, 'unknown_session', `Unknown Hermes session: ${request.params.sessionId}`)
      return
    }
    await options.hermesSessionSource.setActiveSession(request.params.sessionId)
    response.json(jsonEnvelope({
      activeHermesSessionId: request.params.sessionId
    }))
  })

  app.post('/ctl/hermes-sessions/:sessionId/close', async (request, response) => {
    const session = options.hermesSessionSource.getSession(request.params.sessionId)
    if (!session) {
      notFound(response, 'unknown_session', `Unknown Hermes session: ${request.params.sessionId}`)
      return
    }
    await options.hermesSessionSource.closeSession(request.params.sessionId)
    response.json(jsonEnvelope({
      session: options.hermesSessionSource.getSession(request.params.sessionId)
    }))
  })

  app.get('/ctl/proposals', (_request, response) => {
    response.json(jsonEnvelope(options.proposals.list()))
  })

  app.post('/ctl/proposals', async (request, response) => {
    const kind = request.body?.kind
    if (kind !== 'prompt') {
      invalidRequest(response, 'Unsupported proposal kind.')
      return
    }

    const targetSessionId = typeof request.body?.targetSessionId === 'string' ? request.body.targetSessionId : ''
    const text = typeof request.body?.text === 'string' ? request.body.text : ''
    if (!targetSessionId || !text.trim()) {
      invalidRequest(response, 'Missing targetSessionId or text.')
      return
    }

    try {
      const proposal = await options.dispatcher.createPromptProposal({
        hermesSessionId: request.header('x-stoa-session-id')!,
        targetSessionId,
        text
      })
      response.json(jsonEnvelope(proposal))
    } catch (error) {
      response.status(getErrorStatus(error)).json(jsonEnvelope(null, getErrorBody(error)))
    }
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

  app.post('/ctl/dispatch/preset/:presetName', async (request, response) => {
    const targetSessionId = typeof request.body?.targetSessionId === 'string' ? request.body.targetSessionId : ''
    if (!targetSessionId) {
      invalidRequest(response, 'Missing targetSessionId.')
      return
    }

    try {
      response.json(jsonEnvelope(await options.dispatcher.dispatchPreset({
        hermesSessionId: request.header('x-stoa-session-id')!,
        targetSessionId,
        presetName: request.params.presetName as 'run-tests-only' | 'summarize-failures' | 'pause-and-generate-summary'
      })))
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
