import type { BrowserWindow } from 'electron'
import type { SessionStatus } from '@shared/project-session'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type { SessionRuntimeManager } from '@core/session-runtime'
import type { ProjectSessionManager } from '@core/project-session-manager'

interface AppliedSessionEvent {
  sessionId: string
  status: SessionStatus
  summary: string
  externalSessionId?: string | null
}

export class SessionRuntimeController implements SessionRuntimeManager {
  private readonly terminalBacklogs = new Map<string, string>()

  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  async markSessionStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void> {
    this.terminalBacklogs.delete(sessionId)
    await this.manager.markSessionStarting(sessionId, summary, externalSessionId)
    this.pushSessionEvent(sessionId, 'starting', summary)
  }

  async markSessionRunning(sessionId: string, externalSessionId: string | null): Promise<void> {
    await this.manager.markSessionRunning(sessionId, externalSessionId)
    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    this.pushSessionEvent(
      sessionId,
      session?.status ?? 'running',
      session?.summary ?? '会话运行中'
    )
  }

  async markSessionExited(sessionId: string, summary: string): Promise<void> {
    await this.manager.markSessionExited(sessionId, summary)
    this.pushSessionEvent(sessionId, 'exited', summary)
  }

  async applySessionEvent(event: AppliedSessionEvent): Promise<void> {
    await this.manager.applySessionEvent(
      event.sessionId,
      event.status,
      event.summary,
      event.externalSessionId
    )
    this.pushSessionEvent(event.sessionId, event.status, event.summary)
  }

  async appendTerminalData(chunk: { sessionId: string; data: string }): Promise<void> {
    const current = this.terminalBacklogs.get(chunk.sessionId) ?? ''
    this.terminalBacklogs.set(chunk.sessionId, trimBacklog(current + chunk.data))

    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.terminalData, chunk)
    }
  }

  async getTerminalReplay(sessionId: string): Promise<string> {
    return this.terminalBacklogs.get(sessionId) ?? ''
  }

  private pushSessionEvent(sessionId: string, status: SessionStatus, summary: string): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      console.log(`[pushSessionEvent] Sending ${status} for ${sessionId} to renderer`)
      win.webContents.send(IPC_CHANNELS.sessionEvent, { sessionId, status, summary })
    } else {
      console.warn(`[pushSessionEvent] No window available for ${sessionId} ${status} (win=${!!win}, destroyed=${win?.isDestroyed()})`)
    }
  }
}

const MAX_TERMINAL_BACKLOG_CHARS = 250_000

function trimBacklog(backlog: string): string {
  if (backlog.length <= MAX_TERMINAL_BACKLOG_CHARS) {
    return backlog
  }

  return backlog.slice(-MAX_TERMINAL_BACKLOG_CHARS)
}
