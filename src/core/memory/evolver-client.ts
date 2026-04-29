import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DeliveryEnvelope,
  EvidenceRef,
  EvolverDistillationCompleteResult,
  EvolverDistillationPrepareResult,
  EvolverPublishedContext,
  EvolverReviewExport,
  EvolverReviewState,
  EvolverRunResult,
  ProcessTurnResult
} from '@shared/memory-runtime'
import { runJsonCommand as defaultRunJsonCommand } from './command-runner'

type RunJsonCommand = (options: {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}) => Promise<unknown>

export interface EvolverClientOptions {
  command: string
  cwd: string
  argsPrefix?: string[]
  env?: NodeJS.ProcessEnv
  runJsonCommand?: RunJsonCommand
}

export interface EvolverRunOptions {
  projectId: string
  stoaSessionId: string
  providerSessionId: string
  repoRoot: string
  memoryDir: string
  evolutionDir: string
  gepAssetsDir: string
  sessionScope: string
}

export interface WarmStartOptions {
  projectRoot: string
  consumer: 'claude-code' | 'codex' | 'opencode' | 'generic'
  stoaSessionId: string
  providerSessionId?: string
}

export interface RecallOptions extends WarmStartOptions {
  taskText: string
}

export interface ObserveWriteOptions {
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId?: string
  evidenceRefs: EvidenceRef[]
}

export interface ProcessTurnOptions {
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId: string
  evidenceRefs: EvidenceRef[]
  jobId?: string
  inference?: {
    provider?: string
    modelHint?: string
  }
  execution?: {
    mode?: string
  }
}

export interface TurnScopedBridgeOptions {
  projectRoot: string
  stoaSessionId: string
  providerSessionId?: string
  turnId: string
}

export interface CompleteReviewOptions extends TurnScopedBridgeOptions {
  response: string
}

export interface CompleteSolidifyOptions extends TurnScopedBridgeOptions {
  result: ExecutionResult
}

export interface CompleteDistillOptions extends TurnScopedBridgeOptions {
  response: string
}

export interface StateSummaryOptions {
  projectRoot: string
  stoaSessionId?: string
  providerSessionId?: string
}

export interface ExplainRecallOptions extends RecallOptions {}

export interface GetAssetOptions {
  ref: string
}

export interface ExecutionResult {
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
}

export class EvolverClient {
  private readonly command: string
  private readonly cwd: string
  private readonly argsPrefix: string[]
  private readonly env: NodeJS.ProcessEnv
  private readonly runJsonCommand: RunJsonCommand

  constructor(options: EvolverClientOptions) {
    this.command = options.command
    this.cwd = options.cwd
    this.argsPrefix = options.argsPrefix ?? []
    this.env = {
      ...process.env,
      EVOLVER_QUIET_PARENT_GIT: 'true',
      ...options.env
    }
    this.runJsonCommand = options.runJsonCommand ?? defaultRunJsonCommand
  }

  async warmStart(options: WarmStartOptions): Promise<DeliveryEnvelope | null> {
    return await this.runHostBridgeCommand<DeliveryEnvelope | null>('warm-start', options)
  }

  async recall(options: RecallOptions): Promise<DeliveryEnvelope | null> {
    return await this.runHostBridgeCommand<DeliveryEnvelope | null>('recall', options)
  }

  async observeWrite(options: ObserveWriteOptions): Promise<void> {
    await this.runHostBridgeCommand<unknown>('observe-write', options)
  }

  async processTurn(options: ProcessTurnOptions): Promise<ProcessTurnResult> {
    return await this.runHostBridgeCommand<ProcessTurnResult>('process-turn', options)
  }

  async prepareReview(
    options: TurnScopedBridgeOptions
  ): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null> {
    return await this.runHostBridgeCommand('prepare-review', options)
  }

  async completeReview(options: CompleteReviewOptions): Promise<void> {
    await this.runHostBridgeCommand<unknown>('complete-review', options)
  }

  async prepareSolidify(
    options: TurnScopedBridgeOptions
  ): Promise<{ commands: string[] } | null> {
    return await this.runHostBridgeCommand('prepare-solidify', options)
  }

  async completeSolidify(options: CompleteSolidifyOptions): Promise<void> {
    await this.runHostBridgeCommand<unknown>('complete-solidify', options)
  }

  async prepareDistill(
    options: TurnScopedBridgeOptions
  ): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null> {
    return await this.runHostBridgeCommand('prepare-distill', options)
  }

  async completeDistill(options: CompleteDistillOptions): Promise<void> {
    await this.runHostBridgeCommand<unknown>('complete-distill', options)
  }

