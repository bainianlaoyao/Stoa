import type { UpdateState } from './update-state'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from './observability'
import type { MemoryRuntimeEvidence } from './memory-runtime'
import type { BlockingReason } from '@shared/observability'
import type { TerminalSettings } from './terminal-settings'
import type {
  CreateHermesSessionRequest,
  HermesBootstrapState,
  HermesInspectorTarget,
  HermesProposal,
  HermesSessionEvent,
} from './hermes'

export type SessionType = 'shell' | 'opencode' | 'codex' | 'claude-code' | 'hermes-agent'
export type EvolverInferenceProvider = 'claude-code'
export type EvolverExecutionMode = 'workspace-shell'
export type SessionRecoveryMode = 'fresh-shell' | 'resume-external'
export type SessionPhase = 'ready' | 'running' | 'blocked' | 'complete' | 'failure'
export type SessionRuntimeState = 'created' | 'starting' | 'alive' | 'exited' | 'failed_to_start'
export type TurnState = 'idle' | 'running'
export type TurnOutcome = 'none' | 'completed' | 'interrupted' | 'cancelled' | 'failed'
export type FailureReason =
  | 'rate_limit'
  | 'authentication_failed'
  | 'billing_error'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'permission_denied'
  | 'tool_error'
  | 'provider_error'
  | 'runtime_crash'
  | 'failed_to_start'
  | 'unknown'
export type SessionStateSource = 'runtime' | 'provider' | 'ui'
export type SessionStateIntent =
  | 'runtime.created'
  | 'runtime.starting'
  | 'runtime.alive'
  | 'runtime.exited_clean'
  | 'runtime.exited_failed'
  | 'runtime.failed_to_start'
  | 'agent.turn_started'
  | 'agent.tool_started'
  | 'agent.tool_completed'
  | 'agent.permission_requested'
  | 'agent.permission_resolved'
  | 'agent.turn_completed'
  | 'agent.turn_interrupted'
  | 'agent.turn_cancelled'
  | 'agent.turn_failed'
  | 'agent.completion_seen'
  | 'agent.recovered'

export interface SessionStatePatchEvent {
  sessionId: string
  sequence: number
  occurredAt: string
  intent: SessionStateIntent
  source: SessionStateSource
  sourceEventType?: string
  turnEpoch?: number
  sourceTurnId?: string | null
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  failureReason?: FailureReason | null
  summary: string
  externalSessionId?: string | null
}

export interface SessionStatePatchPayload {
  intent: SessionStateIntent
  turnEpoch?: number
  sourceTurnId?: string | null
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  failureReason?: FailureReason | null
  summary: string
  externalSessionId?: string | null
  model?: string
  snippet?: string
  toolName?: string
  error?: string
}

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
  runtimeState: SessionRuntimeState
  turnState: TurnState
  turnEpoch: number
  lastTurnOutcome: TurnOutcome
  blockingReason: BlockingReason | null
  failureReason: FailureReason | null
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  lastStateSequence: number
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
  runtime_state: SessionRuntimeState
  turn_state: TurnState
  turn_epoch: number
  last_turn_outcome: TurnOutcome
  blocking_reason: BlockingReason | null
  failure_reason: FailureReason | null
  has_unseen_completion: boolean
  runtime_exit_code: number | null
  runtime_exit_reason: 'clean' | 'failed' | null
  last_state_sequence: number
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
  terminal: Partial<TerminalSettings>
  providers: Record<string, string>
  evolverInferenceProvider: EvolverInferenceProvider
  evolverExecutionMode: EvolverExecutionMode
  workspaceIde: WorkspaceIdeSettings
  claudeDangerouslySkipPermissions: boolean
  locale: string
}

export type WorkspaceOpenTarget = 'ide' | 'file-manager'
export type WorkspaceIdeId = 'vscode'

export interface WorkspaceIdeSettings {
  id: WorkspaceIdeId
  executablePath: string
}

export interface OpenWorkspaceRequest {
  sessionId: string
  target: WorkspaceOpenTarget
}

export const BUILTIN_FONT_FAMILIES = ['JetBrains Mono', 'Cascadia Mono'] as const

