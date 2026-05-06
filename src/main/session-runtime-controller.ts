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

const TERMINAL_BATCH_INTERVAL_MS = 16

export class SessionRuntimeController implements SessionRuntimeManager {
  private readonly terminalBacklogs = new Map<string, string>()
  private readonly pendingTerminalBatches = new Map<string, string>()
  private batchFlushTimer: ReturnType<typeof setTimeout> | null = null

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

  async markAgentTurnInterrupted(sessionId: string, summary: string): Promise<void> {
    await this.manager.markAgentTurnInterrupted(sessionId, summary)
    this.finishSessionStateChange(sessionId)
  }

  async setActiveSession(sessionId: string): Promise<void> {
    await this.manager.setActiveSession(sessionId)
    this.finishSessionStateChange(sessionId)
  }

  async appendTerminalData(chunk: { sessionId: string; data: string }): Promise<void> {
    const current = this.terminalBacklogs.get(chunk.sessionId) ?? ''
    this.terminalBacklogs.set(chunk.sessionId, trimBacklog(current + chunk.data))

    const pending = this.pendingTerminalBatches.get(chunk.sessionId) ?? ''
    this.pendingTerminalBatches.set(chunk.sessionId, pending + chunk.data)

    this.scheduleBatchFlush()
  }

  private scheduleBatchFlush(): void {
    if (this.batchFlushTimer !== null) {
      return
    }

    this.batchFlushTimer = setTimeout(() => {
      this.batchFlushTimer = null
      this.flushTerminalBatch()
    }, TERMINAL_BATCH_INTERVAL_MS)
  }

  private flushTerminalBatch(): void {
    if (this.pendingTerminalBatches.size === 0) {
      return
    }

    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      this.pendingTerminalBatches.clear()
      return
    }

    for (const [sessionId, data] of this.pendingTerminalBatches) {
      win.webContents.send(IPC_CHANNELS.terminalData, { sessionId, data })
    }

    this.pendingTerminalBatches.clear()
  }

  async getTerminalReplay(sessionId: string): Promise<string> {
    return this.terminalBacklogs.get(sessionId) ?? ''
  }

  private finishSessionStateChange(sessionId: string): void {
    this.pushSessionEvent(sessionId)
    this.pushObservabilitySnapshots(sessionId)
    this.onSessionStateChanged?.()
  }

  private pushSessionEvent(sessionId: string): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      return
    }

    const session = this.manager.snapshot().sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      return
    }

    win.webContents.send(IPC_CHANNELS.sessionEvent, { session })
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
const ANSI_ESCAPE_CODE = 0x1b
const ANSI_BELL_CODE = 0x07
const ANSI_CSI_8BIT_CODE = 0x9b
const ANSI_DCS_8BIT_CODE = 0x90
const ANSI_OSC_8BIT_CODE = 0x9d
const ANSI_SOS_8BIT_CODE = 0x98
const ANSI_PM_8BIT_CODE = 0x9e
const ANSI_APC_8BIT_CODE = 0x9f
const ANSI_ST_8BIT_CODE = 0x9c

type AnsiStringMode = 'osc' | 'dcs' | 'sos' | 'pm' | 'apc'
type AnsiParserMode = 'ground' | 'escape' | 'escape-intermediate' | 'csi' | AnsiStringMode | 'string-escape'

function trimBacklog(backlog: string): string {
  if (backlog.length <= MAX_TERMINAL_BACKLOG_CHARS) {
    return backlog
  }

  return backlog.slice(findSafeBacklogTrimStart(backlog))
}

function findSafeBacklogTrimStart(backlog: string): number {
  const desiredStart = backlog.length - MAX_TERMINAL_BACKLOG_CHARS
  let mode: AnsiParserMode = 'ground'
  let pendingStringMode: AnsiStringMode | null = null
  let trimInsideSequence = false

  for (let index = 0; index < backlog.length; index += 1) {
    if (index === desiredStart && mode !== 'ground') {
      trimInsideSequence = true
    }

    const code = backlog.charCodeAt(index)

    switch (mode) {
      case 'ground':
        mode = enterAnsiMode(code)
        break
      case 'escape':
        mode = continueEscapeMode(code)
        break
      case 'escape-intermediate':
        mode = continueEscapeIntermediateMode(code)
        break
      case 'csi':
        if (isCsiFinalByte(code)) {
          mode = 'ground'
        }
        break
      case 'osc':
      case 'dcs':
      case 'sos':
      case 'pm':
      case 'apc':
        if (isAnsiStringTerminator(mode, code)) {
          mode = 'ground'
          break
        }

        if (code === ANSI_ESCAPE_CODE) {
          pendingStringMode = mode
          mode = 'string-escape'
        }
        break
      case 'string-escape':
        if (code === 0x5c) {
          mode = 'ground'
          pendingStringMode = null
          break
        }

        mode = pendingStringMode ?? 'ground'
        pendingStringMode = null
        break
    }

    if (trimInsideSequence && mode === 'ground') {
      return index + 1
    }
  }

  return trimInsideSequence ? backlog.length : desiredStart
}

function enterAnsiMode(code: number): AnsiParserMode {
  if (code === ANSI_ESCAPE_CODE) {
    return 'escape'
  }

  switch (code) {
    case ANSI_CSI_8BIT_CODE:
      return 'csi'
    case ANSI_DCS_8BIT_CODE:
      return 'dcs'
    case ANSI_OSC_8BIT_CODE:
      return 'osc'
    case ANSI_SOS_8BIT_CODE:
      return 'sos'
    case ANSI_PM_8BIT_CODE:
      return 'pm'
    case ANSI_APC_8BIT_CODE:
      return 'apc'
    default:
      return 'ground'
  }
}

function continueEscapeMode(code: number): AnsiParserMode {
  switch (code) {
    case 0x5b:
      return 'csi'
    case 0x5d:
      return 'osc'
    case 0x50:
      return 'dcs'
    case 0x58:
      return 'sos'
    case 0x5e:
      return 'pm'
    case 0x5f:
      return 'apc'
    default:
      if (isEscapeIntermediateByte(code)) {
        return 'escape-intermediate'
      }

      return 'ground'
  }
}

function continueEscapeIntermediateMode(code: number): AnsiParserMode {
  if (isEscapeIntermediateByte(code)) {
    return 'escape-intermediate'
  }

  if (isEscapeFinalByte(code)) {
    return 'ground'
  }

  return 'ground'
}

function isCsiFinalByte(code: number): boolean {
  return code >= 0x40 && code <= 0x7e
}

function isEscapeIntermediateByte(code: number): boolean {
  return code >= 0x20 && code <= 0x2f
}

function isEscapeFinalByte(code: number): boolean {
  return code >= 0x30 && code <= 0x7e
}

function isAnsiStringTerminator(mode: AnsiStringMode, code: number): boolean {
  if (code === ANSI_ST_8BIT_CODE) {
    return true
  }

  return mode === 'osc' && code === ANSI_BELL_CODE
}
