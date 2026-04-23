import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'

declare global {
  interface Navigator {
    userAgentData?: {
      platform?: string
    }
  }
}

export interface XtermRuntime {
  terminal: Terminal
  fitAddon: FitAddon
  unicode11Addon: Unicode11Addon
  webLinksAddon: WebLinksAddon
  webglAddon: WebglAddon | null
}

export type ExternalLinkOpener = (uri: string) => void

const FALLBACK_MONO_FONT_FAMILY = 'monospace'

function detectRuntimePlatform(): string {
  if (typeof process !== 'undefined' && typeof process.platform === 'string') {
    return process.platform
  }

  if (typeof navigator !== 'undefined') {
    const platform = navigator.userAgentData?.platform ?? navigator.platform ?? ''
    const normalized = platform.toLowerCase()
    if (normalized.includes('win')) {
      return 'win32'
    }

    if (normalized.includes('mac')) {
      return 'darwin'
    }

    if (normalized.includes('linux')) {
      return 'linux'
    }
  }

  return 'unknown'
}

function defaultOpenExternal(uri: string): void {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return
  }

  window.open(uri, '_blank', 'noopener,noreferrer')
}

function canUseWebgl(): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const canvas = document.createElement('canvas')
  return Boolean(canvas.getContext?.('webgl2'))
}

function resolveTerminalFontFamily(): string {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return FALLBACK_MONO_FONT_FAMILY
  }

  const fontFamily = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--font-mono')
    .trim()

  return fontFamily || FALLBACK_MONO_FONT_FAMILY
}

export function createTerminalRuntime(
  platform = detectRuntimePlatform(),
  openExternal: ExternalLinkOpener = defaultOpenExternal,
  enableWebgl = canUseWebgl(),
  fontSize = 14,
  fontFamily?: string
): XtermRuntime {
  const terminal = new Terminal({
    fontFamily: fontFamily || resolveTerminalFontFamily(),
    fontSize,
    lineHeight: 1,
    theme: {
      background: '#0a0b0d',
      foreground: '#e2e8f0',
      cursor: '#e2e8f0',
      cursorAccent: '#0a0b0d',
      selectionBackground: 'rgba(226, 232, 240, 0.2)',
      black: '#0a0b0d',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#e2e8f0',
      brightBlack: '#64748b',
      brightRed: '#f87171',
      brightGreen: '#34d399',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#a78bfa',
      brightCyan: '#22d3ee',
      brightWhite: '#f8fafc',
    },
    allowProposedApi: true,
    scrollback: 10_000,
    windowsPty: platform === 'win32' ? { backend: 'conpty' } : undefined,
  })

  const fitAddon = new FitAddon()
  const unicode11Addon = new Unicode11Addon()
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openExternal(uri)
  })

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(unicode11Addon)
  terminal.unicode.activeVersion = '11'
  terminal.loadAddon(webLinksAddon)

  let webglAddon: WebglAddon | null = null
  if (enableWebgl) {
    try {
      const addon = new WebglAddon()
      terminal.loadAddon(addon)
      addon.onContextLoss(() => {
        if (webglAddon !== addon) {
          return
        }

        addon.dispose()
        webglAddon = null
      })
      webglAddon = addon
    } catch {
      webglAddon = null
    }
  }

  return {
    terminal,
    fitAddon,
    unicode11Addon,
    webLinksAddon,
    webglAddon,
  }
}
