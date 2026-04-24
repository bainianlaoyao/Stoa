import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  BootstrapState,
  CreateProjectRequest,
  CreateSessionRequest,
  PersistedGlobalStateV3,
  PersistedProject,
  PersistedProjectSessions,
  PersistedSession,
  ProjectSummary,
  SessionStateIntent,
  SessionStatePatchEvent,
  SessionSummary,
  SessionType
} from '@shared/project-session'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { reduceSessionState } from '@shared/session-state-reducer'
import {
  DEFAULT_GLOBAL_STATE,
  StateReadError,
  readAllProjectSessions,
  readGlobalState,
  readProjectSessions,
  writeGlobalState,
  writeProjectSessions
} from '@core/state-store'

interface ProjectSessionManagerOptions {
  webhookPort: number | null
  globalStatePath?: string
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function structuredCloneState(state: BootstrapState): BootstrapState {
  return {
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    terminalWebhookPort: state.terminalWebhookPort,
    projects: state.projects.map((project) => ({ ...project })),
    sessions: state.sessions.map((session) => ({ ...session }))
  }
}

function toPersistedProject(project: ProjectSummary): PersistedProject {
  return {
    project_id: project.id,
    name: project.name,
    path: project.path,
    default_session_type: project.defaultSessionType,
    created_at: project.createdAt,
    updated_at: project.updatedAt
  }
}

function toPersistedSession(session: SessionSummary): PersistedSession {
  return {
    session_id: session.id,
    project_id: session.projectId,
    type: session.type,
    title: session.title,
    runtime_state: session.runtimeState,
    agent_state: session.agentState,
    has_unseen_completion: session.hasUnseenCompletion,
    runtime_exit_code: session.runtimeExitCode,
    runtime_exit_reason: session.runtimeExitReason,
    last_state_sequence: session.lastStateSequence,
    blocking_reason: session.blockingReason,
    last_summary: session.summary,
    external_session_id: session.externalSessionId,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_activated_at: session.lastActivatedAt,
    recovery_mode: session.recoveryMode,
    archived: session.archived
  }
}

function toSessionSummary(session: PersistedSession): SessionSummary {
  return {
    id: session.session_id,
    projectId: session.project_id,
    type: session.type,
    status: 'bootstrapping',
    runtimeState: session.runtime_state,
    agentState: session.agent_state,
    hasUnseenCompletion: session.has_unseen_completion,
    runtimeExitCode: session.runtime_exit_code,
    runtimeExitReason: session.runtime_exit_reason,
    lastStateSequence: session.last_state_sequence,
    blockingReason: session.blocking_reason,
    title: session.title,
    summary: session.last_summary,
    recoveryMode: session.recovery_mode,
    externalSessionId: session.external_session_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastActivatedAt: session.last_activated_at,
    archived: session.archived ?? false
  }
}

function toProjectSummary(project: PersistedProject): ProjectSummary {
  return {
    id: project.project_id,
    name: project.name,
    path: project.path,
    defaultSessionType: project.default_session_type,
    createdAt: project.created_at,
    updatedAt: project.updated_at
  }
}

function createSessionRecoveryMode(type: SessionType) {
  return type === 'shell' ? 'fresh-shell' : 'resume-external'
}

function createSessionExternalId(type: SessionType, externalSessionId?: string | null): string | null {
  if (externalSessionId !== undefined && externalSessionId !== null) {
    return externalSessionId
  }

  return getProviderDescriptorBySessionType(type).seedsExternalSessionId
    ? randomUUID()
    : null
}

function resolveActiveProjectId(projects: ProjectSummary[], activeProjectId: string | null): string | null {
  if (!activeProjectId) {
    return null
  }

  return projects.some((project) => project.id === activeProjectId)
    ? activeProjectId
    : null
}

function resolveActiveSessionId(sessions: SessionSummary[], activeSessionId: string | null): string | null {
  if (!activeSessionId) {
    return null
  }

  return sessions.some((session) => session.id === activeSessionId)
    ? activeSessionId
    : null
}

function resolveBootstrapActiveState(
  projects: ProjectSummary[],
  sessions: SessionSummary[],
  activeProjectId: string | null,
  activeSessionId: string | null
): Pick<BootstrapState, 'activeProjectId' | 'activeSessionId'> {
  const projectIds = new Set(projects.map((project) => project.id))
  const resolvedActiveSessionId = resolveActiveSessionId(sessions, activeSessionId)
  if (resolvedActiveSessionId) {
    const activeSession = sessions.find((session) => session.id === resolvedActiveSessionId)
    if (activeSession && projectIds.has(activeSession.projectId)) {
      return {
        activeProjectId: activeSession.projectId,
        activeSessionId: resolvedActiveSessionId
      }
    }
  }

  return {
    activeProjectId: resolveActiveProjectId(projects, activeProjectId),
    activeSessionId: null
  }
}

export class ProjectSessionManager {
  private state: BootstrapState
  private readonly globalStatePath?: string
  private settings: AppSettings
  private readonly persistDisabled: boolean
  private persistChain: Promise<void> = Promise.resolve()
  private hasPersistedProjects = false

