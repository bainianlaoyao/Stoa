/**
 * ProjectSessionManager — Stoa Server side.
 *
 * Extracted from src/core/project-session-manager.ts as part of Phase 2a
 * (Stoa Server / Client separation). Business logic is preserved verbatim;
 * the only structural changes are:
 *
 *   1. Persistence is delegated to an `IPersistenceBackend` (JSON files
 *      during transition, SQLite once Phase 2a stabilizes).
 *   2. Every mutating method broadcasts a `session:graph` (or
 *      `settings:changed`) WS event via the injected `WsHub`. The
 *      broadcast is best-effort and never throws.
 *   3. The in-memory `BootstrapState` cache is still the hot path;
 *      persistence is debounced and chains through a single promise
 *      to preserve write order, matching the original `persistChain`
 *      behavior.
 *
 * Public method signatures are kept identical to the original
 * `ProjectSessionManager` so the renderer can adopt SR without
 * touching call sites.
 */
import { EventEmitter } from 'node:events'
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
} from 'stoa-shared'
import { DEFAULT_SETTINGS } from 'stoa-shared'
import { reduceSessionState } from 'stoa-shared'
import type { IPersistenceBackend } from './persistence-backend'
import { DEFAULT_GLOBAL_STATE_V4, StateReadError } from './persistence-backend'

// ---------------------------------------------------------------------------
// WS event payloads (mirrors plan section 4.3 + 7.3)
// ---------------------------------------------------------------------------

export interface SessionGraphWsEvent {
  kind:
    | 'project_created'
    | 'project_deleted'
    | 'session_created'
    | 'session_archived'
    | 'session_restored'
    | 'session_destroyed'
    | 'session_updated'
    | 'session_state_changed'
  projectId: string | null
  sessionId: string | null
  graphVersion: number
}

export interface SettingsChangedWsEvent {
  key: string
  value: unknown
}

/**
 * Minimal contract the manager needs from the WS hub. A WsHub
 * implementation is created separately (Phase 2a wires one up); the manager
 * only depends on the `broadcast` method so it stays decoupled from the
 * real hub shape.
 */
