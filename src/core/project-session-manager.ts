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
  SessionStatus,
  SessionSummary,
  SessionType
} from '@shared/project-session'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import {
  DEFAULT_GLOBAL_STATE,
  readGlobalState,
  readAllProjectSessions,
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
    last_known_status: session.status,
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
    status: session.last_known_status,
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

const NON_REGRESSIBLE_RUNNING_STATUSES = new Set<SessionStatus>([
  'awaiting_input',
  'degraded',
  'needs_confirmation',
  'error',
  'exited'
])

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
  const resolvedActiveSessionId = resolveActiveSessionId(sessions, activeSessionId)
  if (resolvedActiveSessionId) {
    const activeSession = sessions.find((session) => session.id === resolvedActiveSessionId)
    return {
      activeProjectId: activeSession?.projectId ?? null,
      activeSessionId: resolvedActiveSessionId
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

  private constructor(initialState: BootstrapState, globalStatePath?: string, persistedSettings?: AppSettings) {
    this.state = structuredCloneState(initialState)
    this.globalStatePath = globalStatePath
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
    const persistedGlobal = await readGlobalState(options.globalStatePath)
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

  static createForTest(): ProjectSessionManager {
    return new ProjectSessionManager({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: null,
      projects: [],
      sessions: []
    }, undefined, { ...DEFAULT_SETTINGS })
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

    await this.persist()
    return { ...project }
  }

  async setTerminalWebhookPort(port: number | null): Promise<void> {
    this.state.terminalWebhookPort = port
    await this.persist()
  }

  async applySessionEvent(
    sessionId: string,
    status: SessionStatus,
    summary: string,
    externalSessionId?: string | null
  ): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return

    session.status = status
    session.summary = summary
    if (externalSessionId !== undefined) {
      session.externalSessionId = externalSessionId
    }
    session.updatedAt = new Date().toISOString()
    await this.persist()
  }

  async markSessionStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void> {
    await this.applySessionEvent(sessionId, 'starting', summary, externalSessionId)
  }

  async markSessionRunning(sessionId: string, externalSessionId: string | null): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return

    if (NON_REGRESSIBLE_RUNNING_STATUSES.has(session.status)) {
      if (externalSessionId !== undefined) {
        session.externalSessionId = externalSessionId
      }
      session.updatedAt = new Date().toISOString()
      await this.persist()
      return
    }

    await this.applySessionEvent(sessionId, 'running', '会话运行中', externalSessionId)
  }

  async markSessionExited(sessionId: string, summary: string): Promise<void> {
    await this.applySessionEvent(sessionId, 'exited', summary)
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
      title: request.title,
      summary: '等待会话启动',
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
        version: 4,
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
  }
}
