import type { BootstrapState } from '@shared/project-session'
import type { UpdateState } from '@shared/update-state'
import { writeUpdateLog } from '@core/app-logger'

interface AppLike {
  isPackaged: boolean
  getVersion: () => string
}

interface UpdaterLike {
  autoDownload: boolean
  on: (
    event: 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error',
    handler: (...args: unknown[]) => void
  ) => unknown
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
}

interface SessionManagerLike {
  snapshot: () => BootstrapState
}

interface UpdateServiceOptions {
  app: AppLike
  updater: UpdaterLike
  sessionManager: SessionManagerLike
  showSessionWarningDialog: () => Promise<boolean>
  prepareToInstall?: () => Promise<void>
  onStateChange?: (state: UpdateState) => void
  writeLog?: (message: string) => Promise<void>
}

const DISABLED_MESSAGE = 'Updates are only available in packaged builds.'

function createBaseState(currentVersion: string, isPackaged: boolean): UpdateState {
  return {
    phase: isPackaged ? 'idle' : 'disabled',
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: isPackaged ? null : DISABLED_MESSAGE,
    requiresSessionWarning: false
  }
}

function extractVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as {
    version?: unknown
    info?: { version?: unknown }
    updateInfo?: { version?: unknown }
  }

  if (typeof candidate.version === 'string') {
    return candidate.version
  }

  if (typeof candidate.info?.version === 'string') {
    return candidate.info.version
  }

  if (typeof candidate.updateInfo?.version === 'string') {
    return candidate.updateInfo.version
  }

  return null
}

function normalizeStateForPhase(state: UpdateState): UpdateState {
  switch (state.phase) {
    case 'downloaded':
      return state
    case 'downloading':
      return {
        ...state,
        downloadedVersion: null
      }
    default:
      return {
        ...state,
        downloadedVersion: null,
        downloadProgressPercent: null
      }
  }
}

export class UpdateService {
  private state: UpdateState

  constructor(private readonly options: UpdateServiceOptions) {
    this.options.updater.autoDownload = false
    this.state = createBaseState(this.options.app.getVersion(), this.options.app.isPackaged)
    this.bindUpdaterEvents()
    this.log(`initialized phase=${this.state.phase} version=${this.state.currentVersion}`)
  }

  async getState(): Promise<UpdateState> {
    if (!this.options.app.isPackaged) {
      return this.setState({
        phase: 'disabled',
        message: DISABLED_MESSAGE
      })
    }

    return this.snapshotState()
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (!this.options.app.isPackaged) {
      return this.getState()
    }

    this.log('check requested')
    this.setState({
      phase: 'checking',
      lastCheckedAt: new Date().toISOString(),
      message: 'Checking for updates...'
    })

    try {
      const result = await this.options.updater.checkForUpdates()
      if (this.state.phase === 'checking') {
        const version = extractVersion(result)
        this.setState(
          version
            ? {
                phase: 'available',
                availableVersion: version,
                message: `Update ${version} is available.`
              }
            : {
                phase: 'up-to-date',
                availableVersion: null,
                downloadedVersion: null,
                downloadProgressPercent: null,
                message: 'You are up to date.'
              }
        )
      }
    } catch (error) {
      this.setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
        downloadProgressPercent: null
      })
    }

    return this.snapshotState()
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.options.app.isPackaged) {
      return this.getState()
    }

    this.log('download requested')
    this.setState({
      phase: 'downloading',
      downloadProgressPercent: 0,
      message: 'Downloading update...'
    })

    try {
      const result = await this.options.updater.downloadUpdate()
      if (this.state.phase === 'downloading') {
        const version = extractVersion(result) ?? this.state.availableVersion
        this.setState({
          phase: 'downloaded',
          downloadedVersion: version,
          downloadProgressPercent: 100,
          message: version ? `Update ${version} is ready to install.` : 'Update is ready to install.'
        })
      }
    } catch (error) {
      this.setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
        downloadProgressPercent: null
      })
    }

    return this.snapshotState()
  }

  async quitAndInstall(): Promise<void> {
    if (!this.options.app.isPackaged || this.state.phase !== 'downloaded') {
      return
    }

    if (this.hasBlockingSessions()) {
      this.log('install blocked by active sessions pending confirmation')
      const shouldContinue = await this.options.showSessionWarningDialog()
      if (!shouldContinue) {
        this.log('install cancelled after session warning')
        return
      }
    }

    this.log('quitAndInstall requested')
    await this.options.prepareToInstall?.()
    this.options.updater.quitAndInstall()
  }

  async dismiss(): Promise<void> {
    if (this.state.phase === 'error' || this.state.phase === 'up-to-date') {
      this.setState({
        phase: 'idle',
        message: null,
        downloadProgressPercent: null
      })
      return
    }

    this.setState({ message: null })
  }

  publishState(): UpdateState {
    const snapshot = this.snapshotState()
    this.options.onStateChange?.(snapshot)
    return snapshot
  }

  private log(message: string): void {
    const writer = this.options.writeLog ?? writeUpdateLog
    void writer(message).catch((error) => {
      console.error('[update-log] Failed to write update log entry:', error)
    })
  }

  private bindUpdaterEvents(): void {
    this.options.updater.on('update-available', (payload) => {
      const version = extractVersion(payload)
      this.setState({
        phase: 'available',
        availableVersion: version,
        message: version ? `Update ${version} is available.` : 'An update is available.'
      })
    })

    this.options.updater.on('update-not-available', () => {
      this.setState({
        phase: 'up-to-date',
        availableVersion: null,
        downloadedVersion: null,
        downloadProgressPercent: null,
        message: 'You are up to date.'
      })
    })

    this.options.updater.on('download-progress', (payload) => {
      const percent =
        payload && typeof payload === 'object' && typeof (payload as { percent?: unknown }).percent === 'number'
          ? (payload as { percent: number }).percent
          : null

      this.setState({
        phase: 'downloading',
        downloadProgressPercent: percent,
        message: percent === null ? 'Downloading update...' : `Downloading update... ${Math.round(percent)}%`
      })
    })

    this.options.updater.on('update-downloaded', (payload) => {
      const version = extractVersion(payload) ?? this.state.availableVersion
      this.setState({
        phase: 'downloaded',
        downloadedVersion: version,
        downloadProgressPercent: 100,
        message: version ? `Update ${version} is ready to install.` : 'Update is ready to install.'
      })
    })

    this.options.updater.on('error', (error) => {
      this.setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
        downloadProgressPercent: null
      })
    })
  }

  private hasBlockingSessions(): boolean {
    return this.options.sessionManager
      .snapshot()
      .sessions
      .some((session) => !session.archived && session.runtimeState !== 'exited')
  }

  private snapshotState(): UpdateState {
    return {
      ...this.state,
      requiresSessionWarning: this.hasBlockingSessions()
    }
  }

  private setState(next: Partial<UpdateState>): UpdateState {
    this.state = normalizeStateForPhase({
      ...this.state,
      ...next
    })
    this.log(
      `state phase=${this.state.phase} available=${this.state.availableVersion ?? 'null'} downloaded=${this.state.downloadedVersion ?? 'null'} message=${this.state.message ?? 'null'}`
    )

    return this.publishState()
  }
}