export interface WsHubLike {
  broadcast(type: string, payload: unknown): void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    archived: session.archived,
    subagent_name: session.subagentName ?? null,
    subagent_result_summary: session.subagentResultSummary ?? null,
    subagent_input_epoch: session.subagentInputEpoch,
    subagent_latest_input_at: session.subagentLatestInputAt ?? null,
    subagent_latest_input_state_sequence: session.subagentLatestInputStateSequence,
    subagent_result: session.subagentResult ?? null
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
    archived: session.archived ?? false,
    subagentName: session.subagent_name ?? null,
    subagentResultSummary: session.subagent_result_summary ?? null,
    subagentInputEpoch: session.subagent_input_epoch,
    subagentLatestInputAt: session.subagent_latest_input_at ?? undefined,
    subagentLatestInputStateSequence: session.subagent_latest_input_state_sequence,
    subagentResult: session.subagent_result ?? null
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

function createSessionRecoveryMode(type: SessionType): SessionSummary['recoveryMode'] {
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
    stoaCtlEnabled: typeof settings.stoaCtlEnabled === 'boolean'
      ? settings.stoaCtlEnabled
      : defaults.stoaCtlEnabled,
    locale: typeof settings.locale === 'string' ? settings.locale : defaults.locale,
    theme: settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system'
      ? settings.theme
      : defaults.theme
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

// ---------------------------------------------------------------------------
// Default title resolver (mirrors src/core/work-session-title.ts).
//
// Kept local to avoid a cross-package import of the Electron-only
// `@core` alias. The provider descriptor map is small and stable.
// ---------------------------------------------------------------------------

interface ProviderDescriptorLite {
  seedsExternalSessionId: boolean
  titlePrefix: string
}

const PROVIDER_DESCRIPTORS: Record<SessionType, ProviderDescriptorLite> = {
  shell: { seedsExternalSessionId: false, titlePrefix: 'shell' },
  opencode: { seedsExternalSessionId: false, titlePrefix: 'opencode' },
  codex: { seedsExternalSessionId: false, titlePrefix: 'codex' },
  'claude-code': { seedsExternalSessionId: true, titlePrefix: 'claude' }
}

function resolveDefaultWorkSessionTitle(input: {
  project: Pick<ProjectSummary, 'id' | 'name'>
  sessions: SessionSummary[]
  projectId: string
  type: SessionType
}): string {
  if (input.type === 'shell') {
    const shellCount = input.sessions.filter((session) =>
      session.projectId === input.projectId && session.type === 'shell' && !session.archived
    ).length
    return `shell-${shellCount + 1}`
  }
  const descriptor = PROVIDER_DESCRIPTORS[input.type]
  return `${descriptor.titlePrefix}-${input.project.name}`
}

function createSessionExternalId(type: SessionType, externalSessionId?: string | null): string | null {
  if (externalSessionId !== undefined && externalSessionId !== null) {
    return externalSessionId
  }
  return PROVIDER_DESCRIPTORS[type].seedsExternalSessionId
    ? randomUUID()
    : null
}

// ---------------------------------------------------------------------------
// ProjectSessionManager
// ---------------------------------------------------------------------------

export interface ProjectSessionManagerOptions {
  webhookPort: number | null
  /** Optional: a no-op WS hub so unit tests don't need a real connection. */
  wsHub?: WsHubLike
}

export class ProjectSessionManager extends EventEmitter {
  private state: BootstrapState
  private settings: AppSettings
  private readonly persistDisabled: boolean
  private persistChain: Promise<void> = Promise.resolve()
  private hasPersistedProjects = false
  private persistFailureCount = 0
  private lastPersistError: string | null = null
  private graphVersion = 0
  private readonly wsHub: WsHubLike

  private constructor(
    initialState: BootstrapState,
    persistedSettings: AppSettings | undefined,
    persistDisabled: boolean,
    wsHub: WsHubLike
  ) {
    super()
    this.state = structuredCloneState(initialState)
    this.persistDisabled = persistDisabled
    this.hasPersistedProjects = initialState.projects.length > 0
    this.settings = normalizeAppSettings(persistedSettings)
    this.wsHub = wsHub
  }

  /**
   * Build a manager ready to serve requests. Loads from the configured
   * persistence backend (JSON files or SQLite) and primes the in-memory
   * cache. Then performs an initial flush to make sure the persistence
   * layer reflects the freshly-constructed state.
   */
  static async create(
    backend: IPersistenceBackend,
    options: ProjectSessionManagerOptions
  ): Promise<ProjectSessionManager> {
    const persistedGlobal = await ProjectSessionManager.readGlobalStateWithRetry(backend)
    const projects = persistedGlobal.projects.map(toProjectSummary)
    const allSessions: PersistedSession[] = []
    for (const project of persistedGlobal.projects) {
      const persisted = await backend.loadProjectSessions(project.path)
      allSessions.push(...persisted.sessions)
    }
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

    const manager = new ProjectSessionManager(
      initialState,
      persistedGlobal.settings,
      false,
      options.wsHub ?? noopWsHub
    )
    await manager.persist()
    return manager
  }

  static createForTest(wsHub?: WsHubLike): ProjectSessionManager {
    return new ProjectSessionManager(
      {
        activeProjectId: null,
        activeSessionId: null,
        terminalWebhookPort: null,
        projects: [],
        sessions: []
      },
      { ...DEFAULT_SETTINGS },
      true,
      wsHub ?? noopWsHub
    )
  }

  private static async readGlobalStateWithRetry(
    backend: IPersistenceBackend
  ): Promise<PersistedGlobalStateV4> {
    try {
      return await backend.loadGlobalState()
    } catch (error) {
      if (error instanceof StateReadError && error.isTransient) {
        await new Promise(resolve => setTimeout(resolve, 50))
        return await backend.loadGlobalState()
      }
      throw error
    }
  }

  snapshot(): BootstrapState {
    return structuredCloneState(this.state)
  }

  async flush(): Promise<void> {
    await this.persistChain
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

    // (The JSON-file import step is a no-op for the SQLite backend; it
    // remains a no-op for the JSON backend because loadProjectSessions on
    // the just-created project is empty.)
    await this.persist()
    this.broadcastGraph({
      kind: 'project_created',
      projectId: project.id,
      sessionId: null
    })
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
    this.broadcastGraph({
      kind: 'project_deleted',
      projectId,
      sessionId: null
    })
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
    this.broadcastGraph({
      kind: 'session_archived',
      projectId: session.projectId,
      sessionId
    })
  }

  async deleteSessionRecord(sessionId: string): Promise<boolean> {
    const index = this.state.sessions.findIndex((candidate) => candidate.id === sessionId)
    if (index < 0) {
      return false
    }

    const target = this.state.sessions[index]
    if (!target) {
      return false
    }

    const subtree = this.getSessionSubtree(sessionId)
    const subtreeIds = new Set(subtree.map((session) => session.id))
    const nextSessions = this.state.sessions.filter((session) => !subtreeIds.has(session.id))
    this.state.sessions = nextSessions

    if (this.state.activeSessionId && subtreeIds.has(this.state.activeSessionId)) {
      this.state.activeSessionId = null
    }
    if (this.state.activeProjectId === target.projectId && !nextSessions.some((session) => session.projectId === target.projectId && !session.archived)) {
      this.state.activeProjectId = this.state.projects[0]?.id ?? null
    }
    this.reconcileActiveState()
    await this.persist()
    this.broadcastGraph({
      kind: 'session_destroyed',
      projectId: target.projectId,
      sessionId
    })
    return true
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
    this.broadcastGraph({
      kind: 'session_restored',
      projectId: session.projectId,
      sessionId
    })
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
      subagentName: parentSession ? request.subagentName ?? null : null,
      subagentInputEpoch: parentSession ? 0 : undefined,
      subagentLatestInputAt: undefined,
      subagentLatestInputStateSequence: undefined,
      subagentResultSummary: null,
      subagentResult: null,
      createdAt: now,
      updatedAt: now,
      lastActivatedAt: now,
      archived: false
    }

    this.state.sessions.push(session)
    this.state.activeProjectId = request.projectId
    this.state.activeSessionId = session.id

    await this.persist()
    this.broadcastGraph({
      kind: 'session_created',
      projectId: session.projectId,
      sessionId: session.id
    })
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
      this.settings.terminal = value as Partial<AppSettings['terminal']>
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
    this.emit('settings:updated', this.getSettings())
    this.broadcastSettingsChanged({ key, value })
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
    this.broadcastGraph({
      kind: 'session_updated',
      projectId: session.projectId,
      sessionId: session.id
    })
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
    this.broadcastGraph({
      kind: 'session_updated',
      projectId: session.projectId,
      sessionId: session.id
    })
    return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
  }

  async updateSubagentFacade(
    sessionId: string,
    patch: {
      subagentName?: string | null
      subagentInputEpoch?: number
      subagentLatestInputAt?: string | null
      subagentLatestInputStateSequence?: number
      subagentResult?: SessionSummary['subagentResult'] | null
      subagentResultSummary?: SessionSummary['subagentResultSummary'] | null
    }
  ): Promise<SessionSummary | null> {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return null
    }

    let changed = false

    if (patch.subagentName !== undefined && session.subagentName !== patch.subagentName) {
      session.subagentName = patch.subagentName
      changed = true
    }
    if (patch.subagentInputEpoch !== undefined && session.subagentInputEpoch !== patch.subagentInputEpoch) {
      session.subagentInputEpoch = patch.subagentInputEpoch
      changed = true
    }
    if (patch.subagentLatestInputAt !== undefined && session.subagentLatestInputAt !== (patch.subagentLatestInputAt ?? undefined)) {
      session.subagentLatestInputAt = patch.subagentLatestInputAt ?? undefined
      changed = true
    }
    if (patch.subagentLatestInputStateSequence !== undefined && session.subagentLatestInputStateSequence !== patch.subagentLatestInputStateSequence) {
      session.subagentLatestInputStateSequence = patch.subagentLatestInputStateSequence
      changed = true
    }
    if (patch.subagentResult !== undefined && session.subagentResult !== patch.subagentResult) {
      session.subagentResult = patch.subagentResult ?? null
      changed = true
    }
    if (patch.subagentResultSummary !== undefined && session.subagentResultSummary !== patch.subagentResultSummary) {
      session.subagentResultSummary = patch.subagentResultSummary ?? null
      changed = true
    }

    if (!changed) {
      return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
    }

    session.updatedAt = new Date().toISOString()
    await this.persist()
    this.broadcastGraph({
      kind: 'session_updated',
      projectId: session.projectId,
      sessionId: session.id
    })
    return { ...session, titleGenerationContext: { ...session.titleGenerationContext } }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private async persist(): Promise<void> {
    if (this.persistDisabled) return

    const runPersist = async () => {
      try {
        await this.doPersist()
        this.persistFailureCount = 0
        this.lastPersistError = null
      } catch (error) {
        this.persistFailureCount += 1
        this.lastPersistError = error instanceof Error ? error.message : String(error)
        console.error('[state-persist] Failed to write state to backend', error)
        throw error
      }
    }

    const next = this.persistChain.then(runPersist, runPersist)
    this.persistChain = next.catch(() => undefined)
    await next
  }

  getPersistHealth(): { failureCount: number; lastError: string | null } {
    return { failureCount: this.persistFailureCount, lastError: this.lastPersistError }
  }

  private async doPersist(): Promise<void> {
    if (this.hasPersistedProjects && this.state.projects.length === 0) {
      console.error('[state-persist] Refusing to overwrite persisted projects with an empty list')
      return
    }

    if (!this.backend) {
      throw new Error('Persistence backend not configured')
    }

    const persistedProjects = this.state.projects.map(toPersistedProject)
    const persistedSessions = this.state.sessions.map(toPersistedSession)

    // 1. Persist per-project session lists
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
      await this.backend.saveProjectSessions(project.path, data)
    }

    // 2. Persist global state
    const globalState: PersistedGlobalStateV4 =
      persistedProjects.length === 0
        ? { ...structuredClone(DEFAULT_GLOBAL_STATE_V4), settings: this.settings }
        : {
            version: 4,
            active_project_id: this.state.activeProjectId,
            active_session_id: this.state.activeSessionId,
            projects: persistedProjects,
            settings: this.settings
          }
    await this.backend.saveGlobalState(globalState)

    if (persistedProjects.length > 0) {
      this.hasPersistedProjects = true
    }
  }

