import { randomUUID } from 'node:crypto'
import type {
  MetaSessionBootstrapRecoveryEntry,
  MetaSessionInspectorTarget,
  CreateMetaSessionRequest,
  MetaSessionSummary,
  MetaSessionSnapshot,
  PersistedMetaSession
} from '@shared/meta-session'
import { readMetaSessionState, updateMetaSessionState } from './meta-session-state-store'

interface MetaSessionManagerOptions {
  statePath?: string
}

function toSummary(session: PersistedMetaSession): MetaSessionSummary {
  return {
    id: session.session_id,
    title: session.title,
    status: session.status,
    backendSessionType: session.backend_session_type,
    capabilityLevel: session.capability_level,
    pendingProposalCount: session.pending_proposal_count,
    activeTargetCount: session.active_target_count,
    lastSummary: session.last_summary,
    lastRisk: session.last_risk,
    backendSessionId: session.backend_session_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastActivatedAt: session.last_activated_at
  }
}

function toPersisted(session: MetaSessionSummary): PersistedMetaSession {
  return {
    session_id: session.id,
    title: session.title,
    status: session.status,
    backend_session_type: session.backendSessionType,
    capability_level: session.capabilityLevel,
    pending_proposal_count: session.pendingProposalCount,
    active_target_count: session.activeTargetCount,
    last_summary: session.lastSummary,
    last_risk: session.lastRisk,
    backend_session_id: session.backendSessionId,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_activated_at: session.lastActivatedAt
  }
}

function cloneSnapshot(snapshot: MetaSessionSnapshot): MetaSessionSnapshot {
  return {
    activeMetaSessionId: snapshot.activeMetaSessionId,
    sessions: snapshot.sessions.map((session) => ({ ...session })),
    inspectorTarget: snapshot.inspectorTarget ? { ...snapshot.inspectorTarget } : null
  }
}

export class MetaSessionManager {
  private constructor(
    private readonly statePath: string | undefined,
    private state: MetaSessionSnapshot
  ) {}

  static async create(options: MetaSessionManagerOptions = {}): Promise<MetaSessionManager> {
    const persisted = await readMetaSessionState(options.statePath)
    return new MetaSessionManager(options.statePath, {
      activeMetaSessionId: persisted.active_meta_session_id,
      sessions: persisted.sessions.map(toSummary),
      inspectorTarget: persisted.inspector_target
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
    const created: MetaSessionSummary = {
      id: `meta_session_${randomUUID()}`,
      title: request.title,
      status: 'created',
      backendSessionType: request.backendSessionType,
      capabilityLevel: request.capabilityLevel,
      pendingProposalCount: 0,
      activeTargetCount: 0,
      lastSummary: 'Waiting for meta session backend to start',
      lastRisk: null,
      backendSessionId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivatedAt: this.state.sessions.length === 0 ? nowIso : null
    }

    this.state = {
      activeMetaSessionId: this.state.activeMetaSessionId ?? created.id,
      sessions: [...this.state.sessions, created],
      inspectorTarget: this.state.inspectorTarget
    }

    await this.persist()
    return { ...created }
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const nowIso = new Date().toISOString()
    this.state = {
      activeMetaSessionId: sessionId,
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? {
            ...session,
            lastActivatedAt: nowIso,
            updatedAt: nowIso
          }
        : session),
      inspectorTarget: this.state.inspectorTarget
    }
    await this.persist()
  }

  async closeSession(sessionId: string): Promise<void> {
    const current = this.state.sessions.find((session) => session.id === sessionId)
    if (!current) {
      return
    }

    const nowIso = new Date().toISOString()
    const sessions = this.state.sessions.map((session) => session.id === sessionId
      ? {
          ...session,
          status: 'closed' as const,
          updatedAt: nowIso
        }
      : session)
    const nextActiveSessionId = this.state.activeMetaSessionId === sessionId
      ? sessions.find((session) => session.status !== 'closed')?.id ?? null
      : this.state.activeMetaSessionId

    this.state = {
      activeMetaSessionId: nextActiveSessionId,
      sessions,
      inspectorTarget: this.state.inspectorTarget
    }
    await this.persist()
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
    this.state = {
      activeMetaSessionId: this.state.activeMetaSessionId,
      sessions: this.state.sessions.map((session) => session.id === sessionId
        ? {
            ...session,
            ...patch,
            updatedAt: nowIso
          }
        : session),
      inspectorTarget: this.state.inspectorTarget
    }
    await this.persist()
  }

  async setInspectorTarget(target: MetaSessionInspectorTarget | null): Promise<void> {
    this.state = {
      activeMetaSessionId: this.state.activeMetaSessionId,
      sessions: this.state.sessions,
      inspectorTarget: target ? { ...target } : null
    }
    await this.persist()
  }

  buildBootstrapRecoveryPlan(): MetaSessionBootstrapRecoveryEntry[] {
    return this.state.sessions
      .filter((session) => session.status !== 'closed' && session.backendSessionId)
      .map((session) => ({
        sessionId: session.id,
        backendSessionId: session.backendSessionId!
      }))
  }

  private async persist(): Promise<void> {
    await updateMetaSessionState((current) => ({
      version: 1,
      active_meta_session_id: this.state.activeMetaSessionId,
      sessions: this.state.sessions.map(toPersisted),
      proposals: current.proposals,
      action_logs: current.action_logs,
      inspector_target: this.state.inspectorTarget ? { ...this.state.inspectorTarget } : null
    }), this.statePath)
  }
}
