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
- PTY start size defaults to `120x30` (renderer sends actual size via `session:resize` after mount; PTY is not spawned until the renderer reports ready dimensions — see `docs/engineering/terminal-core-overhaul-spec.md`)

## Windows ConPTY Clarification

`windowsPty: { backend: 'conpty', buildNumber? }` is a compatibility flag in xterm.js, not a statement that xterm.js runs on ConPTY. The accurate description is:

- **Frontend:** xterm.js terminal emulator with Windows ConPTY compatibility options
- **Backend:** node-pty using ConPTY on Windows

## Input Contract

Text and binary use separate IPC channels but share the same per-session ordered queue in `SessionInputRouter`:

```text
Text input:
  xterm.onData(data)
  → preload sendSessionInput(sessionId, data)
  → IPC session:input
  → SessionInputRouter.send(sessionId, data)
  → PtyHost.write(sessionId, data)
  → node-pty.write(string)

Binary input:
  xterm.onBinary(data)
  → preload sendSessionBinaryInput(sessionId, bytes)
  → IPC session:binary-input
  → SessionInputRouter.sendBinary(sessionId, bytes)
  → PtyHost.writeBinary(sessionId, bytes)
  → node-pty.write(Buffer)
```

- Both text and binary enter the same per-session queue — no ordering divergence
- `Ctrl+C` / ETX is written raw to PTY and also marks the agent interrupt path

## Output Contract

- `pty.onData` is forwarded to xterm unchanged
- replay/backlog is a backend concern, not a terminal protocol concern

## Core Constraint

**Provider hooks and session state events must never mutate the terminal byte stream.**

The hook bridge (`session-event-bridge`, `hook-event-adapter`, `evolver-hook-sidecar`) may:
- patch session state
- update status / metadata
- emit stop / prompt-submitted events

The hook bridge must never:
- inject text into the terminal
- rewrite terminal output based on hook events
- simulate Enter / Ctrl+C / other keyboard input
- affect the PTY input queue

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
