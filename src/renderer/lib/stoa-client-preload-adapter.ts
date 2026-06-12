/**
 * StoaClientPreloadAdapter — drop-in replacement for window.stoa (RendererApi).
 *
 * Maps every RendererApi method to Stoa Server REST/WS endpoints per the
 * IPC→REST mapping table in the server/client separation plan (§5.6).
 *
 * Desktop-only methods (window management, native dialogs, auto-update,
 * shell integration) are NOT implemented here — those remain as Electron IPC
 * and must be mixed in at the consumption site.
 */

import { StoaClient } from './stoa-client'
import type {
  AppSettings,
  BootstrapState,
  CreateProjectRequest,
  CreateSessionRequest,
  MemoryNotificationEvent,
  ObservationEventListOptions,
  OpenWorkspaceRequest,
  ProjectSummary,
  RendererApi,
  SessionGraphEvent,
  SessionSummary,
  SessionSummaryEvent,
  SessionTitleGenerationNotification,
  TerminalDataChunk,
} from '@shared/project-session'
import type { SessionEvidenceSnapshot } from '@shared/memory-runtime'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot,
} from '@shared/observability'
import type { UpdateState } from '@shared/update-state'
import type {
  DirEntry,
  FileCreateRequest,
  FileDeleteRequest,
  FileRenameRequest,
  FileWriteRequest,
  FsChangedEvent,
  GitBranchInfo,
  GitCommitRequest,
  GitLogEntry,
  GitMergeRequest,
  GitPushRequest,
  GitRebaseRequest,
  GitStatusResult,
  SearchOptions,
  SearchResult,
  SidebarState,
} from '@shared/sidebar-types'
import type {
  CreateMetaSessionRequest,
  MetaSessionBootstrapState,
  MetaSessionEvent,
  MetaSessionInspectorTarget,
  MetaSessionProposal,
  MetaSessionSummary,
} from '@shared/meta-session'

export class StoaClientPreloadAdapter implements RendererApi {
  readonly windowsBuildNumber = undefined

  constructor(private client: StoaClient) {}

  // ── Bootstrap & Projects ─────────────────────────────────────────

