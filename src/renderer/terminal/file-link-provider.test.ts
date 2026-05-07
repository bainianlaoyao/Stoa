import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FileLinkProvider } from './file-link-provider'

function createMockTerminal(lines: string[]) {
  const bufferLines = lines.map(text => ({
    translateToString: (trimRight?: boolean) => trimRight ? text.trimEnd() : text,
  }))
  return {
    buffer: {
      active: {
        getLine: (y: number) => bufferLines[y] ?? null,
        length: bufferLines.length,
        viewportY: 0,
      },
    },
    cols: 120,
    _registeredProviders: [] as Array<unknown>,
    registerLinkProvider(provider: unknown) {
      this._registeredProviders.push(provider)
      return { dispose: () => {} }
    },
  }
}

function getLinksFromProvider(
  terminal: ReturnType<typeof createMockTerminal>,
  row: number,
): Array<{ link: unknown; provider: unknown }> {
  const provider = terminal._registeredProviders[0] as {
    provideLinks: (y: number, callback: (links: Array<unknown> | undefined) => void) => void
  }
  let result: Array<unknown> | undefined
  provider.provideLinks(row, (links) => {
    result = links
  })
  if (!result) return []
  return result.map(link => ({ link, provider }))
}

describe('FileLinkProvider', () => {
  let openFileMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    openFileMock = vi.fn().mockResolvedValue(undefined)
  })

  test('detects file path with :line:col suffix and activates on Ctrl+click', () => {
    const terminal = createMockTerminal(['error at src/core/handler.ts:42:15'])
    const provider = new FileLinkProvider(() => '/home/user/project', openFileMock)
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    expect(links.length).toBeGreaterThanOrEqual(1)

    const first = links[0].link as {
      text: string
      activate: (event: MouseEvent) => void
    }

    expect(first.text).toContain('handler.ts')
    first.activate({ ctrlKey: true, metaKey: false } as MouseEvent)

    expect(openFileMock).toHaveBeenCalledTimes(1)
    expect(openFileMock).toHaveBeenCalledWith(
      expect.stringContaining('handler.ts'),
      42,
      15,
    )
  })

  test('does NOT activate on regular click (no Ctrl/Cmd)', () => {
    const terminal = createMockTerminal(['see src/core/handler.ts:10:5'])
    const provider = new FileLinkProvider(() => '/home/user/project', openFileMock)
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    expect(links.length).toBeGreaterThanOrEqual(1)

    const first = links[0].link as { activate: (event: MouseEvent) => void }
    first.activate({ ctrlKey: false, metaKey: false } as MouseEvent)

    expect(openFileMock).not.toHaveBeenCalled()
  })

  test('activates on Ctrl+click with correct path/line/col', () => {
    const terminal = createMockTerminal(['fail at lib/parser.ts:99:7'])
    const provider = new FileLinkProvider(() => '/home/user/project', openFileMock, 'linux')
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    const first = links[0].link as { activate: (event: MouseEvent) => void }

    first.activate({ ctrlKey: true, metaKey: false } as MouseEvent)

    expect(openFileMock).toHaveBeenCalledWith(
      '/home/user/project/lib/parser.ts',
      99,
      7,
    )
  })

  test('resolves relative paths using CWD provider', () => {
    const terminal = createMockTerminal(['file not found: utils/helper.ts:22'])
    const provider = new FileLinkProvider(() => '/app/src', openFileMock, 'linux')
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    const first = links[0].link as { activate: (event: MouseEvent) => void }
    first.activate({ ctrlKey: true, metaKey: false } as MouseEvent)

    expect(openFileMock).toHaveBeenCalledWith(
      '/app/src/utils/helper.ts',
      22,
      undefined,
    )
  })

  test('detects Windows absolute path when os=win32', () => {
    const terminal = createMockTerminal(['error at C:\\Users\\dev\\project\\main.ts:10'])
    const provider = new FileLinkProvider(() => null, openFileMock, 'win32')
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    expect(links.length).toBeGreaterThanOrEqual(1)

    const first = links[0].link as { activate: (event: MouseEvent) => void }
    first.activate({ ctrlKey: true, metaKey: false } as MouseEvent)

    expect(openFileMock).toHaveBeenCalledWith(
      expect.stringContaining('main.ts'),
      10,
      undefined,
    )
  })

  test('returns no links for empty line', () => {
    const terminal = createMockTerminal([''])
    const provider = new FileLinkProvider(() => '/home/user', openFileMock)
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    expect(links).toHaveLength(0)
  })

  test('returns no links for line exceeding 2000 chars', () => {
    const longLine = 'x'.repeat(2001) + ' /some/path.ts:5'
    const terminal = createMockTerminal([longLine])
    const provider = new FileLinkProvider(() => '/home/user', openFileMock)
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    expect(links).toHaveLength(0)
  })

  test('activate with Cmd+click (metaKey) also works', () => {
    const terminal = createMockTerminal(['see src/index.ts:3:1'])
    const provider = new FileLinkProvider(() => '/project', openFileMock)
    provider.activate(terminal as unknown as Parameters<typeof provider.activate>[0])

    const links = getLinksFromProvider(terminal, 0)
    const first = links[0].link as { activate: (event: MouseEvent) => void }
    first.activate({ ctrlKey: false, metaKey: true } as MouseEvent)

    expect(openFileMock).toHaveBeenCalledWith(
      expect.stringContaining('index.ts'),
      3,
      1,
    )
  })
})
