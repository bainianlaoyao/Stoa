# Terminal Specification

The terminal is the primary surface of this application. It must behave like a raw PTY viewport.

## xterm.js Configuration

All terminal instances use the same core configuration.

```typescript
new Terminal({
  lineHeight: 1,
  scrollback: 10_000,
  convertEol: false,
  disableStdin: false,
  customGlyphs: true,
  cursorBlink: true,
  cursorStyle: 'block',
  cursorInactiveStyle: 'outline',
  rightClickSelectsWord: platform !== 'darwin',
  altClickMovesCursor: true,
  allowProposedApi: true,
  windowsPty: platform === 'win32'
    ? { backend: 'conpty', buildNumber: windowsBuildNumber }
    : undefined,
})
```

## Addons

Loaded addons:

1. `FitAddon`
2. `Unicode11Addon`
3. `WebLinksAddon`
4. `ClipboardAddon`
5. `SearchAddon`
6. `SerializeAddon`
7. optional `WebglAddon`

## Required Rules

- Preserve raw text input.
- Preserve raw binary input.
- Do not install parser-level ANSI interception in the default path.
- Do not split or throttle paste/input frames.
- Keep `lineHeight` at `1`.
- Keep `scrollback` at `10_000`.
- Use CSS custom properties for theme colors.
- Resolve font family from the design token / settings source.

## PTY Configuration

- `name: 'xterm-256color'`
- `TERM` defaults to `xterm-256color`
- `COLORTERM` defaults to `truecolor`
- `TERM_PROGRAM` is `xterm.js`
- PTY start size defaults to `120x30`

## Input Contract

- `onData` -> `sendSessionInput` -> `session:input`
- `onBinary` -> `sendSessionBinaryInput` -> `session:binary-input`
- `Ctrl+C` is written raw and also marks the agent interrupt path

## Output Contract

- `pty.onData` is forwarded to xterm unchanged
- replay/backlog is a backend concern, not a terminal protocol concern

## Forbidden Patterns

- `registerCsiHandler` in the default terminal path
- frame splitting / throttling / per-character injection
- default `--no-alt-screen`
- scrollback-guard style ANSI swallowing
- hardcoded theme hex values

## Verification

The terminal contract is valid only if:

- raw text passes through unchanged
- raw binary passes through unchanged
- Codex paste is not throttled
- bracketed paste stays intact
- `session:binary-input` is wired end-to-end
- `PtyHost.writeBinary()` exists and is used
