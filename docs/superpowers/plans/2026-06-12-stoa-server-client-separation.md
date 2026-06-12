# Stoa Server/Client Separation — Implementation Plan

> **Status**: Draft v3 (final — all reviewer conditions addressed)
> **Date**: 2026-06-12
> **Breaking Change**: Yes — prototype phase, no backward compatibility
> **Estimated Timeline**: 14–16 weeks

---

## Changelog

### v1 → v2 (3× Conditional Approve → v2 revision)
| Issue | Source | Fix |
|-------|--------|-----|
| MetaSession domain missing | Architecture + API review | Added full MetaSession section |
| Sessions table missing ~15 columns | Architecture + API review | Complete schema |
| SR-to-Electron runtime protocol missing | Migration review | Added §6 Runtime Bridge Protocol |
| Phase 4 Big Bang risk | Migration review | Split into 5 sub-phases |
| Monorepo rename breaks imports | Migration review | stoa-server as sibling, no root rename |
| Terminal data pipeline not designed | Migration review | Added §6.3 pipeline |
| 19 IPC channels unmapped | API review | All 80 IPC channels mapped |
| No API version/pagination/error standards | API review | Added /api/v1/, cursor pagination, error registry |
| Phase 2 REST without WS | Architecture review | Merged WS hub into Phase 2 |
| Timeline underestimated | Migration review | Revised to 14–16 weeks |

