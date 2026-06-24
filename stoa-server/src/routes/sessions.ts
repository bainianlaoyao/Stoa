/**
 * Sessions route group — plan section 5.6.
 *
 * Mounts at `/api/v1`. Endpoints:
 *   POST   /sessions                         — create session
 *   PUT    /sessions/:id/active              — set active session
 *   PUT    /sessions/:id/archive             — archive session
 *   PUT    /sessions/:id/restore             — restore session
 *   POST   /sessions/:id/restart             — restart runtime
 *   PUT    /sessions/:id/title               — update session title
 *   GET    /sessions?archive=archived         — list archived sessions (paginated)
 *   GET    /sessions/:id/terminal-replay      — terminal replay
 *   POST   /sessions/:id/input               — send input
 *   POST   /sessions/:id/resize              — resize
 *   DELETE /projects/:id/sidecar             — uninstall sidecar (stub)
 *   GET    /sessions/:id/evidence             — list evidence snapshots (stub)
 *   GET    /sessions/:id/context/full         — full text export (stub)
 *   GET    /sessions/:id/context/slim         — slim text export (stub)
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type {
  BootstrapState,
  CreateSessionRequest,
  SessionSummary,
  SessionType,
} from 'stoa-shared';
import { AppError, type ApiResponse } from '../shared/errors';
import { ProjectSessionManager } from '../services/project-session-manager';
import type { LaunchOptions, RuntimeBridgeClient } from './runtime-bridge';
import { RuntimeBridgeError } from '../ws/runtime-bridge-handler';

export interface SessionsRouteDeps {
  manager: ProjectSessionManager;
  runtimeBridge: RuntimeBridgeClient;
}

const VALID_SESSION_TYPES: readonly SessionType[] = ['shell', 'opencode', 'codex', 'claude-code'];
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

function ensureSessionExists(state: BootstrapState, sessionId: string): SessionSummary {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new AppError({
      code: 'session_not_found',
      message: `Session not found: ${sessionId}`,
      statusCode: 404,
      details: { sessionId },
    });
  }
  return session;
}

function ensureProjectExists(state: BootstrapState, projectId: string): void {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new AppError({
      code: 'not_found',
      message: `Project not found: ${projectId}`,
      statusCode: 404,
      details: { projectId },
    });
  }
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppError({
      code: 'validation_error',
      message: 'initialCols and initialRows must be positive integers when provided',
      statusCode: 422,
      details: { field: 'initialCols,initialRows' },
    });
  }
  return value;
}

function buildLaunchOptions(
  state: BootstrapState,
  session: SessionSummary,
  dimensions: { cols?: number; rows?: number } = {},
): LaunchOptions {
  const project = state.projects.find((candidate) => candidate.id === session.projectId);
  return {
    projectId: session.projectId,
    title: session.title,
    type: session.type,
    externalSessionId: session.externalSessionId,
    cwd: project?.path,
    cols: dimensions.cols,
    rows: dimensions.rows,
  };
}

function assertRuntimeSessionManaged(runtimeBridge: RuntimeBridgeClient, sessionId: string): void {
  if (runtimeBridge.isSessionManaged(sessionId)) {
    return;
  }
  throw new RuntimeBridgeError(
    'no_provider',
    `No runtime provider is currently managing session ${sessionId} after launch`,
    { command: 'runtime:launch', sessionId },
  );
}

export function createSessionsRoutes(deps: SessionsRouteDeps): Hono {
  const routes = new Hono();
  const { manager, runtimeBridge } = deps;

  routes.get('/sessions', (c) => {
    const archive = c.req.query('archive');
    if (archive === 'archived') {
      const archived = manager.getArchivedSessions();
      const cursor = c.req.query('cursor');
      const limit = Math.min(
        Math.max(1, Number(c.req.query('limit') ?? DEFAULT_PAGE_SIZE)),
        200,
      );

      let startIndex = 0;
      if (cursor) {
        const idx = archived.findIndex((s) => s.id === cursor);
        if (idx >= 0) startIndex = idx;
      }

      const page = archived.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < archived.length;
      const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

      return c.json(envelope(page, {
        cursor: nextCursor,
        hasMore,
        totalCount: archived.length,
      }));
    }
    // Default: return snapshot sessions
    const state = manager.snapshot();
    return c.json(envelope(state.sessions));
  });

  routes.post('/sessions', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must be a JSON object',
        statusCode: 422,
      });
    }
    const projectId = body.projectId;
    const type = body.type;
    if (typeof projectId !== 'string' || !projectId) {
      throw new AppError({
        code: 'validation_error',
        message: 'Field "projectId" is required',
        statusCode: 422,
        details: { field: 'projectId' },
      });
    }
    if (typeof type !== 'string' || !(VALID_SESSION_TYPES as readonly string[]).includes(type)) {
      throw new AppError({
        code: 'validation_error',
        message: `Field "type" must be one of: ${VALID_SESSION_TYPES.join(', ')}`,
        statusCode: 422,
        details: { field: 'type', received: type },
      });
    }
    const initialCols = parseOptionalPositiveInteger(body.initialCols);
    const initialRows = parseOptionalPositiveInteger(body.initialRows);
    const request: CreateSessionRequest = {
      projectId,
      type: type as SessionType,
      title: typeof body.title === 'string' ? body.title : '',
      parentSessionId: body.parentSessionId as string | null | undefined ?? null,
      createdBySessionId: body.createdBySessionId as string | null | undefined ?? null,
      subagentName: body.subagentName as string | null | undefined ?? null,
      externalSessionId: body.externalSessionId as string | null | undefined ?? null,
      initialCols,
      initialRows,
    };
    let session: SessionSummary;
    try {
      session = await manager.createSession(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError({
        code: 'conflict',
        message,
        statusCode: 409,
      });
    }

    try {
      const state = manager.snapshot();
      await runtimeBridge.launch(
        session.id,
        buildLaunchOptions(state, session, { cols: initialCols, rows: initialRows }),
      );
      assertRuntimeSessionManaged(runtimeBridge, session.id);
      await manager.markRuntimeStarting(session.id, `Starting ${session.type}`, session.externalSessionId);
      await manager.markRuntimeAlive(session.id, session.externalSessionId);
      const launchedSession = manager.snapshot().sessions.find((candidate) => candidate.id === session.id) ?? session;
      return c.json(envelope(launchedSession), 201);
    } catch (error) {
      await manager.deleteSessionRecord(session.id);
      throw error;
    }
  });

  routes.put('/sessions/:id/active', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    await manager.setActiveSession(sessionId);
    return c.json(envelope({ id: sessionId, active: true }));
  });

  routes.put('/sessions/:id/archive', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    await runtimeBridge.kill(sessionId);
    await manager.archiveSession(sessionId);
    return c.json(envelope({ id: sessionId, archived: true }));
  });

  routes.put('/sessions/:id/restore', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    const session = ensureSessionExists(state, sessionId);
    await manager.restoreSession(sessionId);
    try {
      await runtimeBridge.launch(sessionId, buildLaunchOptions(state, session));
      assertRuntimeSessionManaged(runtimeBridge, sessionId);
      await manager.markRuntimeStarting(sessionId, `Starting ${session.type}`, session.externalSessionId);
      await manager.markRuntimeAlive(sessionId, session.externalSessionId);
    } catch (error) {
      await manager.markRuntimeFailedToStart(sessionId, `Failed to restore ${session.type}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return c.json(envelope({ id: sessionId, restored: true }));
  });

  routes.post('/sessions/:id/restart', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    const session = ensureSessionExists(state, sessionId);
    await runtimeBridge.kill(sessionId);
    try {
      await runtimeBridge.launch(sessionId, buildLaunchOptions(state, session));
      assertRuntimeSessionManaged(runtimeBridge, sessionId);
      await manager.markRuntimeStarting(sessionId, `Starting ${session.type}`, session.externalSessionId);
      await manager.markRuntimeAlive(sessionId, session.externalSessionId);
    } catch (error) {
      await manager.markRuntimeFailedToStart(sessionId, `Failed to restart ${session.type}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return c.json(envelope({ id: sessionId, restarted: true }));
  });

  routes.put('/sessions/:id/title', async (c) => {
    const sessionId = c.req.param('id');
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    const title = typeof body?.title === 'string' ? body.title : '';
    const options = body?.options as
      | { prompt?: string | null; assistantSnippet?: string | null; autoGeneratedTurnEpoch?: number | null; contextUpdatedAt?: string | null }
      | undefined;
    const updated = await manager.updateSessionTitle(sessionId, title, options);
    if (!updated) {
      throw new AppError({
        code: 'session_not_found',
        message: `Session not found: ${sessionId}`,
        statusCode: 404,
      });
    }
    return c.json(envelope(updated));
  });

  routes.get('/sessions/:id/terminal-replay', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    const replay = await runtimeBridge.getTerminalReplay(sessionId);
    return c.json(envelope(replay));
  });

  routes.post('/sessions/:id/input', async (c) => {
    const sessionId = c.req.param('id');
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const data = typeof body?.data === 'string' ? body.data : '';
    if (!data) {
      throw new AppError({
        code: 'validation_error',
        message: 'Field "data" is required',
        statusCode: 422,
        details: { field: 'data' },
      });
    }
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    await runtimeBridge.input(sessionId, data);
    return c.json(envelope({ sessionId, sent: true }));
  });

  routes.post('/sessions/:id/resize', async (c) => {
    const sessionId = c.req.param('id');
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const cols = typeof body?.cols === 'number' ? body.cols : 0;
    const rows = typeof body?.rows === 'number' ? body.rows : 0;
    if (cols <= 0 || rows <= 0) {
      throw new AppError({
        code: 'validation_error',
        message: 'Fields "cols" and "rows" must be positive integers',
        statusCode: 422,
        details: { field: 'cols,rows', received: { cols, rows } },
      });
    }
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    await runtimeBridge.resize(sessionId, cols, rows);
    return c.json(envelope({ sessionId, resized: true }));
  });

  // Sidecar uninstall — project-level operation under sessions route group
  routes.delete('/projects/:id/sidecar', (c) => {
    const projectId = c.req.param('id');
    const state = manager.snapshot();
    ensureProjectExists(state, projectId);
    // Sidecar management is Electron-only; SR does not implement it directly.
    throw new AppError({
      code: 'internal_error',
      message: 'Sidecar uninstall is not available in Stoa Server mode',
      statusCode: 503,
      nextSteps: ['Use the Electron client to manage sidecar installations'],
    });
  });

  // Evidence snapshots — requires observation store, stub for now
  routes.get('/sessions/:id/evidence', (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    // Observation store integration pending — return empty list
    return c.json(envelope([], { cursor: null, hasMore: false, totalCount: 0 }));
  });

  // Context exports — full and slim text
  routes.get('/sessions/:id/context/full', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    const maxChars = Math.min(
      Math.max(1, Number(c.req.query('maxChars') ?? 100_000)),
      1_000_000,
    );
    // Requires MetaSessionContextAssembler wired to observation store
    // Phase 2b stub — return placeholder
    return c.json(envelope({
      sessionId,
      text: '',
      truncated: false,
      totalTurns: 0,
      maxChars,
    }));
  });

  routes.get('/sessions/:id/context/slim', async (c) => {
    const sessionId = c.req.param('id');
    const state = manager.snapshot();
    ensureSessionExists(state, sessionId);
    const maxChars = Math.min(
      Math.max(1, Number(c.req.query('maxChars') ?? 100_000)),
      1_000_000,
    );
    return c.json(envelope({
      sessionId,
      text: '',
      truncated: false,
      totalTurns: 0,
      maxChars,
    }));
  });

  return routes;
}
