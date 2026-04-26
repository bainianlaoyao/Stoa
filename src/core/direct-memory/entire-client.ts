import type { EntireStoaCheckpointExport, EntireStoaCheckpointRef } from '@shared/direct-memory'
import { runJsonCommand as defaultRunJsonCommand } from './command-runner'

type RunJsonCommand = <TOutput>(options: {
  command: string
  args: string[]
  cwd: string
}) => Promise<TOutput>

export interface EntireClientOptions {
  command: string
  cwd: string
  runJsonCommand?: RunJsonCommand
}

export class EntireClient {
  private readonly command: string
  private readonly cwd: string
  private readonly runJsonCommand: RunJsonCommand

  constructor(options: EntireClientOptions) {
    this.command = options.command
    this.cwd = options.cwd
    this.runJsonCommand = options.runJsonCommand ?? defaultRunJsonCommand
  }

  async listCheckpoints(): Promise<EntireStoaCheckpointRef[]> {
    return await this.runJsonCommand<EntireStoaCheckpointRef[]>({
      command: this.command,
      args: ['stoa', 'checkpoints', '--json'],
      cwd: this.cwd
    })
  }

  async exportCheckpoint(checkpointId: string): Promise<EntireStoaCheckpointExport> {
    return await this.runJsonCommand<EntireStoaCheckpointExport>({
      command: this.command,
      args: ['stoa', 'checkpoint', 'export', checkpointId, '--json'],
      cwd: this.cwd
    })
  }
}