  private constructor(initialState: BootstrapState, globalStatePath?: string, persistedSettings?: AppSettings, persistDisabled = false) {
    this.state = structuredCloneState(initialState)
    this.globalStatePath = globalStatePath
    this.persistDisabled = persistDisabled
    this.hasPersistedProjects = initialState.projects.length > 0
    this.settings = persistedSettings
      ? {
          ...DEFAULT_SETTINGS,
          ...persistedSettings,
          providers: {
            ...DEFAULT_SETTINGS.providers,
            ...persistedSettings.providers
          }
        }
      : { ...DEFAULT_SETTINGS }
  }

  static async create(options: ProjectSessionManagerOptions): Promise<ProjectSessionManager> {
    const persistedGlobal = await ProjectSessionManager.readGlobalStateWithRetry(options.globalStatePath)
    const projects = persistedGlobal.projects.map(toProjectSummary)
    const allSessions = await readAllProjectSessions(persistedGlobal.projects)
    const sessions = allSessions.map(toSessionSummary)
    const activeState = resolveBootstrapActiveState(
      projects,
      sessions,
      persistedGlobal.active_project_id,
      persistedGlobal.active_session_id
    )

    const initialState: BootstrapState = {
      activeProjectId: activeState.activeProjectId,
      activeSessionId: activeState.activeSessionId,
      terminalWebhookPort: options.webhookPort,
      projects,
      sessions
    }

    const manager = new ProjectSessionManager(initialState, options.globalStatePath, persistedGlobal.settings)
    await manager.persist()
    return manager
  }

  private static async readGlobalStateWithRetry(globalStatePath?: string): Promise<PersistedGlobalStateV3> {
    try {
      return await readGlobalState(globalStatePath)
    } catch (error) {
      if (error instanceof StateReadError && error.isTransient) {
        await new Promise(resolve => setTimeout(resolve, 50))
        return await readGlobalState(globalStatePath)
      }

      throw error
    }
  }

  static createForTest(): ProjectSessionManager {
    return new ProjectSessionManager({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }, undefined, { ...DEFAULT_SETTINGS }, true)
  }

  snapshot(): BootstrapState {
    return structuredCloneState(this.state)
  }

