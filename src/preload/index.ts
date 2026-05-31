import { contextBridge, ipcRenderer } from 'electron'
import { release } from 'os'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type {
  AppSettings,
  CreateProjectRequest,
  CreateSessionRequest,
  MemoryNotificationEvent,
  ObservationEventListOptions,
  OpenWorkspaceRequest,
  RendererApi,
  SessionSummaryEvent,
  SessionTitleGenerationNotification,
  TerminalDataChunk
} from '@shared/project-session'
import type { SessionEvidenceSnapshot } from '@shared/memory-runtime'
import type {
  AppObservabilitySnapshot,
  ObservationEvent,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'
import type { MetaSessionInspectorTarget, MetaSessionProposal, MetaSessionEvent } from '@shared/meta-session'
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

interface PreloadKeyboardEvent {
  key: string
}

interface PreloadDocument {
  addEventListener(type: 'keydown', listener: (event: PreloadKeyboardEvent) => void, options?: boolean): void
}

declare const document: PreloadDocument

const windowsBuildNumber = process.platform === 'win32'
  ? (parseInt(release().split('.').pop() ?? '0', 10) || undefined)
  : undefined

const api: RendererApi = {
  windowsBuildNumber,
  async getBootstrapState() {
    return ipcRenderer.invoke(IPC_CHANNELS.projectBootstrap)
  },
  async createProject(request: CreateProjectRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.projectCreate, request)
  },
  async deleteProject(projectId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.projectDelete, projectId)
  },
  async createSession(request: CreateSessionRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionCreate, request)
  },
  async openWorkspace(request: OpenWorkspaceRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen, request)
  },
  async setActiveProject(projectId) {
    return ipcRenderer.invoke(IPC_CHANNELS.projectSetActive, projectId)
  },
  async setActiveSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionSetActive, sessionId)
  },
  async getTerminalReplay(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionTerminalReplay, sessionId) as Promise<string>
  },
  sendSessionInput(sessionId, data) {
    ipcRenderer.send(IPC_CHANNELS.sessionInput, sessionId, data)
  },
  sendSessionBinaryInput(sessionId, data) {
    ipcRenderer.send(IPC_CHANNELS.sessionBinaryInput, sessionId, data)
  },
  async sendSessionResize(sessionId, cols, rows) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionResize, sessionId, cols, rows)
  },
  async archiveSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionArchive, sessionId)
  },
  async regenerateSessionTitle(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRegenerateTitle, sessionId)
  },
  async restoreSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRestore, sessionId)
  },
  async restartSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionRestart, sessionId)
  },
  async listArchivedSessions() {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionListArchived)
  },
  async getMetaSessionBootstrapState() {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionBootstrap)
  },
  async createMetaSession(request) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionCreate, request)
  },
  async setActiveMetaSession(sessionId) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionSetActive, sessionId)
  },
  async archiveMetaSession(sessionId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionArchive, sessionId)
  },
  async restoreMetaSession(sessionId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionRestore, sessionId)
  },
  async listMetaSessionProposals() {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionProposalList) as Promise<MetaSessionProposal[]>
  },
  async getMetaSessionProposal(proposalId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionProposalGet, proposalId) as Promise<MetaSessionProposal | null>
  },
  async approveMetaSessionProposal(proposalId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionProposalApprove, proposalId) as Promise<MetaSessionProposal | null>
  },
  async rejectMetaSessionProposal(proposalId: string, reason?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionProposalReject, proposalId, reason) as Promise<MetaSessionProposal | null>
  },
  async dispatchMetaSessionProposal(proposalId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionProposalDispatch, proposalId) as Promise<MetaSessionProposal | null>
  },
  async setMetaSessionInspectorTarget(target: MetaSessionInspectorTarget | null) {
    return ipcRenderer.invoke(IPC_CHANNELS.metaSessionInspectorSetTarget, target)
  },
  async getUpdateState() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateGetState) as Promise<UpdateState>
  },
  async checkForUpdates() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateCheck) as Promise<UpdateState>
  },
  async downloadUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDownload) as Promise<UpdateState>
  },
  async quitAndInstallUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateQuitAndInstall)
  },
  async dismissUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDismiss)
  },
  async uninstallSidecars(projectId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.sidecarUninstall, projectId)
  },
  async listSessionEvidence(sessionId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.evidenceListSessionSnapshots, sessionId) as Promise<SessionEvidenceSnapshot[]>
  },
  async contextExportFullText(sessionId: string, options: { includeThinking?: boolean; includeToolDetails?: boolean; maxChars?: number; cursor?: string }) {
    return ipcRenderer.invoke(IPC_CHANNELS.contextExportFullText, sessionId, options) as Promise<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }>
  },
  async contextExportSlimText(sessionId: string, options: { maxChars?: number; cursor?: string }) {
    return ipcRenderer.invoke(IPC_CHANNELS.contextExportSlimText, sessionId, options) as Promise<{ text: string; nextCursor?: string; truncated: boolean; totalTurns: number }>
  },
  onTerminalData(callback: (chunk: TerminalDataChunk) => void) {
    const handler = (_event: Electron.IpcRendererEvent, chunk: TerminalDataChunk) => callback(chunk)
    ipcRenderer.on(IPC_CHANNELS.terminalData, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalData, handler)
  },
  onMemoryNotification(callback: (event: MemoryNotificationEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, event: MemoryNotificationEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.memoryNotification, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.memoryNotification, handler)
  },
  onTitleGenerationNotification(callback: (event: SessionTitleGenerationNotification) => void) {
    const handler = (_event: Electron.IpcRendererEvent, event: SessionTitleGenerationNotification) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.titleGenerationNotification, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.titleGenerationNotification, handler)
  },
  onSessionEvent(callback: (event: SessionSummaryEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, event: SessionSummaryEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.sessionEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionEvent, handler)
  },
  onMetaSessionEvent(callback) {
    const handler = (_event: Electron.IpcRendererEvent, event: MetaSessionEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.metaSessionEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.metaSessionEvent, handler)
  },
  async getSessionPresence(sessionId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityGetSessionPresence, sessionId) as Promise<SessionPresenceSnapshot | null>
  },
  async getProjectObservability(projectId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityGetProject, projectId) as Promise<ProjectObservabilitySnapshot | null>
  },
  async getAppObservability() {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityGetApp) as Promise<AppObservabilitySnapshot | null>
  },
  async listSessionObservationEvents(sessionId: string, options: ObservationEventListOptions) {
    return ipcRenderer.invoke(IPC_CHANNELS.observabilityListSessionEvents, sessionId, options) as Promise<{
      events: ObservationEvent[]
      nextCursor: string | null
    }>
  },
  onSessionPresenceChanged(callback: (snapshot: SessionPresenceSnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SessionPresenceSnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.observabilitySessionPresenceChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.observabilitySessionPresenceChanged, handler)
  },
  onProjectObservabilityChanged(callback: (snapshot: ProjectObservabilitySnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ProjectObservabilitySnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.observabilityProjectChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.observabilityProjectChanged, handler)
  },
  onAppObservabilityChanged(callback: (snapshot: AppObservabilitySnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppObservabilitySnapshot) => callback(snapshot)
    ipcRenderer.on(IPC_CHANNELS.observabilityAppChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.observabilityAppChanged, handler)
  },
  onUpdateState(callback: (state: UpdateState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.updateState, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateState, handler)
  },
  async getSettings() {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<AppSettings>
  },
  async setSetting(key: string, value: unknown) {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsSet, key, value)
  },
  async titleGenerationFetchModels(baseUrl: string, apiKey: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.titleGenerationFetchModels, baseUrl, apiKey) as Promise<string[]>
  },
  async pickFolder(options?: { title?: string }) {
    return ipcRenderer.invoke(IPC_CHANNELS.dialogPickFolder, options) as Promise<string | null>
  },
  async pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) {
    return ipcRenderer.invoke(IPC_CHANNELS.dialogPickFile, options) as Promise<string | null>
  },
  async detectShell() {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDetectShell) as Promise<string | null>
  },
  async detectProvider(providerId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDetectProvider, providerId) as Promise<string | null>
  },
  async detectVscode() {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDetectVscode) as Promise<string | null>
  },
  async minimizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowMinimize)
  },
  async maximizeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowMaximize)
  },
  async closeWindow() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowClose)
  },
  async isWindowMaximized() {
    return ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized) as Promise<boolean>
  },
  onWindowMaximizeChange(callback: (maximized: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on(IPC_CHANNELS.windowMaximizeChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizeChanged, handler)
  },

  async getSidebarState() {
    return ipcRenderer.invoke(IPC_CHANNELS.sidebarGetState) as Promise<SidebarState>
  },
  async setSidebarState(state: Partial<SidebarState>) {
    return ipcRenderer.invoke(IPC_CHANNELS.sidebarSetState, state)
  },

  async fsReadDir(projectPath: string, relativePath?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsReadDir, projectPath, relativePath) as Promise<DirEntry[]>
  },
  async fsReadFile(projectPath: string, relativePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsReadFile, projectPath, relativePath) as Promise<string>
  },
  async fsWriteFile(request: FileWriteRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsWriteFile, request)
  },
  async fsCreate(request: FileCreateRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsCreate, request)
  },
  async fsRename(request: FileRenameRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsRename, request)
  },
  async fsDelete(request: FileDeleteRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsDelete, request)
  },
  async fsSearch(options: SearchOptions) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsSearch, options) as Promise<SearchResult>
  },
  async fsOpenFile(filePath: string, line?: number, column?: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.fsOpenFile, filePath, line, column) as Promise<void>
  },
  onFsChanged(callback: (event: FsChangedEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, event: FsChangedEvent) => callback(event)
    ipcRenderer.on(IPC_CHANNELS.fsChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.fsChanged, handler)
  },

  async shellShowItemInFolder(filePath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.shellShowItemInFolder, filePath) as Promise<void>
  },

  async gitStatus(projectPath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitStatus, projectPath) as Promise<GitStatusResult>
  },
  async gitStage(projectPath: string, paths: string[]) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitStage, projectPath, paths)
  },
  async gitUnstage(projectPath: string, paths: string[]) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitUnstage, projectPath, paths)
  },
  async gitDiscard(projectPath: string, paths: string[]) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitDiscard, projectPath, paths)
  },
  async gitCommit(request: GitCommitRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitCommit, request)
  },
  async gitPush(request: GitPushRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitPush, request)
  },
  async gitPull(projectPath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitPull, projectPath)
  },
  async gitFetch(projectPath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitFetch, projectPath)
  },
  async gitRebase(request: GitRebaseRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitRebase, request)
  },
  async gitMerge(request: GitMergeRequest) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitMerge, request)
  },
  async gitBranches(projectPath: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitBranches, projectPath) as Promise<GitBranchInfo>
  },
  async gitLog(projectPath: string, limit?: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitLog, projectPath, limit) as Promise<GitLogEntry[]>
  },
  async gitDiff(projectPath: string, filePath?: string, staged?: boolean) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitDiff, projectPath, filePath, staged) as Promise<string>
  },
  async gitCheckout(projectPath: string, branch: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitCheckout, projectPath, branch)
  },
  async gitCreateBranch(projectPath: string, branch: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.gitCreateBranch, projectPath, branch)
  },
}

contextBridge.exposeInMainWorld('stoa', api)

;(function installDebugKeySequence() {
  const DEBUG_CODE = '114514'
  let keySequence = ''

  document.addEventListener('keydown', (e: PreloadKeyboardEvent) => {
    const ch = e.key
    if (ch.length !== 1 || ch < '0' || ch > '9') {
      keySequence = ''
      return
    }

    keySequence = (keySequence + ch).slice(-DEBUG_CODE.length)
    if (keySequence !== DEBUG_CODE) return

    keySequence = ''
    ipcRenderer.send(IPC_CHANNELS.debugToggleDevTools)
  }, true)
})()
