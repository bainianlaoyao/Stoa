import type { SessionStatePatchEvent, SessionSummary } from '@shared/project-session'
import { IPC_CHANNELS } from '@core/ipc-channels'
import type { SessionRuntimeManager } from '@core/session-runtime'
import type { ProjectSessionManager } from '@core/project-session-manager'
import type {
  AppObservabilitySnapshot,
  ProjectObservabilitySnapshot,
  SessionPresenceSnapshot
} from '@shared/observability'

export interface RuntimeWindow {
  isDestroyed: () => boolean
  webContents: {
    send: (channel: string, data: unknown) => void
  }
}

interface RuntimeObservabilityReader {
  syncSessions: (sessions: SessionSummary[], activeSessionId: string | null) => void
  getSessionPresence: (sessionId: string) => SessionPresenceSnapshot | null
  getProjectObservability: (projectId: string) => ProjectObservabilitySnapshot | null
  getAppObservability: () => AppObservabilitySnapshot
}

export class SessionRuntimeController implements SessionRuntimeManager {
  private readonly terminalBacklogs = new Map<string, string>()

  constructor(
    private readonly manager: ProjectSessionManager,
    private readonly getWindow: () => RuntimeWindow | null,
    private readonly onSessionStateChanged?: () => void,
    private readonly observability?: RuntimeObservabilityReader
  ) {}

  async markRuntimeStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void> {
    this.terminalBacklogs.delete(sessionId)
    await this.manager.markRuntimeStarting(sessionId, summary, externalSessionId)
    this.finishSessionStateChange(sessionId)
  }

  async markRuntimeAlive(sessionId: string, externalSessionId: string | null): Promise<void> {
    await this.manager.markRuntimeAlive(sessionId, externalSessionId)
    this.finishSessionStateChange(sessionId)
  }

  async markRuntimeExited(sessionId: string, exitCode: number | null, summary: string): Promise<void> {
    await this.manager.markRuntimeExited(sessionId, exitCode, summary)
    this.finishSessionStateChange(sessionId)
  }

  async markRuntimeFailedToStart(sessionId: string, summary: string): Promise<void> {
    await this.manager.markRuntimeFailedToStart(sessionId, summary)
    this.finishSessionStateChange(sessionId)
  }

  async applyProviderStatePatch(patch: SessionStatePatchEvent): Promise<void> {
    await this.manager.applySessionStatePatch(patch)
    this.finishSessionStateChange(patch.sessionId)
  }

  async setActiveSession(sessionId: string): Promise<void> {
    await this.manager.setActiveSession(sessionId)
    this.finishSessionStateChange(sessionId)
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

  private finishSessionStateChange(sessionId: string): void {
    this.pushObservabilitySnapshots(sessionId)
    this.onSessionStateChanged?.()
  }

  private pushObservabilitySnapshots(sessionId: string): void {
    if (!this.observability) {
      return
    }

    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      return
    }

    const snapshot = this.manager.snapshot()
    this.observability.syncSessions(snapshot.sessions, snapshot.activeSessionId)
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId)
    const sessionPresence = this.observability.getSessionPresence(sessionId)

    if (sessionPresence) {
      win.webContents.send(IPC_CHANNELS.observabilitySessionPresenceChanged, sessionPresence)
    }

    const projectObservability = session
      ? this.observability.getProjectObservability(session.projectId)
      : null

    if (projectObservability) {
      win.webContents.send(IPC_CHANNELS.observabilityProjectChanged, projectObservability)
    }

    win.webContents.send(IPC_CHANNELS.observabilityAppChanged, this.observability.getAppObservability())
  }
}

const MAX_TERMINAL_BACKLOG_CHARS = 250_000

function trimBacklog(backlog: string): string {
  if (backlog.length <= MAX_TERMINAL_BACKLOG_CHARS) {
    return backlog
  }

  return backlog.slice(-MAX_TERMINAL_BACKLOG_CHARS)
}
