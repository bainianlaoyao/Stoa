// ── Sidebar UI State ──

export type SidebarTab = 'explorer' | 'search' | 'git'

export interface SidebarState {
  open: boolean
  activeTab: SidebarTab
  width: number
  sessionListWidth: number
  activeTabByProject: Record<string, string>
}

// ── Panel Registry ──

export interface SidebarPanelDefinition {
  id: string
  icon: string
  label: string
  component: unknown
  gitOnly?: boolean
  sshOnly?: boolean
  shortcut?: string
}

// ── File System ──

export interface DirEntry {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifiedAt: string | null
}

export interface FileWriteRequest {
  projectPath: string
  relativePath: string
  content: string
}

export interface FileRenameRequest {
  projectPath: string
  oldRelativePath: string
  newRelativePath: string
}

export interface FileDeleteRequest {
  projectPath: string
  relativePath: string
}

export interface FileCreateRequest {
  projectPath: string
  relativePath: string
  isDirectory: boolean
}

// ── Search ──

export interface SearchOptions {
  query: string
  rootPath: string
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  includePattern: string
  excludePattern: string
  maxResults: number
}

export interface SearchMatch {
  line: number
  column: number
  matchLength: number
  lineContent: string
}

export interface SearchFileResult {
  filePath: string
  relativePath: string
  matches: SearchMatch[]
}

export interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  truncated: boolean
}

// ── Git ──

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'
export type GitStagingState = 'unstaged' | 'staged' | 'untracked'

export interface GitStatusEntry {
  path: string
  oldPath?: string
  status: GitFileStatus
  staging: GitStagingState
}

export interface GitStatusResult {
  branch: string
  ahead: number
  behind: number
  clean: boolean
  entries: GitStatusEntry[]
  hasConflicts: boolean
}

export interface GitCommitRequest {
  projectPath: string
  message: string
}

export interface GitPushRequest {
  projectPath: string
  setUpstream?: boolean
  forceWithLease?: boolean
}

export interface GitRebaseRequest {
  projectPath: string
  onto: string
}

export interface GitMergeRequest {
  projectPath: string
  branch: string
}

export interface GitBranchInfo {
  current: string
  locals: string[]
  remotes: string[]
}

export interface GitLogEntry {
  hash: string
  hashAbbrev: string
  message: string
  author: string
  date: string
  refs: string
}

// ── Filesystem Watcher ──

export type FsChangedKind = 'create' | 'delete' | 'modify' | 'rename'

export interface FsChangedEvent {
  projectPath: string
  relativePath: string
  kind: FsChangedKind
}
