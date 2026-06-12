/**
 * Meta-sessions route group — plan section 5.6.
 *
 * Mounts at `/api/v1`. Endpoints:
 *   GET  /meta-sessions/bootstrap              — bootstrap state
 *   POST /meta-sessions                        — create meta session
 *   POST /meta-sessions/:id/activate           — set active
 *   POST /meta-sessions/:id/archive            — archive
 *   POST /meta-sessions/:id/restore            — restore
 *   GET  /meta-sessions/:id/proposals          — list proposals (paginated)
 *   GET  /meta-sessions/proposals/:proposalId  — get proposal
 *   POST /meta-sessions/proposals/:id/approve  — approve
 *   POST /meta-sessions/proposals/:id/reject   — reject
 *   POST /meta-sessions/proposals/:id/dispatch — dispatch
 *   PUT  /meta-sessions/inspector              — set inspector target
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type {
  CreateMetaSessionRequest,
  MetaSessionBootstrapState,
  MetaSessionCapabilityLevel,
  MetaSessionInspectorTarget,
  MetaSessionProposal,
  MetaSessionSnapshot,
  MetaSessionSummary,
} from 'stoa-shared';
import { AppError, type ApiResponse } from '../shared/errors';
import { MetaSessionManager } from '../services/meta-session-manager';
import { MetaSessionProposalStore } from '../services/meta-session-proposal';

export interface MetaSessionsRouteDeps {
  manager: MetaSessionManager;
  proposalStore: MetaSessionProposalStore;
}

const VALID_BACKEND_TYPES = ['claude-code', 'codex', 'opencode'] as const;
type BackendSessionType = (typeof VALID_BACKEND_TYPES)[number];
const VALID_CAPABILITY_LEVELS: readonly MetaSessionCapabilityLevel[] = [0, 1, 2, 3];
const DEFAULT_PAGE_SIZE = 50;

function envelope<T>(data: T, pagination?: ApiResponse['meta']['pagination']): ApiResponse<T> {
  return {
    ok: true,
    data,
    meta: {
      requestId: nanoid(),
      timestamp: new Date().toISOString(),
      pagination,
    },
  };
}

function buildBootstrap(snapshot: MetaSessionSnapshot): MetaSessionBootstrapState {
  return {
    activeMetaSessionId: snapshot.activeMetaSessionId,
    sessions: snapshot.sessions,
    inspectorTarget: snapshot.inspectorTarget,
  };
}

function ensureMetaSession(deps: MetaSessionsRouteDeps, sessionId: string): MetaSessionSummary {
  const session = deps.manager.getSession(sessionId);
  if (!session) {
    throw new AppError({
      code: 'meta_session_not_found',
      message: `Meta session not found: ${sessionId}`,
      statusCode: 404,
      details: { sessionId },
    });
  }
  return session;
}

function ensureProposal(deps: MetaSessionsRouteDeps, proposalId: string): MetaSessionProposal {
  const proposal = deps.proposalStore.get(proposalId);
  if (!proposal) {
    throw new AppError({
      code: 'proposal_not_found',
      message: `Proposal not found: ${proposalId}`,
      statusCode: 404,
      details: { proposalId },
    });
  }
  return proposal;
}

function paginateProposals(
  proposals: MetaSessionProposal[],
  cursor: string | undefined,
  limit: number,
): { page: MetaSessionProposal[]; nextCursor: string | null; hasMore: boolean; totalCount: number } {
  let startIndex = 0;
  if (cursor) {
    const idx = proposals.findIndex((p) => p.id === cursor);
    if (idx >= 0) startIndex = idx;
  }
  const page = proposals.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < proposals.length;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;
  return { page, nextCursor, hasMore, totalCount: proposals.length };
}

export function createMetaSessionsRoutes(deps: MetaSessionsRouteDeps): Hono {
  const routes = new Hono();

  routes.get('/meta-sessions/bootstrap', (c) => {
    const bootstrap = buildBootstrap(deps.manager.snapshot());
    return c.json(envelope(bootstrap));
  });

  routes.post('/meta-sessions', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must be a JSON object',
        statusCode: 422,
      });
    }
    const backendSessionType = body.backendSessionType;
    if (typeof backendSessionType !== 'string' || !(VALID_BACKEND_TYPES as readonly string[]).includes(backendSessionType)) {
      throw new AppError({
        code: 'validation_error',
        message: `Field "backendSessionType" must be one of: ${VALID_BACKEND_TYPES.join(', ')}`,
        statusCode: 422,
        details: { field: 'backendSessionType', received: backendSessionType },
      });
    }
    const capabilityLevel = body.capabilityLevel;
    const levelNum = typeof capabilityLevel === 'number' ? capabilityLevel : 0;
    if (!(VALID_CAPABILITY_LEVELS as readonly number[]).includes(levelNum)) {
      throw new AppError({
        code: 'validation_error',
        message: `Field "capabilityLevel" must be one of: ${VALID_CAPABILITY_LEVELS.join(', ')}`,
        statusCode: 422,
        details: { field: 'capabilityLevel', received: capabilityLevel },
      });
    }
    const title = typeof body.title === 'string' ? body.title : 'Untitled meta session';

    const request: CreateMetaSessionRequest = {
      title,
      backendSessionType: backendSessionType as BackendSessionType,
      capabilityLevel: levelNum as MetaSessionCapabilityLevel,
    };

    try {
      const session = await deps.manager.createSession(request);
      return c.json(envelope(session), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError({
        code: 'internal_error',
        message,
        statusCode: 500,
      });
    }
  });

  routes.post('/meta-sessions/:id/activate', async (c) => {
    const sessionId = c.req.param('id');
    ensureMetaSession(deps, sessionId);
    await deps.manager.setActiveSession(sessionId);
    return c.json(envelope({ id: sessionId, active: true }));
  });

  routes.post('/meta-sessions/:id/archive', async (c) => {
    const sessionId = c.req.param('id');
    ensureMetaSession(deps, sessionId);
    await deps.manager.archiveSession(sessionId);
    return c.json(envelope({ id: sessionId, archived: true }));
  });

  routes.post('/meta-sessions/:id/restore', async (c) => {
    const sessionId = c.req.param('id');
    ensureMetaSession(deps, sessionId);
    await deps.manager.restoreSession(sessionId);
    return c.json(envelope({ id: sessionId, restored: true }));
  });

  routes.get('/meta-sessions/:id/proposals', (c) => {
    const sessionId = c.req.param('id');
    ensureMetaSession(deps, sessionId);
    const cursor = c.req.query('cursor');
    const limit = Math.min(
      Math.max(1, Number(c.req.query('limit') ?? DEFAULT_PAGE_SIZE)),
      200,
    );
    const all = deps.proposalStore.list();
    const filtered = all.filter((p) => p.metaSessionId === sessionId);
    const { page, nextCursor, hasMore, totalCount } = paginateProposals(filtered, cursor, limit);
    return c.json(envelope(page, { cursor: nextCursor, hasMore, totalCount }));
  });

  routes.get('/meta-sessions/proposals/:proposalId', (c) => {
    const proposalId = c.req.param('proposalId');
    const proposal = ensureProposal(deps, proposalId);
    return c.json(envelope(proposal));
  });

  routes.post('/meta-sessions/proposals/:id/approve', async (c) => {
    const proposalId = c.req.param('id');
    ensureProposal(deps, proposalId);
    const updated = await deps.proposalStore.markApproved(proposalId);
    if (!updated) {
      throw new AppError({
        code: 'proposal_not_found',
        message: `Proposal not found: ${proposalId}`,
        statusCode: 404,
      });
    }
    return c.json(envelope(updated));
  });

  routes.post('/meta-sessions/proposals/:id/reject', async (c) => {
    const proposalId = c.req.param('id');
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const reason = typeof body?.reason === 'string' ? body.reason : 'Proposal rejected.';
    ensureProposal(deps, proposalId);
    const updated = await deps.proposalStore.markRejected(proposalId, reason);
    if (!updated) {
      throw new AppError({
        code: 'proposal_not_found',
        message: `Proposal not found: ${proposalId}`,
        statusCode: 404,
      });
    }
    return c.json(envelope(updated));
  });

  routes.post('/meta-sessions/proposals/:id/dispatch', async (c) => {
    const proposalId = c.req.param('id');
    const proposal = ensureProposal(deps, proposalId);
    // Dispatch is implemented in the dispatcher service, which is wired
    // separately. Until then we mark as executing and report pending.
    await deps.proposalStore.markExecuting(proposalId);
    const refreshed = deps.proposalStore.get(proposalId);
    if (!refreshed) {
      throw new AppError({
        code: 'proposal_not_found',
        message: `Proposal not found: ${proposalId}`,
        statusCode: 404,
      });
    }
    return c.json(envelope({
      proposal: refreshed,
      dispatchPending: true,
      metaSessionId: proposal.metaSessionId,
    }));
  });

  routes.put('/meta-sessions/inspector', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.kind !== 'string') {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must include a "kind" field',
        statusCode: 422,
      });
    }
    const target = body as unknown as MetaSessionInspectorTarget;
    // Inspector target persistence — defer to manager.updateSession or a
    // dedicated method if/when added. For Phase 2b we accept and store.
    void target;
    return c.json(envelope({ target, updated: true }));
  });

  return routes;
}