import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createDb, type StoaDb } from './connection'
import * as schema from './schema'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationReport {
  projectsMigrated: number
  sessionsMigrated: number
  metaSessionsMigrated: number
  settingsMigrated: number
  skipped: Array<{ file: string; reason: string }>
  errors: Array<{ file: string; error: string }>
}

// ---------------------------------------------------------------------------
// Source JSON shapes (mirror the persisted snake_case types from current code)
// ---------------------------------------------------------------------------

interface SourcePersistedProject {
  project_id: string
  name: string
  path: string
  default_session_type?: string
  created_at: string
  updated_at: string
}

interface SourcePersistedSession {
  session_id: string
  project_id: string
  parent_session_id: string | null
  created_by_session_id: string | null
  type: string
  title: string
  runtime_state: string
  turn_state: string
  turn_epoch: number
  last_turn_outcome: string
  blocking_reason: string | null
  failure_reason: string | null
  has_unseen_completion: boolean
  runtime_exit_code: number | null
  runtime_exit_reason: 'clean' | 'failed' | null
  last_state_sequence: number
  last_summary: string
  external_session_id: string | null
  title_generation: unknown
  created_at: string
  updated_at: string
  last_activated_at: string | null
  recovery_mode: string
  archived: boolean
  subagent_name?: string | null
  subagent_result_summary?: unknown
  subagent_input_epoch?: number
  subagent_latest_input_at?: string | null
  subagent_latest_input_state_sequence?: number
  subagent_result?: unknown
}

interface SourceGlobalStateV4 {
  version: 4
  active_project_id: string | null
  active_session_id: string | null
  projects: SourcePersistedProject[]
  settings?: Record<string, unknown>
}

interface SourceGlobalStateV3 {
  version: 3
  active_project_id: unknown
  active_session_id: unknown
  projects: SourcePersistedProject[]
  settings?: Record<string, unknown>
}

interface SourceMetaSessionStateV1 {
  version: 1
  active_meta_session_id: string | null
  sessions: SourcePersistedMetaSession[]
  proposals: SourcePersistedMetaSessionProposal[]
  action_logs: SourcePersistedMetaSessionActionLog[]
  inspector_target: unknown
}

interface SourcePersistedMetaSession {
  session_id: string
  title: string
  status: string
  backend_session_type: string
  capability_level: number
  pending_proposal_count: number
  active_target_count: number
  last_summary: string
  last_risk: string | null
  backend_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  archived: boolean
}

interface SourcePersistedMetaSessionProposal {
  proposal_id: string
  meta_session_id: string
  kind: string
  target_session_ids: string[]
  risk_level: number
  status: string
  summary: string
  reason: string
  prompt_text: string | null
  preset_name: string | null
  snapshot: unknown
  created_at: string
  updated_at: string
  approved_at: string | null
  rejected_at: string | null
  executed_at: string | null
  execution_result: string | null
}

interface SourcePersistedMetaSessionActionLog {
  action_id: string
  meta_session_id: string
  proposal_id: string | null
  action: string
  detail: string
  created_at: string
}

// ---------------------------------------------------------------------------
// SQL DDL — used at startup to ensure tables exist before we insert.
// This complements the drizzle-kit migration files which are set up separately.
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
]

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
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as unknown
}

function emptyReport(): MigrationReport {
  return {
    projectsMigrated: 0,
    sessionsMigrated: 0,
    metaSessionsMigrated: 0,
    settingsMigrated: 0,
    skipped: [],
    errors: [],
  }
}

function ensureTables(db: StoaDb): void {
  // The drizzle wrapper exposes the underlying better-sqlite3 instance via `$client`.
  // We use it here for raw DDL because CREATE TABLE IF NOT EXISTS must run before
  // any drizzle insert and we want it to be idempotent.
  const raw = (db as unknown as { $client: { exec: (sql: string) => void } }).$client
  for (const ddl of CREATE_TABLES_SQL) {
    raw.exec(ddl)
  }
  for (const idx of CREATE_INDEXES_SQL) {
    raw.exec(idx)
  }
}

