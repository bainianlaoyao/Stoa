/**
 * Meta-session control routes — Hono port of the legacy Express server.
 *
 * Skips GET /ctl/health (handled by main health).
 * Preserves validation, error handling, and response envelope from the
 * original Express implementation. All service methods are injected via
 * the `createMetaControlRoutes` factory so the router is fully decoupled
 * from concrete service wiring.
 */
import { Hono } from 'hono'
import type {
  BootstrapState,
  CreateSessionRequest,
  SessionSummary,
  SessionType
} from 'stoa-shared'
import type { SessionPresenceSnapshot } from 'stoa-shared'
import type {
  CreateMetaSessionRequest,
  MetaSessionBootstrapState,
  MetaSessionSummary
} from 'stoa-shared'
import { MetaSessionDispatchError, type MetaSessionCommandDispatcher } from '../services/meta-session-dispatcher'
import type { MetaSessionContextAssembler } from '../services/meta-session-context'
import type { MetaSessionProposalStore } from '../services/meta-session-proposal'
import { META_SESSION_BOOTSTRAP_PROMPT } from '../services/meta-session-bootstrap'
import { AppError } from '../shared/errors'

// ---------------------------------------------------------------------------
// Dependency interfaces
// ---------------------------------------------------------------------------

interface SnapshotSource {
  snapshot(): BootstrapState
}

interface MetaSessionSource {
  snapshot(): MetaSessionBootstrapState
  getSession(sessionId: string): MetaSessionSummary | null
  createSession(request: CreateMetaSessionRequest): Promise<MetaSessionSummary>
  setActiveSession(sessionId: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  restoreSession(sessionId: string): Promise<void>
}

interface WorkSessionLifecycle {
  createSession(request: CreateSessionRequest): Promise<SessionSummary>
  archiveSession(sessionId: string): Promise<SessionSummary | null>
}

export interface MetaControlDeps {
  metaSessionSource: MetaSessionSource
  snapshotSource: SnapshotSource
  getSessionPresence: (sessionId: string) => SessionPresenceSnapshot | null
  contextAssembler: MetaSessionContextAssembler
  dispatcher: MetaSessionCommandDispatcher
  proposals: MetaSessionProposalStore
  workSessionLifecycle: WorkSessionLifecycle
  ctlSecret?: string
}

// ---------------------------------------------------------------------------
// Helpers — JSON envelope and error mapping
// ---------------------------------------------------------------------------

function jsonEnvelope(data: unknown, error: unknown = null) {
  return {
    ok: error === null,
    data,
    error
  }
}

function getErrorStatus(error: unknown): number {
  if (error instanceof MetaSessionDispatchError) {
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
  if (error instanceof MetaSessionDispatchError) {
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
  metaSessionSource: MetaSessionSource,
  sessionId: string | undefined,
  secret: string | undefined,
  expectedSecret: string | undefined
): boolean {
  if (expectedSecret && secret === expectedSecret) {
    return true
  }
  if (!sessionId) {
    return false
  }
  return metaSessionSource.getSession(sessionId) !== null
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

function invalidRequest(message: string): never {
  throw new AppError({
    code: 'invalid_request' as never,
    message,
    statusCode: 400,
    details: {}
  })
}

function notFound(code: string, message: string): never {
  throw new AppError({
    code: code as never,
    message,
    statusCode: 404,
    details: {}
  })
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createMetaControlRoutes(deps: MetaControlDeps): Hono {
  const app = new Hono()

  // Authorize each /ctl request — preserve legacy secret-or-session model
  app.use('*', async (c, next) => {
    const sessionId = c.req.header('x-stoa-session-id') ?? undefined
    const secret = c.req.header('x-stoa-secret') ?? undefined
    if (!authorize(deps.metaSessionSource, sessionId, secret, deps.ctlSecret)) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_secret',
        message: 'Invalid meta-session control credentials.',
        details: {}
      }), 401)
    }
    await next()
  })

  // 1. GET /ctl/health → skipped (handled by main health route)

  // 2. GET /ctl/bootstrap-prompt
  app.get('/bootstrap-prompt', (c) => {
    return c.text(META_SESSION_BOOTSTRAP_PROMPT, 200, {
      'content-type': 'text/plain; charset=utf-8'
    })
  })

  // 3. GET /ctl/whoami
  app.get('/whoami', (c) => {
    const metaSessionId = c.req.header('x-stoa-session-id')!
    const session = deps.metaSessionSource.getSession(metaSessionId)
    if (!session) {
      notFound('unknown_session', `Unknown meta session: ${metaSessionId}`)
    }

    return c.json(jsonEnvelope({
      sessionId: session.id,
      title: session.title,
      status: session.status,
      capabilityLevel: session.capabilityLevel,
      pendingProposalCount: session.pendingProposalCount,
      activeTargetCount: session.activeTargetCount,
      lastSummary: session.lastSummary
    }))
  })

  // 4. GET /ctl/capabilities
  app.get('/capabilities', (c) => {
    const metaSessionId = c.req.header('x-stoa-session-id')!
    const session = deps.metaSessionSource.getSession(metaSessionId)
    if (!session) {
      notFound('unknown_session', `Unknown meta session: ${metaSessionId}`)
    }

    return c.json(jsonEnvelope({
      capabilityLevel: session.capabilityLevel,
      controlTransport: 'loopback-http',
      supports: {
        health: true,
        workSessionList: true,
        workSessionContext: true,
        workSessionPrompt: true,
        workSessionSendKeys: true,
        metaSessionManage: true,
        proposalDispatch: true
      },
      requiresApproval: {
        freeformPrompt: true
      }
    }))
  })

  // 5. GET /ctl/state/brief
  app.get('/state/brief', (c) => {
    const snapshot = deps.snapshotSource.snapshot()
    const sessions = snapshot.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      type: session.type,
      presence: deps.getSessionPresence(session.id)?.phase ?? session.runtimeState,
      summary: session.summary
    }))

