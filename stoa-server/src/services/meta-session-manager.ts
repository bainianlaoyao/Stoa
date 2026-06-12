/**
 * MetaSessionManager — CRUD for meta-sessions, active session switching.
 *
 * Extracted from `src/core/meta-session-manager.ts` to stoa-server.
 * Replaces JSON state store with Drizzle queries against the `meta_sessions`
 * table. Active meta-session id is stored in `server_config` under the
 * `active_meta_session_id` key (singleton row).
 */
import { randomUUID } from 'node:crypto'
import { eq, asc } from 'drizzle-orm'
import type {
  MetaSessionBootstrapRecoveryEntry,
  MetaSessionInspectorTarget,
  CreateMetaSessionRequest,
  MetaSessionSummary,
  MetaSessionSnapshot
} from 'stoa-shared'
import {
  metaSessions,
  serverConfig
} from '../db/schema'
import type { StoaDb } from '../db/connection'
import { getProviderDescriptorBySessionType } from 'stoa-shared'

const ACTIVE_META_SESSION_KEY = 'active_meta_session_id'

// ---------------------------------------------------------------------------
// Row <-> Summary mapping
// ---------------------------------------------------------------------------

interface MetaSessionRow {
  id: string
  title: string | null
  backendSessionType: string
  backendSessionId: string | null
  capabilityLevel: number
  status: string
  archived: number
  inspectorTarget: string | null
  totalWorkSessions: number
  activeWorkSessions: number
  totalProposals: number
  pendingProposals: number
  lastSummary: string | null
  lastRiskLevel: string | null
  lastRiskReason: string | null
  lastActivatedAt: string | null
  createdAt: string
  updatedAt: string
}

function toSummary(row: MetaSessionRow): MetaSessionSummary {
  return {
    id: row.id,
    title: row.title ?? 'Untitled meta session',
    status: row.status as MetaSessionSummary['status'],
    backendSessionType: row.backendSessionType as MetaSessionSummary['backendSessionType'],
    capabilityLevel: row.capabilityLevel as MetaSessionSummary['capabilityLevel'],
    pendingProposalCount: row.pendingProposals,
    activeTargetCount: row.activeWorkSessions,
    lastSummary: row.lastSummary ?? '',
    lastRisk: row.lastRiskReason,
    backendSessionId: row.backendSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivatedAt: row.lastActivatedAt,
    archived: row.archived === 1
  }
}

