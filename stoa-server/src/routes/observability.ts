/**
 * Observability route group — plan section 5.6.
 *
 * Mounts at `/api/v1`. Endpoints:
 *   GET /observability/sessions/:id/presence  — session presence
 *   GET /observability/projects/:id           — project observability
 *   GET /observability/app                    — app observability
 *   GET /observability/sessions/:id/events    — session events (paginated)
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type {
  AppObservabilitySnapshot,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot,
} from 'stoa-shared';
import { AppError, type ApiResponse } from '../shared/errors';
import { ProjectSessionManager } from '../services/project-session-manager';

export interface ObservabilityRouteDeps {
  manager: ProjectSessionManager;
  getSessionPresence: (sessionId: string) => SessionPresenceSnapshot | null;
  getProjectObservability: (projectId: string) => ProjectObservabilitySnapshot | null;
  getAppObservability: () => AppObservabilitySnapshot;
  listSessionEvents: (
    sessionId: string,
    options: { limit: number; cursor?: string; categories?: string[]; includeEphemeral?: boolean },
  ) => { events: Array<{ payload: Record<string, unknown> }>; nextCursor: string | null; hasMore: boolean };
}

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

function ensureSession(sessionId: string, deps: ObservabilityRouteDeps): void {
  const state = deps.manager.snapshot();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new AppError({
      code: 'session_not_found',
      message: `Session not found: ${sessionId}`,
      statusCode: 404,
      details: { sessionId },
    });
  }
}

function ensureProject(projectId: string, deps: ObservabilityRouteDeps): void {
  const state = deps.manager.snapshot();
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

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 200;

export function createObservabilityRoutes(deps: ObservabilityRouteDeps): Hono {
  const routes = new Hono();

  routes.get('/observability/sessions/:id/presence', (c) => {
    const sessionId = c.req.param('id');
    ensureSession(sessionId, deps);
    const presence = deps.getSessionPresence(sessionId);
    return c.json(envelope(presence));
  });

  routes.get('/observability/projects/:id', (c) => {
    const projectId = c.req.param('id');
    ensureProject(projectId, deps);
    const snapshot = deps.getProjectObservability(projectId);
    return c.json(envelope(snapshot));
  });

  routes.get('/observability/app', (c) => {
    const snapshot = deps.getAppObservability();
    return c.json(envelope(snapshot));
  });

  routes.get('/observability/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id');
    ensureSession(sessionId, deps);

    const limit = Math.min(
      Math.max(1, Number(c.req.query('limit') ?? DEFAULT_EVENT_LIMIT)),
      MAX_EVENT_LIMIT,
    );
    const cursor = c.req.query('cursor') ?? undefined;
    const categoriesParam = c.req.query('categories');
    const categories = categoriesParam
      ? categoriesParam.split(',').filter(Boolean)
      : undefined;
    const includeEphemeral = c.req.query('includeEphemeral') === 'true';

    const result = deps.listSessionEvents(sessionId, {
      limit,
      cursor,
      categories,
      includeEphemeral,
    });

    return c.json(envelope(result.events, {
      cursor: result.nextCursor,
      hasMore: result.hasMore,
    }));
  });

  return routes;
}