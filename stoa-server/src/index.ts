/**
 * Stoa Server — entry point.
 * Wires up all services and starts the Hono HTTP server using @hono/node-server.
 */
import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { createApp, type AppDeps } from './app';
import { createDb } from './db/connection';
import type { StoaDb } from './db/connection';
import { SqliteBackend, JsonFileBackend } from './services/persistence-backend';
import { ProjectSessionManager } from './services/project-session-manager';
import { WsHub } from './ws/hub';
import { RuntimeBridgeHandler } from './ws/runtime-bridge-handler';
import { createLiveRuntimeBridge } from './routes/runtime-bridge';
import { attachWebSocketServer } from './ws/transport';
import {
  routeConnection,
  invokeOnMessage,
  type RoleRouterHandlers,
} from './ws/role-router';
import { MetaSessionManager } from './services/meta-session-manager';
import { MetaSessionProposalStore } from './services/meta-session-proposal';
import { SessionEventProcessor } from './services/session-event-processor';
import { DEFAULT_PORT } from './shared/constants';
import { isWebClientAvailable } from './shared/web-client-path';
import type { SidebarState } from 'stoa-shared';
import type {
  MemoryNotificationEvent,
  SessionPresenceSnapshot,
  ProjectObservabilitySnapshot,
  AppObservabilitySnapshot,
} from 'stoa-shared';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

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
const authToken = process.env.STOA_AUTH_TOKEN ?? 'stoa-dev-token';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const STOA_DIR = process.env.STOA_DIR ?? join(homedir(), '.stoa');
  const DB_PATH = join(STOA_DIR, 'server.db');

  // Ensure ~/.stoa exists
  mkdirSync(STOA_DIR, { recursive: true });

  // 1. Persistence backend — try SQLite, fall back to JSON files
  let db: StoaDb | null = null;
  let backend;
  try {
    db = createDb(DB_PATH);
    backend = new SqliteBackend(db);
    console.log(`Persistence: SQLite (${DB_PATH})`);
  } catch (error) {
    console.warn('SQLite backend failed, falling back to JSON files:', error instanceof Error ? error.message : error);
    backend = new JsonFileBackend();
    console.log('Persistence: JSON files');
  }

  // 2. WebSocket hub
  const wsHub = new WsHub();

  // 3. ProjectSessionManager — async factory loads from persistence
  const manager = await ProjectSessionManager.create(backend, {
    webhookPort: null,
    wsHub,
  });

  // 4. Runtime bridge — live handler (accepts provider connections over WS)
  const runtimeBridgeHandler = new RuntimeBridgeHandler();
  const runtimeBridge = createLiveRuntimeBridge(runtimeBridgeHandler);

  // 5. Sidebar state — in-memory
  let sidebarData: SidebarState = {
    open: true,
    activeTab: 'explorer',
    width: 260,
    sessionListWidth: 200,
    activeTabByProject: {},
  };

  // 6. Observability stubs — return empty data
  const getSessionPresence = (_sessionId: string): SessionPresenceSnapshot | null => null;

  const getProjectObservability = (_projectId: string): ProjectObservabilitySnapshot | null => null;

  const getAppObservability = (): AppObservabilitySnapshot => ({
    blockedProjectCount: 0,
    failedProjectCount: 0,
    totalUnreadTurns: 0,
    projectsNeedingAttention: [],
    providerHealthSummary: {},
    lastGlobalEventAt: null,
    sourceSequence: 0,
    updatedAt: new Date().toISOString(),
  });

  const listSessionEvents = (
    _sessionId: string,
    _options: { limit: number; cursor?: string; categories?: string[]; includeEphemeral?: boolean },
  ) => ({
    events: [] as Array<{ payload: Record<string, unknown> }>,
    nextCursor: null as string | null,
    hasMore: false,
  });

  // 7. Meta-sessions — requires DB
  let metaSessionManager;
  let proposalStore;
  if (db) {
    try {
      metaSessionManager = MetaSessionManager.create(db, { wsHub });
      proposalStore = new MetaSessionProposalStore(db);
      console.log('Meta-sessions: SQLite-backed');
    } catch (error) {
      console.warn('Meta-session services failed to initialise:', error instanceof Error ? error.message : error);
    }
  }

  if (!db || !metaSessionManager || !proposalStore) {
    console.error('Cannot start: meta-session services require SQLite. Ensure better-sqlite3 is installed.');
    process.exit(1);
  }

  const sessionEventProcessor = new SessionEventProcessor({
    manager,
    db,
    wsHub,
    runtimeBridge: runtimeBridgeHandler,
  });

  const handleMemoryNotification = (notification: Omit<MemoryNotificationEvent, 'id' | 'createdAt'>): void => {
    wsHub.broadcast('notification:memory', {
      id: `memory_${Date.now()}`,
      ...notification,
      createdAt: new Date().toISOString(),
    });
  };

  // ---------------------------------------------------------------------------
  // Assemble deps and create app
  // ---------------------------------------------------------------------------

  const deps: AppDeps = {
    projects: { manager },
    sessions: { manager, runtimeBridge },
    settings: { manager },
    observability: {
      manager,
      getSessionPresence,
      getProjectObservability,
      getAppObservability,
      listSessionEvents,
    },
    metaSessions: { manager: metaSessionManager, proposalStore },
    sidebar: {
      getSidebarState: () => sidebarData,
      setSidebarState: (s: SidebarState) => { sidebarData = s; },
    },
    fs: { wsHub },
    webhooks: {
      onEvent: async (event) => {
        await sessionEventProcessor.processEvent(event);
        return null;
      },
      onMemoryNotification: async (notification) => {
        handleMemoryNotification(notification);
        return null;
      },
      getSessionSecret: (sessionId) => (
        manager.snapshot().sessions.some((session) => session.id === sessionId)
          ? authToken
          : null
      ),
    },
  };

  const webClientAvailable = isWebClientAvailable();
  const serveWeb = web && webClientAvailable;

  const app = createApp(deps, {
    discovery: { webClient: serveWeb, lanMode },
    cors: true,
    webClient: serveWeb,
  });

  // ---------------------------------------------------------------------------
  // Start server
  // ---------------------------------------------------------------------------

  const server = serve({
    fetch: app.fetch,
    port,
  });

  // ---------------------------------------------------------------------------
  // WebSocket upgrade handler — /ws?token=...&role=runtime|web
  // ---------------------------------------------------------------------------

  const roleRouterHandlers: RoleRouterHandlers = {
    hub: wsHub,
    runtimeBridge: runtimeBridgeHandler,
    expectedToken: authToken,
    dispatchBinaryInput: (sessionId, base64Data) => {
      void runtimeBridge.binaryInput(sessionId, base64Data).catch((error) => {
        console.warn('[stoa-server] Failed to dispatch binary input', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  };

  attachWebSocketServer(server as Parameters<typeof attachWebSocketServer>[0], {
    onConnection: (req, conn) => {
      const result = routeConnection(req, conn, roleRouterHandlers);
      if (result.kind === 'accepted') {
        conn.on('message', (raw: string) => {
          invokeOnMessage(conn, raw);
        });
        conn.on('close', () => {
          result.dispose();
        });
      } else {
        conn.close(result.statusCode, result.reason);
      }
    },
  });

  console.log(`Stoa Server listening on port ${port}`);
  if (serveWeb) {
    console.log('Web client: enabled (serving from stoa-server/dist/web/)');
  } else if (web && !webClientAvailable) {
    console.log('Web client: requested but stoa-server/dist/web/ not found — run the web build first');
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
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

start().catch((error) => {
  console.error('Failed to start Stoa Server:', error);
  process.exit(1);
});
