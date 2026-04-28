import type {
  EvolverDistillationCompleteResult,
  EvolverDistillationPrepareResult,
  EvolverPublishedContext,
  EvolverReviewExport,
  EvolverReviewState,
  EvolverRunResult
} from '@shared/memory-runtime'
import { runJsonCommand as defaultRunJsonCommand } from './command-runner'

type RunJsonCommand = <TOutput>(options: {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}) => Promise<TOutput>

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

  async run(options: EvolverRunOptions): Promise<EvolverRunResult> {
    return await this.runJsonCommand<EvolverRunResult>({
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
    })
  }

  async review(): Promise<EvolverReviewState> {
    return await this.runJsonCommand<EvolverReviewState>({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }

  async exportReview(): Promise<EvolverReviewExport> {
    return await this.runJsonCommand<EvolverReviewExport>({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--export', '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }

  async approveReview(): Promise<EvolverReviewState> {
    return await this.runJsonCommand<EvolverReviewState>({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--approve', '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }

  async rejectReview(): Promise<EvolverReviewState> {
    return await this.runJsonCommand<EvolverReviewState>({
      command: this.command,
      args: [...this.argsPrefix, 'review', '--reject', '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }

  async publishContext(target: EvolverPublishedContext['target']): Promise<EvolverPublishedContext> {
    return await this.runJsonCommand<EvolverPublishedContext>({
      command: this.command,
      args: [...this.argsPrefix, 'publish-context', `--target=${target}`, '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }

  async prepareDistillation(): Promise<EvolverDistillationPrepareResult> {
    return await this.runJsonCommand<EvolverDistillationPrepareResult>({
      command: this.command,
      args: [...this.argsPrefix, 'distill', '--prepare', '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }

  async completeDistillation(responseFilePath: string): Promise<EvolverDistillationCompleteResult> {
    return await this.runJsonCommand<EvolverDistillationCompleteResult>({
      command: this.command,
      args: [...this.argsPrefix, 'distill', '--complete', `--response-file=${responseFilePath}`, '--json'],
      cwd: this.cwd,
      env: this.env
    })
  }
}
