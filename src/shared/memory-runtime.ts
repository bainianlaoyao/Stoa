export type MemoryRuntimeEvidenceProvider = 'claude-code' | 'codex'
export type MemoryRuntimeEvidenceChannel = 'hook' | 'notify'
export type MemoryRuntimeConsumer = MemoryRuntimeEvidenceProvider | 'opencode' | 'generic'
export type MemoryRuntimeDeliveryState = 'pending' | 'published' | 'failed'

export interface MemoryRuntimeEvidenceRawSource {
  provider: MemoryRuntimeEvidenceProvider
  channel: MemoryRuntimeEvidenceChannel
  rawEventName: string
}

export interface MemoryRuntimeEvidence {
  rawSource: MemoryRuntimeEvidenceRawSource
  hookEventName?: string
  providerSessionId?: string
  turnId?: string
  transcriptPath?: string
  lastAssistantMessage?: string
  promptText?: string
  inputMessages?: string[]
  toolName?: string
  toolUseId?: string
  cwd?: string
  model?: string
}

export interface MemoryRuntimeSessionProgress {
  projectId: string
  stoaSessionId: string
  lastProcessedEvidenceKey: string
  updatedAt: string
}

export interface MemoryRunRecord {
  projectId: string
  stoaSessionId: string
  runId: string
  worktreePath: string
  memoryDir: string
  evolutionDir: string
  gepAssetsDir: string
  reviewStateRef: string | null
  updatedAt: string
}

export interface PublishedMemoryRecord {
  projectId: string
  stoaSessionId: string
  consumer: MemoryRuntimeConsumer
  deliveryState: MemoryRuntimeDeliveryState
  runId: string | null
  publishedHash: string | null
  updatedAt: string
}
