/**
 * Static file serving route for the Vue SPA web client.
 * Serves built Vue assets from dist/web/ and falls back to index.html for SPA routing.
 *
 * Must be mounted AFTER all API routes so that /api/v1, /ctl, /hooks, and WebSocket
 * upgrades take priority over static file serving.
 */
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

export const staticRoutes = new Hono();

// Serve built Vue assets from dist/web/
staticRoutes.use('/assets/*', serveStatic({ root: './dist/web' }));

// SPA fallback: all non-API, non-ctl, non-hooks, non-ws routes serve index.html
staticRoutes.get('*', serveStatic({ root: './dist/web', path: 'index.html' }));