// ---------------------------------------------------------------------------
// Source readers
// ---------------------------------------------------------------------------

async function readGlobalState(
  stoaDir: string,
  report: MigrationReport
): Promise<SourceGlobalStateV4 | null> {
  const globalPath = join(stoaDir, 'global.json')

  try {
    const parsed = (await readJsonFile(globalPath)) as Record<string, unknown>

    if (parsed.version === 4) {
      return parsed as unknown as SourceGlobalStateV4
    }

    if (parsed.version === 3) {
      const v3 = parsed as unknown as SourceGlobalStateV3
      return {
        version: 4,
        active_project_id: typeof v3.active_project_id === 'string' ? v3.active_project_id : null,
        active_session_id: typeof v3.active_session_id === 'string' ? v3.active_session_id : null,
        projects: v3.projects,
        settings: v3.settings,
      }
    }

    report.skipped.push({ file: globalPath, reason: `Unsupported version ${parsed.version}. Minimum: v3.` })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      report.skipped.push({ file: globalPath, reason: 'Not found' })
      return null
    }
    const message = error instanceof Error ? error.message : String(error)
    report.errors.push({ file: globalPath, error: message })
    return null
  }
}

async function readProjectSessions(
  projectPath: string,
  report: MigrationReport
): Promise<SourcePersistedSession[]> {
  const sessionsPath = join(projectPath, '.stoa', 'sessions.json')

  try {
    const parsed = (await readJsonFile(sessionsPath)) as Record<string, unknown>
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'sessions' in parsed
      && Array.isArray(parsed.sessions)
    ) {
      return parsed.sessions as SourcePersistedSession[]
    }
    report.skipped.push({ file: sessionsPath, reason: 'Invalid project sessions format' })
    return []
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return []
    }
    const message = error instanceof Error ? error.message : String(error)
    report.errors.push({ file: sessionsPath, error: message })
    return []
  }
}

async function readMetaSessionState(
  stoaDir: string,
  report: MigrationReport
): Promise<SourceMetaSessionStateV1 | null> {
  const metaPath = join(stoaDir, 'meta-session.json')

  try {
    const parsed = (await readJsonFile(metaPath)) as Record<string, unknown>
    if (
      typeof parsed === 'object'
      && parsed !== null
      && parsed.version === 1
      && 'sessions' in parsed
      && Array.isArray(parsed.sessions)
    ) {
      return parsed as unknown as SourceMetaSessionStateV1
    }
    report.skipped.push({ file: metaPath, reason: 'Invalid meta-session state format' })
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return null
    }
    const message = error instanceof Error ? error.message : String(error)
    report.errors.push({ file: metaPath, error: message })
    return null
  }
}

// ---------------------------------------------------------------------------
// Main migration function
// ---------------------------------------------------------------------------