  async getBootstrapState(): Promise<BootstrapState> {
    const res = await this.client.get<BootstrapState>('/api/v1/bootstrap')
    return res.data!
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectSummary> {
    const res = await this.client.post<ProjectSummary>('/api/v1/projects', request)
    return res.data!
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/api/v1/projects/${projectId}`)
  }

  async setActiveProject(projectId: string): Promise<void> {
    await this.client.put(`/api/v1/projects/${projectId}/active`)
  }

  async openWorkspace(_request: OpenWorkspaceRequest): Promise<void> {
    // Desktop only — shell.openPath(). Not available via HTTP.
    // This adapter intentionally does nothing; caller should mix in IPC version.
    console.warn('openWorkspace is desktop-only and not available via StoaClient')
  }

  // ── Sessions ─────────────────────────────────────────────────────

  async createSession(request: CreateSessionRequest): Promise<SessionSummary> {
    const res = await this.client.post<SessionSummary>('/api/v1/sessions', request)
    return res.data!
  }

  async setActiveSession(sessionId: string): Promise<void> {
    await this.client.put(`/api/v1/sessions/${sessionId}/active`)
  }

  async getTerminalReplay(sessionId: string): Promise<string> {
    const res = await this.client.get<string>(`/api/v1/sessions/${sessionId}/terminal-replay`)
    return res.data!
  }

  sendSessionInput(sessionId: string, data: string): void {
    this.client.post(`/api/v1/sessions/${sessionId}/input`, { data }).catch(() => {
      // Fire-and-forget, matches IPC send() semantics
    })
  }

  sendSessionBinaryInput(sessionId: string, data: Uint8Array): void {
    this.client.sendBinaryInput(sessionId, data)
  }

  async sendSessionResize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.client.post(`/api/v1/sessions/${sessionId}/resize`, { cols, rows })
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.client.put(`/api/v1/sessions/${sessionId}/archive`)
  }

  async regenerateSessionTitle(sessionId: string): Promise<SessionSummary | null> {
    const res = await this.client.put<SessionSummary | null>(`/api/v1/sessions/${sessionId}/title`)
    return res.data ?? null
  }

  async restoreSession(sessionId: string): Promise<void> {
    await this.client.put(`/api/v1/sessions/${sessionId}/restore`)
  }

  async restartSession(sessionId: string): Promise<void> {
    await this.client.post(`/api/v1/sessions/${sessionId}/restart`)
  }

  async listArchivedSessions(): Promise<SessionSummary[]> {
    const res = await this.client.get<SessionSummary[]>('/api/v1/sessions?archive=archived')
    return res.data!
  }

  // ── WS: Terminal data ────────────────────────────────────────────

  onTerminalData(callback: (chunk: TerminalDataChunk) => void): () => void {
    return this.client.subscribe('session:terminal-data', (payload) => {
      callback(payload as TerminalDataChunk)
    })
  }

  // ── WS: Memory notifications ─────────────────────────────────────

  onMemoryNotification(callback: (event: MemoryNotificationEvent) => void): () => void {
    return this.client.subscribe('notification:memory', (payload) => {
      callback(payload as MemoryNotificationEvent)
    })
  }

  // ── WS: Title generation ─────────────────────────────────────────

  onTitleGenerationNotification(callback: (event: SessionTitleGenerationNotification) => void): () => void {
    return this.client.subscribe('notification:title-generation', (payload) => {
      callback(payload as SessionTitleGenerationNotification)
    })
  }

  // ── WS: Session events ───────────────────────────────────────────

  onSessionEvent(_callback: (event: SessionSummaryEvent) => void): () => void {
    // No-op: the current IPC implementation also returns a no-op unsubscribe
    return () => {}
  }

  onSessionGraphEvent(callback: (event: SessionGraphEvent) => void): () => void {
    return this.client.subscribe('session:graph', (payload) => {
      callback(payload as SessionGraphEvent)
    })
  }

  // ── Observability ────────────────────────────────────────────────

  async getSessionPresence(sessionId: string): Promise<SessionPresenceSnapshot | null> {
    const res = await this.client.get<SessionPresenceSnapshot | null>(
      `/api/v1/observability/sessions/${sessionId}/presence`,
    )
    return res.data ?? null
  }

  async getProjectObservability(projectId: string): Promise<ProjectObservabilitySnapshot | null> {
    const res = await this.client.get<ProjectObservabilitySnapshot | null>(
      `/api/v1/observability/projects/${projectId}`,
    )
    return res.data ?? null
  }

  async getAppObservability(): Promise<AppObservabilitySnapshot | null> {
    const res = await this.client.get<AppObservabilitySnapshot | null>('/api/v1/observability/app')
    return res.data ?? null
  }

  async listSessionObservationEvents(
    sessionId: string,
    options: ObservationEventListOptions,
  ): Promise<{ events: ObservationEvent[]; nextCursor: string | null }> {
    const params = new URLSearchParams()
    params.set('limit', String(options.limit))
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.categories) params.set('categories', options.categories.join(','))
    if (options.includeEphemeral) params.set('includeEphemeral', 'true')

    const res = await this.client.get<{ events: ObservationEvent[]; nextCursor: string | null }>(
      `/api/v1/observability/sessions/${sessionId}/events?${params.toString()}`,
    )
    return res.data!
  }

  onSessionPresenceChanged(callback: (snapshot: SessionPresenceSnapshot) => void): () => void {
    return this.client.subscribe('observability:presence', (payload) => {
      callback(payload as SessionPresenceSnapshot)
    })
  }

  onProjectObservabilityChanged(callback: (snapshot: ProjectObservabilitySnapshot) => void): () => void {
    return this.client.subscribe('observability:project', (payload) => {
      callback(payload as ProjectObservabilitySnapshot)
    })
  }

  onAppObservabilityChanged(callback: (snapshot: AppObservabilitySnapshot) => void): () => void {
    return this.client.subscribe('observability:app', (payload) => {
      callback(payload as AppObservabilitySnapshot)
    })
  }

  // ── Settings ─────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    const res = await this.client.get<AppSettings>('/api/v1/settings')
    return res.data!
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.client.put(`/api/v1/settings/${encodeURIComponent(key)}`, { value })
  }

  async titleGenerationFetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const res = await this.client.get<string[]>(
      `/api/v1/settings/title-generation/models?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`,
    )
    return res.data!
  }

  // ── Desktop-only stubs (dialogs) ─────────────────────────────────

  async pickFolder(_options?: { title?: string }): Promise<string | null> {
    console.warn('pickFolder is desktop-only and not available via StoaClient')
    return null
  }

  async pickFile(_options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
    console.warn('pickFile is desktop-only and not available via StoaClient')
    return null
  }

  // ── Detection endpoints ──────────────────────────────────────────

  async detectShell(): Promise<string | null> {
    const res = await this.client.post<string | null>('/api/v1/settings/detect/shell')
    return res.data ?? null
  }

  async detectProvider(providerId: string): Promise<string | null> {
    const res = await this.client.post<string | null>(
      `/api/v1/settings/detect/provider`,
      { providerId },
    )
    return res.data ?? null
  }

  async detectVscode(): Promise<string | null> {
    const res = await this.client.post<string | null>('/api/v1/settings/detect/vscode')
    return res.data ?? null
  }

  // ── Desktop-only stubs (window management) ───────────────────────

  async minimizeWindow(): Promise<void> {
    console.warn('minimizeWindow is desktop-only')
  }

  async maximizeWindow(): Promise<void> {
    console.warn('maximizeWindow is desktop-only')
  }

  async closeWindow(): Promise<void> {
    console.warn('closeWindow is desktop-only')
  }

  async isWindowMaximized(): Promise<boolean> {
    return false
  }

  onWindowMaximizeChange(_callback: (maximized: boolean) => void): () => void {
    return () => {}
  }

  // ── Update (desktop-only stubs) ──────────────────────────────────

  async getUpdateState(): Promise<UpdateState> {
    console.warn('getUpdateState is desktop-only')
    return {
      phase: 'idle',
      currentVersion: '',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false,
    }
  }

  async checkForUpdates(): Promise<UpdateState> {
    console.warn('checkForUpdates is desktop-only')
    return {
      phase: 'idle',
      currentVersion: '',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false,
    }
  }

  async downloadUpdate(): Promise<UpdateState> {
    console.warn('downloadUpdate is desktop-only')
    return {
      phase: 'idle',
      currentVersion: '',
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      requiresSessionWarning: false,
    }
  }

  async quitAndInstallUpdate(): Promise<void> {
    console.warn('quitAndInstallUpdate is desktop-only')
  }

  async dismissUpdate(): Promise<void> {
    console.warn('dismissUpdate is desktop-only')
  }

  onUpdateState(_callback: (state: UpdateState) => void): () => void {
    return () => {}
  }

  // ── Sidecar ──────────────────────────────────────────────────────

  async uninstallSidecars(projectId: string): Promise<void> {
    await this.client.delete(`/api/v1/projects/${projectId}/sidecar`)
  }

  // ── Evidence & Context ───────────────────────────────────────────

  async listSessionEvidence(sessionId: string): Promise<SessionEvidenceSnapshot[]> {
    const res = await this.client.get<SessionEvidenceSnapshot[]>(
      `/api/v1/sessions/${sessionId}/evidence`,
    )
    return res.data!
  }

  async contextExportFullText(
    sessionId: string,
    options: { includeThinking?: boolean; includeToolDetails?: boolean; maxChars?: number; cursor?: string },
  ): Promise<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }> {
    const params = new URLSearchParams()
    if (options.includeThinking) params.set('includeThinking', 'true')
    if (options.includeToolDetails) params.set('includeToolDetails', 'true')
    if (options.maxChars) params.set('maxChars', String(options.maxChars))
    if (options.cursor) params.set('cursor', options.cursor)

    const res = await this.client.get<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }>(
      `/api/v1/sessions/${sessionId}/context/full?${params.toString()}`,
    )
    return res.data!
  }

  async contextExportSlimText(
    sessionId: string,
    options: { maxChars?: number; cursor?: string },
  ): Promise<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }> {
    const params = new URLSearchParams()
    if (options.maxChars) params.set('maxChars', String(options.maxChars))
    if (options.cursor) params.set('cursor', options.cursor)

    const res = await this.client.get<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }>(
      `/api/v1/sessions/${sessionId}/context/slim?${params.toString()}`,
    )
    return res.data!
  }

  // ── Sidebar ──────────────────────────────────────────────────────

  async getSidebarState(): Promise<SidebarState> {
    const res = await this.client.get<SidebarState>('/api/v1/sidebar')
    return res.data!
  }

  async setSidebarState(state: Partial<SidebarState>): Promise<void> {
    await this.client.put('/api/v1/sidebar', state)
  }

  // ── File System ──────────────────────────────────────────────────

  async fsReadDir(projectPath: string, relativePath?: string): Promise<DirEntry[]> {
    const params = new URLSearchParams()
    params.set('projectPath', projectPath)
    if (relativePath) params.set('path', relativePath)

    // Use projectId-based route; need to resolve projectId from projectPath.
    // The server route is /api/v1/fs/:projectId/dir?path=
    // For now, send projectPath as a query parameter and let the server resolve.
    const res = await this.client.get<DirEntry[]>(
      `/api/v1/fs/dir?projectPath=${encodeURIComponent(projectPath)}${relativePath ? `&path=${encodeURIComponent(relativePath)}` : ''}`,
    )
    return res.data!
  }

  async fsReadFile(projectPath: string, relativePath: string): Promise<string> {
    const res = await this.client.get<string>(
      `/api/v1/fs/file?projectPath=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(relativePath)}`,
    )
    return res.data!
  }

  async fsWriteFile(request: FileWriteRequest): Promise<void> {
    await this.client.put('/api/v1/fs/file', request)
  }

  async fsCreate(request: FileCreateRequest): Promise<void> {
    await this.client.post('/api/v1/fs/entry', request)
  }

  async fsRename(request: FileRenameRequest): Promise<void> {
    await this.client.post('/api/v1/fs/rename', request)
  }

  async fsDelete(request: FileDeleteRequest): Promise<void> {
    await this.client.delete('/api/v1/fs/entry', request)
  }

  async fsSearch(options: SearchOptions): Promise<SearchResult> {
    const res = await this.client.post<SearchResult>('/api/v1/fs/search', options)
    return res.data!
  }

  async fsOpenFile(_filePath: string, _line?: number, _column?: number): Promise<void> {
    // Desktop only — shell.openPath()
    console.warn('fsOpenFile is desktop-only and not available via StoaClient')
  }

  onFsChanged(callback: (event: FsChangedEvent) => void): () => void {
    return this.client.subscribe('fs:changed', (payload) => {
      callback(payload as FsChangedEvent)
    })
  }

  // ── Shell ────────────────────────────────────────────────────────

  async shellShowItemInFolder(_filePath: string): Promise<void> {
    // Desktop only
    console.warn('shellShowItemInFolder is desktop-only and not available via StoaClient')
  }

  // ── Git ──────────────────────────────────────────────────────────

  async gitStatus(projectPath: string): Promise<GitStatusResult> {
    const res = await this.client.get<GitStatusResult>(
      `/api/v1/git/status?projectPath=${encodeURIComponent(projectPath)}`,
    )
    return res.data!
  }

  async gitStage(projectPath: string, paths: string[]): Promise<void> {
    await this.client.post('/api/v1/git/stage', { projectPath, paths })
  }

  async gitUnstage(projectPath: string, paths: string[]): Promise<void> {
    await this.client.post('/api/v1/git/unstage', { projectPath, paths })
  }

  async gitDiscard(projectPath: string, paths: string[]): Promise<void> {
    await this.client.post('/api/v1/git/discard', { projectPath, paths })
  }

  async gitCommit(request: GitCommitRequest): Promise<void> {
    await this.client.post('/api/v1/git/commit', request)
  }

  async gitPush(request: GitPushRequest): Promise<void> {
    await this.client.post('/api/v1/git/push', request)
  }

  async gitPull(projectPath: string): Promise<void> {
    await this.client.post('/api/v1/git/pull', { projectPath })
  }

  async gitFetch(projectPath: string): Promise<void> {
    await this.client.post('/api/v1/git/fetch', { projectPath })
  }

  async gitRebase(request: GitRebaseRequest): Promise<void> {
    await this.client.post('/api/v1/git/rebase', request)
  }

  async gitMerge(request: GitMergeRequest): Promise<void> {
    await this.client.post('/api/v1/git/merge', request)
  }

  async gitBranches(projectPath: string): Promise<GitBranchInfo> {
    const res = await this.client.get<GitBranchInfo>(
      `/api/v1/git/branches?projectPath=${encodeURIComponent(projectPath)}`,
    )
    return res.data!
  }

  async gitLog(projectPath: string, limit?: number): Promise<GitLogEntry[]> {
    const params = new URLSearchParams()
    params.set('projectPath', projectPath)
    if (limit) params.set('limit', String(limit))

    const res = await this.client.get<GitLogEntry[]>(
      `/api/v1/git/log?${params.toString()}`,
    )
    return res.data!
  }

  async gitDiff(projectPath: string, filePath?: string, staged?: boolean): Promise<string> {
    const params = new URLSearchParams()
    params.set('projectPath', projectPath)
    if (filePath) params.set('filePath', filePath)
    if (staged !== undefined) params.set('staged', String(staged))

    const res = await this.client.get<string>(
      `/api/v1/git/diff?${params.toString()}`,
    )
    return res.data!
  }

  async gitCheckout(projectPath: string, branch: string): Promise<void> {
    await this.client.post('/api/v1/git/checkout', { projectPath, branch })
  }

  async gitCreateBranch(projectPath: string, branch: string): Promise<void> {
    await this.client.post('/api/v1/git/branches', { projectPath, name: branch })
  }

  // ── Meta-Session ─────────────────────────────────────────────────

  async getMetaSessionBootstrapState(): Promise<MetaSessionBootstrapState> {
    const res = await this.client.get<MetaSessionBootstrapState>('/api/v1/meta-sessions/bootstrap')
    return res.data!
  }

  async createMetaSession(request: CreateMetaSessionRequest): Promise<MetaSessionSummary> {
    const res = await this.client.post<MetaSessionSummary>('/api/v1/meta-sessions', request)
    return res.data!
  }

  async setActiveMetaSession(sessionId: string): Promise<void> {
    await this.client.post(`/api/v1/meta-sessions/${sessionId}/activate`)
  }

  async archiveMetaSession(sessionId: string): Promise<void> {
    await this.client.post(`/api/v1/meta-sessions/${sessionId}/archive`)
  }

  async restoreMetaSession(sessionId: string): Promise<void> {
    await this.client.post(`/api/v1/meta-sessions/${sessionId}/restore`)
  }

  async listMetaSessionProposals(): Promise<MetaSessionProposal[]> {
    const res = await this.client.get<MetaSessionProposal[]>('/api/v1/meta-sessions/proposals')
    return res.data!
  }

  async getMetaSessionProposal(proposalId: string): Promise<MetaSessionProposal | null> {
    const res = await this.client.get<MetaSessionProposal | null>(
      `/api/v1/meta-sessions/proposals/${proposalId}`,
    )
    return res.data ?? null
  }

  async approveMetaSessionProposal(proposalId: string): Promise<MetaSessionProposal | null> {
    const res = await this.client.post<MetaSessionProposal | null>(
      `/api/v1/meta-sessions/proposals/${proposalId}/approve`,
    )
    return res.data ?? null
  }

  async rejectMetaSessionProposal(proposalId: string, reason?: string): Promise<MetaSessionProposal | null> {
    const res = await this.client.post<MetaSessionProposal | null>(
      `/api/v1/meta-sessions/proposals/${proposalId}/reject`,
      { reason },
    )
    return res.data ?? null
  }

  async dispatchMetaSessionProposal(proposalId: string): Promise<MetaSessionProposal | null> {
    const res = await this.client.post<MetaSessionProposal | null>(
      `/api/v1/meta-sessions/proposals/${proposalId}/dispatch`,
    )
    return res.data ?? null
  }

  async setMetaSessionInspectorTarget(target: MetaSessionInspectorTarget | null): Promise<void> {
    await this.client.put('/api/v1/meta-sessions/inspector', target)
  }

  onMetaSessionEvent(callback: (event: MetaSessionEvent) => void): () => void {
    return this.client.subscribe('meta-session:event', (payload) => {
      callback(payload as MetaSessionEvent)
    })
  }

  // ── Server Info ──────────────────────────────────────────────────

  async getServerInfo(): Promise<{ available: boolean; port: number; url: string; token: string }> {
    // When using StoaClient, server info is inferred from the client connection.
    // The discovery endpoint provides the port; base URL and token come from the client constructor.
    const res = await this.client.get<{ name: string; version: string; port: number; webClient: boolean; lanMode: boolean }>('/api/v1/discovery')
    const data = res.data!
    return {
      available: true,
      port: data.port,
      url: this.client.getBaseUrl(),
      token: this.client.getToken()
    }
  }
}
