/**
 * Persistence backend abstraction for Stoa Server.
 *
 * See plan section 4.2: Introduced to allow incremental migration from the
 * current JSON files to SQLite + Drizzle. Services depend on this interface
 * (not on a concrete file/sqlite API), so tests can swap in-memory fakes and
 * the production deployment can switch backends without touching business
 * logic.
 *
 * Two reference implementations live in this file:
 *   - JsonFileBackend: read/write JSON files identical to state-store.ts
 *   - SqliteBackend:   read/write via Drizzle (target deployment)
 */
import { eq } from 'drizzle-orm'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  PersistedGlobalStateV4,
  PersistedProjectSessions,
} from 'stoa-shared'
import { DEFAULT_SETTINGS } from 'stoa-shared'
import { createDb, type StoaDb } from '../db/connection'
import * as schema from '../db/schema'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface IPersistenceBackend {
  loadGlobalState(): Promise<PersistedGlobalStateV4>
  saveGlobalState(state: PersistedGlobalStateV4): Promise<void>
  loadProjectSessions(projectPath: string): Promise<PersistedProjectSessions>
  saveProjectSessions(
    projectPath: string,
    data: PersistedProjectSessions
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// Default empty state — mirrors DEFAULT_GLOBAL_STATE from state-store.ts
// ---------------------------------------------------------------------------

export const DEFAULT_GLOBAL_STATE_V4: PersistedGlobalStateV4 = {
  version: 4,
  active_project_id: null,
  active_session_id: null,
  projects: [],
  settings: { ...DEFAULT_SETTINGS }
}

export const DEFAULT_PROJECT_SESSIONS: PersistedProjectSessions = {
  version: 7,
  project_id: '',
  sessions: []
}

// ---------------------------------------------------------------------------
// JSON file backend
// ---------------------------------------------------------------------------

function getStateFilePath(): string {
  return join(homedir(), '.stoa', 'state.json')
}

function getGlobalStateFilePath(): string {
  return join(homedir(), '.stoa', 'global.json')
}

function getProjectSessionsFilePath(projectPath: string): string {
  return join(projectPath, '.stoa', 'sessions.json')
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  return 'code' in error && typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function isTransientError(code: string | undefined): boolean {
  return code === 'EBUSY'
    || code === 'EACCES'
    || code === 'EPERM'
    || code === 'EAGAIN'
    || code === 'EMFILE'
    || code === 'ENFILE'
}

export class StateReadError extends Error {
  readonly cause: unknown
  readonly filePath: string
  readonly isTransient: boolean

  constructor(message: string, cause: unknown, filePath: string, isTransient: boolean) {
    super(message)
    this.name = 'StateReadError'
    this.cause = cause
    this.filePath = filePath
    this.isTransient = isTransient
  }
}

function createReadError(message: string, filePath: string, cause: unknown): StateReadError {
  return new StateReadError(message, cause, filePath, isTransientError(getErrorCode(cause)))
}

function createAtomicTempFilePath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
}

const pendingFileAccesses = new Map<string, Promise<void>>()

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function withFileAccess<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingFileAccesses.get(filePath) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  let tracked: Promise<void>
  tracked = current.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    if (pendingFileAccesses.get(filePath) === tracked) {
      pendingFileAccesses.delete(filePath)
    }
  })
  pendingFileAccesses.set(filePath, tracked)
  return current
}

async function replaceFileAtomically(tempFilePath: string, filePath: string): Promise<void> {
  try {
    await rename(tempFilePath, filePath)
    return
  } catch (error) {
    const code = getErrorCode(error)
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error
    }
  }

  const backupPath = `${filePath}.replace.bak`
  await rm(backupPath, { force: true })

  if (await fileExists(filePath)) {
    await rename(filePath, backupPath)
  }

  try {
    await rename(tempFilePath, filePath)
    await rm(backupPath, { force: true })
  } catch (error) {
    if (!(await fileExists(filePath)) && await fileExists(backupPath)) {
      await rename(backupPath, filePath)
    }
    throw error
  }
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await withFileAccess(filePath, async () => {
    await mkdir(dirname(filePath), { recursive: true })
    const tempFilePath = createAtomicTempFilePath(filePath)

    try {
      await writeFile(tempFilePath, JSON.stringify(payload, null, 2), 'utf-8')
      await replaceFileAtomically(tempFilePath, filePath)
    } finally {
      await rm(tempFilePath, { force: true })
    }
  })
}

