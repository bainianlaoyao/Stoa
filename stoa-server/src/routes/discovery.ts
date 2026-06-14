/**
 * Discovery route — returns server identity without authentication.
 * Plan section 9.4: unauthenticated by design.
 */
import { Hono } from 'hono';
import { SERVER_NAME, SERVER_VERSION } from '../shared/constants';
import { isWebClientAvailable } from '../shared/web-client-path';

const startTime = Date.now();

export interface DiscoveryOptions {
  /** Whether the web client static files are available. */
  webClient?: boolean;
  /** Whether the server is running in LAN mode. */
  lanMode?: boolean;
}

export function createDiscoveryRoutes(options: DiscoveryOptions = {}): Hono {
  const routes = new Hono();

  routes.get('/', (c) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    return c.json({
      ok: true,
      data: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        port: Number(c.req.header('host')?.split(':')[1] ?? 3270),
        uptime,
        webClient: options.webClient ?? false,
        lanMode: options.lanMode ?? false,
      },
      meta: {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
    });
  });

  return routes;
}

/**
 * Default discovery routes without web client info.
 * Retained for backward compatibility — use createDiscoveryRoutes() for full options.
 */
export const discoveryRoutes = createDiscoveryRoutes();
