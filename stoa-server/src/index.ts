/**
 * Stoa Server — entry point.
 * Starts the Hono HTTP server using @hono/node-server.
 */
import { serve } from '@hono/node-server';
import { app } from './app';
import { staticRoutes } from './routes/static';
import { DEFAULT_PORT } from './shared/constants';
import { isWebClientAvailable } from './routes/discovery';

function parseArgs(): { port: number; web: boolean; lanMode: boolean } {
  const args = process.argv;
  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
  let web = false;
  let lanMode = process.env.STOA_LAN_MODE === 'true' || process.env.STOA_LAN_MODE === '1';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const p = parseInt(args[i + 1], 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) port = p;
    }
    if (args[i] === '--web') web = true;
    if (args[i] === '--lan') lanMode = true;
  }

  if (Number.isNaN(port)) port = DEFAULT_PORT;
  return { port, web, lanMode };
}

const { port, web, lanMode } = parseArgs();
const webClientAvailable = isWebClientAvailable();
const serveWeb = web && webClientAvailable;

// Mount static routes LAST so API routes (/api/v1, /ctl, /hooks) and
// WebSocket upgrades take priority over static file serving.
if (serveWeb) {
  app.route('/', staticRoutes);
}

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`Stoa Server listening on port ${port}`);
if (serveWeb) {
  console.log('Web client: enabled (serving from dist/web/)');
} else if (web && !webClientAvailable) {
  console.log('Web client: requested but dist/web/ not found — run the web build first');
} else {
  console.log('Web client: disabled (start with --web to enable)');
}
if (lanMode) {
  console.log('LAN mode: enabled');
}

function gracefulShutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('Stoa Server stopped.');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
