/**
 * Tests for Hono server routes and middleware.
 * Uses app.request() for HTTP-level testing without starting a real server.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware } from '../middleware/auth';
import { createErrorHandler } from '../middleware/error-handler';
import { AppError, type ApiResponse } from '../shared/errors';
import { discoveryRoutes } from './discovery';
import { healthRoutes } from './health';

const AUTH_TOKEN = 'stoa-dev-token';

async function parseResponse(res: Response): Promise<ApiResponse> {
  return (await res.json()) as ApiResponse;
}

function createTestApp(): Hono {
  const app = new Hono();
  app.onError(createErrorHandler());
  app.use('*', createAuthMiddleware(AUTH_TOKEN));
  app.route('/api/v1/discovery', discoveryRoutes);
  app.route('/ctl', healthRoutes);
  return app;
}

describe('GET /api/v1/discovery', () => {
  const app = createTestApp();

  it('should return 200 with server info', async () => {
    const res = await app.request('/api/v1/discovery');
    expect(res.status).toBe(200);

    const body = await parseResponse(res);
    expect(body.ok).toBe(true);
    const data = body.data as { name: string; version: string; uptime: number };
    expect(data.name).toBe('stoa');
    expect(data.version).toBe('0.1.0');
    expect(typeof data.uptime).toBe('number');
  });

  it('should not require authentication', async () => {
    const res = await app.request('/api/v1/discovery');
    expect(res.status).toBe(200);
  });

  it('should return correct ApiResponse structure with meta.requestId and meta.timestamp', async () => {
    const res = await app.request('/api/v1/discovery');
    const body = await parseResponse(res);

    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('requestId');
    expect(body.meta).toHaveProperty('timestamp');
    expect(typeof body.meta.requestId).toBe('string');
    expect(body.meta.requestId.length).toBeGreaterThan(0);
    expect(typeof body.meta.timestamp).toBe('string');
    // Validate ISO timestamp format
    expect(new Date(body.meta.timestamp).toISOString()).toBe(body.meta.timestamp);
  });
});

describe('GET /ctl/health', () => {
  const app = createTestApp();

  it('should return 200 with health status when authenticated', async () => {
    const res = await app.request('/ctl/health', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status).toBe(200);

    const body = await parseResponse(res);
    expect(body.ok).toBe(true);
    const data = body.data as { status: string };
    expect(data.status).toBe('healthy');
  });

  it('should return 401 without authentication', async () => {
    const res = await app.request('/ctl/health');
    expect(res.status).toBe(401);
  });

  it('should return 401 with invalid token', async () => {
    const res = await app.request('/ctl/health', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('should return health data with status, uptime, timestamp', async () => {
    const res = await app.request('/ctl/health', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const body = await parseResponse(res);
    const data = body.data as { status: string; uptime: number; timestamp: string };

    expect(data).toHaveProperty('status', 'healthy');
    expect(data).toHaveProperty('uptime');
    expect(typeof data.uptime).toBe('number');
    expect(data).toHaveProperty('timestamp');
    expect(typeof data.timestamp).toBe('string');
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });
});

describe('Auth Middleware', () => {
  const app = createTestApp();

  it('should accept valid Bearer token', async () => {
    const res = await app.request('/ctl/health', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it('should reject missing token', async () => {
    const res = await app.request('/ctl/health');
    expect(res.status).toBe(401);
  });

  it('should reject invalid token', async () => {
    const res = await app.request('/ctl/health', {
      headers: { Authorization: 'Bearer invalid-token-value' },
    });
    expect(res.status).toBe(401);
  });

  it('should accept session-scoped token pair (x-stoa-session-id + x-stoa-session-token)', async () => {
    const res = await app.request('/ctl/health', {
      headers: {
        'x-stoa-session-id': 'session-abc-123',
        'x-stoa-session-token': 'token-xyz-456',
      },
    });
    expect(res.status).toBe(200);
  });

  it('should skip auth for discovery endpoint', async () => {
    const res = await app.request('/api/v1/discovery');
    expect(res.status).toBe(200);
  });
});

describe('Error Handler', () => {
  const app = new Hono();
  app.onError(createErrorHandler());
  app.use('*', createAuthMiddleware(AUTH_TOKEN));

  // Test route that throws AppError
  app.get('/test-app-error', () => {
    throw new AppError({
      code: 'not_found',
      message: 'Resource not found',
      statusCode: 404,
      details: { resource: 'session-123' },
      nextSteps: ['Try a different session ID'],
    });
  });

  // Test route that throws a generic error
  app.get('/test-unknown-error', () => {
    throw new Error('Something completely unexpected');
  });

  it('should format AppError correctly', async () => {
    const res = await app.request('/test-app-error', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status).toBe(404);

    const body = await parseResponse(res);
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe('not_found');
    expect(body.error!.message).toBe('Resource not found');
    expect(body.error!.details).toEqual({ resource: 'session-123' });
    expect(body.error!.nextSteps).toEqual(['Try a different session ID']);
  });

  it('should handle unknown errors with 500', async () => {
    const res = await app.request('/test-unknown-error', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status).toBe(500);

    const body = await parseResponse(res);
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe('internal_error');
    expect(body.error!.message).toBe('An unexpected error occurred');
  });

  it('should include requestId in all responses', async () => {
    const res = await app.request('/test-app-error', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const body = await parseResponse(res);

    expect(body.meta).toHaveProperty('requestId');
    expect(typeof body.meta.requestId).toBe('string');
    expect(body.meta.requestId.length).toBeGreaterThan(0);

    // Also check the 500 path
    const res500 = await app.request('/test-unknown-error', {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const body500 = await parseResponse(res500);
    expect(body500.meta).toHaveProperty('requestId');
    expect(typeof body500.meta.requestId).toBe('string');
    expect(body500.meta.requestId.length).toBeGreaterThan(0);
  });
});