function isValidGlobalState(value: unknown): value is PersistedGlobalStateV4 {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && (value as { version: unknown }).version === 4
    && 'projects' in value
    && Array.isArray((value as { projects: unknown }).projects)
}

function isV3GlobalState(value: unknown): value is { version: 3; active_project_id: unknown; active_session_id: unknown; projects: unknown[]; settings?: unknown } {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && (value as { version: unknown }).version === 3
    && 'projects' in value
    && Array.isArray((value as { projects: unknown }).projects)
}

function migrateV3ToV4(value: { version: 3; active_project_id: unknown; active_session_id: unknown; projects: unknown[]; settings?: unknown }): PersistedGlobalStateV4 {
  return {
    version: 4,
    active_project_id: typeof value.active_project_id === 'string' ? value.active_project_id : null,
    active_session_id: typeof value.active_session_id === 'string' ? value.active_session_id : null,
    projects: value.projects as PersistedGlobalStateV4['projects'],
    settings: (value.settings as AppSettings | undefined) ?? { ...DEFAULT_SETTINGS }
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return await withFileAccess(filePath, async () => {
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw) as unknown
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') {
        throw Object.assign(Object.create(Error.prototype), {
          code: 'ENOENT'
        })
      }
      throw error
    }
  })
}

export interface JsonFileBackendOptions {
  globalStatePath?: string
}

export class JsonFileBackend implements IPersistenceBackend {
  private readonly globalStatePath: string

  constructor(options: JsonFileBackendOptions = {}) {
    this.globalStatePath = options.globalStatePath ?? getGlobalStateFilePath()
  }

  async loadGlobalState(): Promise<PersistedGlobalStateV4> {
    try {
      const parsed = await readJson(this.globalStatePath)
      if (isValidGlobalState(parsed)) {
        return parsed
      }
      if (isV3GlobalState(parsed)) {
        return migrateV3ToV4(parsed)
      }
      throw new StateReadError('Invalid global state', undefined, this.globalStatePath, false)
    } catch (error) {
      if (error instanceof StateReadError) {
        throw error
      }
      if (getErrorCode(error) === 'ENOENT') {
        return structuredClone(DEFAULT_GLOBAL_STATE_V4)
      }
      throw createReadError('Unable to read global state', this.globalStatePath, error)
    }
  }

  async saveGlobalState(state: PersistedGlobalStateV4): Promise<void> {
    await writeJsonAtomically(this.globalStatePath, state)
  }

  async loadProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
    const filePath = getProjectSessionsFilePath(projectPath)
    try {
      const parsed = await readJson(filePath)
      if (typeof parsed === 'object' && parsed !== null) {
        const candidate = parsed as { version?: unknown; project_id?: unknown; sessions?: unknown }
        if (candidate.version === 7
          && typeof candidate.project_id === 'string'
          && Array.isArray(candidate.sessions)) {
          return candidate as unknown as PersistedProjectSessions
        }
        // Unsupported version wrapper
        if (candidate.version !== undefined) {
          return {
            version: 7,
            project_id: typeof candidate.project_id === 'string' ? candidate.project_id : '',
            sessions: []
          }
        }
      }
      throw new StateReadError('Invalid project sessions state', undefined, filePath, false)
    } catch (error) {
      if (error instanceof StateReadError) {
        throw error
      }
      if (getErrorCode(error) === 'ENOENT') {
        return structuredClone(DEFAULT_PROJECT_SESSIONS)
      }
      throw createReadError('Unable to read project sessions', filePath, error)
    }
  }

  async saveProjectSessions(projectPath: string, data: PersistedProjectSessions): Promise<void> {
    const filePath = getProjectSessionsFilePath(projectPath)
    await writeJsonAtomically(filePath, {
      version: 7,
      project_id: data.project_id,
      sessions: data.sessions
    } satisfies PersistedProjectSessions)
  }
}

