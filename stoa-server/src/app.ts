/**
 * Stoa Server — Hono application setup.
 * Mounts global middleware and route groups.
 *
 * Route groups are mounted as sub-apps. Each group factory takes typed
 * dependencies and returns a Hono instance. The app wires them together
 * here; actual service instances are injected from index.ts or tests.
 */
import { Hono } from 'hono';
import { createErrorHandler } from './middleware/error-handler';
import { createAuthMiddleware } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import { staticRoutes } from './routes/static';
import { createDiscoveryRoutes, type DiscoveryOptions } from './routes/discovery';
import { healthRoutes } from './routes/health';
import type { ProjectsRouteDeps } from './routes/projects';
import type { SessionsRouteDeps } from './routes/sessions';
import type { SettingsRouteDeps } from './routes/settings';
import type { ObservabilityRouteDeps } from './routes/observability';
import type { MetaSessionsRouteDeps } from './routes/meta-sessions';
import type { SidebarRouteDeps } from './routes/sidebar';
import { createProjectsRoutes } from './routes/projects';
import { createSessionsRoutes } from './routes/sessions';
import { createSettingsRoutes } from './routes/settings';
import { createObservabilityRoutes } from './routes/observability';
import { createMetaSessionsRoutes } from './routes/meta-sessions';
import { createSidebarRoutes } from './routes/sidebar';

export interface AppDeps {
  projects: ProjectsRouteDeps;
  sessions: SessionsRouteDeps;
  settings: SettingsRouteDeps;
  observability: ObservabilityRouteDeps;
  metaSessions: MetaSessionsRouteDeps;
  sidebar: SidebarRouteDeps;
}

export interface CreateAppOptions {
  discovery?: DiscoveryOptions;
  /** Enable CORS middleware globally. Default: false. */
  cors?: boolean;
  /** Enable static file serving for the web client. Default: false. */
  webClient?: boolean;
}

export function createApp(deps: AppDeps, options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  // Global error handler — must be set before routes
  app.onError(createErrorHandler());

  // CORS middleware — must be before auth so preflight OPTIONS pass through
  if (options.cors) {
    app.use('*', corsMiddleware);
  }

  // Auth middleware — skips /api/v1/discovery internally
  app.use('*', createAuthMiddleware());

  // Unauthenticated routes
  app.route('/api/v1/discovery', createDiscoveryRoutes(options.discovery));
  app.route('/ctl', healthRoutes);

  // Authenticated /api/v1 route groups
  app.route('/api/v1', createProjectsRoutes(deps.projects));
  app.route('/api/v1', createSessionsRoutes(deps.sessions));
  app.route('/api/v1', createSettingsRoutes(deps.settings));
  app.route('/api/v1', createObservabilityRoutes(deps.observability));
  app.route('/api/v1', createMetaSessionsRoutes(deps.metaSessions));
  app.route('/api/v1', createSidebarRoutes(deps.sidebar));

  // Static file serving for the Vue web client — mounted LAST so API routes
  // (/api/v1, /ctl, /hooks) and WebSocket upgrades take priority.
  if (options.webClient) {
    app.route('/', staticRoutes);
  }

  return app;
}

/**
 * Default app instance with no routes mounted.
 * For production use, call `createApp(deps)` instead.
 */
export const app = new Hono();

app.onError(createErrorHandler());
app.use('*', createAuthMiddleware());
app.route('/api/v1/discovery', createDiscoveryRoutes());
app.route('/ctl', healthRoutes);
