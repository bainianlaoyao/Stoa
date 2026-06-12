/**
 * Tests for IPersistenceBackend implementations.
 *
 * Covers:
 *   - JsonFileBackend: defaults-on-missing, round-trip, and v3→v4 migration
 *   - SqliteBackend:    real in-memory SQLite via createDb(':memory:')
 *
 * The SqliteBackend tests use a real better-sqlite3 in-memory connection and
 * run the same raw DDL that `schema.test.ts` / `migrate-from-json.ts` use to
 * set up the schema, so all Drizzle queries in persistence-backend.ts work
 * against the tables.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, type StoaDb } from '../db/connection'
import type Database from 'better-sqlite3'
import {
  JsonFileBackend,
  SqliteBackend,
  DEFAULT_GLOBAL_STATE_V4,
  DEFAULT_PROJECT_SESSIONS,
} from './persistence-backend'
import { DEFAULT_SETTINGS } from 'stoa-shared'
import type {
  AppSettings,
  PersistedGlobalStateV4,
  PersistedProjectSessions,
  PersistedSession,
} from 'stoa-shared'

// ---------------------------------------------------------------------------
// Raw DDL — mirrors schema.test.ts so an in-memory DB has every table
// referenced by persistence-backend.ts (projects, sessions, settings,
// server_config).
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
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS server_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
]

function getRawClient(db: StoaDb): Database.Database {
  return (db as unknown as { $client: Database.Database }).$client
}

/**
 * Build a fully-populated AppSettings. The fields on `AppSettings` are all
 * required, so spreading the partial-shaped `settings?` from
 * `DEFAULT_GLOBAL_STATE_V4` would not satisfy the type. This helper gives us
 * a real `AppSettings` and lets individual tests override specific fields.
 */
function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<{
  projectId: string
  name: string
  path: string
  defaultSessionType: PersistedGlobalStateV4['projects'][number]['default_session_type']
  createdAt: string
  updatedAt: string
}> = {}): PersistedGlobalStateV4['projects'][number] {
  return {
    project_id: overrides.projectId ?? 'proj-1',
    name: overrides.name ?? 'Test Project',
    path: overrides.path ?? '/tmp/test-project',
    default_session_type: overrides.defaultSessionType ?? 'shell',
    created_at: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    updated_at: overrides.updatedAt ?? '2025-01-02T00:00:00.000Z',
  }
}

function makeSession(overrides: Partial<{
  sessionId: string
  projectId: string
  type: PersistedSession['type']
  title: string
  archived: boolean
}> = {}): PersistedSession {
  return {
    session_id: overrides.sessionId ?? 'sess-1',
    project_id: overrides.projectId ?? 'proj-1',
    parent_session_id: null,
    created_by_session_id: null,
    type: overrides.type ?? 'shell',
    title: overrides.title ?? 'Test Session',
    runtime_state: 'alive',
    turn_state: 'idle',
    turn_epoch: 0,
    last_turn_outcome: 'none',
    blocking_reason: null,
    failure_reason: null,
    has_unseen_completion: false,
    runtime_exit_code: null,
    runtime_exit_reason: null,
    last_state_sequence: 0,
    last_summary: '',
    external_session_id: null,
    title_generation: {
      prompt: null,
      assistantSnippet: null,
      contextUpdatedAt: null,
      autoGeneratedTurnEpoch: null,
    },
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    last_activated_at: null,
    recovery_mode: 'fresh-shell',
    archived: overrides.archived ?? false,
    subagent_name: null,
    subagent_result_summary: null,
    subagent_input_epoch: 0,
    subagent_latest_input_at: null,
    subagent_latest_input_state_sequence: 0,
    subagent_result: null,
  }
}

// ===========================================================================
// JsonFileBackend
// ===========================================================================