  buildBootstrapRecoveryPlan() {
    return this.state.sessions.filter(s => !s.archived).map((session) => {
      if (session.type === 'shell') {
        return { sessionId: session.id, action: 'fresh-shell' as const }
      }

      return {
        sessionId: session.id,
        action: 'resume-external' as const,
        externalSessionId: session.externalSessionId
      }
    })
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectSummary> {
    const duplicate = this.state.projects.find((project) => normalizePath(project.path) === normalizePath(request.path))
    if (duplicate) {
      throw new Error('Project path already exists')
    }

    const now = new Date().toISOString()
    const project: ProjectSummary = {
      id: `project_${randomUUID()}`,
      name: request.name,
      path: request.path,
      defaultSessionType: request.defaultSessionType,
      createdAt: now,
      updatedAt: now
    }

    this.state.projects.push(project)
    if (!this.state.activeProjectId) {
      this.state.activeProjectId = project.id
    }

    if (!this.persistDisabled) {
      try {
        const existingSessions = await readProjectSessions(request.path)
        if (Array.isArray(existingSessions.sessions) && existingSessions.sessions.length > 0) {
          const mapped = existingSessions.sessions
            .filter((session) => session.project_id && !this.state.sessions.some((existing) => existing.id === session.session_id))
            .map(toSessionSummary)
          this.state.sessions.push(...mapped)
        }
      } catch (error) {
        console.warn('[state-persist] Ignoring unreadable project session cache during project import', error)
      }
    }

    await this.persist()
    return { ...project }
  }

  async setTerminalWebhookPort(port: number | null): Promise<void> {
    this.state.terminalWebhookPort = port
  }

  async applySessionStatePatch(patch: SessionStatePatchEvent): Promise<void> {
    const session = this.state.sessions.find(s => s.id === patch.sessionId)
    if (!session) return

    const reduced = reduceSessionState(session, patch, new Date().toISOString())
    if (reduced === session) {
      return
    }

    const summary = shouldApplyPatchSummary(session, patch) ? patch.summary : session.summary
    Object.assign(session, reduced, { summary })
    if (patch.externalSessionId !== undefined) {
      session.externalSessionId = patch.externalSessionId
    }
    await this.persist()
  }

  async markRuntimeStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void> {
    await this.applyRuntimePatch(sessionId, 'runtime.starting', summary, { externalSessionId })
  }

  async markRuntimeAlive(sessionId: string, externalSessionId: string | null): Promise<void> {
    await this.applyRuntimePatch(sessionId, 'runtime.alive', 'Session running', { externalSessionId })
  }

  async markRuntimeExited(sessionId: string, exitCode: number | null, summary: string): Promise<void> {
    await this.applyRuntimePatch(
      sessionId,
      exitCode === null || exitCode === 0 ? 'runtime.exited_clean' : 'runtime.exited_failed',
      summary,
      { runtimeExitCode: exitCode }
    )
  }

  async markRuntimeFailedToStart(sessionId: string, summary: string): Promise<void> {
    await this.applyRuntimePatch(sessionId, 'runtime.failed_to_start', summary)
  }

  async markCompletionSeen(sessionId: string): Promise<void> {
    await this.applyRuntimePatch(sessionId, 'agent.completion_seen', 'Completion seen', { source: 'ui' })
  }

  async setActiveProject(projectId: string): Promise<void> {
    const project = this.state.projects.find(p => p.id === projectId)
    if (!project) return
    this.state.activeProjectId = projectId
    await this.persist()
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return
    this.state.activeSessionId = sessionId
    this.state.activeProjectId = session.projectId
    if (session.agentState === 'idle' && session.hasUnseenCompletion) {
      const patch = this.createSessionStatePatch(session, 'agent.completion_seen', 'Completion seen', { source: 'ui' })
      const reduced = reduceSessionState(session, patch, new Date().toISOString())
      Object.assign(session, reduced, { summary: patch.summary })
    }
    await this.persist()
  }

  async archiveSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return
    session.archived = true
    session.updatedAt = new Date().toISOString()
    if (this.state.activeSessionId === sessionId) {
      this.state.activeSessionId = null
    }
    await this.persist()
  }

  async restoreSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return
    session.archived = false
    this.state.activeProjectId = session.projectId
    this.state.activeSessionId = session.id
    session.updatedAt = new Date().toISOString()
    await this.persist()
  }

  getArchivedSessions(): SessionSummary[] {
    return this.state.sessions.filter(s => s.archived)
  }

