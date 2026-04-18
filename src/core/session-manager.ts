import type {
  AppBootstrapState,
  CanonicalWorkspaceEvent,
  PersistedAppState,
  TerminalDataChunk,
  WorkspaceStatus,
  WorkspaceSummary
} from '@shared/workspace'
import { DEFAULT_STATE, readPersistedState, writePersistedState } from '@core/state-store'
import { access } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

type WorkspaceEventListener = (event: CanonicalWorkspaceEvent) => void
type TerminalDataListener = (chunk: TerminalDataChunk) => void

interface SessionManagerOptions {
  projectPath: string
  webhookPort: number | null
  stateFilePath?: string
}

interface WorkspaceRuntimeMetadata {
  workspaceSecret?: string | null
  providerPort?: number | null
}

interface CreateWorkspaceInput {
  path: string
  name: string
  providerId: string
}

const LEGAL_TRANSITIONS: Record<WorkspaceStatus, WorkspaceStatus[]> = {
  bootstrapping: ['starting', 'needs_confirmation'],
  starting: ['running', 'error', 'needs_confirmation'],
  running: ['awaiting_input', 'degraded', 'exited'],
  awaiting_input: ['running', 'degraded', 'exited'],
  degraded: ['running', 'error'],
  error: ['starting'],
  exited: ['starting'],
  needs_confirmation: []
}

function canTransition(from: WorkspaceStatus, to: WorkspaceStatus): boolean {
  return from === to || LEGAL_TRANSITIONS[from].includes(to)
}

function normalizeRecoveredStatus(workspace: PersistedAppState['workspaces'][number]): Pick<WorkspaceSummary, 'status' | 'summary' | 'cliSessionId' | 'isProvisional'> {
  if ((workspace.last_known_status === 'running' || workspace.last_known_status === 'awaiting_input') && !workspace.last_cli_session_id) {
    return {
      status: 'needs_confirmation',
      summary: '等待手动确认恢复',
      cliSessionId: null,
      isProvisional: true
    }
  }

  return {
    status: workspace.last_known_status,
    summary: workspace.last_known_status === 'needs_confirmation' ? '等待手动确认恢复' : '等待状态通道连接',
    cliSessionId: workspace.last_cli_session_id,
    isProvisional: true
  }
}

function fromPersisted(state: PersistedAppState, webhookPort: number | null): AppBootstrapState {
  return {
    activeWorkspaceId: state.active_workspace_id,
    terminalWebhookPort: webhookPort,
    workspaces: state.workspaces.map((workspace) => {
      const recovered = normalizeRecoveredStatus(workspace)

      return {
      workspaceId: workspace.workspace_id,
      name: workspace.name,
      path: workspace.path,
      providerId: workspace.provider_id,
      status: recovered.status,
      summary: recovered.summary,
      cliSessionId: recovered.cliSessionId,
      isProvisional: recovered.isProvisional,
      workspaceSecret: null,
      providerPort: null
      }
    })
  }
}

async function filterRecoverableWorkspaces(state: PersistedAppState): Promise<PersistedAppState> {
  const workspaces = await Promise.all(state.workspaces.map(async (workspace) => {
    try {
      await access(workspace.path)
      return workspace
    } catch {
      return null
    }
  }))

  const filtered = workspaces.filter((workspace): workspace is PersistedAppState['workspaces'][number] => workspace !== null)
  const nextActiveWorkspaceId = filtered.some((workspace) => workspace.workspace_id === state.active_workspace_id)
    ? state.active_workspace_id
    : filtered[0]?.workspace_id ?? null

  return {
    ...state,
    active_workspace_id: nextActiveWorkspaceId,
    workspaces: filtered
  }
}

function toPersisted(state: AppBootstrapState): PersistedAppState {
  return {
    version: 1,
    active_workspace_id: state.activeWorkspaceId,
    workspaces: state.workspaces.map((workspace) => ({
      workspace_id: workspace.workspaceId,
      path: workspace.path,
      name: workspace.name,
      provider_id: workspace.providerId,
      last_cli_session_id: workspace.cliSessionId,
      last_known_status: workspace.status,
      updated_at: new Date().toISOString()
    }))
  }
}

function createDefaultState(projectPath: string, webhookPort: number | null): AppBootstrapState {
  return {
    activeWorkspaceId: 'ws_local_shell',
    terminalWebhookPort: webhookPort,
    workspaces: [
      {
        workspaceId: 'ws_local_shell',
        name: 'local-shell',
        path: projectPath,
        providerId: 'local-shell',
        status: 'bootstrapping',
        summary: '准备启动本地 shell 工作区',
        cliSessionId: null,
        isProvisional: true,
        workspaceSecret: null,
        providerPort: null
      }
    ]
  }
}

export class SessionManager {
  private state: AppBootstrapState
  private readonly stateFilePath?: string
  private readonly workspaceListeners = new Set<WorkspaceEventListener>()
  private readonly terminalListeners = new Set<TerminalDataListener>()
  private readonly acceptedEventIds = new Set<string>()

  private constructor(initialState: AppBootstrapState, stateFilePath?: string) {
    this.state = initialState
    this.stateFilePath = stateFilePath
  }

