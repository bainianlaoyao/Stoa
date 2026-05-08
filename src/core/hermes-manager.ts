import { randomUUID } from 'node:crypto'
import type {
  HermesBootstrapRecoveryEntry,
  HermesInspectorTarget,
  CreateHermesSessionRequest,
  HermesSessionSummary,
  HermesSnapshot,
  PersistedHermesSession
} from '@shared/hermes'
import { readHermesState, updateHermesState } from './hermes-state-store'

interface HermesManagerOptions {
  statePath?: string
}

function toSummary(session: PersistedHermesSession): HermesSessionSummary {
  return {
    id: session.session_id,
    title: session.title,
    status: session.status,
    capabilityLevel: session.capability_level,
    pendingProposalCount: session.pending_proposal_count,
    activeTargetCount: session.active_target_count,
    lastSummary: session.last_summary,
    lastRisk: session.last_risk,
    resumeSessionId: session.resume_session_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastActivatedAt: session.last_activated_at
  }
}

function toPersisted(session: HermesSessionSummary): PersistedHermesSession {
  return {
    session_id: session.id,
    title: session.title,
    status: session.status,
    capability_level: session.capabilityLevel,
    pending_proposal_count: session.pendingProposalCount,
    active_target_count: session.activeTargetCount,
    last_summary: session.lastSummary,
    last_risk: session.lastRisk,
    resume_session_id: session.resumeSessionId,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_activated_at: session.lastActivatedAt
  }
}

function cloneSnapshot(snapshot: HermesSnapshot): HermesSnapshot {
  return {
    activeHermesSessionId: snapshot.activeHermesSessionId,
    sessions: snapshot.sessions.map((session) => ({ ...session })),
    inspectorTarget: snapshot.inspectorTarget ? { ...snapshot.inspectorTarget } : null
  }
}

export class HermesManager {
  private constructor(
    private readonly statePath: string | undefined,
    private state: HermesSnapshot
  ) {}

  static async create(options: HermesManagerOptions = {}): Promise<HermesManager> {
    const persisted = await readHermesState(options.statePath)
    return new HermesManager(options.statePath, {
      activeHermesSessionId: persisted.active_hermes_session_id,
      sessions: persisted.sessions.map(toSummary),
      inspectorTarget: persisted.inspector_target
    })
  }

  snapshot(): HermesSnapshot {
    return cloneSnapshot(this.state)
  }

  async listSessions(): Promise<HermesSessionSummary[]> {
    return this.snapshot().sessions
  }

  async createSession(request: CreateHermesSessionRequest): Promise<HermesSessionSummary> {
    const nowIso = new Date().toISOString()
    const created: HermesSessionSummary = {
      id: `hermes_${randomUUID()}`,
      title: request.title,
      status: 'created',
      capabilityLevel: request.capabilityLevel,
      pendingProposalCount: 0,
      activeTargetCount: 0,
      lastSummary: 'Waiting for Hermes to start',
      lastRisk: null,
      resumeSessionId: randomUUID(),
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivatedAt: this.state.sessions.length === 0 ? nowIso : null
    }

    this.state = {
      activeHermesSessionId: this.state.activeHermesSessionId ?? created.id,
      sessions: [...this.state.sessions, created],
      inspectorTarget: this.state.inspectorTarget
    }

    await this.persist()
    return { ...created }
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const nowIso = new Date().toISOString()
    this.state = {
      activeHermesSessionId: sessionId,
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
    const nextActiveSessionId = this.state.activeHermesSessionId === sessionId
      ? sessions.find((session) => session.status !== 'closed')?.id ?? null
      : this.state.activeHermesSessionId

    this.state = {
      activeHermesSessionId: nextActiveSessionId,
      sessions,
      inspectorTarget: this.state.inspectorTarget
    }
    await this.persist()
  }

  hasSession(sessionId: string): boolean {
    return this.state.sessions.some((session) => session.id === sessionId)
  }

  getSession(sessionId: string): HermesSessionSummary | null {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    return session ? { ...session } : null
  }

  async updateSession(
    sessionId: string,
    patch: Partial<Pick<HermesSessionSummary, 'status' | 'pendingProposalCount' | 'activeTargetCount' | 'lastSummary' | 'lastRisk' | 'resumeSessionId' | 'lastActivatedAt'>>
  ): Promise<void> {
    const existing = this.state.sessions.find((session) => session.id === sessionId)
    if (!existing) {
      return
    }

    const nowIso = new Date().toISOString()
    this.state = {
      activeHermesSessionId: this.state.activeHermesSessionId,
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

  async setInspectorTarget(target: HermesInspectorTarget | null): Promise<void> {
    this.state = {
      activeHermesSessionId: this.state.activeHermesSessionId,
      sessions: this.state.sessions,
      inspectorTarget: target ? { ...target } : null
    }
    await this.persist()
  }

  buildBootstrapRecoveryPlan(): HermesBootstrapRecoveryEntry[] {
    return this.state.sessions
      .filter((session) => session.status !== 'closed' && session.resumeSessionId)
      .map((session) => ({
        sessionId: session.id,
        resumeSessionId: session.resumeSessionId!
      }))
  }

  private async persist(): Promise<void> {
    await updateHermesState((current) => ({
      version: 1,
      active_hermes_session_id: this.state.activeHermesSessionId,
      sessions: this.state.sessions.map(toPersisted),
      proposals: current.proposals,
      action_logs: current.action_logs,
      inspector_target: this.state.inspectorTarget ? { ...this.state.inspectorTarget } : null
    }), this.statePath)
  }
}
