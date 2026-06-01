import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  BootstrapState,
  CreateProjectRequest,
  CreateSessionRequest,
  PersistedGlobalStateV4,
  PersistedProject,
  PersistedProjectSessions,
  PersistedSession,
  ProjectSummary,
  SessionNodeSnapshot,
  SessionTitleGenerationContext,
  SessionStateIntent,
  SessionStatePatchEvent,
  SessionSummary,
  SessionTreeMeta,
  SessionType
} from '@shared/project-session'
import { DEFAULT_SETTINGS } from '@shared/project-session'
import { getProviderDescriptorBySessionType } from '@shared/provider-descriptors'
import { reduceSessionState } from '@shared/session-state-reducer'
import { resolveDefaultWorkSessionTitle } from './work-session-title'
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
    parent_session_id: session.parentSessionId,
    created_by_session_id: session.createdBySessionId,
    type: session.type,
    title: session.title,
    runtime_state: session.runtimeState,
    turn_state: session.turnState,
    turn_epoch: session.turnEpoch,
    last_turn_outcome: session.lastTurnOutcome,
    blocking_reason: session.blockingReason,
    failure_reason: session.failureReason,
    has_unseen_completion: session.hasUnseenCompletion,
    runtime_exit_code: session.runtimeExitCode,
    runtime_exit_reason: session.runtimeExitReason,
    last_state_sequence: session.lastStateSequence,
    last_summary: session.summary,
    external_session_id: session.externalSessionId,
    title_generation: { ...session.titleGenerationContext },
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
    parentSessionId: session.parent_session_id,
    createdBySessionId: session.created_by_session_id,
    type: session.type,
    runtimeState: session.runtime_state,
    turnState: session.turn_state,
    turnEpoch: session.turn_epoch,
    lastTurnOutcome: session.last_turn_outcome,
    blockingReason: session.blocking_reason,
    failureReason: session.failure_reason,
    hasUnseenCompletion: session.has_unseen_completion,
    runtimeExitCode: session.runtime_exit_code,
    runtimeExitReason: session.runtime_exit_reason,
    lastStateSequence: session.last_state_sequence,
    title: session.title,
    summary: session.last_summary,
    titleGenerationContext: normalizeSessionTitleGenerationContext(session.title_generation),
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

function shouldResumeViaExternalSession(session: Pick<SessionSummary, 'type' | 'externalSessionId'>): boolean {
  if (session.type === 'shell') {
    return false
  }

  if (session.type === 'codex') {
    return !!session.externalSessionId
  }

  return true
}

function createSessionExternalId(type: SessionType, externalSessionId?: string | null): string | null {
  if (externalSessionId !== undefined && externalSessionId !== null) {
    return externalSessionId
  }

  return getProviderDescriptorBySessionType(type).seedsExternalSessionId
    ? randomUUID()
    : null
}

function defaultSessionTitleGenerationContext(): SessionTitleGenerationContext {
  return {
    prompt: null,
    assistantSnippet: null,
    contextUpdatedAt: null,
    autoGeneratedTurnEpoch: null
  }
}

function normalizeSessionTitleGenerationContext(value: unknown): SessionTitleGenerationContext {
  if (typeof value !== 'object' || value === null) {
    return defaultSessionTitleGenerationContext()
  }

  const candidate = value as {
    prompt?: unknown
    assistantSnippet?: unknown
    contextUpdatedAt?: unknown
    autoGeneratedTurnEpoch?: unknown
  }

  return {
    prompt: typeof candidate.prompt === 'string' ? candidate.prompt : null,
    assistantSnippet: typeof candidate.assistantSnippet === 'string' ? candidate.assistantSnippet : null,
    contextUpdatedAt: typeof candidate.contextUpdatedAt === 'string' ? candidate.contextUpdatedAt : null,
    autoGeneratedTurnEpoch: typeof candidate.autoGeneratedTurnEpoch === 'number' ? candidate.autoGeneratedTurnEpoch : null
  }
}

