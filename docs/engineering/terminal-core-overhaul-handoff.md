# Terminal Core Overhaul Final Spec

Status: implemented.

Principle: the terminal core is a raw PTY transport. xterm.js and node-pty are the only protocol endpoints; Stoa does not split, throttle, rewrite, or fake terminal input/output in the default path.

## Final Contract

- `xterm.onData(data)` -> `RendererApi.sendSessionInput(sessionId, data)` -> IPC -> `SessionInputRouter.send(sessionId, data)` -> `PtyHost.write(sessionId, data)` -> `node-pty.write(string)`
- `xterm.onBinary(data)` -> `RendererApi.sendSessionBinaryInput(sessionId, bytes)` -> IPC -> `SessionInputRouter.sendBinary(sessionId, bytes)` -> `PtyHost.writeBinary(sessionId, bytes)` -> `node-pty.write(Buffer)`
- `pty.onData(data)` -> `terminal.write(data)`
- resize -> `sendSessionResize()` -> `PtyHost.resize()`
- `Ctrl+C` / ETX is written raw and also triggers the agent interrupt callback for agent providers.

`SessionInputRouter` only preserves per-session ordering and invalidates stale queued writes on `resetSession()`.

## Codex Policy

- Default commands are raw TUI commands:
  - `codex`
  - `codex resume --last`
  - `codex resume <externalSessionId>`
- No default `--no-alt-screen`
- No dual mode
- No Codex-only input framing or throttling

## PTY Defaults

- `name: 'xterm-256color'`
- `TERM` defaults to `xterm-256color`
- `COLORTERM` defaults to `truecolor`
- `TERM_PROGRAM` is `xterm.js`
- `initialCols` / `initialRows` default to `120x30`

## xterm Runtime

- `scrollback: 10_000`
- `lineHeight: 1`
- `convertEol: false`
- `disableStdin: false`
- `customGlyphs: true`
- `rightClickSelectsWord` follows platform
- `altClickMovesCursor: true`
- addons: Fit, Unicode11, WebLinks, Clipboard, Search, Serialize, optional WebGL
- `allowProposedApi` stays enabled because the Unicode11 addon requires it in this codebase

## Explicit Non-Goals

- Scrollback guard / parser-level ANSI interception
- Input splitting / throttling / per-character injection
- DOM-level terminal event guard
- Codex history-mode duality
- Backlog ring-buffer refactor
- Transcript logging

## Test Contract

- Raw text input passes through unchanged
- Raw binary input passes through unchanged
- Codex paste stays single-frame
- Bracketed paste stays intact
- Ctrl+C writes raw ETX and triggers interrupt callback
- `session:binary-input` exists end-to-end
- Tests and docs reflect the raw terminal contract
