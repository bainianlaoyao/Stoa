export interface PromoPaths {
  repoRoot: string
  root: string
  assetsDir: string
  configDir: string
  outDir: string
  stateDir: string
  searchQueriesPath: string
  settingsPath: string
  voicePath: string
  factPackPath: string
  todayPostsJsonPath: string
  todayPostsMarkdownPath: string
  replyQueueJsonPath: string
  replyQueueMarkdownPath: string
  postHistoryPath: string
  replyHistoryPath: string
  runLogPath: string
}

export interface PromoRepoFact {
  path: string
  content: string
}

export interface PromoAsset {
  fileName: string
  absolutePath: string
  note: string | null
}

export interface PromoPostHistoryEntry {
  id: string
  createdAt: string
  topic: string
  text: string
}

export interface PromoReplyHistoryEntry {
  id: string
  createdAt: string
  targetUrl: string
  selectedOptionIndex: number
  text: string
}

export interface PromoRunLogEntry {
  id: string
  startedAt: string
  completedAt: string
  publishedPostIds: string[]
  generatedReplyIds: string[]
}

export interface PromoHistorySnapshot {
  posts: PromoPostHistoryEntry[]
  replies: PromoReplyHistoryEntry[]
  runs: PromoRunLogEntry[]
}

export interface PromoFactPack {
  generatedAt: string
  project: {
    name: string
    repoRoot: string
  }
  repoFacts: PromoRepoFact[]
  assets: PromoAsset[]
  recentPosts: PromoPostHistoryEntry[]
}

export interface PromoSearchMatch {
  id: string
  query: string
  url: string
  authorHandle: string
  text: string
}

export interface PromoPostCandidate {
  id: string
  topic: string
  text: string
  publishToday: boolean
  assetFileNames: string[]
}

export interface PromoReplyCandidate {
  id: string
  createdAt: string
  query: string
  targetUrl: string
  targetText: string
  whyReply: string
  options: string[]
}

export interface PromoModelOutput {
  posts: PromoPostCandidate[]
  replies: PromoReplyCandidate[]
  notes: string[]
}

export interface PromoTodayPostsArtifact {
  generatedAt: string
  notes: string[]
  posts: PromoPostCandidate[]
}

export interface PromoReplyQueueArtifact {
  generatedAt: string
  notes: string[]
  replies: PromoReplyCandidate[]
}

export interface PromoOrchestratorResult {
  generatedAt: string
  posts: PromoPostCandidate[]
  replies: PromoReplyCandidate[]
  notes: string[]
  outputPaths: Pick<
    PromoPaths,
    'todayPostsJsonPath' | 'todayPostsMarkdownPath' | 'replyQueueJsonPath' | 'replyQueueMarkdownPath'
  >
}

export interface PromoSmokeCheckResult {
  ok: boolean
  composeUrl: string
  details: string
}

export interface PromoPublishResult {
  id: string
  dryRun: boolean
}

export interface PromoReplySendResult {
  id: string
  selectedText: string
  dryRun: boolean
}

export interface WebbridgeStatus {
  running: boolean
  extension_connected: boolean
  version?: string
  [key: string]: unknown
}

export interface WebbridgeClient {
  readStatus: () => Promise<WebbridgeStatus>
  command: <T = unknown>(session: string, action: string, args?: Record<string, unknown>) => Promise<T>
  closeSession: (session: string) => Promise<void>
}