export const DEFAULT_SETTINGS: AppSettings = {
  shellPath: '',
  terminal: {},
  providers: {},
  evolverInferenceProvider: 'claude-code',
  evolverExecutionMode: 'workspace-shell',
  workspaceIde: {
    id: 'vscode',
    executablePath: ''
  },
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

export interface PersistedGlobalStateV4 {
  version: 4
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  settings?: AppSettings
}

export interface PersistedProjectSessions {
  version: 6
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
  initialCols?: number
  initialRows?: number
}

export interface TerminalDataChunk {
  sessionId: string
  data: string
}

export interface SessionSummaryEvent {
  session: SessionSummary
}

export interface ObservationEventListOptions {
  limit: number
  cursor?: string
  categories?: Array<'lifecycle' | 'presence' | 'evidence' | 'activity' | 'system'>
  includeEphemeral?: boolean
}

export type MemoryNotificationKind = 'recall' | 'solidify' | 'distill'
export type MemoryNotificationStatus = 'success' | 'info' | 'error'

export interface MemoryNotificationEvent {
  id: string
  projectId: string
  sessionId: string
  kind: MemoryNotificationKind
  status: MemoryNotificationStatus
  title: string
  message: string
  createdAt: string
}

export interface RendererApi {
  windowsBuildNumber: number | undefined
  getBootstrapState: () => Promise<BootstrapState>
  createProject: (request: CreateProjectRequest) => Promise<ProjectSummary>
  deleteProject: (projectId: string) => Promise<void>
  createSession: (request: CreateSessionRequest) => Promise<SessionSummary>
  openWorkspace: (request: OpenWorkspaceRequest) => Promise<void>
  setActiveProject: (projectId: string) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  getTerminalReplay: (sessionId: string) => Promise<string>
  sendSessionInput: (sessionId: string, data: string) => void
  sendSessionBinaryInput: (sessionId: string, data: Uint8Array) => void
  sendSessionResize: (sessionId: string, cols: number, rows: number) => Promise<void>
  onTerminalData: (callback: (chunk: TerminalDataChunk) => void) => () => void
  onMemoryNotification: (callback: (event: MemoryNotificationEvent) => void) => () => void
  onSessionEvent: (callback: (event: SessionSummaryEvent) => void) => () => void
  getSessionPresence: (sessionId: string) => Promise<SessionPresenceSnapshot | null>
  getProjectObservability: (projectId: string) => Promise<ProjectObservabilitySnapshot | null>
  getAppObservability: () => Promise<AppObservabilitySnapshot | null>
  listSessionObservationEvents: (
    sessionId: string,
    options: ObservationEventListOptions
  ) => Promise<{ events: ObservationEvent[]; nextCursor: string | null }>
  onSessionPresenceChanged: (callback: (snapshot: SessionPresenceSnapshot) => void) => () => void
  onProjectObservabilityChanged: (callback: (snapshot: ProjectObservabilitySnapshot) => void) => () => void
  onAppObservabilityChanged: (callback: (snapshot: AppObservabilitySnapshot) => void) => () => void
  getSettings: () => Promise<AppSettings>
  setSetting: (key: string, value: unknown) => Promise<void>
  pickFolder: (options?: { title?: string }) => Promise<string | null>
  pickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
  detectShell: () => Promise<string | null>
  detectProvider: (providerId: string) => Promise<string | null>
  detectVscode: () => Promise<string | null>
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
  uninstallSidecars: (projectId: string) => Promise<void>
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
  getHermesBootstrapState?: () => Promise<HermesBootstrapState>
  createHermesSession?: (request: CreateHermesSessionRequest) => Promise<import('./hermes').HermesSessionSummary>
  setActiveHermesSession?: (sessionId: string) => Promise<void>
  closeHermesSession?: (sessionId: string) => Promise<void>
  listHermesProposals?: () => Promise<HermesProposal[]>
  getHermesProposal?: (proposalId: string) => Promise<HermesProposal | null>
  approveHermesProposal?: (proposalId: string) => Promise<HermesProposal | null>
  rejectHermesProposal?: (proposalId: string, reason?: string) => Promise<HermesProposal | null>
  dispatchHermesProposal?: (proposalId: string) => Promise<HermesProposal | null>
  setHermesInspectorTarget?: (target: HermesInspectorTarget | null) => Promise<void>
  onHermesSessionEvent?: (callback: (event: HermesSessionEvent) => void) => () => void
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
  payload: SessionStatePatchPayload
  evidence?: MemoryRuntimeEvidence
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
  initialCols?: number
  initialRows?: number
}