function normalizeAppSettings(settings?: Partial<AppSettings>): AppSettings {
  const defaults = structuredClone(DEFAULT_SETTINGS)
  if (!settings) {
    return defaults
  }

  return {
    shellPath: typeof settings.shellPath === 'string' ? settings.shellPath : defaults.shellPath,
    terminal: typeof settings.terminal === 'object' && settings.terminal !== null
      ? { ...settings.terminal }
      : defaults.terminal,
    providers: typeof settings.providers === 'object' && settings.providers !== null
      ? { ...settings.providers }
      : defaults.providers,
    evolverInferenceProvider:
      settings.evolverInferenceProvider === 'claude-code'
        ? settings.evolverInferenceProvider
        : defaults.evolverInferenceProvider,
    evolverExecutionMode: settings.evolverExecutionMode === 'workspace-shell'
      ? settings.evolverExecutionMode
      : defaults.evolverExecutionMode,
    titleGeneration: isTitleGenerationSetting(settings.titleGeneration)
      ? { ...settings.titleGeneration }
      : defaults.titleGeneration,
    workspaceIde: isWorkspaceIdeSetting(settings.workspaceIde)
      ? { ...settings.workspaceIde }
      : defaults.workspaceIde,
    claudeDangerouslySkipPermissions: typeof settings.claudeDangerouslySkipPermissions === 'boolean'
      ? settings.claudeDangerouslySkipPermissions
      : defaults.claudeDangerouslySkipPermissions,
    locale: typeof settings.locale === 'string' ? settings.locale : defaults.locale
  }
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
    this.settings = normalizeAppSettings(persistedSettings)
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

  private static async readGlobalStateWithRetry(globalStatePath?: string): Promise<PersistedGlobalStateV4> {
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
    const activeSessions = this.getSessionsInTreeOrder().filter((session) => !session.archived)
    return activeSessions.map((session) => {
      if (!shouldResumeViaExternalSession(session)) {
        return { sessionId: session.id, action: 'fresh-shell' as const }
      }

      return {
        sessionId: session.id,
        action: 'resume-external' as const,
        externalSessionId: session.externalSessionId
      }
    })
  }

  getSessionNodeSnapshot(sessionId: string): SessionNodeSnapshot | null {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return null
    }

    return {
      session: { ...session, titleGenerationContext: { ...session.titleGenerationContext } },
      tree: this.deriveSessionTreeMeta(sessionId)
    }
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
    await this.applySessionStateReduction(patch)
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
    await this.applyRuntimePatch(sessionId, 'runtime.failed_to_start', summary, {
      failureReason: 'failed_to_start'
    })
  }

  async markCompletionSeen(sessionId: string): Promise<void> {
    await this.applyRuntimePatch(sessionId, 'agent.completion_seen', 'Completion seen', { source: 'ui' })
  }

  async markAgentTurnInterrupted(sessionId: string, summary: string): Promise<void> {
    await this.applyRuntimePatch(sessionId, 'agent.turn_interrupted', summary, { source: 'ui' })
  }

  async setActiveProject(projectId: string): Promise<void> {
    const project = this.state.projects.find(p => p.id === projectId)
    if (!project) return
    this.state.activeProjectId = projectId
    const activeSession = this.state.sessions.find((session) => session.id === this.state.activeSessionId)
    if (!activeSession || activeSession.projectId !== projectId) {
      this.state.activeSessionId = null
    }
    await this.persist()
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return
    this.state.activeSessionId = sessionId
    this.state.activeProjectId = session.projectId
    if (session.turnState === 'idle' && session.lastTurnOutcome === 'completed' && session.hasUnseenCompletion) {
      const patch = this.createSessionStatePatch(session, 'agent.completion_seen', 'Completion seen', { source: 'ui' })
      this.applySessionStateReductionToSession(session, patch, new Date().toISOString())
    }
    await this.persist()
  }

  async deleteProject(projectId: string): Promise<void> {
    const projectIndex = this.state.projects.findIndex(p => p.id === projectId)
    if (projectIndex === -1) return

    this.state.projects.splice(projectIndex, 1)
    this.state.sessions = this.state.sessions.filter(s => s.projectId !== projectId)

    if (this.state.activeProjectId === projectId) {
      this.state.activeProjectId = this.state.projects[0]?.id ?? null
    }
    this.reconcileActiveState()

    await this.persist()
  }

  async archiveSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return
    const now = new Date().toISOString()
    const subtree = this.getSessionSubtree(sessionId)
    for (const node of subtree) {
      node.archived = true
      node.updatedAt = now
    }
    if (this.state.activeSessionId && subtree.some((node) => node.id === this.state.activeSessionId)) {
      this.state.activeSessionId = null
    }
    await this.persist()
  }

  async restoreSession(sessionId: string): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return
    const now = new Date().toISOString()
    const subtree = this.getSessionSubtree(sessionId)
    for (const node of subtree) {
      node.archived = false
      node.updatedAt = now
    }
    this.state.activeProjectId = session.projectId
    this.state.activeSessionId = session.id
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

    const parentSession = request.parentSessionId
      ? this.state.sessions.find((candidate) => candidate.id === request.parentSessionId)
      : null
    if (request.parentSessionId && !parentSession) {
      throw new Error('Parent session must exist')
    }
    if (parentSession && parentSession.projectId !== project.id) {
      throw new Error('Parent session must belong to the same project')
    }
    if (parentSession?.archived) {
      throw new Error('Parent session must be live')
    }
    const creatorSession = request.createdBySessionId
      ? this.state.sessions.find((candidate) => candidate.id === request.createdBySessionId)
      : null
    if (request.createdBySessionId && !creatorSession) {
      throw new Error('Creator session must exist')
    }
    if (creatorSession && creatorSession.projectId !== project.id) {
      throw new Error('Creator session must belong to the same project')
    }
    if (!parentSession && request.createdBySessionId != null) {
      throw new Error('Root sessions cannot declare createdBySessionId without parentSessionId')
    }
    if (parentSession && request.createdBySessionId !== parentSession.id) {
      throw new Error('Creator session must equal parent session for direct children')
    }

    const resolvedTitle = request.title?.trim()
      ? request.title.trim()
      : resolveDefaultWorkSessionTitle({
          project,
          sessions: this.state.sessions,
          projectId: request.projectId,
          type: request.type
        })

    const now = new Date().toISOString()
    const session: SessionSummary = {
      id: `session_${randomUUID()}`,
      projectId: request.projectId,
      parentSessionId: parentSession?.id ?? null,
      createdBySessionId: creatorSession?.id ?? null,
      type: request.type,
      runtimeState: 'created',
      turnState: 'idle',
      turnEpoch: 0,
      lastTurnOutcome: 'none',
      blockingReason: null,
      failureReason: null,
      hasUnseenCompletion: false,
      runtimeExitCode: null,
      runtimeExitReason: null,
      lastStateSequence: 0,
      title: resolvedTitle,
      summary: 'Waiting for session to start',
      titleGenerationContext: defaultSessionTitleGenerationContext(),
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
    return {
      ...this.settings,
      providers: { ...this.settings.providers },
      titleGeneration: { ...this.settings.titleGeneration },
      workspaceIde: { ...this.settings.workspaceIde }
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    if (key === 'shellPath' && typeof value === 'string') {
      this.settings.shellPath = value
    } else if (key === 'terminal' && typeof value === 'object' && value !== null) {
      this.settings.terminal = value as Partial<typeof DEFAULT_SETTINGS.terminal>
    } else if (key === 'providers' && typeof value === 'object' && value !== null) {
      this.settings.providers = value as Record<string, string>
    } else if (
      key === 'evolverInferenceProvider'
      && value === 'claude-code'
    ) {
      this.settings.evolverInferenceProvider = value
    } else if (key === 'evolverExecutionMode' && value === 'workspace-shell') {
      this.settings.evolverExecutionMode = value
    } else if (key === 'titleGeneration' && isTitleGenerationSetting(value)) {
      this.settings.titleGeneration = value
    } else if (key === 'workspaceIde' && isWorkspaceIdeSetting(value)) {
      this.settings.workspaceIde = value
    } else if (key === 'claudeDangerouslySkipPermissions' && typeof value === 'boolean') {
      this.settings.claudeDangerouslySkipPermissions = value
    } else if (key === 'locale' && typeof value === 'string') {
      this.settings.locale = value
    } else if (key === 'theme' && (value === 'light' || value === 'dark' || value === 'system')) {
      this.settings.theme = value
    }
    await this.persist()
  }

  async updateSessionTitle(
    sessionId: string,
    title: string,
    options?: {
      prompt?: string | null
      assistantSnippet?: string | null
      autoGeneratedTurnEpoch?: number | null
      contextUpdatedAt?: string | null
    }
  ): Promise<SessionSummary | null> {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return null
    }

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
    }

    const nextContext: SessionTitleGenerationContext = {
      prompt:
        options?.prompt !== undefined
          ? options.prompt
          : session.titleGenerationContext.prompt,
      assistantSnippet:
        options?.assistantSnippet !== undefined
          ? options.assistantSnippet
          : session.titleGenerationContext.assistantSnippet,
      contextUpdatedAt:
        options?.contextUpdatedAt !== undefined
          ? options.contextUpdatedAt
          : session.titleGenerationContext.contextUpdatedAt,
      autoGeneratedTurnEpoch:
        options?.autoGeneratedTurnEpoch !== undefined
          ? options.autoGeneratedTurnEpoch
          : session.titleGenerationContext.autoGeneratedTurnEpoch
    }

    const shouldUpdate =
      session.title !== trimmedTitle
      || session.titleGenerationContext.prompt !== nextContext.prompt
      || session.titleGenerationContext.assistantSnippet !== nextContext.assistantSnippet
      || session.titleGenerationContext.contextUpdatedAt !== nextContext.contextUpdatedAt
      || session.titleGenerationContext.autoGeneratedTurnEpoch !== nextContext.autoGeneratedTurnEpoch

    if (!shouldUpdate) {
      return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
    }

    session.title = trimmedTitle
    session.titleGenerationContext = nextContext
    session.updatedAt = new Date().toISOString()
    await this.persist()
    return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
  }

  async updateSessionTitleGenerationContext(
    sessionId: string,
    patch: Partial<SessionTitleGenerationContext>
  ): Promise<SessionSummary | null> {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return null
    }

    const nextContext: SessionTitleGenerationContext = {
      prompt:
        patch.prompt !== undefined
          ? patch.prompt
          : session.titleGenerationContext.prompt,
      assistantSnippet:
        patch.assistantSnippet !== undefined
          ? patch.assistantSnippet
          : session.titleGenerationContext.assistantSnippet,
      contextUpdatedAt:
        patch.contextUpdatedAt !== undefined
          ? patch.contextUpdatedAt
          : session.titleGenerationContext.contextUpdatedAt,
      autoGeneratedTurnEpoch:
        patch.autoGeneratedTurnEpoch !== undefined
          ? patch.autoGeneratedTurnEpoch
          : session.titleGenerationContext.autoGeneratedTurnEpoch
    }

    const changed =
      session.titleGenerationContext.prompt !== nextContext.prompt
      || session.titleGenerationContext.assistantSnippet !== nextContext.assistantSnippet
      || session.titleGenerationContext.contextUpdatedAt !== nextContext.contextUpdatedAt
      || session.titleGenerationContext.autoGeneratedTurnEpoch !== nextContext.autoGeneratedTurnEpoch

    if (!changed) {
      return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
    }

    session.titleGenerationContext = nextContext
    session.updatedAt = new Date().toISOString()
    await this.persist()
    return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
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
        version: 7,
        project_id: project.project_id,
        sessions: projectSessions
      }
      await writeProjectSessions(project.path, data)
    }

    const globalState: PersistedGlobalStateV4 =
      persistedProjects.length === 0
        ? { ...structuredClone(DEFAULT_GLOBAL_STATE), settings: this.settings }
        : {
            version: 4,
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
    options: Partial<Pick<
      SessionStatePatchEvent,
      'externalSessionId' | 'runtimeExitCode' | 'source' | 'turnEpoch' | 'sourceTurnId' | 'blockingReason' | 'failureReason'
    >> = {}
  ): Promise<void> {
    const session = this.state.sessions.find(s => s.id === sessionId)
    if (!session) return

    await this.applySessionStatePatch(this.createSessionStatePatch(session, intent, summary, options))
  }

  private async applySessionStateReduction(patch: SessionStatePatchEvent): Promise<void> {
    const session = this.state.sessions.find(s => s.id === patch.sessionId)
    if (!session) return

    if (this.applySessionStateReductionToSession(session, patch, new Date().toISOString())) {
      await this.persist()
    }
  }

  private applySessionStateReductionToSession(
    session: SessionSummary,
    patch: SessionStatePatchEvent,
    nowIso: string
  ): boolean {
    const reduced = reduceSessionState(session, patch, nowIso)
    if (reduced === session) {
      return false
    }

    const summary = shouldApplyPatchSummary(session, patch) ? patch.summary : session.summary
    Object.assign(session, reduced, { summary })
    if (patch.externalSessionId !== undefined) {
      session.externalSessionId = patch.externalSessionId
    }
    return true
  }

  private createSessionStatePatch(
    session: SessionSummary,
    intent: SessionStateIntent,
    summary: string,
    options: Partial<Pick<
      SessionStatePatchEvent,
      'externalSessionId' | 'runtimeExitCode' | 'source' | 'turnEpoch' | 'sourceTurnId' | 'blockingReason' | 'failureReason'
    >> = {}
  ): SessionStatePatchEvent {
    const turnEpoch =
      options.turnEpoch !== undefined
        ? options.turnEpoch
        : intent.startsWith('agent.')
          ? session.turnEpoch
          : undefined

    return {
      sessionId: session.id,
      sequence: session.lastStateSequence + 1,
      occurredAt: new Date().toISOString(),
      intent,
      source: options.source ?? 'runtime',
      turnEpoch,
      sourceTurnId: options.sourceTurnId,
      blockingReason: options.blockingReason,
      failureReason: options.failureReason,
      summary,
      externalSessionId: options.externalSessionId,
      runtimeExitCode: options.runtimeExitCode
    }
  }

  private getSessionSubtree(rootSessionId: string): SessionSummary[] {
    const byParent = this.buildChildrenByParentMap()
    const root = this.state.sessions.find((session) => session.id === rootSessionId)
    if (!root) {
      return []
    }

    const ordered: SessionSummary[] = []
    const visited = new Set<string>()
    const queue: SessionSummary[] = [root]
    while (queue.length > 0) {
      const session = queue.shift()!
      if (visited.has(session.id)) {
        continue
      }
      visited.add(session.id)
      ordered.push(session)
      queue.push(...(byParent.get(session.id) ?? []))
    }
    return ordered
  }

  private getSessionsInTreeOrder(): SessionSummary[] {
    const byId = new Map(this.state.sessions.map((session) => [session.id, session]))
    const byParent = this.buildChildrenByParentMap()
    const roots = this.state.sessions.filter((session) => !session.parentSessionId || !byId.has(session.parentSessionId))

    const ordered: SessionSummary[] = []
    const visited = new Set<string>()
    const visit = (session: SessionSummary) => {
      if (visited.has(session.id)) {
        return
      }
      visited.add(session.id)
      ordered.push(session)
      for (const child of byParent.get(session.id) ?? []) {
        visit(child)
      }
    }

    for (const root of roots) {
      visit(root)
    }

    for (const session of this.state.sessions) {
      visit(session)
    }

    return ordered
  }

  private deriveSessionTreeMeta(sessionId: string): SessionTreeMeta {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }

    const childSessions = this.state.sessions.filter((candidate) => candidate.parentSessionId === session.id)
    let depth = 0
    let rootSessionId = session.id
    let cursor: SessionSummary | undefined = session
    const visited = new Set<string>([session.id])
    while (cursor?.parentSessionId) {
      const parent = this.state.sessions.find((candidate) => candidate.id === cursor!.parentSessionId)
      if (!parent) {
        break
      }
      if (visited.has(parent.id)) {
        break
      }
      visited.add(parent.id)
      depth += 1
      rootSessionId = parent.id
      cursor = parent
    }

    const descendantCount = this.getSessionSubtree(session.id).length - 1
    return {
      rootSessionId,
      depth,
      childCount: childSessions.length,
      descendantCount
    }
  }

  private buildChildrenByParentMap(): Map<string, SessionSummary[]> {
    const byParent = new Map<string, SessionSummary[]>()
    for (const session of this.state.sessions) {
      if (!session.parentSessionId) {
        continue
      }

      const siblings = byParent.get(session.parentSessionId) ?? []
      siblings.push(session)
      byParent.set(session.parentSessionId, siblings)
    }

    return byParent
  }

  private reconcileActiveState(): void {
    const activeProject = this.state.projects.find((project) => project.id === this.state.activeProjectId) ?? null
    if (!activeProject) {
      this.state.activeProjectId = null
      this.state.activeSessionId = null
      return
    }

    const activeSession = this.state.sessions.find((session) => session.id === this.state.activeSessionId) ?? null
    if (!activeSession || activeSession.projectId !== activeProject.id) {
      this.state.activeSessionId = null
    }
  }
}

function shouldApplyPatchSummary(session: SessionSummary, patch: SessionStatePatchEvent): boolean {
  return patch.intent !== 'runtime.alive'
    || (session.blockingReason === null && session.failureReason === null)
}

function isWorkspaceIdeSetting(value: unknown): value is AppSettings['workspaceIde'] {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as { id?: unknown; executablePath?: unknown }
  return candidate.id === 'vscode' && typeof candidate.executablePath === 'string'
}

function isTitleGenerationSetting(value: unknown): value is AppSettings['titleGeneration'] {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as {
    enabled?: unknown
    apiKey?: unknown
    baseUrl?: unknown
    model?: unknown
  }

  return typeof candidate.enabled === 'boolean'
    && typeof candidate.apiKey === 'string'
    && typeof candidate.baseUrl === 'string'
    && typeof candidate.model === 'string'
}
