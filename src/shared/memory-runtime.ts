export type MemoryRuntimeEvidenceProvider = 'claude-code' | 'codex'
export type MemoryRuntimeEvidenceChannel = 'hook' | 'notify'

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