function cloneSnapshot(snapshot: MetaSessionSnapshot): MetaSessionSnapshot {
  return {
    activeMetaSessionId: snapshot.activeMetaSessionId,
    sessions: snapshot.sessions.map((session) => ({ ...session })),
    inspectorTarget: snapshot.inspectorTarget ? { ...snapshot.inspectorTarget } : null
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export interface MetaSessionManagerOptions {
  wsHub?: unknown
}

export class MetaSessionManager {
  private state: MetaSessionSnapshot
  private readonly db: StoaDb

  private constructor(db: StoaDb, state: MetaSessionSnapshot) {
    this.db = db
    this.state = state
  }

  static create(db: StoaDb, _options: MetaSessionManagerOptions = {}): MetaSessionManager {
    const sessions = db
      .select()
      .from(metaSessions)
      .orderBy(asc(metaSessions.createdAt))
      .all()
      .map(toSummary)

    const activeRow = db
      .select()
      .from(serverConfig)
      .where(eq(serverConfig.key, ACTIVE_META_SESSION_KEY))
      .get()
    const activeMetaSessionId = activeRow?.value ?? null

    const inspectorTarget = sessions.length > 0
      ? (parseInspectorTarget(sessions[0]?.id ?? null))
      : null

    return new MetaSessionManager(db, {
      activeMetaSessionId,
      sessions,
      inspectorTarget
    })
  }

  snapshot(): MetaSessionSnapshot {
    return cloneSnapshot(this.state)
  }

  async listSessions(): Promise<MetaSessionSummary[]> {
    return this.snapshot().sessions
  }

  async createSession(request: CreateMetaSessionRequest): Promise<MetaSessionSummary> {
    const nowIso = new Date().toISOString()
    const id = `meta_session_${randomUUID()}`
    const seedsExternalSessionId = getProviderDescriptorBySessionType(request.backendSessionType).seedsExternalSessionId
    const backendSessionId = seedsExternalSessionId ? randomUUID() : null

    db_insertMetaSession(this.db, {
      id,
      title: request.title,
      backendSessionType: request.backendSessionType,
      backendSessionId,
      capabilityLevel: request.capabilityLevel,
      status: 'created',
      lastSummary: 'Waiting for meta session backend to start',
      lastActivatedAt: this.state.sessions.length === 0 ? nowIso : null,
      nowIso
    })

    if (this.state.activeMetaSessionId === null) {
      this.setActiveConfig(id)
    }

    const created: MetaSessionSummary = {
      id,
      title: request.title,
      status: 'created',
      backendSessionType: request.backendSessionType,
      capabilityLevel: request.capabilityLevel,
      pendingProposalCount: 0,
      activeTargetCount: 0,
      lastSummary: 'Waiting for meta session backend to start',
      lastRisk: null,
      backendSessionId,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivatedAt: this.state.sessions.length === 0 ? nowIso : null,
      archived: false
    }

    this.state = {
      activeMetaSessionId: this.state.activeMetaSessionId ?? created.id,
      sessions: [...this.state.sessions, created],
      inspectorTarget: this.state.inspectorTarget
    }

    return { ...created }
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const nowIso = new Date().toISOString()
    db_updateLastActivatedAt(this.db, sessionId, nowIso)
    this.setActiveConfig(sessionId)
    this.state = {
      activeMetaSessionId: sessionId,
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? { ...session, lastActivatedAt: nowIso }
        : session),
      inspectorTarget: this.state.inspectorTarget
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const current = this.state.sessions.find((session) => session.id === sessionId)
    if (!current) {
      return
    }

    const nowIso = new Date().toISOString()
    db_updateStatus(this.db, sessionId, 'closed', nowIso)

    const sessions = this.state.sessions.map((session) => session.id === sessionId
      ? { ...session, status: 'closed' as const, updatedAt: nowIso }
      : session)
    const nextActiveSessionId = this.state.activeMetaSessionId === sessionId
      ? sessions.find((session) => session.status !== 'closed')?.id ?? null
      : this.state.activeMetaSessionId

    if (nextActiveSessionId !== this.state.activeMetaSessionId) {
      this.setActiveConfig(nextActiveSessionId)
    }

    this.state = {
      activeMetaSessionId: nextActiveSessionId,
      sessions,
      inspectorTarget: this.state.inspectorTarget
    }
  }

  async archiveSession(sessionId: string): Promise<void> {
    db_updateArchived(this.db, sessionId, 1)
    const nextActive = this.state.activeMetaSessionId === sessionId
      ? this.state.sessions.find((s) => s.id !== sessionId && !s.archived)?.id ?? null
      : this.state.activeMetaSessionId
    if (nextActive !== this.state.activeMetaSessionId) {
      this.setActiveConfig(nextActive)
    }
    this.state = {
      activeMetaSessionId: nextActive,
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? { ...session, archived: true }
        : session),
      inspectorTarget: this.state.inspectorTarget
    }
  }

  async restoreSession(sessionId: string): Promise<void> {
    db_updateArchived(this.db, sessionId, 0)
    this.setActiveConfig(sessionId)
    this.state = {
      activeMetaSessionId: sessionId,
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? { ...session, archived: false }
        : session),
      inspectorTarget: this.state.inspectorTarget
    }
  }

  hasSession(sessionId: string): boolean {
    return this.state.sessions.some((session) => session.id === sessionId)
  }

  getSession(sessionId: string): MetaSessionSummary | null {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    return session ? { ...session } : null
  }

  async updateSession(
    sessionId: string,
    patch: Partial<Pick<MetaSessionSummary, 'status' | 'pendingProposalCount' | 'activeTargetCount' | 'lastSummary' | 'lastRisk' | 'backendSessionId' | 'lastActivatedAt'>>
  ): Promise<void> {
    const existing = this.state.sessions.find((session) => session.id === sessionId)
    if (!existing) {
      return
    }

    const nowIso = new Date().toISOString()
    db_updatePatch(this.db, sessionId, patch, nowIso)

    this.state = {
      activeMetaSessionId: this.state.activeMetaSessionId,
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? { ...session, ...patch, updatedAt: nowIso }
        : session),
      inspectorTarget: this.state.inspectorTarget
    }
  }

  async setInspectorTarget(target: MetaSessionInspectorTarget | null): Promise<void> {
    for (const session of this.state.sessions) {
      db_updateInspectorTarget(this.db, session.id, target)
    }
    this.state = {
      activeMetaSessionId: this.state.activeMetaSessionId,
      sessions: this.state.sessions,
      inspectorTarget: target ? { ...target } : null
    }
  }

  buildBootstrapRecoveryPlan(): MetaSessionBootstrapRecoveryEntry[] {
    return this.state.sessions
      .filter((session) => !session.archived && session.status !== 'closed' && session.backendSessionId)
      .map((session) => ({
        sessionId: session.id,
        backendSessionId: session.backendSessionId!
      }))
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private setActiveConfig(sessionId: string | null): void {
    if (sessionId === null) {
      db_deleteConfig(this.db, ACTIVE_META_SESSION_KEY)
    } else {
      db_upsertConfig(this.db, ACTIVE_META_SESSION_KEY, sessionId)
    }
  }
}

