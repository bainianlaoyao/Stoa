import type { UpdateState } from './update-state'

export type SessionType = 'shell' | 'opencode' | 'codex' | 'claude-code'
export type SessionRecoveryMode = 'fresh-shell' | 'resume-external'
export type SessionStatus =
  | 'bootstrapping'
  | 'starting'
  | 'running'
  | 'turn_complete'
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
  archived: boolean
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
  archived: boolean
}

export interface AppSettings {
  shellPath: string
  terminalFontSize: number
  terminalFontFamily: string
  providers: Record<string, string>
  claudeDangerouslySkipPermissions: boolean
  locale: string
}

export const BUILTIN_FONT_FAMILIES = ['JetBrains Mono', 'Cascadia Mono'] as const

export const DEFAULT_SETTINGS: AppSettings = {
  shellPath: '',
  terminalFontSize: 14,
  terminalFontFamily: 'JetBrains Mono',
  providers: {},
  claudeDangerouslySkipPermissions: false,
  locale: 'en'
}

export interface PersistedAppStateV2 {
  version: 2
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  sessions: PersistedSession[]
  settings?: AppSettings
}

export interface PersistedGlobalStateV3 {
  version: 3
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  settings?: AppSettings
}

export interface PersistedProjectSessions {
  version: 4
  project_id: string
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
  archiveSession: (sessionId: string) => Promise<void>
  getTerminalReplay: (sessionId: string) => Promise<string>
  sendSessionInput: (sessionId: string, data: string) => Promise<void>
  sendSessionResize: (sessionId: string, cols: number, rows: number) => Promise<void>
  onTerminalData: (callback: (chunk: TerminalDataChunk) => void) => () => void
  onSessionEvent: (callback: (event: SessionStatusEvent) => void) => () => void
  getSettings: () => Promise<AppSettings>
  setSetting: (key: string, value: unknown) => Promise<void>
  pickFolder: (options?: { title?: string }) => Promise<string | null>
  pickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
  detectShell: () => Promise<string | null>
  detectProvider: (providerId: string) => Promise<string | null>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowMaximizeChange: (callback: (maximized: boolean) => void) => () => void
  restoreSession: (sessionId: string) => Promise<void>
  listArchivedSessions: () => Promise<SessionSummary[]>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateState>
  quitAndInstallUpdate: () => Promise<void>
  dismissUpdate: () => Promise<void>
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
}

export interface SessionEventPayload {
  status?: SessionStatus
  summary?: string
  isProvisional?: boolean
  externalSessionId?: string | null
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
  providerPath?: string | null
  claudeDangerouslySkipPermissions?: boolean
  startedAt?: number
}

export interface ProviderCommand {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}
