export type ObservedEventProvider = 'claude-code' | 'codex'
export type ObservedEventChannel = 'hook' | 'notify'
export type Consumer = ObservedEventProvider | 'opencode' | 'generic'
export type InferencePurpose = 'distill' | 'llm-review'
export type InferenceCapabilityProvider = ObservedEventProvider | 'api'
export type InferenceCapabilityTarget = Extract<Consumer, 'claude-code' | 'codex' | 'generic'>

export interface InferenceCapability {
  provider?: InferenceCapabilityProvider
  modelHint?: string
  invoke: (input: {
    purpose: InferencePurpose
    prompt: string
    responseFormat: 'text' | 'json'
    projectRoot: string
    timeoutMs?: number
    modelHint?: string
  }) => Promise<{
    content: string
    model?: string
    provider?: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }>
}

export interface ExecutionCapability {
  mode: 'workspace-shell'
  run: (input: {
    commands: string[]
    projectRoot: string
    timeoutMs?: number
  }) => Promise<{
    ok: boolean
    exitCode: number
    stdout: string
    stderr: string
    commandResults: Array<{
      command: string
      exitCode: number
      stdout: string
      stderr: string
    }>
  }>
}

export interface ObservedEventRawSource {
  provider: ObservedEventProvider
  channel: ObservedEventChannel
  rawEventName: string
}

export interface ObservedEvent {
  rawSource: ObservedEventRawSource
  hookEventName?: string
  providerSessionId?: string
  turnId?: string
  transcriptPath?: string
  lastAssistantMessage?: string
  promptText?: string
  inputMessages?: string[]
  toolName?: string
  toolUseId?: string
  toolInput?: Record<string, unknown>
  cwd?: string
  model?: string
}

export interface EvidenceRef {
  evidenceId: string
  projectId: string
  stoaSessionId: string
  providerSessionId: string | null
  turnId: string | null
  eventId: string
  eventType: string
  evidenceKey: string
  kind: 'hook-payload' | 'transcript' | 'turn-slice'
  metadataPath: string
  path: string
  createdAt: string
  toolName: string | null
}

export interface SealedTurnRecord {
  sessionKey: string
  projectId: string
  stoaSessionId: string
  turnId: string
  evidenceIds: string[]
  sealedAt: string
}

export type RuntimeJobState = 'queued' | 'running' | 'done' | 'failed'

export interface RuntimeJobRecord {
  jobId: string
  sessionKey: string
  turnId: string
  state: RuntimeJobState
  error?: string
  updatedAt: string
}

export interface RuntimeState {
  sealedTurns: SealedTurnRecord[]
  jobs: RuntimeJobRecord[]
}

export interface ProcessTurnResult {
  jobId: string
}

export type MemoryRuntimeEvidenceProvider = ObservedEventProvider
export type MemoryRuntimeEvidenceChannel = ObservedEventChannel
export type MemoryRuntimeConsumer = Consumer
export type MemoryRuntimeEvidence = ObservedEvent
