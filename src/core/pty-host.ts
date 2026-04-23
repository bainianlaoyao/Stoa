import pty, { type IPty } from 'node-pty'
import type { ProviderCommand } from '@shared/project-session'

export interface PtySession {
  runtimeId: string
}

export class PtyHost {
  private readonly sessions = new Map<string, IPty>()

  start(runtimeId: string, command: ProviderCommand, onData: (data: string) => void, onExit: (exitCode: number) => void): PtySession {
    const terminal = pty.spawn(command.command, command.args, {
      cwd: command.cwd,
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      env: command.env
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
