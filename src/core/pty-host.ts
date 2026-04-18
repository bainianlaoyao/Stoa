import pty, { type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import type { ProviderCommand } from '@shared/workspace'

export interface PtySession {
  workspaceId: string
  sessionId: string
}

export class PtyHost {
  private readonly sessions = new Map<string, IPty>()

  start(workspaceId: string, command: ProviderCommand, onData: (data: string) => void, onExit: (exitCode: number) => void): PtySession {
    const sessionId = `shell-${randomUUID()}`
    const terminal = pty.spawn(command.command, command.args, {
      cwd: command.cwd,
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      env: command.env
    })

    terminal.onData(onData)
    terminal.onExit(({ exitCode }) => {
      this.sessions.delete(workspaceId)
      onExit(exitCode)
    })

    this.sessions.set(workspaceId, terminal)
    return { workspaceId, sessionId }
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

  dispose(): void {
    this.sessions.forEach((terminal) => terminal.kill())
    this.sessions.clear()
  }
}
