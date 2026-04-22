# Terminal Specification

The terminal is the primary surface of this application. It must deliver a native shell experience with zero visual or functional compromise.

## xterm.js Configuration

All terminal instances must use the following configuration. No deviation without explicit user approval.

### Required Options

```typescript
new Terminal({
  fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.0,          // 1.0 only. TUI apps (opencode, vim) need pixel-perfect row alignment.
  cursorBlink: true,
  allowProposedApi: true,
  scrollback: 10_000,
  convertEol: true,
  windowsMode: true,        // Required for Windows conpty compatibility.
})
```

### Required Addons (load in this order)

1. **Unicode11Addon** — Unicode 11.0 character width table. Ensures CJK, emoji, and box-drawing characters have correct column widths.
2. **WebLinksAddon** — Clickable URLs that open in the system browser.
3. **FitAddon** — Auto-fit terminal to container dimensions.
4. **WebglAddon** — WebGL renderer. Primary renderer for pixel-accurate character alignment. Must wrap in try/catch with silent fallback to canvas.

```typescript
terminal.loadAddon(new Unicode11Addon())
terminal.loadAddon(new WebLinksAddon())

fitAddon = new FitAddon()
terminal.loadAddon(fitAddon)
terminal.open(container)

try {
  const webglAddon = new WebglAddon()
  webglAddon.onContextLoss(() => { webglAddon.dispose() })
  terminal.loadAddon(webglAddon)
} catch { /* fallback to canvas */ }
```

### Forbidden Patterns

| Forbidden | Reason |
|---|---|
| `lineHeight > 1.0` | Breaks box-drawing character alignment (gaps between ┌─┐│) |
| `fontFamily: "var(--css-variable)"` | CSS variables may not resolve in Canvas/WebGL context |
| `screenReaderMode: true` in production | Forces DOM renderer, inferior to WebGL for TUI |
| Hardcoded `#hex` colors in theme | Must use CSS custom properties (`var(--terminal-bg)`) |
| Native scrollbar visible | Must hide via `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` |

### Font Loading

Terminal initialization must wait for web fonts to finish loading. Otherwise xterm measures character widths with the fallback font, causing permanent misalignment.

```typescript
await (document.fonts?.ready ?? Promise.resolve())
```

## PTY Configuration

### Terminal Type

```
TERM=xterm-256color
```

This is set via `node-pty`'s `name` option. `xterm-256color` enables:

- 256 color support (required by opencode TUI)
- Mouse protocol (click, drag, scroll)
- Focus event reporting
- Bracketed paste mode

**Never use `xterm-color`** — it only supports 16 colors and lacks mouse protocol terminfo.

### Environment Isolation

The PTY environment must strip inherited `OPENCODE_*` variables from `process.env` to prevent the spawned process from accidentally connecting to a parent opencode instance.

Blocklist: `OPENCODE`, `OPENCODE_CLIENT`, `OPENCODE_PID`, `OPENCODE_PROCESS_ROLE`, `OPENCODE_RUN_ID`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME`.

## Rendering Rules

### Running State (session status === 'running')

The terminal must fill the entire viewport. No header, no status bar, no messages, no padding, no border.

```
┌──────────────────────────┐
│                          │
│     xterm.js surface     │
│     (edge-to-edge)       │
│                          │
└──────────────────────────┘
```

### Non-Running States (exited, error, starting, etc.)

Show a semantic overlay with session details, lifecycle copy, and metadata. This is informational only — no terminal surface.

## Accessibility

### Semantic Structure

- Terminal surface: `role="region" aria-label="Terminal surface"`
- Empty state: `role="region" aria-label="Terminal empty state"`
- Non-running overlay: `role="region" aria-label="Session details"`
- Session metadata: `dl[aria-label="Session metadata"]`
- Each overlay must have `aria-describedby` linking to its summary paragraph

### E2E Debug Hook

In e2e test mode (`?e2e=1`), the terminal exposes `window.__VIBECODING_TERMINAL_DEBUG__` with:
- `getActiveBufferText()` — full buffer content
- `getViewportText()` — visible viewport content