// ---------------------------------------------------------------------------
// SQLite + Drizzle backend
// ---------------------------------------------------------------------------

/**
 * Persist PersistedProject + PersistedSession + PersistedGlobalStateV4 into
 * the existing Drizzle schema (projects / sessions / settings / server_config).
 *
 * Loads:  reads all rows from `projects` + `sessions` (filtered by archived
 *         state not needed for full bootstrap), and reconstructs
 *         `PersistedGlobalStateV4` from those tables + active ids stored in
 *         `server_config` and settings blob in `settings` (key='app').
 *
 * Saves:  upserts each project/session row inside a single transaction. Global
 *         state is split into `settings` (AppSettings) and `server_config`
 *         keys for active_project_id / active_session_id.
 */
export class SqliteBackend implements IPersistenceBackend {
  private readonly db: StoaDb

  constructor(db: StoaDb) {
    this.db = db
  }

  static fromPath(dbPath: string): SqliteBackend {
    return new SqliteBackend(createDb(dbPath))
  }

  async loadGlobalState(): Promise<PersistedGlobalStateV4> {
    const projects = this.db.select().from(schema.projects).all()
    const settingsRow = this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'app'))
      .get()
    const activeProjectRow = this.db
      .select()
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.key, 'active_project_id'))
      .get()
    const activeSessionRow = this.db
      .select()
      .from(schema.serverConfig)
      .where(eq(schema.serverConfig.key, 'active_session_id'))
      .get()

    const settings: AppSettings = settingsRow
      ? (JSON.parse(settingsRow.value) as AppSettings)
      : { ...DEFAULT_SETTINGS }

    return {
      version: 4,
      active_project_id: activeProjectRow?.value ?? null,
      active_session_id: activeSessionRow?.value ?? null,
      projects: projects.map((p) => ({
        project_id: p.id,
        name: p.name,
        path: p.path,
        default_session_type: (p.defaultSessionType ?? undefined) as PersistedGlobalStateV4['projects'][number]['default_session_type'],
        created_at: p.createdAt,
        updated_at: p.updatedAt
      })),
      settings
    }
  }

  async saveGlobalState(state: PersistedGlobalStateV4): Promise<void> {
    this.db.transaction((tx) => {
      // Upsert projects
      for (const project of state.projects) {
        tx.insert(schema.projects)
          .values({
            id: project.project_id,
            path: project.path,
            name: project.name,
            defaultSessionType: project.default_session_type ?? null,
            sortOrder: 0,
            createdAt: project.created_at,
            updatedAt: project.updated_at
          })
          .onConflictDoUpdate({
            target: schema.projects.id,
            set: {
              path: project.path,
              name: project.name,
              defaultSessionType: project.default_session_type ?? null,
              updatedAt: project.updated_at
            }
          })
          .run()
      }

      // Settings blob (AppSettings)
      const serialized = JSON.stringify(state.settings ?? { ...DEFAULT_SETTINGS })
      tx.insert(schema.settings)
        .values({ key: 'app', value: serialized })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: serialized }
        })
        .run()

      // Active project id
      if (state.active_project_id) {
        tx.insert(schema.serverConfig)
          .values({ key: 'active_project_id', value: state.active_project_id })
          .onConflictDoUpdate({
            target: schema.serverConfig.key,
            set: { value: state.active_project_id }
          })
          .run()
      } else {
        tx.delete(schema.serverConfig)
          .where(eq(schema.serverConfig.key, 'active_project_id'))
          .run()
      }

      // Active session id
      if (state.active_session_id) {
        tx.insert(schema.serverConfig)
          .values({ key: 'active_session_id', value: state.active_session_id })
          .onConflictDoUpdate({
            target: schema.serverConfig.key,
            set: { value: state.active_session_id }
          })
          .run()
      } else {
        tx.delete(schema.serverConfig)
          .where(eq(schema.serverConfig.key, 'active_session_id'))
          .run()
      }
    })
  }

  async loadProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
    // Look up project by path
    const project = this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, projectPath))
      .get()

    if (!project) {
      return structuredClone(DEFAULT_PROJECT_SESSIONS)
    }

    const sessions = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.projectId, project.id))
      .all()

    return {
      version: 7,
      project_id: project.id,
      sessions: sessions.map((s) => ({
        session_id: s.id,
        project_id: s.projectId,
        parent_session_id: s.parentId ?? null,
        created_by_session_id: s.createdBySessionId ?? null,
        type: s.type as PersistedProjectSessions['sessions'][number]['type'],
        title: s.title ?? '',
        runtime_state: s.runtimeState as PersistedProjectSessions['sessions'][number]['runtime_state'],
        turn_state: s.turnState as PersistedProjectSessions['sessions'][number]['turn_state'],
        turn_epoch: s.turnEpoch,
        last_turn_outcome: s.turnOutcome as PersistedProjectSessions['sessions'][number]['last_turn_outcome'],
        blocking_reason: (s.blockingReason ?? null) as PersistedProjectSessions['sessions'][number]['blocking_reason'],
        failure_reason: (s.failureReason ?? null) as PersistedProjectSessions['sessions'][number]['failure_reason'],
        has_unseen_completion: s.hasUnseenCompletion !== 0,
        runtime_exit_code: s.runtimeExitCode ?? null,
        runtime_exit_reason: (s.runtimeExitReason ?? null) as PersistedProjectSessions['sessions'][number]['runtime_exit_reason'],
        last_state_sequence: s.lastStateSequence,
        last_summary: s.lastSummary ?? '',
        external_session_id: s.externalSessionId ?? null,
        title_generation: s.titleGeneration
          ? (JSON.parse(s.titleGeneration) as PersistedProjectSessions['sessions'][number]['title_generation'])
          : { prompt: null, assistantSnippet: null, contextUpdatedAt: null, autoGeneratedTurnEpoch: null },
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        last_activated_at: s.lastActivatedAt ?? null,
        recovery_mode: s.recoveryMode as PersistedProjectSessions['sessions'][number]['recovery_mode'],
        archived: s.archiveState === 'archived',
        subagent_name: s.subagentName ?? null,
        subagent_result_summary: s.subagentResultSummary
          ? (JSON.parse(s.subagentResultSummary) as PersistedProjectSessions['sessions'][number]['subagent_result_summary'])
          : null,
        subagent_input_epoch: s.subagentInputEpoch,
        subagent_latest_input_at: s.subagentLatestInputAt ?? null,
        subagent_latest_input_state_sequence: s.subagentLatestInputStateSequence,
        subagent_result: s.subagentResult
          ? (JSON.parse(s.subagentResult) as PersistedProjectSessions['sessions'][number]['subagent_result'])
          : null
      }))
    }
  }

  async saveProjectSessions(projectPath: string, data: PersistedProjectSessions): Promise<void> {
    // Ensure the project row exists; the project manager keeps it consistent
    // with sessions by writing projects first via saveGlobalState. If the
    // project row is missing, we skip the session write — the caller is
    // expected to flush the project row first.
    const project = this.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, projectPath))
      .get()

    if (!project) {
      return
    }

    this.db.transaction((tx) => {
      // Remove any existing sessions for this project, then re-insert the
      // authoritative set. This matches the JSON backend's replace-on-write
      // semantics and keeps the table as a denormalized projection of
      // per-project session lists.
      tx.delete(schema.sessions)
        .where(eq(schema.sessions.projectId, project.id))
        .run()

      for (const session of data.sessions) {
        tx.insert(schema.sessions)
          .values({
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
            archiveState: session.archived ? 'archived' : 'active',
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
            updatedAt: session.updated_at
          })
          .onConflictDoUpdate({
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
              archiveState: session.archived ? 'archived' : 'active',
              recoveryMode: session.recovery_mode,
              lastActivatedAt: session.last_activated_at,
              updatedAt: session.updated_at
            }
          })
          .run()
      }
    })
  }
}