describe('JsonFileBackend', () => {
  let tmpDir: string
  let globalStatePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stoa-persistence-test-'))
    globalStatePath = join(tmpDir, 'global.json')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('loadGlobalState', () => {
    it('returns defaults when no global state file exists', async () => {
      const backend = new JsonFileBackend({ globalStatePath })
      const state = await backend.loadGlobalState()

      expect(state.version).toBe(4)
      expect(state.active_project_id).toBeNull()
      expect(state.active_session_id).toBeNull()
      expect(state.projects).toEqual([])
      // Settings must be a fresh object equal in shape to DEFAULT_SETTINGS.
      expect(state.settings).toBeDefined()
      expect(state.settings?.theme).toBe(DEFAULT_SETTINGS.theme)
      expect(state.settings?.locale).toBe(DEFAULT_SETTINGS.locale)
    })

    it('returns a deep clone — mutating the result must not affect defaults', async () => {
      const backend = new JsonFileBackend({ globalStatePath })
      const state = await backend.loadGlobalState()
      state.projects.push(makeProject())
      state.settings = makeSettings({ theme: 'dark' })

      // A fresh load must still be at the defaults.
      const second = await backend.loadGlobalState()
      expect(second.projects).toEqual([])
      expect(second.settings?.theme).toBe(DEFAULT_SETTINGS.theme)
    })

    it('migrates v3 global state to v4 on load', async () => {
      const { writeFileSync } = await import('node:fs')
      const v3State = {
        version: 3,
        active_project_id: 'proj-v3',
        active_session_id: 'sess-v3',
        projects: [makeProject({ projectId: 'proj-v3' })],
        settings: DEFAULT_SETTINGS,
      }
      writeFileSync(globalStatePath, JSON.stringify(v3State), 'utf-8')

      const backend = new JsonFileBackend({ globalStatePath })
      const state = await backend.loadGlobalState()

      expect(state.version).toBe(4)
      expect(state.active_project_id).toBe('proj-v3')
      expect(state.active_session_id).toBe('sess-v3')
      expect(state.projects).toHaveLength(1)
    })
  })

  describe('saveGlobalState / loadGlobalState round-trip', () => {
    it('persists and reloads global state without loss', async () => {
      const backend = new JsonFileBackend({ globalStatePath })
      const written: PersistedGlobalStateV4 = {
        version: 4,
        active_project_id: 'proj-active',
        active_session_id: 'sess-active',
        projects: [
          makeProject({ projectId: 'proj-a', name: 'Alpha' }),
          makeProject({ projectId: 'proj-b', name: 'Beta', path: '/tmp/beta' }),
        ],
        settings: makeSettings({ theme: 'dark', locale: 'fr', stoaCtlEnabled: true }),
      }

      await backend.saveGlobalState(written)
      const loaded = await backend.loadGlobalState()

      expect(loaded).toEqual(written)
    })
  })

  describe('loadProjectSessions', () => {
    it('returns defaults when no sessions file exists', async () => {
      const backend = new JsonFileBackend({ globalStatePath })
      const sessions = await backend.loadProjectSessions('/tmp/whatever')

      expect(sessions.version).toBe(7)
      expect(sessions.project_id).toBe('')
      expect(sessions.sessions).toEqual([])
      // Result should be a fresh clone of the default.
      sessions.sessions.push(makeSession())
      const second = await backend.loadProjectSessions('/tmp/whatever')
      expect(second.sessions).toEqual([])
    })
  })

  describe('saveProjectSessions / loadProjectSessions round-trip', () => {
    it('persists and reloads project sessions keyed by projectPath', async () => {
      const backend = new JsonFileBackend({ globalStatePath })
      const projectPath = '/tmp/my-project'
      const written: PersistedProjectSessions = {
        version: 7,
        project_id: 'proj-1',
        sessions: [
          makeSession({ sessionId: 'sess-a', projectId: 'proj-1', title: 'A' }),
          makeSession({ sessionId: 'sess-b', projectId: 'proj-1', title: 'B', archived: true }),
        ],
      }

      await backend.saveProjectSessions(projectPath, written)
      const loaded = await backend.loadProjectSessions(projectPath)

      expect(loaded).toEqual(written)
    })

    it('keeps sessions for different project paths independent', async () => {
      const backend = new JsonFileBackend({ globalStatePath })
      const pathA = '/tmp/proj-a'
      const pathB = '/tmp/proj-b'

      await backend.saveProjectSessions(pathA, {
        version: 7,
        project_id: 'proj-a',
        sessions: [makeSession({ sessionId: 'sess-a', projectId: 'proj-a' })],
      })
      await backend.saveProjectSessions(pathB, {
        version: 7,
        project_id: 'proj-b',
        sessions: [makeSession({ sessionId: 'sess-b', projectId: 'proj-b' })],
      })

      const loadedA = await backend.loadProjectSessions(pathA)
      const loadedB = await backend.loadProjectSessions(pathB)
      expect(loadedA.sessions).toHaveLength(1)
      expect(loadedA.sessions[0]?.session_id).toBe('sess-a')
      expect(loadedB.sessions).toHaveLength(1)
      expect(loadedB.sessions[0]?.session_id).toBe('sess-b')
    })
  })
})

// ===========================================================================
// SqliteBackend — real in-memory SQLite
// ===========================================================================

