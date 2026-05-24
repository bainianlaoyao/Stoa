export interface PromoPaths {
  repoRoot: string
  root: string
  assetsDir: string
  generatedAssetsDir: string
  packsDir: string
  configDir: string
  outDir: string
  stateDir: string
  searchQueriesPath: string
  settingsPath: string
  voicePath: string
  manualShotListPath: string
  assetManifestPath: string
  factPackPath: string
  weekPlanJsonPath: string
  weekPlanMarkdownPath: string
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

export type PromoAssetKind = 'screenshot' | 'gif' | 'video' | 'social-preview' | 'fact-card'
export type PromoAssetCategory = 'overview' | 'workflow' | 'closeup' | 'meta' | 'trust' | 'pack'
export type PromoAssetSource = 'readme-sync' | 'electron-capture' | 'manual-capture' | 'fact-card-generator' | 'derived-pack'

export interface PromoAsset {
  fileName: string
  relativePath: string
  absolutePath: string
  pointId: string
  note: string | null
  alt: string | null
  category: PromoAssetCategory
  scene: string
  kind: PromoAssetKind
  tags: string[]
  source: PromoAssetSource
  derivesFrom: string[]
}

export interface PromoPackDefinition {
  id: string
  title: string
  goal: string
  pointIds: string[]
  platforms: string[]
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
  packs: PromoPackDefinition[]
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
  packId?: string | null
  assetPaths: string[]
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

export interface PromoWeekPlanDay {
  date: string
  topic: string
  angle: string
  whyNow: string
  packId?: string | null
  assetPaths: string[]
  seedText: string
}

export interface PromoWeekPlanArtifact {
  generatedAt: string
  notes: string[]
  days: PromoWeekPlanDay[]
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