  // Backend is captured lazily on the first call to create(); tests that
  // use createForTest() leave this null, in which case persist() is a
  // no-op (persistDisabled path).
  private backend: IPersistenceBackend | null = null

  // -------------------------------------------------------------------------
  // WS broadcast
  // -------------------------------------------------------------------------

  private broadcastGraph(partial: Omit<SessionGraphWsEvent, 'graphVersion'>): void {
    this.graphVersion += 1
    const event: SessionGraphWsEvent = { ...partial, graphVersion: this.graphVersion }
    try {
      this.wsHub.broadcast('session:graph', event)
    } catch (error) {
      console.warn('[state-persist] Failed to broadcast session:graph event', error)
    }
  }

  private broadcastSettingsChanged(payload: SettingsChangedWsEvent): void {
    try {
      this.wsHub.broadcast('settings:changed', payload)
    } catch (error) {
      console.warn('[state-persist] Failed to broadcast settings:changed event', error)
    }
  }

  // -------------------------------------------------------------------------
  // Internal mutation helpers
  // -------------------------------------------------------------------------

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
      this.broadcastGraph({
        kind: 'session_state_changed',
        projectId: session.projectId,
        sessionId: session.id
      })
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

// ---------------------------------------------------------------------------
// No-op WS hub for tests
// ---------------------------------------------------------------------------

const noopWsHub: WsHubLike = {
  broadcast() {
    // intentionally empty
  }
}
