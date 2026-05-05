import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pty, { type IPty } from 'node-pty'
import type { ProviderCommand } from '@shared/project-session'
import { detectShellFamily, buildShellIntegrationEnv, generateNonce } from './shell-integration-env'

export interface ShellIntegrationOptions {
  enabled: boolean
  shellPath: string
}

export interface PtySession {
  runtimeId: string
}

function getShellScriptsDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(__dirname, 'shell-integration-scripts')
}

export class PtyHost {
  private readonly sessions = new Map<string, IPty>()

  start(runtimeId: string, command: ProviderCommand, onData: (data: string) => void, onExit: (exitCode: number) => void, shellIntegration?: ShellIntegrationOptions): PtySession {
    let spawnCommand = command.command
    let spawnArgs = command.args
    let spawnEnv: Record<string, string | undefined> = {
      ...command.env,
      TERM: command.env?.TERM ?? 'xterm-256color',
      COLORTERM: command.env?.COLORTERM ?? 'truecolor',
      TERM_PROGRAM: 'Stoa',
      TERM_PROGRAM_VERSION: '0.1.1',
    }

    if (shellIntegration?.enabled && shellIntegration.shellPath) {
      const family = detectShellFamily(shellIntegration.shellPath)
      const nonce = generateNonce()
      const scriptDir = getShellScriptsDir()
      const integration = buildShellIntegrationEnv(family, shellIntegration.shellPath, nonce, scriptDir)
      if (integration) {
        spawnEnv = { ...spawnEnv, ...integration.env }
        spawnCommand = shellIntegration.shellPath
        spawnArgs = integration.args
      }
    }

    const terminal = pty.spawn(spawnCommand, spawnArgs, {
      cwd: command.cwd,
      name: 'xterm-256color',
      cols: command.initialCols ?? 120,
      rows: command.initialRows ?? 30,
      env: spawnEnv,
    })

    terminal.onData(onData)
    terminal.onExit(({ exitCode }) => {
      this.sessions.delete(runtimeId)
      onExit(exitCode)
    })

    this.sessions.set(runtimeId, terminal)
    return { runtimeId }
  }

  write(workspaceId: string, data: string): void {
    this.sessions.get(workspaceId)?.write(data)
  }

  writeBinary(workspaceId: string, data: Uint8Array | Buffer | string): void {
    const terminal = this.sessions.get(workspaceId)
    if (!terminal) {
      return
    }

    if (typeof data === 'string') {
      terminal.write(Buffer.from(data, 'binary'))
      return
    }

    terminal.write(Buffer.from(data))
  }

  resize(workspaceId: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) {
      return
    }

    this.sessions.get(workspaceId)?.resize(cols, rows)
  }

  kill(runtimeId: string): void {
    const terminal = this.sessions.get(runtimeId)
    if (terminal) {
      terminal.kill()
      this.sessions.delete(runtimeId)
    }
  }

  dispose(): void {
    this.sessions.forEach((terminal) => terminal.kill())
    this.sessions.clear()
  }
}