### v2 → v3 (3× Conditional Approve → final precision fixes)
| Issue | Source | Fix |
|-------|--------|-----|
| session_events missing evidence field | Architecture review | Added `evidence TEXT` column + extraction note |
| MetaSession schema missing 9 fields | Architecture review | Added title, archived, inspector_target, last_activated_at, etc. |
| MetaSession proposals missing timestamps/kind/preset | Architecture review | Added approved_at, rejected_at, executed_at, kind, preset_name |
| /ctl/* routes no explicit mapping | API review | Full route tables for all 18 session-control + 28 meta-session routes |
| Sessions table "1:1 match" inaccurate | Architecture review | Changed to "superset" with documented differences |
| Runtime bridge no timeout semantics | API review | Added §6.5 per-command timeout table |
| SR crash recovery missing | Migration review | Added §6.6 crash recovery protocol |
| No rate limiting | API review | Added rate limit config per route group |
| Concurrent client access undefined | API review | Added per-domain concurrency semantics |
| Drizzle migration workflow missing | Migration review | Added drizzle-kit workflow to Phase 1 |
| stoa-ctl port file mechanism | Migration review | Added port discovery note to §10.4 |
| FS watcher design deferred | Architecture review | Marked as "deferred: design before Phase 2b" |
| WS back-pressure deferred | Architecture review | Marked as "deferred: design before Phase 3" |

---

## 1. Overview

### 1.1 Goal

Extract Stoa's core business logic from the Electron main process into an independent **Stoa Server (SR)** that exposes REST + WebSocket APIs. Clients (Electron, Web, future Android) connect to SR via HTTP/WS.

### 1.2 Scope

**IN scope**: Project-session management, settings, file system, git, observability, meta-session, webhooks, session control, subagent coordination

**OUT of scope**: Terminal PTY emulation (Electron only), auto-update (client-side), native dialogs (Electron only)

### 1.3 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Windows / Mac / Linux                     │
│                                                                 │
│  ┌──────────────────────┐        ┌──────────────────────────┐   │
│  │  Electron Shell      │        │  Stoa Server (SR)         │   │
│  │  ("Fat Client")      │        │                            │   │
│  │                      │        │  Hono REST API             │   │
│  │  - PTY host          │◄──────►│  Hono WebSocket Hub        │   │
│  │  - Native dialogs    │  RPC   │  Static File Server        │   │
│  │  - Window mgmt       │ bridge │  SQLite (WAL)              │   │
│  │  - Auto-update       │        │  Services (business logic) │   │
│  │  - Shell integration │        │  Meta-session engine       │   │
│  └──────────┬───────────┘        └──────────┬───────────────┘   │
│             │ WS                              │ WS / REST         │
│             ▼                                 ▼                   │
│        ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│        │ Renderer │   │  Web     │   │  PWA /   │               │
│        │ (Electron│   │ Browser │   │ Android  │               │
│        │  window) │   │  tab    │   │  app     │               │
│        └──────────┘   └──────────┘   └──────────┘               │
└─────────────────────────────────────────────────────────────────┘
                         Remote access via:
                         - Port forwarding
                         - SSH tunnel
                         - NAT traversal
```

**Key insight**: Electron shell is NOT a "thin client". It is a **runtime-capable client** that holds PTY processes and native OS integrations. SR is the data/state center. They communicate via a bidirectional "Runtime Bridge Protocol" (§6).

---

## 2. Technology Decisions

### 2.1 Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| HTTP framework | **Hono v4** | 14KB, built-in WS, multi-runtime, TS-native |
| ORM | **Drizzle ORM** | TS-native, schema-as-code, SQLite-first, type-safe queries worth the ~200KB cost for 30+ column tables |
| Database | **better-sqlite3** (existing) | WAL mode, sync API, single-file DB |
| Real-time | **Hono WebSocket** (built-in) | No extra deps; terminal data multiplexed with back-pressure monitoring |
| Validation | **Zod** | Shared schemas between SR and all clients |
| Runtime | **Node.js** (not Bun) | better-sqlite3 is a native addon; Bun compat layer is unstable. Benchmark later. |

### 2.2 Monorepo Structure (No Root Rename)

```
ultra_simple_panel/              ← Existing root stays as-is
├── package.json                 ← Add "workspaces": ["stoa-server", "stoa-shared"]
├── src/                         ← Existing code, NOT renamed
├── tests/                       ← Existing tests, NOT moved
├── stoa-shared/                 ← NEW: shared types + Zod schemas
│   ├── types/
│   │   ├── project-session.ts   ← from src/shared/project-session.ts
│   │   ├── observability.ts
│   │   ├── meta-session.ts
│   │   ├── sidebar-types.ts
│   │   └── memory-runtime.ts
│   ├── schemas/                 ← NEW: Zod validation schemas
│   │   ├── api-requests.ts
│   │   ├── api-responses.ts
│   │   └── ws-events.ts
│   └── package.json
├── stoa-server/                 ← NEW: SR package
│   ├── src/
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── db/
│   │   │   ├── schema.ts        ← Drizzle schema
│   │   │   ├── connection.ts    ← SQLite + WAL
│   │   │   └── migrations/
│   │   ├── routes/
│   │   │   ├── bootstrap.ts
│   │   │   ├── projects.ts
│   │   │   ├── sessions.ts
│   │   │   ├── meta-sessions.ts ← NEW
│   │   │   ├── settings.ts
│   │   │   ├── fs.ts
│   │   │   ├── git.ts
│   │   │   ├── subagents.ts
│   │   │   ├── observability.ts
│   │   │   ├── webhooks.ts
│   │   │   ├── control.ts       ← Absorbs session-control-server
│   │   │   ├── meta-control.ts  ← NEW: absorbs meta-session-control-server
│   │   │   ├── discovery.ts
│   │   │   ├── runtime-bridge.ts ← NEW: internal RPC from Electron
│   │   │   └── static.ts
│   │   ├── services/
│   │   │   ├── project-session-manager.ts
│   │   │   ├── session-supervisor.ts
│   │   │   ├── subagent-supervisor.ts
│   │   │   ├── meta-session-manager.ts     ← NEW
│   │   │   ├── meta-session-context.ts      ← NEW
│   │   │   ├── meta-session-proposal.ts     ← NEW
│   │   │   ├── meta-session-dispatcher.ts   ← NEW
│   │   │   ├── settings-service.ts
│   │   │   ├── fs-service.ts
│   │   │   ├── git-service.ts
│   │   │   ├── observability-service.ts
│   │   │   └── session-event-processor.ts   ← Absorbs session-event-bridge
│   │   ├── ws/
│   │   │   ├── hub.ts
│   │   │   ├── events.ts
│   │   │   └── broadcast.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts           ← Token auth
│   │   │   ├── visibility.ts     ← Session visibility enforcement
│   │   │   ├── path-validation.ts ← FS path traversal guard
│   │   │   └── error-handler.ts
│   │   └── shared/
│   │       ├── errors.ts         ← Unified error code registry
│   │       └── constants.ts
│   ├── drizzle.config.ts
│   ├── package.json
│   └── tsconfig.json
└── tools/stoa-ctl/               ← Existing, minor auth update
```

**Why no rename**: Renaming root to `stoa-desktop` would break all 139+ test files, all `@core/` `@shared/` path aliases, all vite configs, all CI scripts. Instead, `stoa-server/` and `stoa-shared/` are added as workspace siblings.

---

## 3. SQLite Schema Design

### 3.1 Projects Table

```sql
CREATE TABLE projects (
  id                    TEXT PRIMARY KEY,
  path                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,           -- matches PersistedProject.name
  default_session_type  TEXT,                     -- nullable
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.2 Sessions Table

> **Note**: This table is a superset of `PersistedSession`, not a strict 1:1 match.
> Extra columns (`session_phase`, `command`, `cwd`, `sort_order`, `subagent_epoch`,
> `subagent_short_name`) are denormalized from runtime state for query convenience.
> Naming differences: `turn_outcome` (here) vs `last_turn_outcome` (PersistedSession),
> `archive_state TEXT` (here) vs `archived BOOLEAN` (PersistedSession — richer here).

```sql
CREATE TABLE sessions (
  id                                 TEXT PRIMARY KEY,
  project_id                         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id                          TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_by_session_id              TEXT,                          -- which session created this
  type                               TEXT NOT NULL,                 -- 'shell'|'opencode'|'codex'|'claude-code'
  title                              TEXT,
  runtime_state                      TEXT NOT NULL DEFAULT 'created',
  turn_state                         TEXT NOT NULL DEFAULT 'idle',
  turn_outcome                       TEXT NOT NULL DEFAULT 'none',
  turn_epoch                         INTEGER NOT NULL DEFAULT 0,
  session_phase                      TEXT NOT NULL DEFAULT 'ready',
  blocking_reason                    TEXT,
  failure_reason                     TEXT,
  has_unseen_completion              INTEGER NOT NULL DEFAULT 0,   -- boolean
  command                            TEXT,
  cwd                                TEXT,
  runtime_exit_code                  INTEGER,                      -- nullable
  runtime_exit_reason                TEXT,                          -- 'clean'|'failed'|null
  last_state_sequence                INTEGER NOT NULL DEFAULT 0,
  last_summary                       TEXT,                          -- nullable
  external_session_id                TEXT,                          -- nullable, provider-specific
  title_generation                   TEXT,                          -- JSON: SessionTitleGenerationContext
  archive_state                      TEXT NOT NULL DEFAULT 'active',
  recovery_mode                      TEXT NOT NULL DEFAULT 'fresh-shell',
  last_activated_at                  TEXT,
  sort_order                         INTEGER NOT NULL DEFAULT 0,
  -- Subagent facade
  subagent_epoch                     INTEGER NOT NULL DEFAULT 0,
  subagent_short_name                TEXT,
  subagent_name                      TEXT,                          -- full name
  subagent_result_summary            TEXT,                          -- JSON, nullable
  subagent_input_epoch               INTEGER NOT NULL DEFAULT 0,
  subagent_latest_input_at           TEXT,
  subagent_latest_input_state_sequence INTEGER NOT NULL DEFAULT 0,
  subagent_result                    TEXT,                          -- JSON: SubagentResult, nullable
  -- Metadata
  created_at                         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.3 Session Events Table (queryable)

```sql
CREATE TABLE session_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence      INTEGER NOT NULL,            -- session-scoped sequence number
  event_version TEXT NOT NULL DEFAULT '1',
  event_id      TEXT NOT NULL,               -- unique event ID
  event_type    TEXT NOT NULL,
  intent        TEXT NOT NULL,               -- extracted for querying (e.g. 'agent.turn_started')
  source        TEXT NOT NULL,               -- 'hook-sidecar'|'provider-adapter'|'system-recovery'
  project_id    TEXT NOT NULL,
  correlation_id TEXT,
  turn_epoch    INTEGER,
  payload       TEXT NOT NULL,               -- JSON: full CanonicalSessionEvent.payload
  evidence      TEXT,                        -- JSON: MemoryRuntimeEvidence (nullable, top-level in CanonicalSessionEvent)
  timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Intent extraction logic: on INSERT, extract intent from payload JSON
-- using JSON_EXTRACT(payload, '$.intent') and store in intent column.
-- This is done via a SQLite trigger or application-level logic.
```

### 3.4 Meta-Session Tables

```sql
CREATE TABLE meta_sessions (
  id                      TEXT PRIMARY KEY,
  title                   TEXT,                         -- nullable display name
  backend_session_type    TEXT NOT NULL,               -- 'claude-code'|'codex'|'opencode'
  backend_session_id      TEXT,
  capability_level        INTEGER NOT NULL DEFAULT 0,  -- 0|1|2|3
  status                  TEXT NOT NULL DEFAULT 'created',
  archived                INTEGER NOT NULL DEFAULT 0,  -- boolean
  inspector_target        TEXT,                         -- JSON: MetaSessionInspectorTarget
  total_work_sessions     INTEGER NOT NULL DEFAULT 0,
  active_work_sessions    INTEGER NOT NULL DEFAULT 0,
  total_proposals         INTEGER NOT NULL DEFAULT 0,
  pending_proposals       INTEGER NOT NULL DEFAULT 0,
  last_summary            TEXT,
  last_risk_level         TEXT,
  last_risk_reason        TEXT,
  last_activated_at       TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Active meta session tracking (singleton row)
-- Stored in server_config: key='active_meta_session_id', value='<id>'

CREATE TABLE meta_session_proposals (
  id                      TEXT PRIMARY KEY,
  meta_session_id         TEXT NOT NULL REFERENCES meta_sessions(id) ON DELETE CASCADE,
  work_session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind                    TEXT NOT NULL DEFAULT 'prompt',   -- 'prompt'|'preset'
  preset_name             TEXT,                              -- nullable, for kind='preset'
  prompt_text             TEXT,                              -- nullable for preset kind
  status                  TEXT NOT NULL DEFAULT 'pending_approval',
  snapshot                TEXT NOT NULL,               -- JSON: MetaSessionProposalSnapshotSession
  risk_level              TEXT,
  risk_reason             TEXT,
  execution_result        TEXT,                        -- JSON, nullable
  staleness_reason        TEXT,
  approved_at             TEXT,
  rejected_at             TEXT,
  executed_at             TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meta_session_action_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_session_id   TEXT NOT NULL REFERENCES meta_sessions(id) ON DELETE CASCADE,
  proposal_id       TEXT REFERENCES meta_session_proposals(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,                      -- 'proposal.created'|'proposal.approved'|...
  detail            TEXT,                               -- nullable
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.5 Supporting Tables

```sql
-- Settings (single-row with key-value, or single blob)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                -- JSON
);

-- Observability (ephemeral)
CREATE TABLE session_presence (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,          -- JSON: SessionPresenceSnapshot
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session tokens (for /ctl/ auth)
CREATE TABLE session_tokens (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Server auth token
CREATE TABLE server_config (
  key   TEXT PRIMARY KEY,            -- e.g. 'auth_token', 'lan_mode'
  value TEXT NOT NULL
);

-- Sidebar state
CREATE TABLE sidebar_state (
  key   TEXT PRIMARY KEY,            -- 'global'
  value TEXT NOT NULL                -- JSON: SidebarState
);
```

### 3.6 Indexes

```sql
-- Sessions
CREATE INDEX idx_sessions_project_archive ON sessions(project_id, archive_state);
CREATE INDEX idx_sessions_parent ON sessions(parent_id);
CREATE INDEX idx_sessions_created_by ON sessions(created_by_session_id);
CREATE INDEX idx_sessions_archive ON sessions(archive_state);

-- Events
CREATE INDEX idx_events_session_sequence ON session_events(session_id, sequence);
CREATE INDEX idx_events_intent ON session_events(intent);
CREATE INDEX idx_events_timestamp ON session_events(timestamp);

-- Meta-sessions
CREATE INDEX idx_meta_proposals_session ON meta_session_proposals(meta_session_id);
CREATE INDEX idx_meta_proposals_status ON meta_session_proposals(status);
CREATE INDEX idx_meta_logs_session ON meta_session_action_logs(meta_session_id);
```

### 3.7 JSON → SQLite Migration Script

```typescript
// stoa-server/src/db/migrate-from-json.ts
interface MigrationReport {
  projectsMigrated: number;
  sessionsMigrated: number;
  metaSessionsMigrated: number;
  settingsMigrated: number;
  skipped: Array<{ file: string; reason: string }>;
  errors: Array<{ file: string; error: string }>;
}

async function migrateFromJson(stoaDir: string, db: Database): Promise<MigrationReport> {
  const report: MigrationReport = { ... };

  // 1. Validate source version
  const globalState = readGlobalState(stoaDir);
  if (globalState.version < 4) {
    throw new Error(`Cannot migrate from version ${globalState.version}. Minimum: v4.`);
  }

  // 2. Transactional migration
  db.transaction(() => {
    // 2a. Projects
    for (const project of globalState.projects) {
      db.insert/projects...

      // 2b. Sessions per project (skip corrupt files)
      try {
        const sessions = readProjectSessions(project.path);
        for (const session of sessions.sessions) {
          db.insert/sessions... (all 30+ columns, null defaults for missing fields)
        }
      } catch (e) {
        report.skipped.push({ file: project.path, reason: e.message });
      }
    }

    // 2c. Settings
    for (const [key, value] of Object.entries(globalState.settings)) {
      db.insert/settings...
    }

    // 2d. Meta-session state
    try {
      const metaState = readMetaSessionState(stoaDir);
      // migrate sessions, proposals, action_logs
    } catch (e) {
      report.skipped.push({ file: 'meta-session', reason: e.message });
    }
  })();

  // 3. Verify counts
  // 4. Backup originals: rename to .json.bak (not delete)
  return report;
}
```

---

## 4. Service Layer

### 4.1 In-Memory Cache Strategy

**Decision**: SR maintains an in-memory `BootstrapState` cache, same as the current `ProjectSessionManager`. SQLite is the persistence backend, not the query path for hot data.

```typescript
// stoa-server/src/services/project-session-manager.ts
class ProjectSessionManager {
  private state: BootstrapState;           // In-memory cache
  private dirty: boolean = false;
  private persistTimer: NodeJS.Timer | null = null;

  constructor(private db: Database, private wsHub: WsHub) {
    // Load from SQLite on startup (instead of JSON files)
    this.state = this.loadFromDb();
  }

  snapshot(): BootstrapState {
    return structuredClone(this.state);  // Still synchronous, still fast
  }

  private persist(): void {
    // Debounced write to SQLite (instead of JSON)
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushToDb(), 100);
  }

  private flushToDb(): void {
    // Write current state to SQLite tables
    // Uses INSERT ... ON CONFLICT UPDATE for atomicity
  }
}
```

### 4.2 Service Extraction Pattern

Introduce `IPersistenceBackend` abstraction to allow incremental migration:

```typescript
// stoa-server/src/services/persistence-backend.ts
interface IPersistenceBackend {
  loadGlobalState(): PersistedGlobalStateV4;
  saveGlobalState(state: PersistedGlobalStateV4): void;
  loadProjectSessions(projectPath: string): PersistedProjectSessions;
  saveProjectSessions(projectPath: string, data: PersistedProjectSessions): void;
}

// Implementation 1: Current JSON files (used during transition)
class JsonFileBackend implements IPersistenceBackend { ... }

// Implementation 2: SQLite + Drizzle (target)
class SqliteBackend implements IPersistenceBackend { ... }
```

This allows testing the extracted services against JSON first, then switching to SQLite without changing business logic.

### 4.3 Broadcast Points (Service → WS)

Every mutating service method must broadcast the corresponding WS event:

| Service Method | WS Event Broadcast |
|---------------|-------------------|
| `createProject` | `session:graph { kind: 'project_created' }` |
| `deleteProject` | `session:graph { kind: 'project_deleted' }` |
| `createSession` | `session:graph { kind: 'session_created' }` |
| `archiveSession` | `session:graph { kind: 'session_archived' }` |
| `restoreSession` | `session:graph { kind: 'session_restored' }` |
| `updateSessionTitle` | `session:graph { kind: 'session_updated' }` |
| `applySessionStatePatch` | `session:graph { kind: 'session_state_changed' }` + `observability:presence` |
| `updateSetting` | `settings:changed { key, value }` |
| `fsWrite` | `fs:changed { projectId, path }` |
| `gitStage/Commit/Push` | `observability:project` (git status changed) |
| Meta-session mutations | `meta-session:event { kind, ... }` |

---

## 5. REST API Design

### 5.1 API Versioning

All endpoints use `/api/v1/` prefix. The control server keeps `/ctl/` prefix (acts as its own versioned namespace).

### 5.2 Response Envelope

```typescript
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;                            // e.g. 'session_not_found', 'path_traversal'
    message: string;
    details?: Record<string, unknown>;       // Machine-readable context
    nextSteps?: string[] | null;             // Human-readable suggestions
  };
  meta: {
    requestId: string;
    timestamp: string;
    pagination?: {                           // Present for collection endpoints
      cursor: string | null;
      hasMore: boolean;
      totalCount?: number;
    };
  };
}
```

### 5.3 Error Code Registry

```typescript
// Unified from session-control-server + webhook-server + meta-session-control-server
const ERROR_CODES = {
  // General
  'unauthorized':           401,
  'forbidden':              403,
  'not_found':              404,
  'conflict':               409,
  'validation_error':       422,
  'internal_error':         500,

  // Session
  'session_not_found':      404,
  'session_already_exists': 409,
  'session_not_alive':      409,
  'no_completion_yet':      409,
  'wait_timeout':           408,

  // Subagent
  'subagent_not_found':     404,
  'subagent_stale':         409,
  'subagent_not_approved':  409,
  'invalid_epoch':          409,

  // Meta-session
  'meta_session_not_found': 404,
  'proposal_not_found':     404,
  'proposal_stale':         409,
  'unknown_preset':         422,

  // File system
  'path_traversal':         403,
  'file_too_large':         413,
  'search_timeout':         408,
  'entry_not_found':        404,
} as const;
```

### 5.4 API Conventions

**Pagination** (cursor-based for all collection endpoints):
```
GET /api/v1/sessions?archive=active&limit=50&cursor=eyJpZCI6ImFiYyJ9&sort=updatedAt:desc
```

**Query parameters for GET endpoints with complex filters:**
```
GET /api/v1/git/:projectId/log?limit=50&since=2026-01-01
GET /api/v1/git/:projectId/diff?filePath=src/index.ts&staged=true
GET /api/v1/observability/sessions/:id/events?limit=100&cursor=abc&categories=lifecycle,presence&includeEphemeral=true
```

**Batch operations** use arrays in request body:
```typescript
// POST /api/v1/git/:projectId/stage
{ paths: string[] }    // or { all: true }

// POST /api/v1/git/:projectId/discard
{ paths: string[], dryRun?: boolean }   // dryRun returns preview without executing
```

### 5.5 Authorization & Security Middleware

**Path traversal protection** (applied to all `/api/v1/fs/*` routes):
```typescript
function validateRelativePath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!resolved.startsWith(path.resolve(projectRoot) + path.sep) && resolved !== path.resolve(projectRoot)) {
    throw new PathTraversalError(relativePath);
  }
  // Also reject null bytes, encoding tricks
  if (relativePath.includes('\0') || relativePath.includes('..')) {
    throw new PathTraversalError(relativePath);
  }
  return resolved;
}
```

**Session visibility middleware** (applied to all `/ctl/*` routes):
```typescript
// Reuses session-visibility-service logic
// Ensures a session can only access/see its descendants in the tree
function visibilityGuard(c: Context, next: Next) {
  const caller = resolveCaller(c.req.headers);
  const targetId = c.req.param('id') || c.req.param('sessionId');
  if (caller.type === 'session' && !visibilityService.canSee(caller.sessionId, targetId)) {
    return c.json({ ok: false, error: { code: 'forbidden', message: 'Session visibility violation' } }, 403);
  }
  return next();
}
```

**Resource limits:**
- File write: max 50MB body size
- File search: 30s timeout, max 1000 results
- Git operations: 60s timeout

**Rate limiting (Hono middleware):**
```typescript
// Applied globally, configurable per route group
const rateLimitConfig = {
  '/api/v1/fs/*':      { windowMs: 60000, max: 100 },   // 100 FS ops per minute
  '/api/v1/git/*':     { windowMs: 60000, max: 60 },    // 60 git ops per minute
  '/hooks/*':          { windowMs: 60000, max: 200 },    // 200 webhooks per minute
  '/api/v1/sessions':  { windowMs: 60000, max: 30 },    // 30 session creates per minute
  'default':           { windowMs: 60000, max: 300 },    // 300 general API calls per minute
};
// Uses client IP + token as rate limit key
```

**Concurrent client access:**
- **Settings updates**: Last-writer-wins (no locking). Each update replaces the full value for a key. WS broadcasts the winning write to all clients.
- **Git operations**: Serialized per project (queue via SQLite write lock). Concurrent git ops on the same project wait in queue.
- **Session creation**: Optimistic — UUID generation prevents ID collision. If two clients create a session for the same project simultaneously, both succeed (they get different sessions).
- **File writes**: Last-writer-wins with atomic file replacement. No merge/lock semantics.
- **Subagent dispatch**: Serialized per parent session via input epoch tracking (existing mechanism).

### 5.6 Complete IPC → REST/WS Mapping

#### Bootstrap & Projects (5 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `projectBootstrap` | `/api/v1/bootstrap` | GET | Returns `BootstrapState` |
| `projectCreate` | `/api/v1/projects` | POST | Body: `{ path, name?, defaultSessionType? }` |
| `projectDelete` | `/api/v1/projects/:id` | DELETE | |
| `projectSetActive` | `/api/v1/projects/:id/active` | PUT | |
| `workspaceOpen` | Desktop only | — | `shell.openPath()` |

#### Sessions (12 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `sessionCreate` | `/api/v1/sessions` | POST | Body: `{ projectId, type, command?, cwd?, parentId? }` |
| `sessionSetActive` | `/api/v1/sessions/:id/active` | PUT | |
| `sessionArchive` | `/api/v1/sessions/:id/archive` | PUT | |
| `sessionRestore` | `/api/v1/sessions/:id/restore` | PUT | |
| `sessionRestart` | `/api/v1/sessions/:id/restart` | POST | Triggers runtime bridge → Electron PTY |
| `sessionRegenerateTitle` | `/api/v1/sessions/:id/title` | PUT | Body: `{ title?, options? }` |
| `sessionListArchived` | `/api/v1/sessions?archive=archived` | GET | Paginated |
| `sessionTerminalReplay` | `/api/v1/sessions/:id/terminal-replay` | GET | proxied from Electron via runtime bridge |
| `sessionInput` | `/api/v1/sessions/:id/input` | POST | Body: `{ data: string }` → runtime bridge |
| `sessionResize` | `/api/v1/sessions/:id/resize` | POST | Body: `{ cols, rows }` → runtime bridge |
| `sessionGraphEvent` | **WS** `session:graph` | — | Broadcast on any session mutation |
| `sessionBinaryInput` | **WS** `session:binary-input` | — | Client→SR→runtime bridge→Electron PTY |

#### Observability (7 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `observabilityGetSessionPresence` | `/api/v1/observability/sessions/:id/presence` | GET | |
| `observabilityGetProject` | `/api/v1/observability/projects/:id` | GET | |
| `observabilityGetApp` | `/api/v1/observability/app` | GET | |
| `observabilityListSessionEvents` | `/api/v1/observability/sessions/:id/events` | GET | Query: `?limit&cursor&categories&includeEphemeral` |
| `observabilitySessionPresenceChanged` | **WS** `observability:presence` | — | |
| `observabilityProjectChanged` | **WS** `observability:project` | — | |
| `observabilityAppChanged` | **WS** `observability:app` | — | |

#### Settings & Sidebar (9 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `settingsGet` | `/api/v1/settings` | GET | Returns all settings as object |
| `settingsSet` | `/api/v1/settings/:key` | PUT | Body: `{ value }` |
| `settingsDetectShell` | `/api/v1/settings/detect/shell` | POST | |
| `settingsDetectProvider` | `/api/v1/settings/detect/provider` | POST | |
| `settingsDetectVscode` | `/api/v1/settings/detect/vscode` | POST | |
| `titleGenerationFetchModels` | `/api/v1/settings/title-generation/models` | GET | |
| `sidebarGetState` | `/api/v1/sidebar` | GET | |
| `sidebarSetState` | `/api/v1/sidebar` | PUT | Body: `SidebarState` |
| `dialogPickFolder` / `dialogPickFile` | Desktop only (Electron IPC) | — | Native dialog API |

#### File System (10 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `fsReadDir` | `/api/v1/fs/:projectId/dir?path=` | GET | Query: `?path=&recursive=&depth=` |
| `fsReadFile` | `/api/v1/fs/:projectId/file?path=` | GET | Query: `?path=` |
| `fsWriteFile` | `/api/v1/fs/:projectId/file` | PUT | Body: `{ path, content, encoding? }` |
| `fsCreate` | `/api/v1/fs/:projectId/entry` | POST | Body: `{ path, type: 'file'|'dir' }` |
| `fsRename` | `/api/v1/fs/:projectId/rename` | POST | Body: `{ oldPath, newPath }` |
| `fsDelete` | `/api/v1/fs/:projectId/entry` | DELETE | Body: `{ path }` |
| `fsStat` | `/api/v1/fs/:projectId/stat?path=` | GET | Query: `?path=` |
| `fsSearch` | `/api/v1/fs/:projectId/search` | POST | Body: `SearchOptions`, 30s timeout |
| `fsOpenFile` | Desktop only | — | `shell.openPath()` |
| `fsChanged` | **WS** `fs:changed` | — | Server-side fs.watch per project |

#### Git (16 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `gitStatus` | `/api/v1/git/:projectId/status` | GET | |
| `gitStage` | `/api/v1/git/:projectId/stage` | POST | Body: `{ paths: string[] } \| { all: true }` |
| `gitUnstage` | `/api/v1/git/:projectId/unstage` | POST | Body: `{ paths: string[] }` |
| `gitDiscard` | `/api/v1/git/:projectId/discard` | POST | Body: `{ paths: string[], dryRun?: boolean }` |
| `gitCommit` | `/api/v1/git/:projectId/commit` | POST | Body: `GitCommitRequest` |
| `gitPush` | `/api/v1/git/:projectId/push` | POST | Body: `GitPushOptions` |
| `gitPull` | `/api/v1/git/:projectId/pull` | POST | |
| `gitFetch` | `/api/v1/git/:projectId/fetch` | POST | |
| `gitRebase` | `/api/v1/git/:projectId/rebase` | POST | Body: `{ branch }` |
| `gitMerge` | `/api/v1/git/:projectId/merge` | POST | Body: `{ branch }` |
| `gitBranches` | `/api/v1/git/:projectId/branches` | GET | |
| `gitLog` | `/api/v1/git/:projectId/log` | GET | Query: `?limit=50&since=` |
| `gitDiff` | `/api/v1/git/:projectId/diff` | GET | Query: `?filePath=&staged=` |
| `gitCheckout` | `/api/v1/git/:projectId/checkout` | POST | Body: `{ branch }` |
| `gitCreateBranch` | `/api/v1/git/:projectId/branches` | POST | Body: `{ name, startPoint? }` |

#### Meta-Sessions (12 IPC channels + 28 control endpoints — NEW in v2)

**IPC-based endpoints (from RendererApi):**

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `getMetaSessionBootstrapState` | `/api/v1/meta-sessions/bootstrap` | GET | |
| `createMetaSession` | `/api/v1/meta-sessions` | POST | Body: `{ backendSessionType, ... }` |
| `setActiveMetaSession` | `/api/v1/meta-sessions/:id/activate` | POST | |
| `archiveMetaSession` | `/api/v1/meta-sessions/:id/archive` | POST | |
| `restoreMetaSession` | `/api/v1/meta-sessions/:id/restore` | POST | |
| `listMetaSessionProposals` | `/api/v1/meta-sessions/:id/proposals` | GET | Paginated |
| `getMetaSessionProposal` | `/api/v1/meta-sessions/proposals/:proposalId` | GET | |
| `approveMetaSessionProposal` | `/api/v1/meta-sessions/proposals/:id/approve` | POST | |
| `rejectMetaSessionProposal` | `/api/v1/meta-sessions/proposals/:id/reject` | POST | Body: `{ reason }` |
| `dispatchMetaSessionProposal` | `/api/v1/meta-sessions/proposals/:id/dispatch` | POST | |
| `setMetaSessionInspectorTarget` | `/api/v1/meta-sessions/inspector` | PUT | Body: `MetaSessionInspectorTarget` |
| `onMetaSessionEvent` | **WS** `meta-session:event` | — | All meta-session state changes |

**Control server endpoints (from meta-session-control-server.ts, 28 routes):**

These are preserved as-is under `/ctl/` prefix. Express→Hono conversion, identical route structure.
Used by subagent runtimes (not renderer).

| Current Route | SR Route | Notes |
|--------------|----------|-------|
| `GET /ctl/health` | `GET /ctl/health` | Merged with main health check |
| `GET /ctl/bootstrap-prompt` | `GET /ctl/bootstrap-prompt` | Text/plain bootstrap instructions |
| `GET /ctl/whoami` | `GET /ctl/whoami` | Current meta session info |
| `GET /ctl/capabilities` | `GET /ctl/capabilities` | Capability level + features |
| `GET /ctl/state/brief` | `GET /ctl/state/brief` | Lightweight state overview |
| `GET /ctl/state/attention-queue` | `GET /ctl/state/attention-queue` | Sessions needing attention |
| `GET /ctl/state/conflicts` | `GET /ctl/state/conflicts` | Detected conflicts |
| `GET /ctl/work-sessions` | `GET /ctl/work-sessions` | List with presence |
| `POST /ctl/work-sessions` | `POST /ctl/work-sessions` | Create work session |
| `GET /ctl/work-sessions/:sessionId` | `GET /ctl/work-sessions/:sessionId` | Session status |
| `POST /ctl/work-sessions/:sessionId/archive` | `POST /ctl/work-sessions/:sessionId/archive` | Archive session |
| `GET /ctl/work-sessions/:sessionId/events` | `GET /ctl/work-sessions/:sessionId/events` | Paginated events |
| `GET /ctl/work-sessions/:sessionId/context` | `GET /ctl/work-sessions/:sessionId/context` | Multi-level: `?level=bundle\|slim\|full` |
| `POST /ctl/work-sessions/:sessionId/prompt` | `POST /ctl/work-sessions/:sessionId/prompt` | Send prompt (409 if approval needed) |
| `POST /ctl/work-sessions/:sessionId/send-keys` | `POST /ctl/work-sessions/:sessionId/send-keys` | Keystroke injection |
| `GET /ctl/meta-sessions` | `GET /ctl/meta-sessions` | List meta sessions |
| `POST /ctl/meta-sessions` | `POST /ctl/meta-sessions` | Create meta session |
| `GET /ctl/meta-sessions/:sessionId` | `GET /ctl/meta-sessions/:sessionId` | Meta session details |
| `POST /ctl/meta-sessions/:sessionId/activate` | `POST /ctl/meta-sessions/:sessionId/activate` | Set active |
| `POST /ctl/meta-sessions/:sessionId/archive` | `POST /ctl/meta-sessions/:sessionId/archive` | Archive |
| `POST /ctl/meta-sessions/:sessionId/restore` | `POST /ctl/meta-sessions/:sessionId/restore` | Restore |
| `GET /ctl/proposals` | `GET /ctl/proposals` | List all proposals |
| `POST /ctl/proposals` | `POST /ctl/proposals` | Create prompt proposal |
| `GET /ctl/proposals/:proposalId` | `GET /ctl/proposals/:proposalId` | Proposal details |
| `POST /ctl/proposals/:proposalId/approve` | `POST /ctl/proposals/:proposalId/approve` | Mark approved |
| `POST /ctl/proposals/:proposalId/reject` | `POST /ctl/proposals/:proposalId/reject` | Mark rejected |
| `POST /ctl/dispatch/proposal/:proposalId` | `POST /ctl/dispatch/proposal/:proposalId` | Execute proposal |
| `POST /ctl/dispatch/preset/:presetName` | `POST /ctl/dispatch/preset/:presetName` | Execute preset |

#### Notifications (4 channels)

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `memoryNotification` | **WS** `notification:memory` | — | |
| `titleGenerationNotification` | **WS** `notification:title-generation` | — | |
| `terminalData` | **WS** `session:terminal-data` | — | High-frequency, multiplexed |
| `debugToggleDevTools` | Desktop only | — | |

#### Update / Window / Shell (Desktop-only)

| IPC Channels | Location |
|-------------|----------|
| `windowMinimize`, `windowMaximize`, `windowClose`, `windowIsMaximized` | Electron shell IPC |
| `windowMaximizeChanged` | Electron shell IPC (push) |
| `updateGetState`, `updateCheck`, `updateDownload`, `updateQuitAndInstall`, `updateDismiss`, `updateState` | Electron shell IPC |
| `shellGetScriptsDir`, `shellShowItemInFolder` | Electron shell IPC |

#### Previously Missing Channels

| IPC Channel | Endpoint | Method | Notes |
|-------------|----------|--------|-------|
| `sidecarUninstall` | `/api/v1/projects/:id/sidecar` | DELETE | |
| `evidenceListSessionSnapshots` | `/api/v1/sessions/:id/evidence` | GET | |
| `contextExportFullText` | `/api/v1/sessions/:id/context/full` | GET | Query: `?maxLength=100000` |
| `contextExportSlimText` | `/api/v1/sessions/:id/context/slim` | GET | Query: `?maxLength=100000` |

#### Absorbed Servers → SR Routes

**Webhook server** (6 → merged into SR):
| Current Endpoint | SR Endpoint | Notes |
|-----------------|-------------|-------|
| `GET /health` | `GET /ctl/health` | Merged |
| `POST /events` | `POST /hooks/events` | Canonical session events |
| `POST /hooks/claude-code` | `POST /hooks/claude-code` | Provider adapter |
| `POST /hooks/codex` | `POST /hooks/codex` | Provider adapter |
| `POST /hooks/opencode` | `POST /hooks/opencode` | Provider adapter |
| `POST /memory-notifications` | `POST /hooks/memory-notifications` | |

**Session control server** (18 → merged into SR):

| Current Route | SR Route | Notes |
|--------------|----------|-------|
| `GET /ctl/health` | `GET /ctl/health` | Merged with webhook health |
| `GET /ctl/whoami` | `GET /ctl/whoami` | Caller identity |
| `GET /ctl/capabilities` | `GET /ctl/capabilities` | Supported features |
| `GET /ctl/session/list` | `GET /ctl/session/list` | Session nodes |
| `GET /ctl/session/:id/inspect` | `GET /ctl/session/:id/inspect` | Full details |
| `GET /ctl/session/:id/status` | `GET /ctl/session/:id/status` | Status only |
| `GET /ctl/session/:id/output` | `GET /ctl/session/:id/output` | Session output |
| `GET /ctl/session/:id/completion-report` | `GET /ctl/session/:id/completion-report` | Completion data |
| `GET /ctl/session/:id/wait` | `GET /ctl/session/:id/wait` | Long-poll wait (SSE in future) |
| `POST /ctl/session/:id/input` | `POST /ctl/session/:id/input` | Send input → runtime bridge |
| `POST /ctl/session/:id/destroy` | `POST /ctl/session/:id/destroy` | Destroy → runtime bridge |
| `POST /ctl/session/create` | `POST /ctl/session/create` | Create + launch via runtime bridge |
| `GET /ctl/subagent/list` | `GET /ctl/subagent/list` | List subagents |
| `POST /ctl/subagent/dispatch` | `POST /ctl/subagent/dispatch` | Dispatch → runtime bridge |
| `POST /ctl/subagent/wait` | `POST /ctl/subagent/wait` | Wait for completion |
| `POST /ctl/subagent/input` | `POST /ctl/subagent/input` | Send input → runtime bridge |
| `POST /ctl/subagent/stop` | `POST /ctl/subagent/stop` | Stop → runtime bridge |
| `POST /ctl/subagent/result` | `POST /ctl/subagent/result` | Submit result |

**Meta-session control server** (28 → merged into SR):
All current `/ctl/work-sessions/*`, `/ctl/meta-sessions/*`, `/ctl/proposals/*`, `/ctl/dispatch/*` routes preserved as-is under `/ctl/` prefix. Express→Hono conversion.

**Total absorbed**: 52 control endpoints (18 + 28 + 6 webhook).

#### Discovery

| Endpoint | Method | Auth | Response |
|----------|--------|------|----------|
| `/api/v1/discovery` | GET | No | `{ name: 'stoa', version, ip, port, uptime }` |

---

## 6. Runtime Bridge Protocol (SR ↔ Electron)

### 6.1 Problem

SR holds business logic but Electron holds PTY processes. When SR needs to perform PTY operations (input, resize, kill, create child session), it must call back to Electron.

### 6.2 Solution: Electron as "Runtime Provider"

Electron connects to SR's WebSocket as a **special client** with runtime capabilities. SR sends commands; Electron executes and responds.

```
┌─────┐         ┌─────┐         ┌──────────┐
│ Web │──WS────►│ SR  │──WS────►│ Electron │
│     │◄──WS────│     │◄──WS────│ (Runtime)│
└─────┘         └─────┘         └──────────┘
                  │                    │
                  │ SQLite             │ PTY processes
                  └──┘                └──┘
```

### 6.3 Protocol Messages

**SR → Electron (runtime commands):**
```typescript
interface RuntimeCommand {
  type: 'runtime:launch' | 'runtime:kill' | 'runtime:input' | 'runtime:resize'
       | 'runtime:get-terminal-replay' | 'runtime:interrupt';
  sessionId: string;
  payload: Record<string, unknown>;
  replyTo: string;  // correlation ID for response
}

interface RuntimeResponse {
  replyTo: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}
```

**Terminal data pipeline:**
```
PTY stdout → Electron → WS event { type: 'runtime:terminal-data', sessionId, data }
                              → SR receives → SR broadcasts to all WS clients as
                                { type: 'session:terminal-data', sessionId, data }
```

**Runtime command catalog:**

| Command | Trigger | Electron Action |
|---------|---------|----------------|
| `runtime:launch` | `POST /api/v1/sessions` or `POST /ctl/session/create` | Create PTY process, start runtime |
| `runtime:kill` | `POST /api/v1/sessions/:id/destroy` | Kill PTY process |
| `runtime:input` | `POST /api/v1/sessions/:id/input` | Write to PTY stdin |
| `runtime:resize` | `POST /api/v1/sessions/:id/resize` | PTY resize |
| `runtime:interrupt` | Subagent stop with interrupt | Send Ctrl+C to PTY |
| `runtime:get-terminal-replay` | `GET /api/v1/sessions/:id/terminal-replay` | Return PTY replay buffer |
| `runtime:create-child-session` | Subagent dispatch | Create child session + launch PTY |

### 6.4 SessionEventBridge Extraction

Current `session-event-bridge.ts` (797 lines) is the orchestration layer. Extraction plan:

| Bridge Responsibility | New Location | Notes |
|----------------------|-------------|-------|
| Webhook event handling | `stoa-server/services/session-event-processor.ts` | Receives webhook → updates session state → broadcasts WS |
| Evidence storage | `stoa-server/services/session-event-processor.ts` | Persists to SQLite session_events table |
| Turn lifecycle | `stoa-server/services/session-event-processor.ts` | Manages turn epoch, outcome, blocking |
| PTY data forwarding | **Stays in Electron** | Electron receives PTY output → sends as runtime:terminal-data to SR |
| Session token management | `stoa-server/db` | session_tokens table |
| Session state patching | `stoa-server/services/project-session-manager.ts` | applySessionStatePatch() |
| Title generation | `stoa-server/services/session-event-processor.ts` | Triggers title generation on turn completion |

### 6.5 Runtime Command Timeouts

Each runtime command has a specific timeout. If Electron doesn't respond within the timeout, SR returns an error to the caller.

| Command | Timeout | Failure Mode |
|---------|---------|-------------|
| `runtime:launch` | 30s | Return 503 "Runtime unavailable" |
| `runtime:kill` | 10s | Mark session as orphaned, log warning |
| `runtime:input` | 5s | Return 503, client retries |
| `runtime:resize` | 5s | Silently drop (non-critical) |
| `runtime:interrupt` | 5s | Return 503 |
| `runtime:get-terminal-replay` | 15s | Return 504 Gateway Timeout |
| `runtime:create-child-session` | 30s | Return 503 |

**Idempotency**: `runtime:launch` includes a `sessionId` correlation. If SR sends duplicate launch commands for the same session, Electron must ignore the duplicate (check if PTY already exists).

### 6.6 SR Crash Recovery

When SR crashes, Electron detects via process exit event:

```typescript
// Electron crash recovery sequence:
// 1. Detect SR process exit
srProcess.on('exit', (code) => {
  if (code !== 0 && !app.isQuitting) {
    // 2. Reconnect WS clients are disconnected automatically
    // 3. Wait 2 seconds (avoid crash loop)
    setTimeout(() => restartSR(), 2000);
  }
});

// 4. SR restarts → rebuilds in-memory cache from SQLite
//    (all persisted state survives; ephemeral WS subscriptions lost)
// 5. Electron reconnects as runtime provider
// 6. Running PTY processes are NOT affected (they're in Electron's process)
// 7. SR queries Electron for current PTY states → syncs in-memory cache
// 8. WS clients reconnect → receive initial state snapshot
```

**Key invariant**: PTY processes live in Electron, not SR. SR crash never kills running sessions. SR crash only interrupts:
- Pending HTTP requests (clients get connection errors → retry)
- WS connections (clients auto-reconnect with `lastEventId`)
- Pending runtime commands (Electron discards stale `replyTo` IDs)

### 6.7 SubagentSupervisor Deps Resolution

`SubagentSupervisorDeps` has 12 dependencies, 6 need PTY. Resolution:

| Dep | Provider | Location |
|-----|----------|----------|
| `getSnapshot()` | `ProjectSessionManager` | SR (in-memory) |
| `visibilityService` | `SessionVisibilityService` | SR (extracted) |
| `sessionInput.send()` | **Runtime bridge** → Electron | SR sends runtime:input |
| `createChildSession()` | **Runtime bridge** → Electron | SR sends runtime:create-child-session |
| `destroySession()` | SR service + runtime bridge | SR updates DB, tells Electron to kill PTY |
| `rollbackDispatchedSession()` | SR service | SR-only (DB cleanup) |
| `getTerminalReplay()` | **Runtime bridge** → Electron | SR sends runtime:get-terminal-replay |
| `waitForSessionStateChange()` | SR polling | Stays in SR, becomes SSE or long-poll |
| `updateSessionFacade()` | SR service | SR-only (DB update) |
| `interruptSession()` | **Runtime bridge** → Electron | SR sends runtime:interrupt |

---

## 7. WebSocket Protocol

### 7.1 Connection

```
ws://<host>:<port>/ws?token=<auth-token>
```

Token passed via query parameter (not first message) to avoid unauthenticated window.

### 7.2 Event Format

```typescript
// Server → Client
interface WsServerEvent {
  id: string;              // Unique event ID for dedup
  type: string;
  payload: unknown;
  timestamp: string;
}

// Client → Server
interface WsClientMessage {
  type: string;
  payload: unknown;
  requestId?: string;      // For request-response pattern
}
```

### 7.3 Event Catalog

**Server → Client (12 event types):**

| Event | Payload Type | Frequency |
|-------|-------------|-----------|
| `session:graph` | `SessionGraphEvent` | Low (on mutation) |
| `session:terminal-data` | `{ sessionId, data: Uint8Array }` | High (PTTY output) |
| `session:state-patch` | `SessionStatePatchEvent` | Medium |
| `observability:presence` | `SessionPresenceSnapshot` | Medium |
| `observability:project` | `ProjectObservabilitySnapshot` | Low |
| `observability:app` | `AppObservabilitySnapshot` | Low |
| `meta-session:event` | `MetaSessionEvent` | Low |
| `fs:changed` | `{ projectId, path, kind }` | Medium |
| `settings:changed` | `{ key, value }` | Low |
| `notification:memory` | `MemoryNotificationPayload` | Low |
| `notification:title-generation` | `TitleGenerationResult` | Low |
| `update:state` | `UpdateState` | Low (desktop only) |

**Client → Server (4 message types):**

| Message | Payload | Notes |
|---------|---------|-------|
| `session:binary-input` | `{ sessionId, data }` | Terminal input → runtime bridge |
| `subscribe` | `{ eventTypes: string[] }` | Client subscribes to specific events |
| `unsubscribe` | `{ eventTypes: string[] }` | Client unsubscribes |
| `runtime:response` | `RuntimeResponse` | Electron responds to runtime commands |

### 7.4 Subscription Granularity

Clients subscribe to event types, optionally filtered by session ID:

```typescript
// Subscribe to all session graph events
subscribe({ eventTypes: ['session:graph'] })

// Subscribe to terminal data for specific session only
subscribe({ eventTypes: ['session:terminal-data'], filter: { sessionId: 'abc123' } })
```

### 7.5 Reconnection & State Reconciliation

```typescript
// On WS connect, client sends last seen event ID
ws://host:port/ws?token=xxx&lastEventId=evt_12345

// Server responds with:
// 1. Initial state snapshot (if no lastEventId or gap too large)
// 2. Missed events (if lastEventId is recent enough)
interface WsInitialState {
  type: 'ws:initial-state';
  payload: {
    bootstrap: BootstrapState;
    activeProjectId: string | null;
    activeSessionId: string | null;
    settings: AppSettings;
    sidebarState: SidebarState;
    metaSessionBootstrap: MetaSessionBootstrapState;
  };
}

interface WsMissedEvents {
  type: 'ws:missed-events';
  payload: { events: WsServerEvent[] };
}
```

**Hydration protocol for Pinia stores:**
1. Establish WS connection → buffer incoming events
2. `GET /api/v1/bootstrap` → hydrate stores with initial state
3. Apply buffered WS events (dedup by event ID)
4. Normal operation: WS events apply incrementally

---

## 8. Meta-Session Domain

### 8.1 Extraction from Current Code

9 files totaling 2,298 lines:

| File | Lines | SR Location |
|------|-------|-------------|
| `meta-session-manager.ts` | 243 | `services/meta-session-manager.ts` |
| `meta-session-control-server.ts` | 669 | `routes/meta-control.ts` (Express→Hono) |
| `meta-session-state-store.ts` | 516 | `db/` (replaced by SQLite) |
| `meta-session-proposal-store.ts` | 320 | `services/meta-session-proposal.ts` |
| `meta-session-context-assembler.ts` | 163 | `services/meta-session-context.ts` |
| `meta-session-command-dispatcher.ts` | 189 | `services/meta-session-dispatcher.ts` |
| `meta-session-bootstrap-prompt.ts` | 33 | `services/meta-session-bootstrap.ts` |
| `meta-session-provider-patch.ts` | 137 | `services/meta-session-provider-patch.ts` |
| `shared/meta-session.ts` | 198 | `stoa-shared/types/meta-session.ts` |

### 8.2 Service Architecture

```
MetaSessionManager (CRUD + active session switching)
├── MetaSessionProposalStore (lifecycle + audit)
├── MetaSessionCommandDispatcher (execution + staleness)
├── MetaSessionContextAssembler (context levels: status/bundle/slim/full)
├── MetaSessionProviderPatch (session state → meta-session status mapping)
└── Persistence → SQLite meta_sessions + meta_session_proposals + meta_session_action_logs
```

---

## 9. Security Model

### 9.1 Always-On Token Auth

Token authentication is **required on all endpoints** (including localhost). Rationale: defense-in-depth against CSRF, same-machine rogue processes, browser-based attacks.

```typescript
// Token lifecycle:
// 1. SR generates token on first start → ~/.stoa/server-token.json
// 2. Electron reads from file automatically
// 3. Web clients enter token via UI
// 4. Android clients scan QR or enter manually
```

### 9.2 Unified Auth Model

Current code has 3 different auth mechanisms:
- `x-stoa-secret` header (webhook + control servers)
- `x-stoa-session-id` + `x-stoa-session-token` pair (session-scoped control)
- No auth on some endpoints

**Unified to:**
- `Authorization: Bearer <server-token>` — Full access
- `x-stoa-session-id: <id>` + `x-stoa-session-token: <token>` — Session-scoped access (visibility-restricted)
- Both headers go through Hono middleware

### 9.3 Token on WebSocket

Token passed via query parameter: `ws://host:port/ws?token=xxx`

This avoids the unauthenticated window of "first message auth".

### 9.4 Discovery Endpoint

`GET /api/v1/discovery` is **unauthenticated** by design (clients need to discover before they can auth). In LAN mode, this reveals `{ name, version }` only, not `ip`/`port` (clients already know those to reach this endpoint).

---

## 10. Build & Packaging

### 10.1 SR Package

```jsonc
{
  "name": "stoa-server",
  "scripts": {
    "build": "tsup src/index.ts --format cjs --dts",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "migrate": "tsx src/db/migrate-from-json.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

### 10.2 Windows EXE

```jsonc
// electron-builder config
{
  "extraResources": [
    { "from": "stoa-server/dist/**", "to": "stoa-server" },
    { "from": "stoa-server/node_modules/**", "to": "stoa-server/node_modules" }
  ]
}
```

### 10.3 Startup Sequence

```typescript
// Electron main/index.ts
app.on('ready', async () => {
  // 1. Find or generate port
  const port = await findAvailablePort(3270, 3280);

  // 2. Spawn SR
  const srProcess = spawn('node', [
    path.join(resourcesPath, 'stoa-server', 'index.js'),
    '--port', String(port)
  ], { stdio: 'pipe' });

  // 3. Wait for health check (with timeout + retry)
  await waitForHealth(`http://localhost:${port}/ctl/health`, 30000);

  // 4. Read server token
  const token = fs.readFileSync(path.join(stoaDir, 'server-token.json'), 'utf-8');

  // 5. Connect to SR as runtime provider
  const runtimeWs = new WebSocket(`ws://localhost:${port}/ws?token=${token}&role=runtime`);

  // 6. Open renderer
  const win = new BrowserWindow({ ... });
  win.loadURL(`http://localhost:${port}/`);
});
```

### 10.4 stoa-ctl Compatibility

`stoa-ctl` currently connects to session-control-server HTTP endpoints. After migration:
- Routes remain at `/ctl/*` (unchanged paths)
- Auth changes from `x-stoa-secret` to `Authorization: Bearer <token>`
- `stoa-ctl` reads token from `~/.stoa/server-token.json` (same location)
- Update stoa-ctl auth header in Phase 2

**Port discovery**: `stoa-ctl` currently reads the port from a port file (`~/.stoa/ctl-port`). SR writes its actual port to this same file on startup. stoa-ctl reads from file → connects to SR. If port file is missing, stoa-ctl falls back to default port 3270. This is unchanged from current behavior.

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1–2)

**Goal**: Monorepo set up, SR bootable, SQLite connected.

1. Add `stoa-server/` and `stoa-shared/` as workspace packages (no root rename)
2. Extract `src/shared/*.ts` types to `stoa-shared/` (symlink or re-export from original location for backward compat)
3. Set up Hono + Drizzle + better-sqlite3 in `stoa-server`
4. Define all SQLite schema (§3)
5. Set up Drizzle migration workflow (`drizzle-kit generate` + `drizzle-kit migrate`)
   — Establish `drizzle.config.ts` and `stoa-server/src/db/migrations/` directory
   — First migration: initial schema creation
   — Workflow: change schema.ts → `drizzle-kit generate` → `drizzle-kit migrate`
6. Implement `GET /api/v1/discovery` and `GET /ctl/health`
6. Write JSON → SQLite migration script (§3.7)
7. Write DB layer unit tests

**Deliverable**: `npx stoa-server` starts, health check passes, migration script works.

**Tests**: Existing tests untouched. New tests only in `stoa-server/`.

### Phase 2a: Persistence + Services (Week 3–4)

**Goal**: Core services extracted with `IPersistenceBackend` abstraction.

1. Create `IPersistenceBackend` interface + `JsonFileBackend` + `SqliteBackend`
2. Extract `ProjectSessionManager` (1127 lines) to SR service
3. Extract `MetaSessionManager` (243 lines) + proposal store + context assembler
4. Extract `SessionVisibilityService`
5. Wire in-memory cache + debounced SQLite persist
6. Wire WsHub (basic) — broadcast `session:graph` on mutations
7. Service-level unit tests

**Deliverable**: Services work with both JSON and SQLite backends.

**Tests**: Existing tests untouched. New service tests in `stoa-server/`.

### Phase 2b: Routes + Webhook/Control Absorption (Week 5–7)

**Goal**: All REST + WebSocket endpoints operational.

1. Implement `/api/v1/` route groups (projects, sessions, settings, fs, git, observability, meta-sessions)
2. Convert `webhook-server.ts` (6 routes) Express → Hono `/hooks/*`
3. Convert `session-control-server.ts` (18 routes) Express → Hono `/ctl/*`
4. Convert `meta-session-control-server.ts` (25 routes) Express → Hono `/ctl/*`
5. Implement runtime bridge route (`/ws?role=runtime`)
6. Implement all WS event types (§7.3)
7. Add auth middleware, visibility middleware, path validation middleware
8. Route-level integration tests

**Deliverable**: All 86 IPC channels have REST/WS equivalents. Webhook and control clients can connect to SR.

**Tests**: Existing tests untouched. New route tests in `stoa-server/`.

**stoa-ctl**: Update auth header to use Bearer token.

### Phase 3: Runtime Bridge (Week 8–9)

**Goal**: SR ↔ Electron bidirectional communication for PTY operations.

1. Implement Electron-side runtime WebSocket client
2. Implement runtime command handlers (launch, kill, input, resize, interrupt, replay)
3. Implement terminal data pipeline: PTY → Electron → SR → WS → clients
4. Implement `SessionEventBridge` extraction (webhook handling → SR, PTY forwarding → Electron)
5. Implement `SubagentSupervisor` with runtime bridge deps
6. Integration tests for runtime bridge round-trip

**Deliverable**: SR can create/destroy/control PTY sessions via Electron. Terminal data flows through SR to all clients.

**Tests**: Existing tests untouched. New bridge tests in `stoa-server/`.

### Phase 4: Client Migration (Incremental, Week 10–12)

**Goal**: Electron renderer uses HTTP/WS instead of IPC. Sub-phased to avoid Big Bang.

#### Phase 4a: StoaClient Adapter (Week 10, days 1–3)
1. Create `StoaClient` class with `get/post/put/delete/subscribe`
2. Create `StoaClientPreloadAdapter` that implements `RendererApi` interface using StoaClient
3. Adapter is a drop-in replacement for `window.stoa` — store code unchanged

#### Phase 4b: Workspaces Store (Week 10, days 4–5)
1. Replace `hydrate()` → `GET /api/v1/bootstrap`
2. Replace `applySessionGraphEvent` → WS subscription `session:graph`
3. Verify component tests pass

#### Phase 4c: Settings + Sidebar Stores (Week 11, days 1–2)
1. Replace `loadSettings()` → `GET /api/v1/settings`
2. Replace `updateSetting()` → `PUT /api/v1/settings/:key`
3. Replace sidebar state → `GET/PUT /api/v1/sidebar`

#### Phase 4d: Git + Search Stores (Week 11, days 3–4)
1. Replace all git actions → `/api/v1/git/:projectId/*`
2. Replace search → `POST /api/v1/fs/:projectId/search`
3. Verify all component tests pass

#### Phase 4e: Remove IPC (Week 11–12)
1. Remove IPC handlers from `src/main/index.ts`
2. Remove IPC channel definitions from `ipc-channels.ts` (keep desktop-only: window, update, dialog, shell)
3. Update preload to use StoaClient for business logic, keep IPC for desktop-only
4. Update all renderer tests to mock StoaClient instead of `window.stoa`
5. Verify all existing tests pass

**Deliverable**: Electron app works identically via HTTP/WS. IPC removed for all business logic.

**Tests**: Tests updated per sub-phase. Each sub-phase leaves the test suite green.

### Phase 5: Desktop Shell Integration (Week 13)

**Goal**: Single EXE starts both SR and Electron.

1. Implement SR process spawning in `src/main/index.ts`
2. Port conflict detection + auto-increment (3270–3280 range)
3. Health check wait with 30s timeout
4. Electron-builder config to bundle SR
5. LAN mode toggle in settings UI
6. E2E test: full Windows package lifecycle

**Deliverable**: Windows EXE with embedded SR.

### Phase 6: Web Client (Week 14–16)

**Goal**: Browser loads Stoa from SR.

1. Add static file serving to SR (Hono `serveStatic`)
2. Adapt Vue router for `http://` (currently assumes `file://`)
3. Handle desktop-only features gracefully (dialog → file input fallback, PTY → "terminal not available" message)
4. Responsive layout for tablet (optional, stretch goal)
5. Browser testing (Chrome, Firefox, Safari)

**Deliverable**: `http://<ip>:3270/` loads Stoa in browser.

---

## 12. Test Migration Matrix

| Test File | Phase Affected | Action |
|-----------|---------------|--------|
| `src/core/project-session-manager.test.ts` | 2a | Rewrite: JSON assertions → SQLite assertions |
| `src/core/state-store.test.ts` | 2a | Delete: replaced by Drizzle migration |
| `src/core/session-control-server.test.ts` | 2b | Rewrite: Express → Hono route tests |
| `src/core/webhook-server.test.ts` | 2b | Rewrite: Express → Hono route tests |
| `src/core/session-bootstrap-prompt-service.test.ts` | 2b | Migrate to SR test suite |
| `src/core/session-supervisor.test.ts` | 3 | Rewrite with runtime bridge mocks |
| `src/core/session-visibility-service.test.ts` | 2a | Extract to SR test suite |
| `tests/e2e/backend-lifecycle.test.ts` | 4e | Rewrite: IPC mocks → HTTP mocks |
| `tests/e2e/frontend-store-projection.test.ts` | 4e | Rewrite: hydrate from HTTP instead of IPC |
| `tests/e2e/ipc-bridge.test.ts` | 4e | Delete: IPC replaced by HTTP |
| `tests/e2e/main-config-guard.test.ts` | 4e | Update: verify fewer IPC channels |
| `src/renderer/stores/*.test.ts` | 4b–4d | Update mocks: `window.stoa` → `StoaClient` |
| `src/renderer/app/App.test.ts` | 4e | Update bootstrap mock |
| All generated tests | 4e | Update after IPC removal |
| New SR tests | 1–3 | ~150 new tests in stoa-server/ |

---

## 13. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SQLite write contention under multi-client | Low | Medium | WAL mode + single-writer via in-memory cache |
| WebSocket disconnection | Medium | Medium | Reconnection protocol with state reconciliation (§7.5) |
| Phase 4 breaks all tests | High | High | Sub-phased (4a–4e), each leaves suite green |
| SR process crash | Medium | High | Electron monitors SR, auto-restarts + reconnects |
| Port conflict | Medium | Low | Auto-detect + increment 3270–3280 |
| Migration data loss | Low | Critical | Transactional migration, backup originals, verify counts |
| Runtime bridge latency | Medium | Medium | Terminal data goes Electron→SR→WS; measure latency in Phase 3 |
| Monorepo import breakage | Low | High | No root rename; stoa-shared re-exports from original locations |
| Express→Hono route conversion bugs | Medium | Medium | Route-by-route conversion with integration tests per route |

---

## 14. Resolved Open Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Drizzle vs raw better-sqlite3? | **Drizzle** | 30+ column sessions table makes raw SQL unmaintainable. Type-safe queries worth ~200KB. |
| Monorepo vs separate repo? | **Monorepo** | Shared types are the binding. No separate deployment needed in prototype. |
| Hono on Node.js vs Bun? | **Node.js** | better-sqlite3 native addon. Bun compat layer unstable. Benchmark later. |
| Auth for localhost mode? | **Always-on token** | Defense-in-depth. Electron reads token from file automatically. Zero UX cost. |
| Terminal streaming: dedicated WS vs multiplexed? | **Multiplexed with back-pressure monitoring** | Start simple. Add `maxMessageSize` config and per-session channel option later if needed. |
| API versioning? | **`/api/v1/` prefix** | Zero-cost convention. Prevents painful URL migration once external clients connect. |
| Settings storage: single row vs per-key? | **Single row** `key='app', value=JSON(allSettings)` | Matches current `AppSettings` interface. Simpler migration. |
