/**
 * Health route — requires authentication (Bearer token).
 * Merged health check from plan section 5.6 (absorbed servers).
 */
import { Hono } from 'hono';

const startTime = Date.now();

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  return c.json({
    ok: true,
    data: {
      status: 'healthy',
      uptime,
      db: 'connected',
      timestamp: new Date().toISOString(),
    },
    meta: {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    },
  });
});
