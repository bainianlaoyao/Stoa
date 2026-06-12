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
import { SqliteBackend, JsonFileBackend } from './services/persistence-backend';
import { ProjectSessionManager } from './services/project-session-manager';
import { WsHub } from './ws/hub';
import { createStubRuntimeBridge } from './routes/runtime-bridge';
import { MetaSessionManager } from './services/meta-session-manager';
import { MetaSessionProposalStore } from './services/meta-session-proposal';
import { DEFAULT_PORT } from './shared/constants';
import { isWebClientAvailable } from './routes/discovery';
import type { SidebarState } from 'stoa-shared';
import type {
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

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const STOA_DIR = join(homedir(), '.stoa');
  const DB_PATH = join(STOA_DIR, 'server.db');

  // Ensure ~/.stoa exists
  mkdirSync(STOA_DIR, { recursive: true });

  // 1. Persistence backend — try SQLite, fall back to JSON files
  let backend;
  let db;
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

  // 4. Runtime bridge stub (503 until a real runtime connects)
  const runtimeBridge = createStubRuntimeBridge();

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

  if (!metaSessionManager || !proposalStore) {
    console.error('Cannot start: meta-session services require SQLite. Ensure better-sqlite3 is installed.');
    process.exit(1);
  }

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
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

start().catch((error) => {
  console.error('Failed to start Stoa Server:', error);
  process.exit(1);
});
