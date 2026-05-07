import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'

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

vi.mock('@xterm/addon-clipboard', () => {
  return {
    ClipboardAddon: class {},
  }
})

vi.mock('@xterm/addon-search', () => {
  return {
    SearchAddon: class {},
  }
})

vi.mock('@xterm/addon-serialize', () => {
  return {
    SerializeAddon: class {},
  }
})

describe('createTerminalRuntime', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { WebglAddon } = await import('@xterm/addon-webgl')
    ;(WebglAddon as unknown as { failNext: boolean }).failNext = false
    ;(WebglAddon as unknown as { lastInstance: unknown }).lastInstance = null
  })

  test('enables windowsPty heuristics on Windows and sets convertEol to false', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'win32', openExternal: vi.fn() })
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.windowsPty).toEqual({ backend: 'conpty' })
    expect(terminal.options.convertEol).toBe(false)
  })

  test('passes windowsBuildNumber to windowsPty when provided', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'win32', openExternal: vi.fn(), windowsBuildNumber: 22631 })
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.windowsPty).toEqual({ backend: 'conpty', buildNumber: 22631 })
  })

  test('loads all addons and activates unicode11', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn(), settings: { gpuAcceleration: 'on' } })
    const terminal = runtime.terminal as unknown as {
      loadedAddons: unknown[]
      unicode: { activeVersion: string }
    }

    expect(terminal.loadedAddons).toHaveLength(8)
    expect(terminal.unicode.activeVersion).toBe('11')
  })

  test('swallows WebGL setup failures and keeps terminal creation alive', async () => {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    ;(WebglAddon as unknown as { failNext: boolean }).failNext = true

    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'darwin', openExternal: vi.fn(), settings: { gpuAcceleration: 'on' } })
    expect(runtime.terminal).toBeTruthy()
    expect(runtime.webglAddon).toBeNull()
  })

  test('uses the configured terminal font size instead of a hardcoded value', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn(), settings: { fontSize: 18 } })
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.fontSize).toBe(18)
  })

  test('uses lineHeight 1.0 by default to keep terminal cells pixel-aligned', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn() })
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.lineHeight).toBe(1)
  })

  test('enables allowProposedApi for Unicode11 addon support', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn() })
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.allowProposedApi).toBe(true)
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

      const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn() })
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

      const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn() })
      const terminal = runtime.terminal as unknown as {
        options: { theme: Record<string, unknown> }
      }

      expect(terminal.options.theme.selectionBackground).toBe('rgba(226, 232, 240, 0.16)')
      expect(terminal.options.theme.red).toBe('#ff5a5f')
    } finally {
      getComputedStyleMock.mockRestore()
    }
  })

  test('uses the explicit fontFamily from settings when provided', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')

    const runtime = createTerminalRuntime({ platform: 'linux', openExternal: vi.fn(), settings: { fontFamily: 'Cascadia Mono' } })
    const terminal = runtime.terminal as unknown as {
      options: Record<string, unknown>
    }

    expect(terminal.options.fontFamily).toBe('Cascadia Mono')
  })

  test('disposes WebGL addon when context loss occurs', async () => {
    const { createTerminalRuntime } = await import('./xterm-runtime')
    const { WebglAddon } = await import('@xterm/addon-webgl')

    createTerminalRuntime({ platform: 'linux', openExternal: vi.fn(), settings: { gpuAcceleration: 'on' } })

    const webgl = (WebglAddon as unknown as { lastInstance: { triggerContextLoss(): void; disposeCount: number } | null }).lastInstance
    expect(webgl).toBeTruthy()

    webgl?.triggerContextLoss()
    webgl?.triggerContextLoss()
    expect(webgl?.disposeCount).toBe(1)
  })
})
