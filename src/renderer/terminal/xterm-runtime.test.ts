import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@xterm/xterm', () => {
  class Terminal {
    options: Record<string, unknown>
    loadedAddons: unknown[] = []
    unicode = { activeVersion: '6' }

    constructor(options: Record<string, unknown>) {
      this.options = options
    }

    loadAddon(addon: unknown) {
      this.loadedAddons.push(addon)
    }

    onSelectionChange(_handler: () => void) {
      return { dispose: () => {} }
    }

    getSelection() {
      return ''
    }
  }

  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: class {},
  }
})

vi.mock('@xterm/addon-unicode11', () => {
  return {
    Unicode11Addon: class {},
  }
})

vi.mock('@xterm/addon-web-links', () => {
  return {
    WebLinksAddon: class {
      constructor(
        _handler: (event: MouseEvent, uri: string) => void
      ) {}
    },
  }
})

vi.mock('@xterm/addon-webgl', () => {
  class WebglAddon {
    static failNext = false
    static lastInstance: WebglAddon | null = null
    private contextLossHandler: (() => void) | null = null
    disposeCount = 0

    constructor() {
      WebglAddon.lastInstance = this
      if (WebglAddon.failNext) {
        WebglAddon.failNext = false
        throw new Error('webgl unavailable')
      }
    }

    onContextLoss(handler: () => void) {
      this.contextLossHandler = handler
    }

    triggerContextLoss() {
      this.contextLossHandler?.()
    }

    dispose() {
      this.disposeCount += 1
    }
  }

  return { WebglAddon }
})

describe('createTerminalRuntime', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { WebglAddon } = await import('@xterm/addon-webgl')
    ;(WebglAddon as unknown as { failNext: boolean }).failNext = false
    ;(WebglAddon as unknown as { lastInstance: unknown }).lastInstance = null
  })

  test('enables windowsPty heuristics on Windows and does not set convertEol', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime('win32', vi.fn(), true)
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.windowsPty).toEqual({ backend: 'conpty' })
    expect(terminal.options.convertEol).toBeUndefined()
  })

  test('loads fit/unicode11/web-links/webgl addons and activates unicode11', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime('linux', vi.fn(), true)
    const terminal = runtime.terminal as unknown as {
      loadedAddons: unknown[]
      unicode: { activeVersion: string }
    }

    expect(terminal.loadedAddons).toHaveLength(4)
    expect(terminal.unicode.activeVersion).toBe('11')
  })

  test('swallows WebGL setup failures and keeps terminal creation alive', async () => {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    ;(WebglAddon as unknown as { failNext: boolean }).failNext = true

    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime('darwin', vi.fn(), true)
    expect(runtime.terminal).toBeTruthy()
    expect(runtime.webglAddon).toBeNull()
  })

  test('uses the configured terminal font size instead of a hardcoded value', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime('linux', vi.fn(), true, 18)
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.fontSize).toBe(18)
  })

  test('uses lineHeight 1.0 to keep terminal cells pixel-aligned', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime('linux', vi.fn(), true, 14)
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.lineHeight).toBe(1)
  })

  test('resolves the mono font token before passing fontFamily into xterm', async () => {
    const getComputedStyleMock = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({
        getPropertyValue: (property: string) => {
          if (property === '--font-mono') {
            return "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
          }

          return ''
        },
      } as CSSStyleDeclaration)

    try {
      const { createTerminalRuntime } = await import('./xterm-runtime')

      const runtime = createTerminalRuntime('linux', vi.fn(), true)
      const terminal = runtime.terminal as unknown as {
        options: Record<string, unknown>
      }

      expect(terminal.options.fontFamily).toBe(
        "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
      )
    } finally {
      getComputedStyleMock.mockRestore()
    }
  })

  test('resolves the terminal selection token before passing theme colors into xterm', async () => {
    const getComputedStyleMock = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({
        getPropertyValue: (property: string) => {
          if (property === '--color-terminal-selection') {
            return 'rgba(226, 232, 240, 0.16)'
          }

          if (property === '--color-terminal-ansi-red') {
            return '#ff5a5f'
          }

          return ''
        },
      } as CSSStyleDeclaration)

    try {
      const { createTerminalRuntime } = await import('./xterm-runtime')

      const runtime = createTerminalRuntime('linux', vi.fn(), true)
      const terminal = runtime.terminal as unknown as {
        options: { theme: Record<string, unknown> }
      }

      expect(terminal.options.theme.selectionBackground).toBe('rgba(226, 232, 240, 0.16)')
      expect(terminal.options.theme.red).toBe('#ff5a5f')
    } finally {
      getComputedStyleMock.mockRestore()
    }
  })

  test('uses the explicit fontFamily parameter when provided', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime('linux', vi.fn(), true, 14, 'Cascadia Mono')
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.fontFamily).toBe('Cascadia Mono')
  })

  test('disposes WebGL addon when context loss occurs', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')
    const { WebglAddon } = await import('@xterm/addon-webgl')

    createTerminalRuntime('linux', vi.fn(), true)

    const webgl = (WebglAddon as unknown as { lastInstance: { triggerContextLoss(): void; disposeCount: number } | null }).lastInstance
    expect(webgl).toBeTruthy()

    webgl?.triggerContextLoss()
    webgl?.triggerContextLoss()
    expect(webgl?.disposeCount).toBe(1)
  })
})

