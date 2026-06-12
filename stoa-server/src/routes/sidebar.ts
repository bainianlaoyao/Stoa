/**
 * Sidebar route group — plan section 5.6.
 *
 * Mounts at `/api/v1`. Endpoints:
 *   GET /sidebar  — get sidebar state
 *   PUT /sidebar  — update sidebar state
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { SidebarState } from 'stoa-shared';
import { AppError, type ApiResponse } from '../shared/errors';

export interface SidebarRouteDeps {
  getSidebarState: () => SidebarState;
  setSidebarState: (state: SidebarState) => void;
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

function isValidSidebarTab(value: unknown): value is SidebarState['activeTab'] {
  return value === 'explorer' || value === 'search' || value === 'git';
}

export function createSidebarRoutes(deps: SidebarRouteDeps): Hono {
  const routes = new Hono();

  routes.get('/sidebar', (c) => {
    const state = deps.getSidebarState();
    return c.json(envelope(state));
  });

  routes.put('/sidebar', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must be a JSON object matching SidebarState',
        statusCode: 422,
      });
    }
    if (typeof body.open !== 'boolean') {
      throw new AppError({
        code: 'validation_error',
        message: 'Field "open" must be a boolean',
        statusCode: 422,
        details: { field: 'open' },
      });
    }
    if (!isValidSidebarTab(body.activeTab)) {
      throw new AppError({
        code: 'validation_error',
        message: 'Field "activeTab" must be one of: explorer, search, git',
        statusCode: 422,
        details: { field: 'activeTab', received: body.activeTab },
      });
    }
    if (typeof body.width !== 'number' || body.width <= 0) {
      throw new AppError({
        code: 'validation_error',
        message: 'Field "width" must be a positive number',
        statusCode: 422,
        details: { field: 'width' },
      });
    }
    if (typeof body.sessionListWidth !== 'number' || body.sessionListWidth <= 0) {
      throw new AppError({
        code: 'validation_error',
        message: 'Field "sessionListWidth" must be a positive number',
        statusCode: 422,
        details: { field: 'sessionListWidth' },
      });
    }

    const state: SidebarState = {
      open: body.open,
      activeTab: body.activeTab,
      width: body.width,
      sessionListWidth: body.sessionListWidth,
      activeTabByProject: typeof body.activeTabByProject === 'object' && body.activeTabByProject !== null
        ? body.activeTabByProject as Record<string, string>
        : {},
    };

    deps.setSidebarState(state);
    return c.json(envelope(state));
  });

  return routes;
}