  async getStateSummary(options: StateSummaryOptions): Promise<Record<string, unknown>> {
    return await this.runHostBridgeCommand('state-summary', options)
  }

  async traceTurn(options: TurnScopedBridgeOptions): Promise<Record<string, unknown>> {
    return await this.runHostBridgeCommand('trace-turn', options)
  }

  async explainRecall(options: ExplainRecallOptions): Promise<Record<string, unknown>> {
    return await this.runHostBridgeCommand('explain-recall', options)
  }

  async getAsset(options: GetAssetOptions): Promise<Record<string, unknown> | null> {
    return await this.runHostBridgeCommand('get-asset', options)
  }

  async run(options: EvolverRunOptions): Promise<EvolverRunResult> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'run', '--json'],
      cwd: this.cwd,
      env: {
        ...this.env,
        EVOLVER_REPO_ROOT: options.repoRoot,
        MEMORY_DIR: options.memoryDir,
        EVOLUTION_DIR: options.evolutionDir,
        GEP_ASSETS_DIR: options.gepAssetsDir,
        EVOLVER_SESSION_SCOPE: options.sessionScope,
        STOA_PROJECT_ID: options.projectId,
        STOA_SESSION_ID: options.stoaSessionId,
        STOA_PROVIDER_SESSION_ID: options.providerSessionId
      }
    }) as EvolverRunResult
  }

  async review(): Promise<EvolverReviewState> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverReviewState
  }

  async exportReview(): Promise<EvolverReviewExport> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--export', '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverReviewExport
  }

  async approveReview(): Promise<EvolverReviewState> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--approve', '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverReviewState
  }

  async rejectReview(): Promise<EvolverReviewState> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--reject', '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverReviewState
  }

  async publishContext(target: EvolverPublishedContext['target']): Promise<EvolverPublishedContext> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'publish-context', `--target=${target}`, '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverPublishedContext
  }

  async prepareDistillation(): Promise<EvolverDistillationPrepareResult> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'distill', '--prepare', '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverDistillationPrepareResult
  }

  async completeDistillation(responseFilePath: string): Promise<EvolverDistillationCompleteResult> {
    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'distill', '--complete', `--response-file=${responseFilePath}`, '--json'],
      cwd: this.cwd,
      env: this.env
    }) as EvolverDistillationCompleteResult
  }

  private async runHostBridgeCommand<TOutput>(
    action:
      | 'warm-start'
      | 'recall'
      | 'observe-write'
      | 'process-turn'
      | 'prepare-review'
      | 'complete-review'
      | 'prepare-solidify'
      | 'complete-solidify'
      | 'prepare-distill'
      | 'complete-distill'
      | 'state-summary'
      | 'trace-turn'
      | 'explain-recall'
      | 'get-asset',
    payload: object
  ): Promise<TOutput> {
    const projectRoot = maybeReadProjectRoot(payload as Record<string, unknown>)
    const requestFilePath = await this.writeBridgeRequestFile(action, payload)

    return await this.runJsonCommand({
      command: this.command,
      args: [...this.argsPrefix, 'host-bridge', action, `--request-file=${requestFilePath}`, '--json'],
      cwd: this.cwd,
      env: buildHostBridgeEnv(this.env, projectRoot)
    }) as TOutput
  }

  private async writeBridgeRequestFile(
    action: string,
    payload: object
  ): Promise<string> {
    const directoryPath = join(this.cwd, '.stoa', 'memory', 'bridge-requests')
    await mkdir(directoryPath, { recursive: true })

    const filePath = join(directoryPath, `${action}-${Date.now()}-${randomUUID()}.json`)
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return filePath
  }
}

function maybeReadProjectRoot(payload: Record<string, unknown>): string | null {
  const projectRoot = payload.projectRoot
  if (typeof projectRoot !== 'string') {
    return null
  }

  const trimmedProjectRoot = projectRoot.trim()
  return trimmedProjectRoot.length > 0 ? trimmedProjectRoot : null
}

function buildHostBridgeEnv(
  env: NodeJS.ProcessEnv,
  projectRoot: string | null
): NodeJS.ProcessEnv {
  if (!projectRoot) {
    return env
  }

  return {
    ...env,
    STOA_EVOLVER_PROJECT_ROOT: projectRoot,
    EVOLVER_REPO_ROOT: projectRoot,
    MEMORY_DIR: join(projectRoot, '.stoa', 'evolver', 'memory'),
    EVOLUTION_DIR: join(projectRoot, '.stoa', 'evolver', 'memory', 'evolution'),
    GEP_ASSETS_DIR: join(projectRoot, '.stoa', 'evolver', 'assets', 'gep')
  }
}
