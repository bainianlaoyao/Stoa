/**
 * Integration tests for /api/v1/ route groups — Phase 2b + Phase 3 stubs.
 *
 * Uses Hono's app.request() for HTTP-level testing with real
 * ProjectSessionManager.createForTest() instances + vi.spyOn to mock
 * specific methods when needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type {
  AppSettings,
  ProjectSummary,
  SidebarState,
} from 'stoa-shared';
import { DEFAULT_SETTINGS } from 'stoa-shared';
import { createErrorHandler } from '../middleware/error-handler';
import { createAuthMiddleware } from '../middleware/auth';
import { createProjectsRoutes } from './projects';
import { createSessionsRoutes } from './sessions';
import { createSettingsRoutes } from './settings';
import { createSidebarRoutes } from './sidebar';
import { createObservabilityRoutes } from './observability';
import { createStubRuntimeBridge } from './runtime-bridge';
import type { RuntimeBridgeClient } from './runtime-bridge';
import { ProjectSessionManager } from '../services/project-session-manager';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    providers: {},
    titleGeneration: { ...DEFAULT_SETTINGS.titleGeneration },
    workspaceIde: { ...DEFAULT_SETTINGS.workspaceIde },
  };
}

function makeDefaultSidebarState(): SidebarState {
  return {
    open: true,
    activeTab: 'explorer',
    width: 260,
    sessionListWidth: 200,
    activeTabByProject: {},
  };
}

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function createMockAppObservability() {
  return {
    blockedProjectCount: 0,
    failedProjectCount: 0,
    totalUnreadTurns: 0,
    projectsNeedingAttention: [] as string[],
    providerHealthSummary: {} as Record<string, 'healthy' | 'lost'>,
    lastGlobalEventAt: null as string | null,
    sourceSequence: 0,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function createTestApp(overrides: {
  manager?: ProjectSessionManager;
  runtimeBridge?: RuntimeBridgeClient;
  sidebarState?: SidebarState;
  setSidebarState?: (state: SidebarState) => void;
} = {}) {
  const manager = overrides.manager ?? ProjectSessionManager.createForTest();
  const runtimeBridge = overrides.runtimeBridge ?? createStubRuntimeBridge();
  let sidebarState: SidebarState = overrides.sidebarState ?? makeDefaultSidebarState();

  const app = new Hono();
  app.onError(createErrorHandler());
  app.use('*', createAuthMiddleware('test-token'));

  app.route('/api/v1', createProjectsRoutes({ manager }));
  app.route('/api/v1', createSessionsRoutes({ manager, runtimeBridge }));
  app.route('/api/v1', createSettingsRoutes({ manager }));
  app.route('/api/v1', createSidebarRoutes({
    getSidebarState: () => sidebarState,
    setSidebarState: overrides.setSidebarState ?? ((s: SidebarState) => { sidebarState = s; }),
  }));
  app.route('/api/v1', createObservabilityRoutes({
    manager,
    getSessionPresence: () => null,
    getProjectObservability: () => null,
    getAppObservability: () => createMockAppObservability(),
    listSessionEvents: () => ({ events: [], nextCursor: null, hasMore: false }),
  }));
  // Meta-sessions and observability are mounted but not under test here.
  // The meta-sessions route group uses concrete class types in its deps,
  // so we build a minimal Hono sub-app that returns 501 for all routes
  // instead of wiring the real factories.
  const metaSessionsStub = new Hono();
  metaSessionsStub.all('/*', (c) => c.json({ ok: false, error: { code: 'not_tested' } }, 501));
  app.route('/api/v1', metaSessionsStub);

  return { app, manager };
}

const AUTH = { Authorization: 'Bearer test-token' };

// Helper to parse JSON responses with proper typing
async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ApiResponseEnvelope<T> {
  ok: boolean;
  data: T;
  meta: { requestId: string; timestamp: string; pagination?: unknown };
}

interface ApiErrorEnvelope {
  ok: boolean;
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: { requestId: string; timestamp: string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API routes — /api/v1/', () => {
  describe('GET /api/v1/bootstrap', () => {
    it('returns 200 with bootstrap state', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/bootstrap', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { projects: ProjectSummary[]; sessions: unknown[] }; meta: { requestId: string; timestamp: string } };
      expect(body.ok).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.projects).toEqual([]);
      expect(body.data.sessions).toEqual([]);
      expect(body.meta.requestId).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
    });
  });

  describe('POST /api/v1/projects', () => {
    it('creates a project and returns 201', async () => {
      const { app, manager } = createTestApp();
      const spy = vi.spyOn(manager, 'createProject');
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/new-proj', name: 'New Project' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { ok: boolean; data: ProjectSummary };
      expect(body.ok).toBe(true);
      expect(body.data.path).toBe('/tmp/new-proj');
      expect(body.data.name).toBe('New Project');
      expect(spy).toHaveBeenCalledOnce();
    });

    it('returns 422 when body is missing', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: AUTH,
      });
      expect(res.status).toBe(422);
    });

    it('returns 422 when path is empty', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '', name: 'Test' }),
      });
      expect(res.status).toBe(422);
    });

    it('returns 409 on duplicate path', async () => {
      const manager = ProjectSessionManager.createForTest();
      await manager.createProject({ path: '/tmp/test-project', name: 'Original' });
      const { app } = createTestApp({ manager });
      const res = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/test-project', name: 'Dup' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/v1/projects/:id', () => {
    it('deletes a project and returns 200', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const { app } = createTestApp({ manager });
      const res = await app.request(`/api/v1/projects/${project.id}`, {
        method: 'DELETE',
        headers: AUTH,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string; deleted: boolean } };
      expect(body.data.id).toBe(project.id);
      expect(body.data.deleted).toBe(true);
    });

    it('returns 404 for unknown project', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/projects/nonexistent', {
        method: 'DELETE',
        headers: AUTH,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/projects/:id/active', () => {
    it('sets active project and returns 200', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const { app } = createTestApp({ manager });
      const res = await app.request(`/api/v1/projects/${project.id}/active`, {
        method: 'PUT',
        headers: AUTH,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string; active: boolean } };
      expect(body.data.id).toBe(project.id);
      expect(body.data.active).toBe(true);
    });

    it('returns 404 for unknown project', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/projects/nonexistent/active', {
        method: 'PUT',
        headers: AUTH,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/sessions', () => {
    it('creates a session and returns 201', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const { app } = createTestApp({ manager });
      const res = await app.request('/api/v1/sessions', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, type: 'shell' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { ok: boolean; data: { projectId: string } };
      expect(body.ok).toBe(true);
      expect(body.data.projectId).toBe(project.id);
    });

    it('returns 422 when projectId is missing', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/sessions', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'shell' }),
      });
      expect(res.status).toBe(422);
    });

    it('returns 422 when type is invalid', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/sessions', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', type: 'invalid-type' }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('PUT /api/v1/sessions/:id/archive', () => {
    it('archives a session and returns 200', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const { app } = createTestApp({ manager });
      const res = await app.request(`/api/v1/sessions/${session.id}/archive`, {
        method: 'PUT',
        headers: AUTH,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string; archived: boolean } };
      expect(body.data.id).toBe(session.id);
      expect(body.data.archived).toBe(true);
    });

    it('returns 404 for unknown session', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/sessions/nonexistent/archive', {
        method: 'PUT',
        headers: AUTH,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/sessions/:id/restore', () => {
    it('restores a session and returns 200', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      await manager.archiveSession(session.id);
      const { app } = createTestApp({ manager });
      const res = await app.request(`/api/v1/sessions/${session.id}/restore`, {
        method: 'PUT',
        headers: AUTH,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { id: string; restored: boolean } };
      expect(body.data.id).toBe(session.id);
      expect(body.data.restored).toBe(true);
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('returns sessions from snapshot', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const { app } = createTestApp({ manager });
      const res = await app.request('/api/v1/sessions', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(session.id);
    });

    it('returns archived sessions when archive=archived', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      await manager.archiveSession(session.id);
      const { app } = createTestApp({ manager });
      const res = await app.request('/api/v1/sessions?archive=archived', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(session.id);
    });
  });

  describe('GET /api/v1/settings', () => {
    it('returns settings with 200', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/settings', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: AppSettings };
      expect(body.ok).toBe(true);
      expect(body.data).toBeDefined();
      expect(typeof body.data.shellPath).toBe('string');
    });
  });

  describe('PUT /api/v1/settings/:key', () => {
    it('updates a setting and returns 200', async () => {
      const { app, manager } = createTestApp();
      const spy = vi.spyOn(manager, 'setSetting');
      const res = await app.request('/api/v1/settings/shellPath', {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: '/bin/zsh' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { key: string; updated: boolean } };
      expect(body.data.key).toBe('shellPath');
      expect(body.data.updated).toBe(true);
      expect(spy).toHaveBeenCalledWith('shellPath', '/bin/zsh');
    });

    it('returns 422 for unknown key', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/settings/nonexistentKey', {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x' }),
      });
      expect(res.status).toBe(422);
    });

    it('returns 422 when value is missing', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/settings/shellPath', {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('Settings detection stubs', () => {
    it('POST /settings/detect/shell returns 503', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/settings/detect/shell', {
        method: 'POST',
        headers: AUTH,
      });
      expect(res.status).toBe(503);
    });

    it('POST /settings/detect/provider returns 503', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/settings/detect/provider', {
        method: 'POST',
        headers: AUTH,
      });
      expect(res.status).toBe(503);
    });

    it('GET /settings/title-generation/models returns empty array', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/settings/title-generation/models', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /api/v1/sidebar', () => {
    it('returns sidebar state with 200', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/sidebar', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: SidebarState };
      expect(body.ok).toBe(true);
      expect(body.data.open).toBe(true);
      expect(body.data.activeTab).toBe('explorer');
      expect(body.data.width).toBe(260);
    });
  });

  describe('PUT /api/v1/sidebar', () => {
    it('updates sidebar state and returns 200', async () => {
      let currentState: SidebarState = makeDefaultSidebarState();
      const { app } = createTestApp({
        sidebarState: currentState,
        setSidebarState: (s) => { currentState = s; },
      });
      const res = await app.request('/api/v1/sidebar', {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open: false,
          activeTab: 'git',
          width: 300,
          sessionListWidth: 150,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: SidebarState };
      expect(body.data.open).toBe(false);
      expect(body.data.activeTab).toBe('git');
    });

    it('returns 422 when open is not boolean', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/sidebar', {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open: 'yes',
          activeTab: 'explorer',
          width: 200,
          sessionListWidth: 100,
        }),
      });
      expect(res.status).toBe(422);
    });

    it('returns 422 when activeTab is invalid', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/sidebar', {
        method: 'PUT',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open: true,
          activeTab: 'invalid',
          width: 200,
          sessionListWidth: 100,
        }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('Runtime bridge stubs', () => {
    function makeAppWithSession() {
      const manager = ProjectSessionManager.createForTest();
      return createTestApp({ manager });
    }

    it('POST /sessions/:id/restart returns 503 via runtime bridge stub', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/restart`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    });

    it('GET /sessions/:id/terminal-replay returns 503 via runtime bridge stub', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/terminal-replay`, { headers: AUTH });
      expect(res.status).toBe(503);
    });

    it('POST /sessions/:id/input returns 503 via runtime bridge stub', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/input`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'ls' }),
      });
      expect(res.status).toBe(503);
    });

    it('POST /sessions/:id/resize returns 503 via runtime bridge stub', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/resize`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      });
      expect(res.status).toBe(503);
    });
  });

  describe('Auth middleware', () => {
    it('returns 401 without auth header', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/bootstrap');
      expect(res.status).toBe(401);
    });

    it('returns 401 with wrong token', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/bootstrap', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
    });

    it('accepts session id + token pair', async () => {
      const { app } = createTestApp();
      const res = await app.request('/api/v1/bootstrap', {
        headers: {
          'x-stoa-session-id': 'sid-123',
          'x-stoa-session-token': 'tok-456',
        },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Session context export stubs', () => {
    function makeAppWithSession() {
      const manager = ProjectSessionManager.createForTest();
      return createTestApp({ manager });
    }

    it('GET /sessions/:id/context/full returns placeholder', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/context/full`, { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { sessionId: string; text: string } };
      expect(body.data.sessionId).toBe(session.id);
      expect(body.data.text).toBe('');
    });

    it('GET /sessions/:id/context/slim returns placeholder', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/context/slim`, { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { sessionId: string; text: string } };
      expect(body.data.sessionId).toBe(session.id);
      expect(body.data.text).toBe('');
    });

    it('GET /sessions/:id/evidence returns empty list', async () => {
      const { app, manager } = makeAppWithSession();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'shell-1' });
      const res = await app.request(`/api/v1/sessions/${session.id}/evidence`, { headers: AUTH });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });
  });

  describe('DELETE /projects/:id/sidecar', () => {
    it('returns 503 — not available in Stoa Server mode', async () => {
      const manager = ProjectSessionManager.createForTest();
      const project = await manager.createProject({ path: '/tmp/test-project', name: 'Test' });
      const { app } = createTestApp({ manager });
      const res = await app.request(`/api/v1/projects/${project.id}/sidecar`, {
        method: 'DELETE',
        headers: AUTH,
      });
      expect(res.status).toBe(503);
    });
  });
});
