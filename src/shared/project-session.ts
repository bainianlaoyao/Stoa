export type SessionType = 'shell' | 'opencode'
export type SessionRecoveryMode = 'fresh-shell' | 'resume-external'
export type SessionStatus =
  | 'bootstrapping'
  | 'starting'
  | 'running'
  | 'awaiting_input'
  | 'degraded'
  | 'error'
  | 'exited'
  | 'needs_confirmation'

export interface ProjectSummary {
  id: string
  name: string
  path: string
  defaultSessionType?: SessionType
  createdAt: string
  updatedAt: string
}

export interface SessionSummary {
  id: string
  projectId: string
  type: SessionType
  status: SessionStatus
  title: string
  summary: string
  recoveryMode: SessionRecoveryMode
  externalSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
}

export interface PersistedProject {
  project_id: string
  name: string
  path: string
  default_session_type?: SessionType
  created_at: string
  updated_at: string
}

export interface PersistedSession {
  session_id: string
  project_id: string
  type: SessionType
  title: string
  last_known_status: SessionStatus
  last_summary: string
  external_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  recovery_mode: SessionRecoveryMode
}

export interface PersistedAppStateV2 {
  version: 2
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  sessions: PersistedSession[]
}

export interface BootstrapState {
  activeProjectId: string | null
  activeSessionId: string | null
  projects: ProjectSummary[]
  sessions: SessionSummary[]
  terminalWebhookPort: number | null
}

export interface CreateProjectRequest {
  path: string
  name: string
  defaultSessionType?: SessionType
}

export interface CreateSessionRequest {
  projectId: string
  type: SessionType
  title: string
  externalSessionId?: string | null
}

export interface TerminalDataChunk {
  sessionId: string
  data: string
}

export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
  summary: string
}

export interface RendererApi {
  getBootstrapState: () => Promise<BootstrapState>
  createProject: (request: CreateProjectRequest) => Promise<ProjectSummary>
  createSession: (request: CreateSessionRequest) => Promise<SessionSummary>
  setActiveProject: (projectId: string) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
  sendSessionInput: (sessionId: string, data: string) => Promise<void>
  sendSessionResize: (sessionId: string, cols: number, rows: number) => Promise<void>
  onTerminalData: (callback: (chunk: TerminalDataChunk) => void) => () => void
  onSessionEvent: (callback: (event: SessionStatusEvent) => void) => () => void
}

export interface SessionEventPayload {
  status?: SessionStatus
  summary?: string
  isProvisional?: boolean
}

export interface CanonicalSessionEvent {
  event_version: 1
  event_id: string
  event_type: string
  timestamp: string
  session_id: string
  project_id: string
  correlation_id?: string
  source: 'hook-sidecar' | 'provider-adapter' | 'system-recovery'
  payload: SessionEventPayload
}

export interface ProviderCommandContext {
  webhookPort: number
  sessionSecret: string
  providerPort: number
}

export interface ProviderCommand {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}
