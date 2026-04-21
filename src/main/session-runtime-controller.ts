import type { BrowserWindow } from 'electron'
import type { SessionStatus } from '@shared/project-session'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type { SessionRuntimeManager } from '@core/session-runtime'
import type { ProjectSessionManager } from '@core/project-session-manager'

export class SessionRuntimeController implements SessionRuntimeManager {
  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  async markSessionStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void> {
    await this.manager.markSessionStarting(sessionId, summary, externalSessionId)
    this.pushSessionEvent(sessionId, 'starting', summary)
  }

  async markSessionRunning(sessionId: string, externalSessionId: string | null): Promise<void> {
    await this.manager.markSessionRunning(sessionId, externalSessionId)
    this.pushSessionEvent(sessionId, 'running', '会话运行中')
  }

  async markSessionExited(sessionId: string, summary: string): Promise<void> {
    await this.manager.markSessionExited(sessionId, summary)
    this.pushSessionEvent(sessionId, 'exited', summary)
  }

  async appendTerminalData(chunk: { sessionId: string; data: string }): Promise<void> {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.terminalData, chunk)
    }
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
