/**
 * Integration tests for webhook routes — Phase 2b.
 *
 * Tests:
 *   POST /events — canonical session events
 *   POST /hooks/claude-code — Claude Code provider adapter
 *   POST /hooks/codex — Codex provider adapter
 *   POST /hooks/opencode — OpenCode provider adapter
 *   POST /memory-notifications — memory runtime notifications
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { CanonicalSessionEvent } from 'stoa-shared';
import { createWebhookRoutes } from './webhooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WebhookBody {
  accepted: boolean;
  reason?: string;
}

interface HandlerResult {
  processed: boolean;
}

interface MemoryAck {
  acknowledged: boolean;
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function makeValidEvent(overrides: Partial<CanonicalSessionEvent> = {}): CanonicalSessionEvent {
  return {
    event_version: 1,
    event_id: 'evt_test_001',
    event_type: 'test.event',
    timestamp: new Date().toISOString(),
    session_id: 'session_test1',
    project_id: 'project_test1',
    source: 'hook-sidecar',
    payload: {
      intent: 'runtime.alive',
      summary: 'Session is alive',
    },
    ...overrides,
  };
}

function makeAuthHeaders(secret: string, sessionId?: string, projectId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-stoa-secret': secret,
  };
  if (sessionId) headers['x-stoa-session-id'] = sessionId;
  if (projectId) headers['x-stoa-project-id'] = projectId;
  return headers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Webhook routes', () => {
  describe('POST /events — canonical session events', () => {
    it('returns 202 for a valid event when handler is undefined', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'test-secret',
      }));

      const event = makeValidEvent();
      const res = await app.request('/events', {
        method: 'POST',
        headers: makeAuthHeaders('test-secret'),
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(202);
      const body = await parseBody<WebhookBody>(res);
      expect(body.accepted).toBe(true);
    });

    it('returns 200 when onEvent handler returns a value', async () => {
      const onEvent = vi.fn().mockResolvedValue({ processed: true });
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        onEvent,
        getSessionSecret: () => 'test-secret',
      }));

      const event = makeValidEvent();
      const res = await app.request('/events', {
        method: 'POST',
        headers: makeAuthHeaders('test-secret'),
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(200);
      const body = await parseBody<HandlerResult>(res);
      expect(body.processed).toBe(true);
      expect(onEvent).toHaveBeenCalledWith(event);
    });

    it('returns 400 for an invalid event', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'test-secret',
      }));

      const res = await app.request('/events', {
        method: 'POST',
        headers: makeAuthHeaders('test-secret'),
        body: JSON.stringify({ invalid: true }),
      });
      expect(res.status).toBe(400);
      const body = await parseBody<WebhookBody>(res);
      expect(body.accepted).toBe(false);
      expect(body.reason).toBe('invalid_event');
    });

    it('returns 401 when secret does not match', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'correct-secret',
      }));

      const event = makeValidEvent();
      const res = await app.request('/events', {
        method: 'POST',
        headers: makeAuthHeaders('wrong-secret'),
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(401);
      const body = await parseBody<WebhookBody>(res);
      expect(body.accepted).toBe(false);
      expect(body.reason).toBe('invalid_secret');
    });

    it('returns 401 when no secret is configured for the session', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => null,
      }));

      const event = makeValidEvent();
      const res = await app.request('/events', {
        method: 'POST',
        headers: makeAuthHeaders('any-secret'),
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /hooks/claude-code', () => {
    it('returns 400 when session-id and project-id headers are missing', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/hooks/claude-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await parseBody<WebhookBody>(res);
      expect(body.reason).toBe('invalid_hook_context');
    });

    it('returns 401 when secret does not match', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'correct-secret',
      }));

      const res = await app.request('/hooks/claude-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 'session_1',
          'x-stoa-project-id': 'project_1',
          'x-stoa-secret': 'wrong-secret',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it('returns 204 when adapter returns null (unrecognized hook event)', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      // body without hook_event_name — adaptClaudeCodeHook returns null
      const res = await app.request('/hooks/claude-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 'session_1',
          'x-stoa-project-id': 'project_1',
          'x-stoa-secret': 'secret',
        },
        body: JSON.stringify({ some_field: 'value' }),
      });
      expect(res.status).toBe(204);
    });

    it('uses authorizeHookRequest when provided', async () => {
      const authorizeHookRequest = vi.fn().mockResolvedValue({
        ok: true,
        lease: { sessionId: 'session_1', projectId: 'project_1', provider: 'claude-code' },
      });
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        authorizeHookRequest,
      }));

      // body without hook_event_name — returns 204
      const res = await app.request('/hooks/claude-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 'session_1',
          'x-stoa-project-id': 'project_1',
          'x-stoa-secret': 'any',
        },
        body: JSON.stringify({ some_field: 'value' }),
      });
      expect(authorizeHookRequest).toHaveBeenCalledWith({
        sessionId: 'session_1',
        projectId: 'project_1',
        provider: 'claude-code',
        secret: 'any',
      });
      expect(res.status).toBe(204);
    });
  });

  describe('POST /hooks/codex', () => {
    it('returns 400 when session-id and project-id headers are missing', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/hooks/codex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 with wrong secret', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/hooks/codex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 's1',
          'x-stoa-project-id': 'p1',
          'x-stoa-secret': 'wrong',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /hooks/opencode', () => {
    it('returns 400 when session-id and project-id headers are missing', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/hooks/opencode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 with wrong secret', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/hooks/opencode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 's1',
          'x-stoa-project-id': 'p1',
          'x-stoa-secret': 'wrong',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /memory-notifications', () => {
    it('returns 202 for a valid memory notification', async () => {
      const onMemoryNotification = vi.fn().mockResolvedValue(undefined);
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        onMemoryNotification,
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/memory-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 'session_1',
          'x-stoa-project-id': 'project_1',
          'x-stoa-secret': 'secret',
        },
        body: JSON.stringify({
          kind: 'recall',
          status: 'success',
          title: 'Memory recalled',
          message: 'Successfully recalled memory',
        }),
      });
      expect(res.status).toBe(202);
      const body = await parseBody<WebhookBody>(res);
      expect(body.accepted).toBe(true);
      expect(onMemoryNotification).toHaveBeenCalledWith({
        sessionId: 'session_1',
        projectId: 'project_1',
        kind: 'recall',
        status: 'success',
        title: 'Memory recalled',
        message: 'Successfully recalled memory',
      });
    });

    it('returns 400 when session-id and project-id headers are missing', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/memory-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'recall',
          status: 'success',
          title: 'Title',
          message: 'Message',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid notification payload', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/memory-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 's1',
          'x-stoa-project-id': 'p1',
          'x-stoa-secret': 'secret',
        },
        body: JSON.stringify({ kind: 'invalid-kind' }),
      });
      expect(res.status).toBe(400);
      const body = await parseBody<WebhookBody>(res);
      expect(body.reason).toBe('invalid_memory_notification');
    });

    it('returns 401 when secret does not match', async () => {
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        getSessionSecret: () => 'correct-secret',
      }));

      const res = await app.request('/memory-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 's1',
          'x-stoa-project-id': 'p1',
          'x-stoa-secret': 'wrong',
        },
        body: JSON.stringify({
          kind: 'recall',
          status: 'success',
          title: 'Title',
          message: 'Message',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 200 when handler returns a value', async () => {
      const onMemoryNotification = vi.fn().mockResolvedValue({ acknowledged: true });
      const app = new Hono();
      app.route('/', createWebhookRoutes({
        onMemoryNotification,
        getSessionSecret: () => 'secret',
      }));

      const res = await app.request('/memory-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stoa-session-id': 's1',
          'x-stoa-project-id': 'p1',
          'x-stoa-secret': 'secret',
        },
        body: JSON.stringify({
          kind: 'distill',
          status: 'info',
          title: 'Distilled',
          message: 'Memory distilled',
        }),
      });
      expect(res.status).toBe(200);
      const body = await parseBody<MemoryAck>(res);
      expect(body.acknowledged).toBe(true);
    });
  });
});
