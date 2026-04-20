import { randomUUID } from 'node:crypto'
import type {
  BootstrapState,
  CreateProjectRequest,
  CreateSessionRequest,
  PersistedAppStateV2,
  ProjectSummary,
  SessionSummary,
  SessionType
} from '@shared/project-session'
import { DEFAULT_STATE, readPersistedState, writePersistedState } from '@core/state-store'

interface ProjectSessionManagerOptions {
  webhookPort: number | null
  stateFilePath?: string
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

function toBootstrapState(state: PersistedAppStateV2, webhookPort: number | null): BootstrapState {
  return {
    activeProjectId: state.active_project_id,
    activeSessionId: state.active_session_id,
    terminalWebhookPort: webhookPort,
    projects: state.projects.map((project) => ({
      id: project.project_id,
      name: project.name,
      path: project.path,
      defaultSessionType: project.default_session_type,
      createdAt: project.created_at,
      updatedAt: project.updated_at
    })),
    sessions: state.sessions.map((session) => ({
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
      lastActivatedAt: session.last_activated_at
    }))
  }
}

function toPersistedState(state: BootstrapState): PersistedAppStateV2 {
  return {
    version: 2,
    active_project_id: state.activeProjectId,
    active_session_id: state.activeSessionId,
    projects: state.projects.map((project) => ({
      project_id: project.id,
      name: project.name,
      path: project.path,
      default_session_type: project.defaultSessionType,
      created_at: project.createdAt,
      updated_at: project.updatedAt
    })),
    sessions: state.sessions.map((session) => ({
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
      recovery_mode: session.recoveryMode
    }))
  }
}

function createSessionRecoveryMode(type: SessionType) {
  return type === 'shell' ? 'fresh-shell' : 'resume-external'
}

export class ProjectSessionManager {
  private state: BootstrapState
  private readonly stateFilePath?: string

  private constructor(initialState: BootstrapState, stateFilePath?: string) {
    this.state = structuredCloneState(initialState)
    this.stateFilePath = stateFilePath
  }

  static async create(options: ProjectSessionManagerOptions): Promise<ProjectSessionManager> {
    const persisted = await readPersistedState(options.stateFilePath)
    const initialState = toBootstrapState(persisted, options.webhookPort)
    const manager = new ProjectSessionManager(initialState, options.stateFilePath)
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
    })
  }

  snapshot(): BootstrapState {
    return structuredCloneState(this.state)
  }

  buildBootstrapRecoveryPlan() {
    return this.state.sessions.map((session) => {
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
      externalSessionId: request.externalSessionId ?? null,
      createdAt: now,
      updatedAt: now,
      lastActivatedAt: now
    }

    this.state.sessions.push(session)
    this.state.activeProjectId = request.projectId
    this.state.activeSessionId = session.id

    await this.persist()
    return { ...session }
  }

  private async persist(): Promise<void> {
    const nextState = this.state.projects.length === 0 && this.state.sessions.length === 0
      ? DEFAULT_STATE
      : toPersistedState(this.state)

    await writePersistedState(nextState, this.stateFilePath)
  }
}
