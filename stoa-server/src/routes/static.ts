/**
 * Static file serving route for the Vue SPA web client.
 * Serves built Vue assets from dist/web/ and falls back to index.html for SPA routing.
 *
 * Must be mounted AFTER all API routes so that /api/v1, /ctl, /hooks, and WebSocket
 * upgrades take priority over static file serving.
 */
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolveWebClientRoot } from '../shared/web-client-path';

export const staticRoutes = new Hono();
const webClientRoot = resolveWebClientRoot()
const serveIndex = serveStatic({ root: webClientRoot, path: 'index.html' })

// Serve built Vue assets from dist/web/
staticRoutes.use('/assets/*', serveStatic({ root: webClientRoot }));

// SPA fallback: all non-API, non-ctl, non-hooks, non-ws routes serve index.html
staticRoutes.get('*', (c, next) => {
  const path = c.req.path
  if (
    path.startsWith('/api/')
    || path === '/ctl'
    || path.startsWith('/ctl/')
    || path === '/events'
    || path === '/memory-notifications'
    || path.startsWith('/hooks/')
    || path === '/ws'
    || path.startsWith('/ws/')
  ) {
    return c.notFound()
  }
  return serveIndex(c, next)
});