    return c.json(jsonEnvelope({
      activeProjectId: snapshot.activeProjectId,
      activeSessionId: snapshot.activeSessionId,
      sessions
    }))
  })

  // 6. GET /ctl/state/attention-queue
  app.get('/state/attention-queue', (c) => {
    const snapshot = deps.snapshotSource.snapshot()
    const sessionsNeedingAttention = snapshot.sessions
      .filter((session) => !session.archived)
      .map((session) => {
        const presence = deps.getSessionPresence(session.id)
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
        const leftPresence = deps.getSessionPresence(left.sessionId)!
        const rightPresence = deps.getSessionPresence(right.sessionId)!
        const priority = attentionPriorityForPresence(rightPresence) - attentionPriorityForPresence(leftPresence)
        if (priority !== 0) {
          return priority
        }
        return right.updatedAt.localeCompare(left.updatedAt)
      })

    return c.json(jsonEnvelope({
      sessions: sessionsNeedingAttention
    }))
  })

  // 7. GET /ctl/state/conflicts
  app.get('/state/conflicts', (c) => {
    return c.json(jsonEnvelope({
      conflicts: []
    }))
  })

  // 8. GET /ctl/work-sessions
  app.get('/work-sessions', (c) => {
    const snapshot = deps.snapshotSource.snapshot()
    return c.json(jsonEnvelope({
      activeProjectId: snapshot.activeProjectId,
      activeSessionId: snapshot.activeSessionId,
      sessions: snapshot.sessions
        .filter((session) => !session.archived)
        .map((session) => ({
          ...session,
          presence: deps.getSessionPresence(session.id)
        }))
    }))
  })

  // 9. POST /ctl/work-sessions
  app.post('/work-sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    const type = typeof body.type === 'string' ? body.type : ''
    const title = typeof body.title === 'string' ? body.title.trim() : undefined

    if (!projectId) {
      invalidRequest('Missing projectId.')
    }

    if (!['shell', 'opencode', 'codex', 'claude-code'].includes(type)) {
      invalidRequest('Invalid session type.')
    }

    try {
      const created = await deps.workSessionLifecycle.createSession({
        projectId,
        type: type as SessionType,
        title: title ?? ''
      })
      return c.json(jsonEnvelope(created))
    } catch (error) {
      return c.json(jsonEnvelope(null, {
        code: 'invalid_request',
        message: error instanceof Error ? error.message : String(error),
        details: {}
      }), 400)
    }
  })

  // 10. GET /ctl/work-sessions/:sessionId
  app.get('/work-sessions/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId')
    try {
      return c.json(jsonEnvelope(deps.contextAssembler.getStatus(sessionId)))
    } catch (error) {
      notFound(
        'unknown_session',
        error instanceof Error ? error.message : `Unknown session: ${sessionId}`
      )
    }
  })

  // 11. POST /ctl/work-sessions/:sessionId/archive
  app.post('/work-sessions/:sessionId/archive', async (c) => {
    const sessionId = c.req.param('sessionId')
    try {
      const archived = await deps.workSessionLifecycle.archiveSession(sessionId)
      if (!archived) {
        notFound('unknown_session', `Unknown work session: ${sessionId}`)
      }

      return c.json(jsonEnvelope({
        session: archived
      }))
    } catch (error) {
      return c.json(jsonEnvelope(null, {
        code: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
        details: {}
      }), 500)
    }
  })

  // 12. GET /ctl/work-sessions/:sessionId/events
  app.get('/work-sessions/:sessionId/events', (c) => {
    const sessionId = c.req.param('sessionId')
    const limit = parsePositiveInt(c.req.query('limit'), 50)
    const cursor = c.req.query('cursor')
    const includeEphemeral = parseBooleanQuery(c.req.query('includeEphemeral'))
    try {
      return c.json(jsonEnvelope(deps.contextAssembler.getEvents(sessionId, {
        limit,
        cursor: typeof cursor === 'string' ? cursor : undefined,
        includeEphemeral
      })))
    } catch (error) {
      notFound(
        'unknown_session',
        error instanceof Error ? error.message : `Unknown session: ${sessionId}`
      )
    }
  })

  // 13. GET /ctl/work-sessions/:sessionId/context
  app.get('/work-sessions/:sessionId/context', async (c) => {
    const level = c.req.query('level') ?? 'status'
    const sessionId = c.req.param('sessionId')
    const maxCharsRaw = c.req.query('maxChars')
    const cursorRaw = c.req.query('cursor')
    const maxChars = maxCharsRaw ? Number(maxCharsRaw) : undefined
    const cursor = typeof cursorRaw === 'string' ? cursorRaw : null

    try {
      if (level === 'slim') {
        const result = await deps.contextAssembler.getSlimContext(sessionId, { maxChars, cursor })
        return c.text(result.text, 200, {
          'content-type': 'text/plain; charset=utf-8'
        })
      }

      if (level === 'full') {
        const result = await deps.contextAssembler.getFullContext(sessionId, { maxChars, cursor })
        return c.text(result.text, 200, {
          'content-type': 'text/plain; charset=utf-8'
        })
      }

      if (level === 'bundle') {
        return c.json(jsonEnvelope(deps.contextAssembler.getBundle(sessionId)))
      }

      return c.json(jsonEnvelope(deps.contextAssembler.getStatus(sessionId)))
    } catch (error) {
      notFound(
        'unknown_session',
        error instanceof Error ? error.message : `Unknown session: ${sessionId}`
      )
    }
  })

  // 14. POST /ctl/work-sessions/:sessionId/prompt
  app.post('/work-sessions/:sessionId/prompt', async (c) => {
    try {
      const metaSessionId = c.req.header('x-stoa-session-id')!
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
      const text = typeof body.text === 'string' ? body.text : ''
      const result = await deps.dispatcher.promptWorkSession({
        metaSessionId,
        targetSessionId: c.req.param('sessionId'),
        text
      })

      const statusCode = result.kind === 'approval_required' ? 409 : 200
      return c.json(jsonEnvelope(
        result.kind === 'approval_required' ? null : result,
        result.kind === 'approval_required'
          ? {
              code: 'approval_required',
              message: 'Prompt injection requires approval.',
              details: { proposal: result.proposal }
            }
          : null
      ), statusCode)
    } catch (error) {
      return c.json(jsonEnvelope(null, getErrorBody(error)), getErrorStatus(error) as 400)
    }
  })

  // 15. POST /ctl/work-sessions/:sessionId/send-keys
  app.post('/work-sessions/:sessionId/send-keys', async (c) => {
    try {
      const metaSessionId = c.req.header('x-stoa-session-id')!
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
      const data = typeof body.data === 'string' ? body.data : ''
      if (!data) {
        invalidRequest('Missing input data.')
      }

      const result = await deps.dispatcher.sendKeysToWorkSession({
        metaSessionId,
        targetSessionId: c.req.param('sessionId'),
        data
      })

      return c.json(jsonEnvelope(result))
    } catch (error) {
      return c.json(jsonEnvelope(null, getErrorBody(error)), getErrorStatus(error) as 400)
    }
  })

  // 16. GET /ctl/meta-sessions
  app.get('/meta-sessions', (c) => {
    const snapshot = deps.metaSessionSource.snapshot()
    return c.json(jsonEnvelope({
      activeMetaSessionId: snapshot.activeMetaSessionId,
      sessions: snapshot.sessions
    }))
  })

  // 17. POST /ctl/meta-sessions
  app.post('/meta-sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const backendSessionType = body.backendSessionType
    const capabilityLevel = body.capabilityLevel

    if (!title) {
      invalidRequest('Missing meta session title.')
    }

    if (!['claude-code', 'codex', 'opencode'].includes(backendSessionType as string)) {
      invalidRequest('Invalid backendSessionType.')
    }

    if (![0, 1, 2, 3].includes(capabilityLevel as number)) {
      invalidRequest('Invalid capabilityLevel.')
    }

    const created = await deps.metaSessionSource.createSession({
      title,
      backendSessionType: backendSessionType as CreateMetaSessionRequest['backendSessionType'],
      capabilityLevel: capabilityLevel as CreateMetaSessionRequest['capabilityLevel']
    })
    return c.json(jsonEnvelope(created))
  })

  // 18. GET /ctl/meta-sessions/:sessionId
  app.get('/meta-sessions/:sessionId', (c) => {
    const session = deps.metaSessionSource.getSession(c.req.param('sessionId'))
    if (!session) {
      notFound('unknown_session', `Unknown meta session: ${c.req.param('sessionId')}`)
    }
    return c.json(jsonEnvelope({ session }))
  })

  // 19. POST /ctl/meta-sessions/:sessionId/activate
  app.post('/meta-sessions/:sessionId/activate', async (c) => {
    const sessionId = c.req.param('sessionId')
    const session = deps.metaSessionSource.getSession(sessionId)
    if (!session) {
      notFound('unknown_session', `Unknown meta session: ${sessionId}`)
    }
    await deps.metaSessionSource.setActiveSession(sessionId)
    return c.json(jsonEnvelope({
      activeMetaSessionId: sessionId
    }))
  })

  // 20. POST /ctl/meta-sessions/:sessionId/archive
  app.post('/meta-sessions/:sessionId/archive', async (c) => {
    const sessionId = c.req.param('sessionId')
    const session = deps.metaSessionSource.getSession(sessionId)
    if (!session) {
      notFound('unknown_session', `Unknown meta session: ${sessionId}`)
    }
    await deps.metaSessionSource.archiveSession(sessionId)
    return c.json(jsonEnvelope({
      session: deps.metaSessionSource.getSession(sessionId)
    }))
  })

  // 21. POST /ctl/meta-sessions/:sessionId/restore
  app.post('/meta-sessions/:sessionId/restore', async (c) => {
    const sessionId = c.req.param('sessionId')
    const session = deps.metaSessionSource.getSession(sessionId)
    if (!session) {
      notFound('unknown_session', `Unknown meta session: ${sessionId}`)
    }
    await deps.metaSessionSource.restoreSession(sessionId)
    return c.json(jsonEnvelope({
      session: deps.metaSessionSource.getSession(sessionId)
    }))
  })

  // 22. GET /ctl/proposals
  app.get('/proposals', (c) => {
    return c.json(jsonEnvelope(deps.proposals.list()))
  })

  // 23. POST /ctl/proposals
  app.post('/proposals', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const kind = body.kind
    if (kind !== 'prompt') {
      invalidRequest('Unsupported proposal kind.')
    }

    const targetSessionId = typeof body.targetSessionId === 'string' ? body.targetSessionId : ''
    const text = typeof body.text === 'string' ? body.text : ''
    if (!targetSessionId || !text.trim()) {
      invalidRequest('Missing targetSessionId or text.')
    }

    try {
      const proposal = await deps.dispatcher.createPromptProposal({
        metaSessionId: c.req.header('x-stoa-session-id')!,
        targetSessionId,
        text
      })
      return c.json(jsonEnvelope(proposal))
    } catch (error) {
      return c.json(jsonEnvelope(null, getErrorBody(error)), getErrorStatus(error) as 400)
    }
  })

  // 24. GET /ctl/proposals/:proposalId
  app.get('/proposals/:proposalId', (c) => {
    return c.json(jsonEnvelope(deps.proposals.get(c.req.param('proposalId'))))
  })

  // 25. POST /ctl/proposals/:proposalId/approve
  app.post('/proposals/:proposalId/approve', async (c) => {
    const proposalId = c.req.param('proposalId')
    const proposal = await deps.proposals.markApproved(proposalId)
    if (!proposal) {
      return c.json(jsonEnvelope(null, {
        code: 'unknown_proposal',
        message: `Unknown proposal: ${proposalId}`,
        details: {}
      }), 404)
    }
    return c.json(jsonEnvelope(proposal))
  })

  // 26. POST /ctl/proposals/:proposalId/reject
  app.post('/proposals/:proposalId/reject', async (c) => {
    const proposalId = c.req.param('proposalId')
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason
      : 'Proposal rejected.'
    const proposal = await deps.proposals.markRejected(proposalId, reason)
    if (!proposal) {
      return c.json(jsonEnvelope(null, {
        code: 'unknown_proposal',
        message: `Unknown proposal: ${proposalId}`,
        details: {}
      }), 404)
    }
    return c.json(jsonEnvelope(proposal))
  })

  // 27. POST /ctl/dispatch/proposal/:proposalId
  app.post('/dispatch/proposal/:proposalId', async (c) => {
    try {
      return c.json(jsonEnvelope(await deps.dispatcher.dispatchProposal(c.req.param('proposalId'))))
    } catch (error) {
      return c.json(jsonEnvelope(null, getErrorBody(error)), getErrorStatus(error) as 400)
    }
  })

  // 28. POST /ctl/dispatch/preset/:presetName
  app.post('/dispatch/preset/:presetName', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const targetSessionId = typeof body.targetSessionId === 'string' ? body.targetSessionId : ''
    if (!targetSessionId) {
      invalidRequest('Missing targetSessionId.')
    }

    try {
      return c.json(jsonEnvelope(await deps.dispatcher.dispatchPreset({
        metaSessionId: c.req.header('x-stoa-session-id')!,
        targetSessionId,
        presetName: c.req.param('presetName') as 'run-tests-only' | 'summarize-failures' | 'pause-and-generate-summary'
      })))
    } catch (error) {
      return c.json(jsonEnvelope(null, getErrorBody(error)), getErrorStatus(error) as 400)
    }
  })

  return app
}
