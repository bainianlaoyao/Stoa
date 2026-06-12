import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function createDb(dbPath: string) {
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  // Run migrations if the schema is not yet applied. Check for the
  // `projects` table as a sentinel.
  const hasProjectsTable = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
    .get();
  if (!hasProjectsTable) {
    const migrationSql = readMigrationsSql();
    raw.exec(migrationSql);
  }

  return drizzle(raw, { schema });
}

/**
 * Read the initial migration SQL. At build time the SQL files are resolved
 * relative to this source file. After tsup bundling the migrations folder
 * is not available, so we inline the schema creation SQL as a fallback.
 */
function readMigrationsSql(): string {
  try {
    // ESM __dirname equivalent
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // In dev (tsx), the file is at src/db/connection.ts
    // After tsup build, it might be at dist/index.cjs — migrations won't be there
    const migrationPath = join(__dirname, 'migrations', '0000_faithful_tempest.sql');
    return readFileSync(migrationPath, 'utf-8');
  } catch {
    // Fallback: inline the schema creation SQL
    return INLINE_SCHEMA_SQL;
  }
}

const INLINE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY NOT NULL,
  path text NOT NULL,
  name text NOT NULL,
  default_session_type text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_path_unique ON projects (path);
CREATE TABLE IF NOT EXISTS server_config (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL,
  parent_id text,
  created_by_session_id text,
  type text NOT NULL,
  title text,
  runtime_state text DEFAULT 'created' NOT NULL,
  turn_state text DEFAULT 'idle' NOT NULL,
  turn_outcome text DEFAULT 'none' NOT NULL,
  turn_epoch integer DEFAULT 0 NOT NULL,
  session_phase text DEFAULT 'ready' NOT NULL,
  blocking_reason text,
  failure_reason text,
  has_unseen_completion integer DEFAULT 0 NOT NULL,
  command text,
  cwd text,
  runtime_exit_code integer,
  runtime_exit_reason text,
  last_state_sequence integer DEFAULT 0 NOT NULL,
  last_summary text,
  external_session_id text,
  title_generation text,
  archive_state text DEFAULT 'active' NOT NULL,
  recovery_mode text DEFAULT 'fresh-shell' NOT NULL,
  last_activated_at text,
  sort_order integer DEFAULT 0 NOT NULL,
  subagent_epoch integer DEFAULT 0 NOT NULL,
  subagent_short_name text,
  subagent_name text,
  subagent_result_summary text,
  subagent_input_epoch integer DEFAULT 0 NOT NULL,
  subagent_latest_input_at text,
  subagent_latest_input_state_sequence integer DEFAULT 0 NOT NULL,
  subagent_result text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (parent_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS idx_sessions_project_archive ON sessions (project_id, archive_state);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions (parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON sessions (created_by_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_archive ON sessions (archive_state);
CREATE TABLE IF NOT EXISTS session_events (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  session_id text NOT NULL,
  sequence integer NOT NULL,
  event_version text DEFAULT '1' NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  intent text NOT NULL,
  source text NOT NULL,
  project_id text NOT NULL,
  correlation_id text,
  turn_epoch integer,
  payload text NOT NULL,
  evidence text,
  timestamp text NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS idx_events_session_sequence ON session_events (session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_intent ON session_events (intent);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON session_events (timestamp);
CREATE TABLE IF NOT EXISTS session_presence (
  session_id text PRIMARY KEY NOT NULL,
  data text NOT NULL,
  updated_at text NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE IF NOT EXISTS session_tokens (
  session_id text PRIMARY KEY NOT NULL,
  token text NOT NULL,
  created_at text NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS session_tokens_token_unique ON session_tokens (token);
CREATE TABLE IF NOT EXISTS meta_sessions (
  id text PRIMARY KEY NOT NULL,
  title text,
  backend_session_type text NOT NULL,
  backend_session_id text,
  capability_level integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'created' NOT NULL,
  archived integer DEFAULT 0 NOT NULL,
  inspector_target text,
  total_work_sessions integer DEFAULT 0 NOT NULL,
  active_work_sessions integer DEFAULT 0 NOT NULL,
  total_proposals integer DEFAULT 0 NOT NULL,
  pending_proposals integer DEFAULT 0 NOT NULL,
  last_summary text,
  last_risk_level text,
  last_risk_reason text,
  last_activated_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS meta_session_proposals (
  id text PRIMARY KEY NOT NULL,
  meta_session_id text NOT NULL,
  work_session_id text NOT NULL,
  kind text DEFAULT 'prompt' NOT NULL,
  preset_name text,
  prompt_text text,
  status text DEFAULT 'pending_approval' NOT NULL,
  snapshot text NOT NULL,
  risk_level text,
  risk_reason text,
  execution_result text,
  staleness_reason text,
  approved_at text,
  rejected_at text,
  executed_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  FOREIGN KEY (meta_session_id) REFERENCES meta_sessions(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (work_session_id) REFERENCES sessions(id) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS idx_meta_proposals_session ON meta_session_proposals (meta_session_id);
CREATE INDEX IF NOT EXISTS idx_meta_proposals_status ON meta_session_proposals (status);
CREATE TABLE IF NOT EXISTS meta_session_action_logs (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  meta_session_id text NOT NULL,
  proposal_id text,
  action text NOT NULL,
  detail text,
  created_at text NOT NULL,
  FOREIGN KEY (meta_session_id) REFERENCES meta_sessions(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (proposal_id) REFERENCES meta_session_proposals(id) ON UPDATE no action ON DELETE set null
);
CREATE INDEX IF NOT EXISTS idx_meta_logs_session ON meta_session_action_logs (meta_session_id);
CREATE TABLE IF NOT EXISTS sidebar_state (
  key text PRIMARY KEY NOT NULL,
  value text NOT NULL
);
`;

export type StoaDb = ReturnType<typeof createDb>;

export { schema };
