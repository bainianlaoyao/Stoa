export type WorkspaceStatus =
  | 'bootstrapping'
  | 'starting'
  | 'running'
  | 'awaiting_input'
  | 'degraded'
  | 'error'
  | 'exited'
  | 'needs_confirmation'

export interface WorkspaceSummary {
  workspaceId: string
  name: string
  path: string
  providerId: string
  status: WorkspaceStatus
  summary: string
  cliSessionId: string | null
  isProvisional: boolean
  workspaceSecret?: string | null
  providerPort?: number | null
 }

export interface AppBootstrapState {
  activeWorkspaceId: string | null
  workspaces: WorkspaceSummary[]
  terminalWebhookPort: number | null
}

export interface CanonicalEventPayload {
  status?: WorkspaceStatus
  summary?: string
  is_provisional?: boolean
}

export interface CanonicalWorkspaceEvent {
  event_version: 1
  event_id: string
  event_type: string
  timestamp: string
  workspace_id: string
  provider_id: string
  session_id: string | null
  correlation_id?: string
  source: 'hook-sidecar' | 'provider-adapter' | 'system-recovery'
  payload: CanonicalEventPayload
}

export type WorkspaceEvent = CanonicalWorkspaceEvent

export interface TerminalDataChunk {
  workspaceId: string
  data: string
}

export interface PersistedWorkspaceState {
  workspace_id: string
  path: string
  name: string
  provider_id: string
  last_cli_session_id: string | null
  last_known_status: WorkspaceStatus
  updated_at: string
}

export interface PersistedAppState {
  version: 1
  active_workspace_id: string | null
  workspaces: PersistedWorkspaceState[]
}

export interface ProviderCommandContext {
  webhookPort: number
  workspaceSecret: string
  providerPort: number
}

export interface ProviderCommand {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export interface ProviderWorkspaceRuntimeInput {
  workspaceId: string
  name: string
  path: string
  providerId: string
  status: WorkspaceStatus
  summary: string
  cliSessionId: string | null
  isProvisional: boolean
  workspaceSecret?: string | null
  providerPort?: number | null
}

export interface CreateWorkspaceRequest {
  path: string
  name: string
  providerId: string
}

export interface ProviderDefinition {
  providerId: string
  supportsResume(): boolean
  supportsStructuredEvents(): boolean
  buildStartCommand(workspace: PersistedWorkspaceState, context: ProviderCommandContext): Promise<ProviderCommand>
  buildResumeCommand(
    workspace: PersistedWorkspaceState,
    sessionId: string,
    context: ProviderCommandContext
  ): Promise<ProviderCommand>
  resolveSessionId(event: CanonicalWorkspaceEvent): string | null
  installSidecar(workspace: PersistedWorkspaceState, context: ProviderCommandContext): Promise<void>
}

export interface RendererApi {
  getBootstrapState: () => Promise<AppBootstrapState>
  createWorkspace: (request: CreateWorkspaceRequest) => Promise<WorkspaceSummary>
  onWorkspaceEvent: (listener: (event: WorkspaceEvent) => void) => () => void
  onTerminalData: (listener: (chunk: TerminalDataChunk) => void) => () => void
  writeTerminalInput: (workspaceId: string, data: string) => Promise<void>
  resizeTerminal: (workspaceId: string, cols: number, rows: number) => Promise<void>
  setActiveWorkspace: (workspaceId: string) => Promise<void>
}

declare global {
  interface Window {
    vibecoding: RendererApi
  }
}