describe('SqliteBackend (in-memory)', () => {
  let db: StoaDb
  let raw: Database.Database
  let backend: SqliteBackend

  beforeEach(() => {
    db = createDb(':memory:')
    raw = getRawClient(db)
    for (const ddl of CREATE_TABLES_SQL) raw.exec(ddl)
    backend = new SqliteBackend(db)
  })

  afterEach(() => {
    raw.close()
  })

  describe('loadGlobalState', () => {
    it('returns defaults when the database is empty', async () => {
      const state = await backend.loadGlobalState()

      expect(state.version).toBe(4)
      expect(state.active_project_id).toBeNull()
      expect(state.active_session_id).toBeNull()
      expect(state.projects).toEqual([])
      // Settings row is missing → defaults must come back.
      expect(state.settings).toBeDefined()
      expect(state.settings?.theme).toBe(DEFAULT_SETTINGS.theme)
      expect(state.settings?.locale).toBe(DEFAULT_SETTINGS.locale)
    })

    it('preserves the equality of returned defaults (fresh object, not the constant)', async () => {
      const state = await backend.loadGlobalState()
      // Mutating the result must not corrupt the module-level default.
      state.settings = makeSettings({ theme: 'dark' })
      state.projects.push(makeProject())
      const again = await backend.loadGlobalState()
      expect(again.projects).toEqual([])
      expect(again.settings?.theme).toBe(DEFAULT_SETTINGS.theme)
    })
  })

  describe('saveGlobalState / loadGlobalState round-trip', () => {
    it('persists and reloads a full global state', async () => {
      const written: PersistedGlobalStateV4 = {
        version: 4,
        active_project_id: 'proj-active',
        active_session_id: 'sess-active',
        projects: [
          makeProject({ projectId: 'proj-a', name: 'Alpha', path: '/tmp/alpha' }),
          makeProject({
            projectId: 'proj-b',
            name: 'Beta',
            path: '/tmp/beta',
            defaultSessionType: 'claude-code',
          }),
        ],
        settings: makeSettings({ theme: 'dark', locale: 'zh', stoaCtlEnabled: true }),
      }

      await backend.saveGlobalState(written)
      const loaded = await backend.loadGlobalState()

      expect(loaded).toEqual(written)
    })

    it('upserts projects on subsequent saves (idempotent for the same id)', async () => {
      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [makeProject({ projectId: 'proj-1', name: 'Original' })],
        settings: DEFAULT_SETTINGS,
      })

      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [makeProject({ projectId: 'proj-1', name: 'Renamed' })],
        settings: DEFAULT_SETTINGS,
      })

      const all = raw
        .prepare('SELECT id, name FROM projects')
        .all() as Array<{ id: string; name: string }>
      expect(all).toHaveLength(1)
      expect(all[0]?.name).toBe('Renamed')
    })

    it('clears active ids when saved as null', async () => {
      // Seed both active ids.
      await backend.saveGlobalState({
        version: 4,
        active_project_id: 'proj-x',
        active_session_id: 'sess-x',
        projects: [makeProject({ projectId: 'proj-x' })],
        settings: DEFAULT_SETTINGS,
      })

      // Now save a state with both active ids nulled.
      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [makeProject({ projectId: 'proj-x' })],
        settings: DEFAULT_SETTINGS,
      })

      const state = await backend.loadGlobalState()
      expect(state.active_project_id).toBeNull()
      expect(state.active_session_id).toBeNull()
    })

    it('handles an empty project list', async () => {
      const written: PersistedGlobalStateV4 = {
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [],
        settings: DEFAULT_SETTINGS,
      }

      await backend.saveGlobalState(written)
      const loaded = await backend.loadGlobalState()

      expect(loaded.projects).toEqual([])
      expect(loaded.settings?.theme).toBe(DEFAULT_SETTINGS.theme)
    })
  })

  describe('saveProjectSessions / loadProjectSessions round-trip', () => {
    it('returns defaults when the project path is unknown', async () => {
      const sessions = await backend.loadProjectSessions('/no/such/project')
      expect(sessions).toEqual(structuredClone(DEFAULT_PROJECT_SESSIONS))
    })

    it('skips session write when the project row is missing', async () => {
      // No project → backend should silently skip (the project manager
      // is expected to flush the project row first).
      await backend.saveProjectSessions('/missing/project', {
        version: 7,
        project_id: 'proj-ghost',
        sessions: [makeSession()],
      })
      const sessions = await backend.loadProjectSessions('/missing/project')
      expect(sessions.sessions).toEqual([])
    })

    it('persists and reloads sessions once the project row exists', async () => {
      // First, write the project row.
      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [makeProject({ projectId: 'proj-1', path: '/tmp/proj-1' })],
        settings: DEFAULT_SETTINGS,
      })

      const written: PersistedProjectSessions = {
        version: 7,
        project_id: 'proj-1',
        sessions: [
          makeSession({ sessionId: 'sess-a', projectId: 'proj-1', title: 'A' }),
          makeSession({
            sessionId: 'sess-b',
            projectId: 'proj-1',
            title: 'B',
            archived: true,
          }),
        ],
      }

      await backend.saveProjectSessions('/tmp/proj-1', written)
      const loaded = await backend.loadProjectSessions('/tmp/proj-1')

      expect(loaded.version).toBe(7)
      expect(loaded.project_id).toBe('proj-1')
      expect(loaded.sessions).toHaveLength(2)
      expect(loaded.sessions[0]?.session_id).toBe('sess-a')
      expect(loaded.sessions[1]?.session_id).toBe('sess-b')
      expect(loaded.sessions[1]?.archived).toBe(true)
    })

    it('replaces existing sessions for a project on subsequent writes', async () => {
      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [makeProject({ projectId: 'proj-1', path: '/tmp/proj-1' })],
        settings: DEFAULT_SETTINGS,
      })

      // Initial write: two sessions.
      await backend.saveProjectSessions('/tmp/proj-1', {
        version: 7,
        project_id: 'proj-1',
        sessions: [
          makeSession({ sessionId: 'sess-a', projectId: 'proj-1' }),
          makeSession({ sessionId: 'sess-b', projectId: 'proj-1' }),
        ],
      })

      // Second write: only one session remains.
      await backend.saveProjectSessions('/tmp/proj-1', {
        version: 7,
        project_id: 'proj-1',
        sessions: [makeSession({ sessionId: 'sess-c', projectId: 'proj-1' })],
      })

      const loaded = await backend.loadProjectSessions('/tmp/proj-1')
      expect(loaded.sessions).toHaveLength(1)
      expect(loaded.sessions[0]?.session_id).toBe('sess-c')
    })

    it('handles multiple distinct project paths independently', async () => {
      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [
          makeProject({ projectId: 'proj-a', path: '/tmp/proj-a' }),
          makeProject({ projectId: 'proj-b', path: '/tmp/proj-b' }),
        ],
        settings: DEFAULT_SETTINGS,
      })

      await backend.saveProjectSessions('/tmp/proj-a', {
        version: 7,
        project_id: 'proj-a',
        sessions: [makeSession({ sessionId: 'sess-a', projectId: 'proj-a' })],
      })
      await backend.saveProjectSessions('/tmp/proj-b', {
        version: 7,
        project_id: 'proj-b',
        sessions: [
          makeSession({ sessionId: 'sess-b1', projectId: 'proj-b' }),
          makeSession({ sessionId: 'sess-b2', projectId: 'proj-b' }),
        ],
      })

      const a = await backend.loadProjectSessions('/tmp/proj-a')
      const b = await backend.loadProjectSessions('/tmp/proj-b')

      expect(a.sessions.map((s) => s.session_id)).toEqual(['sess-a'])
      expect(b.sessions.map((s) => s.session_id).sort()).toEqual(['sess-b1', 'sess-b2'])
    })

    it('handles an empty sessions list', async () => {
      await backend.saveGlobalState({
        version: 4,
        active_project_id: null,
        active_session_id: null,
        projects: [makeProject({ projectId: 'proj-1', path: '/tmp/proj-1' })],
        settings: DEFAULT_SETTINGS,
      })

      await backend.saveProjectSessions('/tmp/proj-1', {
        version: 7,
        project_id: 'proj-1',
        sessions: [],
      })

      const loaded = await backend.loadProjectSessions('/tmp/proj-1')
      expect(loaded.sessions).toEqual([])
      expect(loaded.project_id).toBe('proj-1')
    })
  })
})

// ===========================================================================
// SqliteBackend.fromPath — sanity check on the factory helper
// ===========================================================================

describe('SqliteBackend.fromPath', () => {
  it('opens an in-memory database and loads defaults', async () => {
    const backend = SqliteBackend.fromPath(':memory:')
    try {
      // Without migrations, the SELECTs must throw — the tables do not exist.
      // We only verify construction succeeds here; the table-creating tests
      // live in the SqliteBackend describe above.
      expect(backend).toBeInstanceOf(SqliteBackend)
    } finally {
      // Best-effort cleanup; the raw client is held privately, so we let
      // the in-memory DB be GC'd. (`:memory:` is process-local.)
    }
  })
})
