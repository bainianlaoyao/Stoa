/**
 * Projects & bootstrap route group — plan section 5.6.
 *
 * Mounts at `/api/v1`. Endpoints:
 *   GET    /bootstrap            — full BootstrapState snapshot
 *   POST   /projects             — create a project
 *   DELETE /projects/:id         — delete a project
 *   PUT    /projects/:id/active  — set active project
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type {
  BootstrapState,
  CreateProjectRequest,
  ProjectSummary,
  SessionType,
} from 'stoa-shared';
import { AppError, type ApiResponse } from '../shared/errors';
import { ProjectSessionManager } from '../services/project-session-manager';

export interface ProjectsRouteDeps {
  manager: ProjectSessionManager;
}

const VALID_SESSION_TYPES: readonly SessionType[] = ['shell', 'opencode', 'codex', 'claude-code'];

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

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new AppError({
      code: 'validation_error',
      message: `Field "${field}" must be a non-empty string`,
      statusCode: 422,
      details: { field },
    });
  }
  return value;
}

function asOptionalSessionType(value: unknown): SessionType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(VALID_SESSION_TYPES as readonly string[]).includes(value)) {
    throw new AppError({
      code: 'validation_error',
      message: `Field "defaultSessionType" must be one of: ${VALID_SESSION_TYPES.join(', ')}`,
      statusCode: 422,
      details: { field: 'defaultSessionType', received: value },
    });
  }
  return value as SessionType;
}

function ensureProjectExists(state: BootstrapState, projectId: string): ProjectSummary {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new AppError({
      code: 'not_found',
      message: `Project not found: ${projectId}`,
      statusCode: 404,
      details: { projectId },
    });
  }
  return project;
}

export function createProjectsRoutes(deps: ProjectsRouteDeps): Hono {
  const routes = new Hono();
  const { manager } = deps;

  routes.get('/bootstrap', (c) => {
    const state = manager.snapshot();
    return c.json(envelope(state));
  });

  routes.post('/projects', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      throw new AppError({
        code: 'validation_error',
        message: 'Request body must be a JSON object',
        statusCode: 422,
      });
    }
    const request: CreateProjectRequest = {
      path: asString(body.path, 'path'),
      name: asString(body.name, 'name'),
      defaultSessionType: asOptionalSessionType(body.defaultSessionType),
    };
    try {
      const project = await manager.createProject(request);
      return c.json(envelope(project), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError({
        code: 'conflict',
        message,
        statusCode: 409,
        details: { path: request.path },
      });
    }
  });

  routes.delete('/projects/:id', async (c) => {
    const projectId = c.req.param('id');
    const state = manager.snapshot();
    ensureProjectExists(state, projectId);
    await manager.deleteProject(projectId);
    return c.json(envelope({ id: projectId, deleted: true }));
  });

  routes.put('/projects/:id/active', async (c) => {
    const projectId = c.req.param('id');
    const state = manager.snapshot();
    ensureProjectExists(state, projectId);
    await manager.setActiveProject(projectId);
    return c.json(envelope({ id: projectId, active: true }));
  });

  return routes;
}