  static async create(options: SessionManagerOptions): Promise<SessionManager> {
    const persisted = await filterRecoverableWorkspaces(await readPersistedState(options.stateFilePath))
    const initial = persisted.workspaces.length > 0
      ? fromPersisted(persisted, options.webhookPort)
      : createDefaultState(options.projectPath, options.webhookPort)

    const manager = new SessionManager(initial, options.stateFilePath)
    await manager.persist()
    return manager
  }

  snapshot(): AppBootstrapState {
    return {
      activeWorkspaceId: this.state.activeWorkspaceId,
      terminalWebhookPort: this.state.terminalWebhookPort,
      workspaces: this.state.workspaces.map((workspace) => ({ ...workspace }))
    }
  }

  subscribeWorkspace(listener: WorkspaceEventListener): () => void {
    this.workspaceListeners.add(listener)
    return () => {
      this.workspaceListeners.delete(listener)
    }
  }

  subscribeTerminal(listener: TerminalDataListener): () => void {
    this.terminalListeners.add(listener)
    return () => {
      this.terminalListeners.delete(listener)
    }
  }

  getWorkspaceSecret(workspaceId: string): string | null {
    return this.state.workspaces.find((item) => item.workspaceId === workspaceId)?.workspaceSecret ?? null
  }

  async setActiveWorkspace(workspaceId: string): Promise<void> {
    this.state.activeWorkspaceId = workspaceId
    await this.persist()
  }

  async configureWorkspaceRuntime(workspaceId: string, metadata: WorkspaceRuntimeMetadata): Promise<void> {
    const workspace = this.state.workspaces.find((item) => item.workspaceId === workspaceId)
    if (!workspace) {
      return
    }

    if (metadata.workspaceSecret !== undefined) {
      workspace.workspaceSecret = metadata.workspaceSecret
    }

    if (metadata.providerPort !== undefined) {
      workspace.providerPort = metadata.providerPort
    }
  }

  async addWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary> {
    const created: WorkspaceSummary = {
      workspaceId: `ws_${randomUUID()}`,
      name: input.name,
      path: input.path,
      providerId: input.providerId,
      status: 'bootstrapping',
      summary: '等待状态通道连接',
      cliSessionId: null,
      isProvisional: true,
      workspaceSecret: null,
      providerPort: null
    }

    this.state.workspaces.push(created)
    await this.persist()
    return { ...created }
  }

  async applyWorkspaceEvent(event: CanonicalWorkspaceEvent): Promise<void> {
    if (this.acceptedEventIds.has(event.event_id)) {
      return
    }

    const workspace = this.state.workspaces.find((item) => item.workspaceId === event.workspace_id)
    if (!workspace) {
      return
    }

    const nextStatus = event.payload.status ?? workspace.status
    if (!canTransition(workspace.status, nextStatus)) {
      return
    }

    this.acceptedEventIds.add(event.event_id)
    workspace.status = nextStatus
    workspace.summary = event.payload.summary ?? workspace.summary
    workspace.isProvisional = event.payload.is_provisional ?? workspace.isProvisional
    workspace.providerId = event.provider_id
    workspace.cliSessionId = event.session_id ?? workspace.cliSessionId

    this.workspaceListeners.forEach((listener) => listener(event))
    await this.persist()
  }

  async appendTerminalData(chunk: TerminalDataChunk): Promise<void> {
    const workspace = this.state.workspaces.find((item) => item.workspaceId === chunk.workspaceId)
    if (!workspace) {
      return
    }

    this.terminalListeners.forEach((listener) => listener(chunk))
  }

  async markWorkspaceStarting(workspaceId: string, summary: string, sessionId: string | null): Promise<void> {
    await this.applyWorkspaceEvent({
      event_version: 1,
      event_id: randomUUID(),
      event_type: 'workspace.status_changed',
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      provider_id: 'local-shell',
      session_id: sessionId,
      source: 'provider-adapter',
      payload: {
        status: 'starting',
        summary,
        is_provisional: false
      }
    })
  }

  async markWorkspaceRunning(workspaceId: string, sessionId: string | null): Promise<void> {
    await this.applyWorkspaceEvent({
      event_version: 1,
      event_id: randomUUID(),
      event_type: 'session.started',
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      provider_id: 'local-shell',
      session_id: sessionId,
      source: 'provider-adapter',
      payload: {
        status: 'running',
        summary: '本地 shell 已连接',
        is_provisional: false
      }
    })
  }

  async markWorkspaceExited(workspaceId: string, summary: string): Promise<void> {
    await this.applyWorkspaceEvent({
      event_version: 1,
      event_id: randomUUID(),
      event_type: 'session.exited',
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      provider_id: 'local-shell',
      session_id: null,
      source: 'provider-adapter',
      payload: {
        status: 'exited',
        summary,
        is_provisional: false
      }
    })
  }

  async handleWebhookEvent(event: CanonicalWorkspaceEvent): Promise<void> {
    await this.applyWorkspaceEvent(event)
  }

  private async persist(): Promise<void> {
    if (this.state.workspaces.length === 0) {
      await writePersistedState(DEFAULT_STATE, this.stateFilePath)
      return
    }

    await writePersistedState(toPersisted(this.state), this.stateFilePath)
  }
}