describe('installScrollbackGuard', () => {
  type CsiCallback = (params: (number | number[])[]) => boolean
  type CsiHandler = { dispose: () => void }

  /** Create a mock Terminal that captures registerCsiHandler calls. */
  function createMockTerminal() {
    const handlers: {
      id: { prefix?: string; intermediates?: string; final: string }
      callback: CsiCallback
      disposed: boolean
    }[] = []

    const terminal = {
      parser: {
        registerCsiHandler(
          id: { prefix?: string; intermediates?: string; final: string },
          callback: CsiCallback
        ): CsiHandler {
          const entry = { id, callback, disposed: false }
          handlers.push(entry)
          return {
            dispose() {
              entry.disposed = true
            },
          }
        },
      },
    }

    return { terminal, handlers }
  }

  function findHandler(
    handlers: ReturnType<typeof createMockTerminal>['handlers'],
    prefix: string | undefined,
    final: string
  ): { callback: CsiCallback; disposed: boolean } | undefined {
    return handlers.find(
      h => (h.id.prefix ?? '') === (prefix ?? '') && h.id.final === final
    )
  }

  test('registers exactly 3 CSI handlers: DECSET (h), DECRST (l), ED (J)', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()

    installScrollbackGuard(terminal as unknown as Terminal)

    expect(handlers).toHaveLength(3)
    expect(handlers[0].id).toEqual({ prefix: '?', final: 'h' })
    expect(handlers[1].id).toEqual({ prefix: '?', final: 'l' })
    expect(handlers[2].id).toEqual({ final: 'J' })
  })

  // --- DECSET (?..h) blocking ---

  test('DECSET blocks mode 1049 (alternate screen)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decset = findHandler(handlers, '?', 'h')
    expect(decset?.callback([1049])).toBe(true)
  })

  test('DECSET blocks mode 1047 (alternate screen variant)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decset = findHandler(handlers, '?', 'h')
    expect(decset?.callback([1047])).toBe(true)
  })

  test('DECSET blocks mode 47 (alternate screen variant)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decset = findHandler(handlers, '?', 'h')
    expect(decset?.callback([47])).toBe(true)
  })

  test('DECSET passes through unrelated modes like 1 (cursor keys)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decset = findHandler(handlers, '?', 'h')
    expect(decset?.callback([1])).toBe(false)
    expect(decset?.callback([25])).toBe(false) // cursor visible
    expect(decset?.callback([1000])).toBe(false) // mouse tracking
  })

  test('DECSET blocks when alt screen mode appears as sub-params', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decset = findHandler(handlers, '?', 'h')
    // Sub-param form: [[1049]] — colon-separated sub-params in one position
    expect(decset?.callback([[1049]])).toBe(true)
    expect(decset?.callback([[47, 1047]])).toBe(true)
  })

  // --- DECRST (?..l) blocking ---

  test('DECRST blocks mode 1049 restore', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decrst = findHandler(handlers, '?', 'l')
    expect(decrst?.callback([1049])).toBe(true)
    expect(decrst?.callback([1047])).toBe(true)
    expect(decrst?.callback([47])).toBe(true)
  })

  test('DECRST passes through unrelated modes', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const decrst = findHandler(handlers, '?', 'l')
    expect(decrst?.callback([1])).toBe(false)
    expect(decrst?.callback([25])).toBe(false)
  })

  // --- ED3 (CSI 3J) blocking ---

  test('ED handler blocks param 3 (scrollback clear)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const ed = findHandler(handlers, undefined, 'J')
    expect(ed?.callback([3])).toBe(true)
  })

  test('ED handler passes through params 0, 1, 2 (normal erase)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const ed = findHandler(handlers, undefined, 'J')
    expect(ed?.callback([0])).toBe(false)
    expect(ed?.callback([1])).toBe(false)
    expect(ed?.callback([2])).toBe(false)
  })

  test('ED handler passes through empty params (defaults to 0)', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    installScrollbackGuard(terminal as unknown as Terminal)

    const ed = findHandler(handlers, undefined, 'J')
    // CSI J with no params — xterm.js may pass [] (ZDM fills [0])
    expect(ed?.callback([])).toBe(false)
  })

  // --- Disposal ---

  test('dispose() disposes all 3 handlers', async () => {
    const { installScrollbackGuard } = await import('./xterm-runtime')
    const { terminal, handlers } = createMockTerminal()
    const guard = installScrollbackGuard(terminal as unknown as Terminal)

    guard.dispose()

    expect(handlers.every(h => h.disposed)).toBe(true)
  })
})
