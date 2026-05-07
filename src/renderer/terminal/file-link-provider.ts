import type { ITerminalAddon, Terminal, ILink, ILinkProvider } from '@xterm/xterm'
import { detectLinks } from './link-parsing'
import type { IParsedLink } from './link-parsing'
import { isAbsolute, join, normalize } from './path-utils'

export type FileLinkOpener = (absolutePath: string, line?: number, col?: number) => Promise<void>

async function defaultOpenFile(absolutePath: string, line?: number, col?: number): Promise<void> {
  const stoa = (window as unknown as { stoa?: { openFile?: (filePath: string, line?: number, col?: number) => Promise<void> } }).stoa
  if (stoa?.openFile) {
    await stoa.openFile(absolutePath, line, col)
  }
}

export class FileLinkProvider implements ITerminalAddon {
  private _terminal: Terminal | null = null
  private _linkProviderDisposable: { dispose(): void } | null = null

  private readonly _linkProvider: ILinkProvider = {
    provideLinks: (y: number, callback: (links: ILink[] | undefined) => void) => {
      this._provideLinks(y, callback)
    },
  }

  constructor(
    private readonly _getCwd: () => string | null,
    private readonly _openFile: FileLinkOpener = defaultOpenFile,
    private readonly _os: string = typeof process !== 'undefined' ? process.platform : 'linux',
  ) {}

  activate(terminal: Terminal): void {
    this._terminal = terminal
    this._linkProviderDisposable = terminal.registerLinkProvider(this._linkProvider)
  }

  dispose(): void {
    this._linkProviderDisposable?.dispose()
    this._linkProviderDisposable = null
    this._terminal = null
  }

  private _provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const terminal = this._terminal
    if (!terminal) {
      callback(undefined)
      return
    }

    const line = terminal.buffer.active.getLine(y)
    if (!line) {
      callback(undefined)
      return
    }

    const text = line.translateToString(true)
    if (!text || text.length > 2000) {
      callback(undefined)
      return
    }

    const parsedLinks = detectLinks(text, this._os)
    const links: ILink[] = []

    for (const parsedLink of parsedLinks) {
      if (parsedLink.path.length > 1024) {
        continue
      }

      const link = this._createLink(parsedLink, y, terminal.cols)
      links.push(link)
    }

    callback(links.length > 0 ? links : undefined)
  }

  private _createLink(parsedLink: IParsedLink, y: number, cols: number): ILink {
    const startX = parsedLink.index + 1
    const endX = Math.min(parsedLink.endIndex, cols)

    return {
      range: {
        start: { x: startX, y: y + 1 },
        end: { x: endX, y: y + 1 },
      },
      text: parsedLink.text,
      decorations: { underline: true, pointerCursor: true },
      activate: (event: MouseEvent) => {
        if (event.ctrlKey || event.metaKey) {
          this._handleActivate(parsedLink)
        }
      },
    }
  }

  private _handleActivate(parsedLink: IParsedLink): void {
    let rawPath = parsedLink.path

    if (rawPath.startsWith('file:///')) {
      rawPath = decodeURIComponent(rawPath.slice('file:///'.length))
    }

    let absolutePath: string
    if (isAbsolute(rawPath, this._os)) {
      absolutePath = rawPath
    } else {
      const cwd = this._getCwd()
      if (cwd) {
        absolutePath = join(cwd, rawPath, this._os)
      } else {
        absolutePath = rawPath
      }
    }

    absolutePath = normalize(absolutePath, this._os)

    const line = parsedLink.suffix?.line
    const col = parsedLink.suffix?.col

    void this._openFile(
      absolutePath,
      line,
      col !== undefined && col >= 0 ? col : undefined,
    )
  }
}
