import type { SessionStatus, SessionSummary } from '@shared/project-session'
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

interface AppliedSessionEvent {
  sessionId: string
  status: SessionStatus
  summary: string
  externalSessionId?: string | null
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

  async markSessionStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void> {
    this.terminalBacklogs.delete(sessionId)
    await this.manager.markSessionStarting(sessionId, summary, externalSessionId)
    this.pushSessionEvent(sessionId, 'starting', summary)
    this.pushObservabilitySnapshots(sessionId)
    this.onSessionStateChanged?.()
  }

  async markSessionRunning(sessionId: string, externalSessionId: string | null): Promise<void> {
    await this.manager.markSessionRunning(sessionId, externalSessionId)
    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    this.pushSessionEvent(
      sessionId,
      session?.status ?? 'running',
      session?.summary ?? 'Session running'
    )
    this.pushObservabilitySnapshots(sessionId)
    this.onSessionStateChanged?.()
  }

  async markSessionExited(sessionId: string, summary: string): Promise<void> {
    await this.manager.markSessionExited(sessionId, summary)
    this.pushSessionEvent(sessionId, 'exited', summary)
    this.pushObservabilitySnapshots(sessionId)
    this.onSessionStateChanged?.()
  }

  async applySessionEvent(event: AppliedSessionEvent): Promise<void> {
    const result = await this.manager.applySessionEvent(
      event.sessionId,
      event.status,
      event.summary,
      event.externalSessionId
    )
    if (result.reconciled) {
      console.info(`[reconcile] session ${event.sessionId} externalId changed`)
    }
    this.pushSessionEvent(event.sessionId, event.status, event.summary)
    this.pushObservabilitySnapshots(event.sessionId)
    this.onSessionStateChanged?.()
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
      const session = this.manager.snapshot().sessions.find(s => s.id === sessionId)
      win.webContents.send(IPC_CHANNELS.sessionEvent, {
        sessionId,
        status,
        summary,
        externalSessionId: session?.externalSessionId ?? null
      })
    }
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
