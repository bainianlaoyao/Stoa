import type {
  EvolverBridgeRefs,
  EvolverPublishedContext,
  EvolverStoaReviewState,
  EvolverStoaRunResult,
  PublishedContextFormat,
  PublishedContextTarget
} from '@shared/direct-memory'
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
  runJsonCommand?: RunJsonCommand
}

export interface EvolverRunOptions {
  bridge: EvolverBridgeRefs
  repoRoot: string
  memoryDir: string
  evolutionDir: string
  gepAssetsDir: string
  sessionScope: string
}

export class EvolverClient {
  private readonly command: string
  private readonly cwd: string
  private readonly runJsonCommand: RunJsonCommand

  constructor(options: EvolverClientOptions) {
    this.command = options.command
    this.cwd = options.cwd
    this.runJsonCommand = options.runJsonCommand ?? defaultRunJsonCommand
  }

  async run(options: EvolverRunOptions): Promise<EvolverStoaRunResult> {
    return await this.runJsonCommand<EvolverStoaRunResult>({
      command: this.command,
      args: ['run', '--json'],
      cwd: this.cwd,
      env: {
        ...process.env,
        EVOLVER_REPO_ROOT: options.repoRoot,
        MEMORY_DIR: options.memoryDir,
        EVOLUTION_DIR: options.evolutionDir,
        GEP_ASSETS_DIR: options.gepAssetsDir,
        EVOLVER_SESSION_SCOPE: options.sessionScope,
        STOA_PROJECT_ID: options.bridge.project_id,
        STOA_SESSION_ID: options.bridge.stoa_session_id,
        STOA_PROVIDER_SESSION_ID: options.bridge.provider_session_id,
        STOA_SOURCE_CHECKPOINT_ID: options.bridge.source_checkpoint_id,
        STOA_CHECKPOINT_METADATA_COMMIT_SHA: options.bridge.checkpoint_metadata_commit_sha,
        STOA_SOURCE_WORKTREE_COMMIT_SHA: options.bridge.source_worktree_commit_sha ?? ''
      }
    })
  }

  async review(): Promise<EvolverStoaReviewState> {
    return await this.runJsonCommand<EvolverStoaReviewState>({
      command: this.command,
      args: ['review', '--json'],
      cwd: this.cwd
    })
  }

  async approveReview(): Promise<EvolverStoaReviewState> {
    return await this.runJsonCommand<EvolverStoaReviewState>({
      command: this.command,
      args: ['review', '--approve', '--json'],
      cwd: this.cwd
    })
  }

  async rejectReview(): Promise<EvolverStoaReviewState> {
    return await this.runJsonCommand<EvolverStoaReviewState>({
      command: this.command,
      args: ['review', '--reject', '--json'],
      cwd: this.cwd
    })
  }

  async publishContext(target: PublishedContextTarget, format: PublishedContextFormat): Promise<EvolverPublishedContext> {
    return await this.runJsonCommand<EvolverPublishedContext>({
      command: this.command,
      args: ['publish-context', `--target=${target}`, `--format=${format}`, '--json'],
      cwd: this.cwd
    })
  }
}