export async function migrateFromJson(
  stoaDir: string,
  dbPath: string
): Promise<MigrationReport> {
  const report = emptyReport()
  const db = createDb(dbPath)

  // 1. Ensure schema exists (raw DDL via better-sqlite3).
  ensureTables(db)

  // 2. Read source files (async I/O).
  const globalState = await readGlobalState(stoaDir, report)
  if (!globalState) {
    return report
  }

  const projectSessionsMap = new Map<string, SourcePersistedSession[]>()
  for (const project of globalState.projects) {
    const sessions = await readProjectSessions(project.path, report)
    if (sessions.length > 0) {
      projectSessionsMap.set(project.project_id, sessions)
    }
  }

  const metaState = await readMetaSessionState(stoaDir, report)

  // 3. Transactional writes via drizzle.
  // `drizzle-orm/better-sqlite3`'s transaction() executes the callback synchronously
  // and returns the callback's return value (or undefined for void). We pass a void
  // callback, so we just call it — do NOT chain an extra `()` (the return value is
  // not callable).
  db.transaction((tx) => {
    // 3a. Projects
    for (const project of globalState.projects) {
      tx.insert(schema.projects).values({
        id: project.project_id,
        path: project.path,
        name: project.name,
        defaultSessionType: project.default_session_type ?? null,
        sortOrder: 0,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      }).onConflictDoUpdate({
        target: schema.projects.id,
        set: {
          path: project.path,
          name: project.name,
          defaultSessionType: project.default_session_type ?? null,
          updatedAt: project.updated_at,
        },
      }).run()

      report.projectsMigrated++
    }

    // 3b. Sessions
    for (const project of globalState.projects) {
      const sessions = projectSessionsMap.get(project.project_id) ?? []
      for (const session of sessions) {
        const archiveState = session.archived ? 'archived' : 'active'

        tx.insert(schema.sessions).values({
          id: session.session_id,
          projectId: session.project_id,
          parentId: session.parent_session_id,
          createdBySessionId: session.created_by_session_id,
          type: session.type,
          title: session.title,
          runtimeState: session.runtime_state,
          turnState: session.turn_state,
          turnOutcome: session.last_turn_outcome,
          turnEpoch: session.turn_epoch,
          sessionPhase: 'ready',
          blockingReason: session.blocking_reason,
          failureReason: session.failure_reason,
          hasUnseenCompletion: session.has_unseen_completion ? 1 : 0,
          runtimeExitCode: session.runtime_exit_code,
          runtimeExitReason: session.runtime_exit_reason,
          lastStateSequence: session.last_state_sequence,
          lastSummary: session.last_summary,
          externalSessionId: session.external_session_id,
          titleGeneration: JSON.stringify(session.title_generation),
          archiveState,
          recoveryMode: session.recovery_mode,
          lastActivatedAt: session.last_activated_at,
          sortOrder: 0,
          subagentEpoch: 0,
          subagentShortName: null,
          subagentName: session.subagent_name ?? null,
          subagentResultSummary: session.subagent_result_summary != null
            ? JSON.stringify(session.subagent_result_summary)
            : null,
          subagentInputEpoch: session.subagent_input_epoch ?? 0,
          subagentLatestInputAt: session.subagent_latest_input_at ?? null,
          subagentLatestInputStateSequence: session.subagent_latest_input_state_sequence ?? 0,
          subagentResult: session.subagent_result != null
            ? JSON.stringify(session.subagent_result)
            : null,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        }).onConflictDoUpdate({
          target: schema.sessions.id,
          set: {
            title: session.title,
            runtimeState: session.runtime_state,
            turnState: session.turn_state,
            turnOutcome: session.last_turn_outcome,
            turnEpoch: session.turn_epoch,
            blockingReason: session.blocking_reason,
            failureReason: session.failure_reason,
            hasUnseenCompletion: session.has_unseen_completion ? 1 : 0,
            runtimeExitCode: session.runtime_exit_code,
            runtimeExitReason: session.runtime_exit_reason,
            lastStateSequence: session.last_state_sequence,
            lastSummary: session.last_summary,
            externalSessionId: session.external_session_id,
            titleGeneration: JSON.stringify(session.title_generation),
            archiveState,
            recoveryMode: session.recovery_mode,
            lastActivatedAt: session.last_activated_at,
            updatedAt: session.updated_at,
          },
        }).run()

        report.sessionsMigrated++
      }
    }

    // 3c. Settings
    if (globalState.settings) {
      for (const [key, value] of Object.entries(globalState.settings)) {
        const serialized = JSON.stringify(value)
        tx.insert(schema.settings).values({ key, value: serialized })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: serialized },
          }).run()

        report.settingsMigrated++
      }
    }

    // 3d. Meta-session state
    if (metaState) {
      for (const ms of metaState.sessions) {
        tx.insert(schema.metaSessions).values({
          id: ms.session_id,
          title: ms.title,
          backendSessionType: ms.backend_session_type,
          backendSessionId: ms.backend_session_id,
          capabilityLevel: ms.capability_level,
          status: ms.status,
          archived: ms.archived ? 1 : 0,
          inspectorTarget: null,
          totalWorkSessions: ms.active_target_count,
          activeWorkSessions: ms.active_target_count,
          totalProposals: ms.pending_proposal_count,
          pendingProposals: ms.pending_proposal_count,
          lastSummary: ms.last_summary,
          lastRiskLevel: ms.last_risk,
          lastRiskReason: null,
          lastActivatedAt: ms.last_activated_at,
          createdAt: ms.created_at,
          updatedAt: ms.updated_at,
        }).onConflictDoUpdate({
          target: schema.metaSessions.id,
          set: {
            title: ms.title,
            backendSessionType: ms.backend_session_type,
            backendSessionId: ms.backend_session_id,
            capabilityLevel: ms.capability_level,
            status: ms.status,
            archived: ms.archived ? 1 : 0,
            totalWorkSessions: ms.active_target_count,
            activeWorkSessions: ms.active_target_count,
            totalProposals: ms.pending_proposal_count,
            pendingProposals: ms.pending_proposal_count,
            lastSummary: ms.last_summary,
            lastRiskLevel: ms.last_risk,
            lastActivatedAt: ms.last_activated_at,
            updatedAt: ms.updated_at,
          },
        }).run()

        report.metaSessionsMigrated++
      }

      // Meta-session proposals
      for (const proposal of metaState.proposals) {
        const workSessionId = proposal.target_session_ids[0]
        if (!workSessionId) {
          report.skipped.push({
            file: 'meta-session.json',
            reason: `Proposal ${proposal.proposal_id} has no target session; skipping`,
          })
          continue
        }

        tx.insert(schema.metaSessionProposals).values({
          id: proposal.proposal_id,
          metaSessionId: proposal.meta_session_id,
          workSessionId,
          kind: proposal.kind,
          presetName: proposal.preset_name,
          promptText: proposal.prompt_text,
          status: proposal.status,
          snapshot: JSON.stringify(proposal.snapshot),
          riskLevel: String(proposal.risk_level),
          riskReason: proposal.reason,
          executionResult: proposal.execution_result,
          stalenessReason: null,
          approvedAt: proposal.approved_at,
          rejectedAt: proposal.rejected_at,
          executedAt: proposal.executed_at,
          createdAt: proposal.created_at,
          updatedAt: proposal.updated_at,
        }).onConflictDoUpdate({
          target: schema.metaSessionProposals.id,
          set: {
            status: proposal.status,
            riskLevel: String(proposal.risk_level),
            approvedAt: proposal.approved_at,
            rejectedAt: proposal.rejected_at,
            executedAt: proposal.executed_at,
            executionResult: proposal.execution_result,
            updatedAt: proposal.updated_at,
          },
        }).run()
      }

      // Meta-session action logs
      for (const log of metaState.action_logs) {
        tx.insert(schema.metaSessionActionLogs).values({
          metaSessionId: log.meta_session_id,
          proposalId: log.proposal_id,
          action: log.action,
          detail: log.detail,
          createdAt: log.created_at,
        }).run()
      }

      // Active meta session id → server_config
      if (metaState.active_meta_session_id) {
        tx.insert(schema.serverConfig).values({
          key: 'active_meta_session_id',
          value: metaState.active_meta_session_id,
        }).onConflictDoUpdate({
          target: schema.serverConfig.key,
          set: { value: metaState.active_meta_session_id },
        }).run()
      }

      // Inspector target → server_config
      if (metaState.inspector_target) {
        const serialized = JSON.stringify(metaState.inspector_target)
        tx.insert(schema.serverConfig).values({
          key: 'meta_inspector_target',
          value: serialized,
        }).onConflictDoUpdate({
          target: schema.serverConfig.key,
          set: { value: serialized },
        }).run()
      }
    }

    // Active project/session → server_config
    if (globalState.active_project_id) {
      tx.insert(schema.serverConfig).values({
        key: 'active_project_id',
        value: globalState.active_project_id,
      }).onConflictDoUpdate({
        target: schema.serverConfig.key,
        set: { value: globalState.active_project_id },
      }).run()
    }

    if (globalState.active_session_id) {
      tx.insert(schema.serverConfig).values({
        key: 'active_session_id',
        value: globalState.active_session_id,
      }).onConflictDoUpdate({
        target: schema.serverConfig.key,
        set: { value: globalState.active_session_id },
      }).run()
    }
  })

  // 4. Verify counts
  const dbProjectCount = Number(
    db.select({ count: sql<number>`count(*)` }).from(schema.projects).get()?.count ?? 0
  )
  const dbSessionCount = Number(
    db.select({ count: sql<number>`count(*)` }).from(schema.sessions).get()?.count ?? 0
  )

  if (dbProjectCount !== report.projectsMigrated) {
    report.errors.push({
      file: dbPath,
      error: `Project count mismatch: expected ${report.projectsMigrated}, got ${dbProjectCount}`,
    })
  }
  if (dbSessionCount !== report.sessionsMigrated) {
    report.errors.push({
      file: dbPath,
      error: `Session count mismatch: expected ${report.sessionsMigrated}, got ${dbSessionCount}`,
    })
  }

  // 5. Backup originals (rename to .json.bak, never delete)
  const filesToBackup: string[] = [
    join(stoaDir, 'global.json'),
    join(stoaDir, 'meta-session.json'),
  ]
  for (const project of globalState.projects) {
    filesToBackup.push(join(project.path, '.stoa', 'sessions.json'))
  }

  for (const filePath of filesToBackup) {
    try {
      await rename(filePath, `${filePath}.bak`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        continue
      }
      report.errors.push({
        file: filePath,
        error: `Failed to backup: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  let stoaDir: string | undefined
  let dbPath: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stoa-dir' && i + 1 < args.length) {
      stoaDir = args[i + 1]
      i++
    } else if (args[i] === '--db-path' && i + 1 < args.length) {
      dbPath = args[i + 1]
      i++
    }
  }

  const resolvedStoaDir = stoaDir
    ?? (process.env.HOME ? join(process.env.HOME, '.stoa') : undefined)
    ?? (process.env.USERPROFILE ? join(process.env.USERPROFILE, '.stoa') : undefined)
    ?? join(homedir(), '.stoa')

  const resolvedDbPath = dbPath ?? './stoa.db'

  console.log(`Migrating from ${resolvedStoaDir} to ${resolvedDbPath}`)

  try {
    const report = await migrateFromJson(resolvedStoaDir, resolvedDbPath)

    console.log('')
    console.log('=== Migration Report ===')
    console.log(`Projects migrated:       ${report.projectsMigrated}`)
    console.log(`Sessions migrated:       ${report.sessionsMigrated}`)
    console.log(`Meta-sessions migrated:  ${report.metaSessionsMigrated}`)
    console.log(`Settings migrated:       ${report.settingsMigrated}`)

    if (report.skipped.length > 0) {
      console.log('')
      console.log('Skipped:')
      for (const item of report.skipped) {
        console.log(`  - ${item.file}: ${item.reason}`)
      }
    }

    if (report.errors.length > 0) {
      console.log('')
      console.log('Errors:')
      for (const item of report.errors) {
        console.log(`  - ${item.file}: ${item.error}`)
      }
    }

    console.log('')
    if (report.errors.length > 0) {
      console.log('Migration completed with errors.')
      process.exit(1)
    } else {
      console.log('Migration completed successfully.')
      process.exit(0)
    }
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

const isDirectRun = process.argv[1]?.endsWith('migrate-from-json.ts')
  || process.argv[1]?.endsWith('migrate-from-json.js')

if (isDirectRun) {
  main()
}