  async createSession(request: CreateSessionRequest): Promise<SessionSummary> {
    const project = this.state.projects.find((candidate) => candidate.id === request.projectId)
    if (!project) {
      throw new Error('Session must belong to an existing project')
    }

    const now = new Date().toISOString()
    const session: SessionSummary = {
      id: `session_${randomUUID()}`,
      projectId: request.projectId,
      type: request.type,
      status: 'bootstrapping',
      runtimeState: 'created',
      agentState: 'unknown',
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      lastStateSequence: 0,
      blockingReason: null,
      title: request.title,
      summary: 'Waiting for session to start',
      recoveryMode: createSessionRecoveryMode(request.type),
      externalSessionId: createSessionExternalId(request.type, request.externalSessionId),
      createdAt: now,
      updatedAt: now,
      lastActivatedAt: now,
      archived: false
    }

    this.state.sessions.push(session)
    this.state.activeProjectId = request.projectId
    this.state.activeSessionId = session.id

    await this.persist()
    return { ...session }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    if (key === 'shellPath' && typeof value === 'string') {
      this.settings.shellPath = value
    } else if (key === 'terminalFontSize' && typeof value === 'number') {
      this.settings.terminalFontSize = Math.max(12, Math.min(24, value))
    } else if (key === 'terminalFontFamily' && typeof value === 'string') {
      this.settings.terminalFontFamily = value
    } else if (key === 'providers' && typeof value === 'object' && value !== null) {
      this.settings.providers = value as Record<string, string>
    } else if (key === 'claudeDangerouslySkipPermissions' && typeof value === 'boolean') {
      this.settings.claudeDangerouslySkipPermissions = value
    }
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (this.persistDisabled) return

    const runPersist = async () => {
      try {
        await this.doPersist()
      } catch (error) {
        console.error('[state-persist] Failed to write state to disk', error)
        throw error
      }
    }

    const next = this.persistChain.then(runPersist, runPersist)
    this.persistChain = next.catch(() => undefined)
    await next
  }

  private async doPersist(): Promise<void> {
    if (this.hasPersistedProjects && this.state.projects.length === 0) {
      console.error('[state-persist] Refusing to overwrite persisted projects with an empty list')
      return
    }

    const persistedProjects = this.state.projects.map(toPersistedProject)
    const persistedSessions = this.state.sessions.map(toPersistedSession)

    const byProject = new Map<string, PersistedSession[]>()
    for (const session of persistedSessions) {
      const list = byProject.get(session.project_id) ?? []
      list.push(session)
      byProject.set(session.project_id, list)
    }

    for (const project of persistedProjects) {
      const projectSessions = byProject.get(project.project_id) ?? []
      const data: PersistedProjectSessions = {
        version: 5,
        project_id: project.project_id,
        sessions: projectSessions
      }
      await writeProjectSessions(project.path, data)
    }

    const globalState: PersistedGlobalStateV3 =
      persistedProjects.length === 0
        ? { ...structuredClone(DEFAULT_GLOBAL_STATE), settings: this.settings }
        : {
            version: 3,
            active_project_id: this.state.activeProjectId,
            active_session_id: this.state.activeSessionId,
            projects: persistedProjects,
            settings: this.settings
          }
    await writeGlobalState(globalState, this.globalStatePath)

    if (persistedProjects.length > 0) {
      this.hasPersistedProjects = true
    }
  }

  private async applyRuntimePatch(
    sessionId: string,
    intent: SessionStateIntent,
    summary: string,
    options: Partial<Pick<SessionStatePatchEvent, 'externalSessionId' | 'runtimeExitCode' | 'source'>> = {}
  ): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return

    await this.applySessionStatePatch(this.createSessionStatePatch(session, intent, summary, options))
  }

  private createSessionStatePatch(
    session: SessionSummary,
    intent: SessionStateIntent,
    summary: string,
    options: Partial<Pick<SessionStatePatchEvent, 'externalSessionId' | 'runtimeExitCode' | 'source'>> = {}
  ): SessionStatePatchEvent {
    return {
      sessionId: session.id,
      sequence: session.lastStateSequence + 1,
      occurredAt: new Date().toISOString(),
      intent,
      source: options.source ?? 'runtime',
      summary,
      externalSessionId: options.externalSessionId,
      runtimeExitCode: options.runtimeExitCode
    }
  }
}

function shouldApplyPatchSummary(session: SessionSummary, patch: SessionStatePatchEvent): boolean {
  return patch.intent !== 'runtime.alive'
    || (session.agentState !== 'blocked' && session.agentState !== 'error')
}
