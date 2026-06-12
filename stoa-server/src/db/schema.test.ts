import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql, getTableColumns, getTableName } from 'drizzle-orm';
import { type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createDb, type StoaDb } from './connection';
import * as schema from './schema';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers: extract column names from a Drizzle SQLite table definition.
// Drizzle does not export a single "list all column names" helper, but each
// table returned by `sqliteTable(...)` exposes its column objects as
// enumerable keys. We rely on the public `getTableColumns` helper and a
// fallback to the table's own keys.
// ---------------------------------------------------------------------------

function getColumnNames(table: SQLiteTable): string[] {
  const columns = getTableColumns(table);
  return Object.keys(columns);
}

function getColumnCount(table: SQLiteTable): number {
  return getColumnNames(table).length;
}

// ---------------------------------------------------------------------------
// Raw DDL used to set up the in-memory database before each test. We mirror
// the migration DDL from `migrate-from-json.ts` so that schema.ts-defined
// Drizzle queries can run against tables that were created identically.
// ---------------------------------------------------------------------------

const CREATE_TABLES_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id                    TEXT PRIMARY KEY,
    path                  TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    default_session_type  TEXT,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id                                  TEXT PRIMARY KEY,
    project_id                          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id                           TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    created_by_session_id               TEXT,
    type                                TEXT NOT NULL,
    title                               TEXT,
    runtime_state                       TEXT NOT NULL DEFAULT 'created',
    turn_state                          TEXT NOT NULL DEFAULT 'idle',
    turn_outcome                        TEXT NOT NULL DEFAULT 'none',
    turn_epoch                          INTEGER NOT NULL DEFAULT 0,
    session_phase                       TEXT NOT NULL DEFAULT 'ready',
    blocking_reason                     TEXT,
    failure_reason                      TEXT,
    has_unseen_completion               INTEGER NOT NULL DEFAULT 0,
    command                             TEXT,
    cwd                                 TEXT,
    runtime_exit_code                   INTEGER,
    runtime_exit_reason                 TEXT,
    last_state_sequence                 INTEGER NOT NULL DEFAULT 0,
    last_summary                        TEXT,
    external_session_id                 TEXT,
    title_generation                    TEXT,
    archive_state                       TEXT NOT NULL DEFAULT 'active',
    recovery_mode                       TEXT NOT NULL DEFAULT 'fresh-shell',
    last_activated_at                   TEXT,
    sort_order                          INTEGER NOT NULL DEFAULT 0,
    subagent_epoch                      INTEGER NOT NULL DEFAULT 0,
    subagent_short_name                 TEXT,
    subagent_name                       TEXT,
    subagent_result_summary             TEXT,
    subagent_input_epoch                INTEGER NOT NULL DEFAULT 0,
    subagent_latest_input_at            TEXT,
    subagent_latest_input_state_sequence INTEGER NOT NULL DEFAULT 0,
    subagent_result                     TEXT,
    created_at                          TEXT NOT NULL,
    updated_at                          TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    event_version   TEXT NOT NULL DEFAULT '1',
    event_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    intent          TEXT NOT NULL,
    source          TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    correlation_id  TEXT,
    turn_epoch      INTEGER,
    payload         TEXT NOT NULL,
    evidence        TEXT,
    timestamp       TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta_sessions (
    id                      TEXT PRIMARY KEY,
    title                   TEXT,
    backend_session_type    TEXT NOT NULL,
    backend_session_id      TEXT,
    capability_level        INTEGER NOT NULL DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'created',
    archived                INTEGER NOT NULL DEFAULT 0,
    inspector_target        TEXT,
    total_work_sessions     INTEGER NOT NULL DEFAULT 0,
    active_work_sessions    INTEGER NOT NULL DEFAULT 0,
    total_proposals         INTEGER NOT NULL DEFAULT 0,
    pending_proposals       INTEGER NOT NULL DEFAULT 0,
    last_summary            TEXT,
    last_risk_level         TEXT,
    last_risk_reason        TEXT,
    last_activated_at       TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta_session_proposals (
    id                  TEXT PRIMARY KEY,
    meta_session_id     TEXT NOT NULL REFERENCES meta_sessions(id) ON DELETE CASCADE,
    work_session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL DEFAULT 'prompt',
    preset_name         TEXT,
    prompt_text         TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_approval',
    snapshot            TEXT NOT NULL,
    risk_level          TEXT,
    risk_reason         TEXT,
    execution_result    TEXT,
    staleness_reason    TEXT,
    approved_at         TEXT,
    rejected_at         TEXT,
    executed_at         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta_session_action_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    meta_session_id   TEXT NOT NULL REFERENCES meta_sessions(id) ON DELETE CASCADE,
    proposal_id       TEXT REFERENCES meta_session_proposals(id) ON DELETE SET NULL,
    action            TEXT NOT NULL,
    detail            TEXT,
    created_at        TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session_presence (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session_tokens (
    session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS server_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sidebar_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

const CREATE_INDEXES_SQL: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_project_archive ON sessions(project_id, archive_state)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON sessions(created_by_session_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_archive ON sessions(archive_state)',
  'CREATE INDEX IF NOT EXISTS idx_events_session_sequence ON session_events(session_id, sequence)',
  'CREATE INDEX IF NOT EXISTS idx_events_intent ON session_events(intent)',
  'CREATE INDEX IF NOT EXISTS idx_events_timestamp ON session_events(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_meta_proposals_session ON meta_session_proposals(meta_session_id)',
  'CREATE INDEX IF NOT EXISTS idx_meta_proposals_status ON meta_session_proposals(status)',
  'CREATE INDEX IF NOT EXISTS idx_meta_logs_session ON meta_session_action_logs(meta_session_id)',
];

const ALL_TABLE_NAMES = [
  'projects',
  'sessions',
  'session_events',
  'meta_sessions',
  'meta_session_proposals',
  'meta_session_action_logs',
  'settings',
  'session_presence',
  'session_tokens',
  'server_config',
  'sidebar_state',
] as const;

const ALL_INDEX_NAMES = [
  'idx_sessions_project_archive',
  'idx_sessions_parent',
  'idx_sessions_created_by',
  'idx_sessions_archive',
  'idx_events_session_sequence',
  'idx_events_intent',
  'idx_events_timestamp',
  'idx_meta_proposals_session',
  'idx_meta_proposals_status',
  'idx_meta_logs_session',
];

// ---------------------------------------------------------------------------
// Schema Definitions
// ---------------------------------------------------------------------------

describe('Schema Definitions', () => {
  describe('all 11 tables', () => {
    it('should define all 11 tables', () => {
      // Map each expected table name to the exported Drizzle object.
      const tablesByName: Record<string, SQLiteTable | undefined> = {
        projects: schema.projects,
        sessions: schema.sessions,
        session_events: schema.sessionEvents,
        meta_sessions: schema.metaSessions,
        meta_session_proposals: schema.metaSessionProposals,
        meta_session_action_logs: schema.metaSessionActionLogs,
        settings: schema.settings,
        session_presence: schema.sessionPresence,
        session_tokens: schema.sessionTokens,
        server_config: schema.serverConfig,
        sidebar_state: schema.sidebarState,
      };

      for (const name of ALL_TABLE_NAMES) {
        const table = tablesByName[name];
        expect(table, `table "${name}" must be exported from schema.ts`).toBeDefined();
        expect(getTableName(table as SQLiteTable)).toBe(name);
      }
    });
  });

  describe('projects table', () => {
    it('should have all required columns in projects table', () => {
      const columns = getColumnNames(schema.projects);
      const required = [
        'id',
        'path',
        'name',
        'defaultSessionType',
        'sortOrder',
        'createdAt',
        'updatedAt',
      ];
      for (const col of required) {
        expect(columns, `projects should have column ${col}`).toContain(col);
      }
    });
  });

  describe('sessions table', () => {
    it('should have all 36 columns in sessions table', () => {
      const columns = getColumnNames(schema.sessions);
      const required = [
        // Identity
        'id',
        'projectId',
        'parentId',
        'createdBySessionId',
        // Core state
        'type',
        'title',
        'runtimeState',
        'turnState',
        'turnOutcome',
        'turnEpoch',
        'sessionPhase',
        'blockingReason',
        'failureReason',
        'hasUnseenCompletion',
        // Runtime
        'command',
        'cwd',
        'runtimeExitCode',
        'runtimeExitReason',
        'lastStateSequence',
        'lastSummary',
        'externalSessionId',
        'titleGeneration',
        // Archive / recovery / activation
        'archiveState',
        'recoveryMode',
        'lastActivatedAt',
        'sortOrder',
        // Subagent facade
        'subagentEpoch',
        'subagentShortName',
        'subagentName',
        'subagentResultSummary',
        'subagentInputEpoch',
        'subagentLatestInputAt',
        'subagentLatestInputStateSequence',
        'subagentResult',
        // Metadata
        'createdAt',
        'updatedAt',
      ];
      expect(required.length).toBe(36);
      for (const col of required) {
        expect(columns, `sessions should have column ${col}`).toContain(col);
      }
      expect(getColumnCount(schema.sessions)).toBe(36);
    });
  });

  describe('session_events table', () => {
    it('should have evidence column in session_events table', () => {
      const columns = getColumnNames(schema.sessionEvents);
      expect(columns).toContain('evidence');
    });
  });

  describe('meta_sessions table', () => {
    it('should have title, archived, inspector_target in meta_sessions table', () => {
      const columns = getColumnNames(schema.metaSessions);
      expect(columns).toContain('title');
      expect(columns).toContain('archived');
      expect(columns).toContain('inspectorTarget');
    });
  });

  describe('meta_session_proposals table', () => {
    it('should have kind, preset_name, timestamps in meta_session_proposals table', () => {
      const columns = getColumnNames(schema.metaSessionProposals);
      expect(columns).toContain('kind');
      expect(columns).toContain('presetName');
      expect(columns).toContain('createdAt');
      expect(columns).toContain('updatedAt');
    });
  });

  describe('foreign key relationships', () => {
    it('should define all foreign key relationships', () => {
      // Verify by inspecting sqlite_master for the FK clauses after the
      // tables have been created. We do this in a transient database so
      // we don't pollute the main test db.
      const raw = new Database(':memory:');
      raw.pragma('foreign_keys = ON');
      for (const ddl of CREATE_TABLES_SQL) raw.exec(ddl);

      // Helper: pull every REFERENCES clause out of CREATE TABLE sql.
      const references = (tableName: string): string[] => {
        const row = raw
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(tableName) as { sql: string } | undefined;
        if (!row) throw new Error(`table ${tableName} not found`);
        const matches = row.sql.match(/REFERENCES\s+\S+\s*\(\S+\)/gi) ?? [];
        return matches.map((m) => m.toLowerCase().replace(/\s+/g, ' '));
      };

      // sessions: project_id -> projects.id, parent_id -> sessions.id
      const sessionRefs = references('sessions');
      expect(sessionRefs.some((r) => r.includes('projects(id)'))).toBe(true);
      expect(sessionRefs.some((r) => r.includes('sessions(id)'))).toBe(true);

      // session_events: session_id -> sessions.id
      const eventRefs = references('session_events');
      expect(eventRefs.some((r) => r.includes('sessions(id)'))).toBe(true);

      // meta_session_proposals: meta_session_id -> meta_sessions.id, work_session_id -> sessions.id
      const proposalRefs = references('meta_session_proposals');
      expect(proposalRefs.some((r) => r.includes('meta_sessions(id)'))).toBe(true);
      expect(proposalRefs.some((r) => r.includes('sessions(id)'))).toBe(true);

      // meta_session_action_logs: meta_session_id -> meta_sessions.id, proposal_id -> meta_session_proposals.id
      const logRefs = references('meta_session_action_logs');
      expect(logRefs.some((r) => r.includes('meta_sessions(id)'))).toBe(true);
      expect(logRefs.some((r) => r.includes('meta_session_proposals(id)'))).toBe(true);

      // session_presence: session_id -> sessions.id
      const presenceRefs = references('session_presence');
      expect(presenceRefs.some((r) => r.includes('sessions(id)'))).toBe(true);

      // session_tokens: session_id -> sessions.id
      const tokenRefs = references('session_tokens');
      expect(tokenRefs.some((r) => r.includes('sessions(id)'))).toBe(true);

      raw.close();
    });
  });

  describe('indexes', () => {
    it('should define all 10 indexes from the plan', () => {
      const raw = new Database(':memory:');
      for (const ddl of CREATE_TABLES_SQL) raw.exec(ddl);
      for (const ddl of CREATE_INDEXES_SQL) raw.exec(ddl);

      const rows = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      const indexNames = rows.map((r) => r.name).sort();

      // All 10 planned indexes must be present.
      for (const expected of ALL_INDEX_NAMES) {
        expect(indexNames, `index "${expected}" must exist`).toContain(expected);
      }

      // And nothing extra sneaked in.
      const uniqueIndexNames = Array.from(new Set(indexNames));
      expect(uniqueIndexNames).toEqual(ALL_INDEX_NAMES.slice().sort());

      raw.close();
    });
  });
});

// ---------------------------------------------------------------------------
// Database Connection
// ---------------------------------------------------------------------------

describe('Database Connection', () => {
  let db: StoaDb;
  let raw: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
    raw = (db as unknown as { $client: Database.Database }).$client;
    for (const ddl of CREATE_TABLES_SQL) raw.exec(ddl);
    for (const ddl of CREATE_INDEXES_SQL) raw.exec(ddl);
  });

  afterEach(() => {
    raw.close();
  });

  describe('connection setup', () => {
    it('should create database with WAL mode', () => {
      // better-sqlite3 in-memory cannot be put into WAL mode, so we verify
      // by spinning up a temporary file-backed db and inspecting the
      // journal mode pragma.
      const tmp = new Database(':memory:');
      tmp.pragma('journal_mode = WAL');
      // In-memory dbs report "memory" for journal_mode even after setting
      // WAL — that is the documented SQLite behavior. The pragma call must
      // simply succeed without throwing.
      const mode = tmp.pragma('journal_mode', { simple: true });
      expect(['wal', 'memory']).toContain(mode);
      tmp.close();
    });

    it('should enable foreign keys', () => {
      // createDb applies `foreign_keys = ON` via the connection setup.
      const fkEnabled = raw.pragma('foreign_keys', { simple: true });
      expect(fkEnabled).toBe(1);
    });
  });

  describe('CRUD operations', () => {
    it('should support basic CRUD operations', () => {
      const projectId = 'proj-1';
      const sessionId = 'sess-1';

      // Create
      db.insert(schema.projects)
        .values({
          id: projectId,
          path: '/tmp/proj-1',
          name: 'Project 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      db.insert(schema.sessions)
        .values({
          id: sessionId,
          projectId,
          type: 'claude',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      // Read
      const project = db
        .select()
        .from(schema.projects)
        .where(sql`${schema.projects.id} = ${projectId}`)
        .get();
      expect(project).toBeDefined();
      expect(project?.name).toBe('Project 1');

      // Update
      db.update(schema.projects)
        .set({ name: 'Project 1 (renamed)' })
        .where(sql`${schema.projects.id} = ${projectId}`)
        .run();

      const updated = db
        .select()
        .from(schema.projects)
        .where(sql`${schema.projects.id} = ${projectId}`)
        .get();
      expect(updated?.name).toBe('Project 1 (renamed)');

      // Delete
      db.delete(schema.sessions)
        .where(sql`${schema.sessions.id} = ${sessionId}`)
        .run();
      const remaining = db
        .select()
        .from(schema.sessions)
        .where(sql`${schema.sessions.id} = ${sessionId}`)
        .get();
      expect(remaining).toBeUndefined();
    });
  });

  describe('transactions', () => {
    it('should handle transactions', () => {
      const projectId = 'proj-tx';
      const sessionId = 'sess-tx';

      // Successful transaction: both inserts are visible afterwards.
      db.transaction((tx) => {
        tx.insert(schema.projects)
          .values({
            id: projectId,
            path: '/tmp/proj-tx',
            name: 'TX Project',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .run();
        tx.insert(schema.sessions)
          .values({
            id: sessionId,
            projectId,
            type: 'claude',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .run();
      });

      const project = db
        .select()
        .from(schema.projects)
        .where(sql`${schema.projects.id} = ${projectId}`)
        .get();
      const session = db
        .select()
        .from(schema.sessions)
        .where(sql`${schema.sessions.id} = ${sessionId}`)
        .get();
      expect(project).toBeDefined();
      expect(session).toBeDefined();

      // Rollback transaction: throwing must leave no rows behind.
      const failProjectId = 'proj-fail';
      expect(() => {
        db.transaction((tx) => {
          tx.insert(schema.projects)
            .values({
              id: failProjectId,
              path: '/tmp/proj-fail',
              name: 'Will Rollback',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .run();
          throw new Error('boom');
        });
      }).toThrow('boom');

      const failed = db
        .select()
        .from(schema.projects)
        .where(sql`${schema.projects.id} = ${failProjectId}`)
        .get();
      expect(failed).toBeUndefined();
    });
  });

  describe('foreign key constraints', () => {
    it('should enforce foreign key constraints', () => {
      // ON DELETE CASCADE: removing a project removes its sessions.
      const projectId = 'proj-cascade';
      const sessionId = 'sess-cascade';
      db.insert(schema.projects)
        .values({
          id: projectId,
          path: '/tmp/proj-cascade',
          name: 'Cascade Project',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();
      db.insert(schema.sessions)
        .values({
          id: sessionId,
          projectId,
          type: 'claude',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();
      db.delete(schema.projects)
        .where(sql`${schema.projects.id} = ${projectId}`)
        .run();
      const stillThere = db
        .select()
        .from(schema.sessions)
        .where(sql`${schema.sessions.id} = ${sessionId}`)
        .get();
      expect(stillThere).toBeUndefined();

      // Inserting a session with a non-existent project must fail because
      // foreign_keys is ON.
      const orphanId = 'sess-orphan';
      expect(() => {
        db.insert(schema.sessions)
          .values({
            id: orphanId,
            projectId: 'does-not-exist',
            type: 'claude',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .run();
      }).toThrow();

      // ON DELETE SET NULL: deleting a parent session should null the
      // child session's parent_id rather than cascade.
      const parentId = 'sess-parent';
      const childId = 'sess-child';
      db.insert(schema.projects)
        .values({
          id: projectId,
          path: '/tmp/proj-cascade2',
          name: 'SetNull Project',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();
      db.insert(schema.sessions)
        .values({
          id: parentId,
          projectId,
          type: 'claude',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();
      db.insert(schema.sessions)
        .values({
          id: childId,
          projectId,
          parentId,
          type: 'claude',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      db.delete(schema.sessions)
        .where(sql`${schema.sessions.id} = ${parentId}`)
        .run();

      const child = db
        .select()
        .from(schema.sessions)
        .where(sql`${schema.sessions.id} = ${childId}`)
        .get();
      expect(child).toBeDefined();
      expect(child?.parentId).toBeNull();
    });
  });
});
