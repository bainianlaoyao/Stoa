import { join } from 'node:path'
import type { EntireStoaCheckpointExport, EntireStoaCheckpointRef } from '@shared/direct-memory'
import { runJsonCommand as defaultRunJsonCommand } from './command-runner'

type RunJsonCommand = <TOutput>(options: {
  command: string
  args: string[]
  cwd: string
}) => Promise<TOutput>

export interface EntireClientOptions {
  command?: string
  cwd: string
  appRoot?: string
  platform?: NodeJS.Platform
  runJsonCommand?: RunJsonCommand
}

export function resolveDefaultEntireBridgeCommand(options: {
  appRoot?: string
  platform?: NodeJS.Platform
} = {}): string {
  const binaryName = options.platform === 'win32' ? 'entire-bridge.exe' : 'entire-bridge'
  return join(options.appRoot ?? process.cwd(), 'out', 'tools', 'entire-bridge', binaryName).replace(/\\/g, '/')
}

export class EntireClient {
  private readonly command: string
  private readonly cwd: string
  private readonly runJsonCommand: RunJsonCommand

  constructor(options: EntireClientOptions) {
    this.command = options.command ?? resolveDefaultEntireBridgeCommand({
      appRoot: options.appRoot,
      platform: options.platform ?? process.platform
    })
    this.cwd = options.cwd
    this.runJsonCommand = options.runJsonCommand ?? defaultRunJsonCommand
  }

  async listCheckpoints(): Promise<EntireStoaCheckpointRef[]> {
    return await this.runJsonCommand<EntireStoaCheckpointRef[]>({
      command: this.command,
      args: ['checkpoints', '--repo', this.cwd, '--json'],
      cwd: this.cwd
    })
  }

  async exportCheckpoint(checkpointId: string): Promise<EntireStoaCheckpointExport> {
    return await this.runJsonCommand<EntireStoaCheckpointExport>({
      command: this.command,
      args: ['checkpoint', 'export', checkpointId, '--repo', this.cwd, '--json'],
      cwd: this.cwd
    })
  }
}