// ---------------------------------------------------------------------------
// Drizzle write helpers — small wrappers that keep the public methods focused
// on business logic while persisting via the schema module.
// ---------------------------------------------------------------------------

function db_insertMetaSession(
  db: StoaDb,
  input: {
    id: string
    title: string
    backendSessionType: string
    backendSessionId: string | null
    capabilityLevel: number
    status: string
    lastSummary: string
    lastActivatedAt: string | null
    nowIso: string
  }
): void {
  db.insert(metaSessions).values({
    id: input.id,
    title: input.title,
    backendSessionType: input.backendSessionType,
    backendSessionId: input.backendSessionId,
    capabilityLevel: input.capabilityLevel,
    status: input.status,
    archived: 0,
    inspectorTarget: null,
    totalWorkSessions: 0,
    activeWorkSessions: 0,
    totalProposals: 0,
    pendingProposals: 0,
    lastSummary: input.lastSummary,
    lastRiskLevel: null,
    lastRiskReason: null,
    lastActivatedAt: input.lastActivatedAt,
    createdAt: input.nowIso,
    updatedAt: input.nowIso
  }).run()
}

function db_updateLastActivatedAt(db: StoaDb, sessionId: string, nowIso: string): void {
  db.update(metaSessions)
    .set({ lastActivatedAt: nowIso, updatedAt: nowIso })
    .where(eq(metaSessions.id, sessionId))
    .run()
}

function db_updateStatus(db: StoaDb, sessionId: string, status: string, nowIso: string): void {
  db.update(metaSessions)
    .set({ status, updatedAt: nowIso })
    .where(eq(metaSessions.id, sessionId))
    .run()
}

function db_updateArchived(db: StoaDb, sessionId: string, archived: 0 | 1): void {
  db.update(metaSessions)
    .set({ archived, updatedAt: new Date().toISOString() })
    .where(eq(metaSessions.id, sessionId))
    .run()
}

function db_updatePatch(
  db: StoaDb,
  sessionId: string,
  patch: Partial<Pick<MetaSessionSummary, 'status' | 'pendingProposalCount' | 'activeTargetCount' | 'lastSummary' | 'lastRisk' | 'backendSessionId' | 'lastActivatedAt'>>,
  nowIso: string
): void {
  const update: Record<string, unknown> = { updatedAt: nowIso }
  if (patch.status !== undefined) update.status = patch.status
  if (patch.pendingProposalCount !== undefined) update.pendingProposals = patch.pendingProposalCount
  if (patch.activeTargetCount !== undefined) update.activeWorkSessions = patch.activeTargetCount
  if (patch.lastSummary !== undefined) update.lastSummary = patch.lastSummary
  if (patch.lastRisk !== undefined) update.lastRiskReason = patch.lastRisk
  if (patch.backendSessionId !== undefined) update.backendSessionId = patch.backendSessionId
  if (patch.lastActivatedAt !== undefined) update.lastActivatedAt = patch.lastActivatedAt
  db.update(metaSessions)
    .set(update as never)
    .where(eq(metaSessions.id, sessionId))
    .run()
}

function db_updateInspectorTarget(
  db: StoaDb,
  sessionId: string,
  target: MetaSessionInspectorTarget | null
): void {
  db.update(metaSessions)
    .set({
      inspectorTarget: target ? JSON.stringify(target) : null,
      updatedAt: new Date().toISOString()
    })
    .where(eq(metaSessions.id, sessionId))
    .run()
}

function db_upsertConfig(db: StoaDb, key: string, value: string): void {
  const existing = db
    .select()
    .from(serverConfig)
    .where(eq(serverConfig.key, key))
    .get()
  if (existing) {
    db.update(serverConfig)
      .set({ value })
      .where(eq(serverConfig.key, key))
      .run()
  } else {
    db.insert(serverConfig).values({ key, value }).run()
  }
}

function db_deleteConfig(db: StoaDb, key: string): void {
  db.delete(serverConfig).where(eq(serverConfig.key, key)).run()
}

function parseInspectorTarget(_firstSessionId: string | null): MetaSessionInspectorTarget | null {
  // Initial inspector target defaults to 'app' in the original implementation.
  return { kind: 'app' }
}
