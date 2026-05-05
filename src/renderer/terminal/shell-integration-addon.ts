import type { ITerminalAddon, Terminal } from '@xterm/xterm'

export interface CommandStartEvent {
  commandLine: string | null
  cwd: string | null
  timestamp: number
}

export interface CommandFinishedEvent {
  exitCode: number | undefined
  commandLine: string | null
  cwd: string | null
  timestamp: number
  duration: number | null
}

export interface ShellIntegrationState {
  currentCwd: string | null
  currentCommand: string | null
  commandStartTimestamp: number | null
  nonce: string | null
}

function unescapeValue(value: string): string {
  let result = ''
  let i = 0
  while (i < value.length) {
    if (value[i] === '\\' && i + 1 < value.length) {
      if (value[i + 1] === '\\') {
        result += '\\'
        i += 2
      } else if (
        value[i + 1] === 'x' &&
        i + 3 < value.length &&
        isHexDigit(value[i + 2]) &&
        isHexDigit(value[i + 3])
      ) {
        const hex = value.substring(i + 2, i + 4)
        result += String.fromCharCode(parseInt(hex, 16))
        i += 4
      } else {
        result += value[i]
        i += 1
      }
    } else {
      result += value[i]
      i += 1
    }
  }
  return result
}

function isHexDigit(ch: string): boolean {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'f') ||
    (ch >= 'A' && ch <= 'F')
  )
}

export class ShellIntegrationAddon implements ITerminalAddon {
  private terminal: Terminal | null = null
  private state: ShellIntegrationState = {
    currentCwd: null,
    currentCommand: null,
    commandStartTimestamp: null,
    nonce: null,
  }
  private disposables: Array<() => void> = []

  onCommandStart?: (event: CommandStartEvent) => void
  onCommandExecuted?: () => void
  onCommandFinished?: (event: CommandFinishedEvent) => void
  onCwdChanged?: (cwd: string) => void

  activate(terminal: Terminal): void {
    this.terminal = terminal

    const osc633 = terminal.parser.registerOscHandler(633, (data) => this.handleOsc633(data))
    const osc133 = terminal.parser.registerOscHandler(133, (data) => this.handleOsc133(data))
    const osc7 = terminal.parser.registerOscHandler(7, (data) => this.handleOsc7(data))
    this.disposables.push(() => osc633.dispose())
    this.disposables.push(() => osc133.dispose())
    this.disposables.push(() => osc7.dispose())
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable()
    }
    this.disposables = []
    this.terminal = null
  }

  getState(): Readonly<ShellIntegrationState> {
    return this.state
  }

  private handleOsc633(data: string): boolean {
    if (data === 'A') {
      return false
    }

    if (data === 'B') {
      this.state.currentCommand = null
      this.state.commandStartTimestamp = Date.now()
      this.onCommandStart?.({
        commandLine: null,
        cwd: this.state.currentCwd,
        timestamp: this.state.commandStartTimestamp,
      })
      return false
    }

    if (data === 'C') {
      this.onCommandExecuted?.()
      return false
    }

    if (data === 'D') {
      this.fireCommandFinished(undefined)
      return false
    }

    if (data.startsWith('D;')) {
      const raw = data.substring(2)
      if (raw.length === 0) {
        this.fireCommandFinished(undefined)
      } else {
        const exitCode = parseInt(raw, 10)
        this.fireCommandFinished(isNaN(exitCode) ? undefined : exitCode)
      }
      return false
    }

    if (data.startsWith('E;')) {
      const raw = data.substring(2)
      const semicolonIdx = raw.indexOf(';')
      if (semicolonIdx !== -1) {
        this.state.currentCommand = unescapeValue(raw.substring(0, semicolonIdx))
      } else {
        this.state.currentCommand = unescapeValue(raw)
      }
      return false
    }

    if (data === 'F' || data === 'G') {
      return false
    }

    if (data.startsWith('P;')) {
      const payload = data.substring(2)
      const eqIndex = payload.indexOf('=')
      if (eqIndex !== -1) {
        const key = payload.substring(0, eqIndex)
        const rawValue = payload.substring(eqIndex + 1)
        const value = unescapeValue(rawValue)

        if (key === 'Cwd') {
          this.state.currentCwd = value
          this.onCwdChanged?.(value)
        } else if (key === 'Nonce') {
          this.state.nonce = value
        }
      }
      return false
    }

    return false
  }

  private handleOsc133(data: string): boolean {
    if (data === 'A') {
      return false
    }

    if (data === 'B') {
      this.state.currentCommand = null
      this.state.commandStartTimestamp = Date.now()
      this.onCommandStart?.({
        commandLine: null,
        cwd: this.state.currentCwd,
        timestamp: this.state.commandStartTimestamp,
      })
      return false
    }

    if (data === 'C') {
      this.onCommandExecuted?.()
      return false
    }

    if (data === 'D') {
      this.fireCommandFinished(undefined)
      return false
    }

    return false
  }

  private handleOsc7(data: string): boolean {
    try {
      const url = new URL(data)
      if (url.protocol === 'file:') {
        const cwd = decodeURIComponent(url.pathname)
        this.state.currentCwd = cwd
        this.onCwdChanged?.(cwd)
      }
    } catch {
      // Malformed URL, ignore
    }
    return false
  }

  private fireCommandFinished(exitCode: number | undefined): void {
    const now = Date.now()
    const duration =
      this.state.commandStartTimestamp !== null
        ? now - this.state.commandStartTimestamp
        : null

    this.onCommandFinished?.({
      exitCode,
      commandLine: this.state.currentCommand,
      cwd: this.state.currentCwd,
      timestamp: now,
      duration,
    })

    this.state.commandStartTimestamp = null
  }
}
