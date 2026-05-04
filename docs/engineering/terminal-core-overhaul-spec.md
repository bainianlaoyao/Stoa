# Terminal Core Overhaul Spec

Status: implemented.

This document records the terminal contract that the repository now enforces. It is not a speculative plan.

## Design Rules

1. The terminal core is raw passthrough.
2. No parser-level ANSI interception in the default path.
3. No input frame splitting, throttling, or per-character injection.
4. Text input and binary input are explicit and both are wired end-to-end.
5. `Ctrl+C` remains raw PTY input and also triggers agent interrupt bookkeeping.
6. Provider-specific product behavior must not mutate the terminal protocol.

## Implemented Data Flow

### Text

```text
xterm onData(data)
  -> preload sendSessionInput(sessionId, data)
  -> ipcRenderer.send('session:input', sessionId, data)
  -> ipcMain.on('session:input')
  -> SessionInputRouter.send(sessionId, data)
  -> PtyHost.write(sessionId, data)
  -> node-pty.write(string)
```

### Binary

```text
xterm onBinary(data)
  -> preload sendSessionBinaryInput(sessionId, bytes)
  -> ipcRenderer.send('session:binary-input', sessionId, bytes)
  -> ipcMain.on('session:binary-input')
  -> SessionInputRouter.sendBinary(sessionId, bytes)
  -> PtyHost.writeBinary(sessionId, bytes)
  -> node-pty.write(Buffer)
```

### Output

```text
node-pty onData(data)
  -> SessionRuntimeController.appendTerminalData()
  -> runtime backlog
  -> renderer terminal.write(data)
```

## xterm Runtime Contract

The runtime created in [src/renderer/terminal/xterm-runtime.ts](/abs/path/D:/Data/DEV/ultra_simple_panel/src/renderer/terminal/xterm-runtime.ts) must preserve:

- `scrollback: 10_000`
- `lineHeight: 1`
- `convertEol: false`
- `disableStdin: false`
- `customGlyphs: true`
- `windowsPty: { backend: 'conpty', buildNumber? }` on Windows — this is a compatibility flag, not a statement that xterm.js runs on ConPTY (see Windows ConPTY Clarification below)
- theme colors from CSS variables
- font family from CSS variables or settings
- addons: `FitAddon`, `Unicode11Addon`, `WebLinksAddon`, `ClipboardAddon`, `SearchAddon`, `SerializeAddon`, optional `WebglAddon`

`allowProposedApi` remains enabled. In this repository that is an intentional requirement of the loaded xterm addon set, and tests lock it.

## PTY Contract

The PTY host in [src/core/pty-host.ts](/abs/path/D:/Data/DEV/ultra_simple_panel/src/core/pty-host.ts) must preserve:

- `name: 'xterm-256color'`
- `cols: command.initialCols ?? 120`
- `rows: command.initialRows ?? 30`
- These defaults are fallbacks only — the PTY is spawned after the renderer reports actual dimensions via `session:resize`
- `TERM: command.env?.TERM ?? 'xterm-256color'`
- `COLORTERM: command.env?.COLORTERM ?? 'truecolor'`
- `TERM_PROGRAM: 'xterm.js'`
- `write()` for string input
- `writeBinary()` for `Uint8Array | Buffer | string`

`node-pty` already supports `Buffer` writes. `writeBinary()` exists to make the application boundary explicit.

## SessionInputRouter Contract

The router in [src/main/session-input-router.ts](/abs/path/D:/Data/DEV/ultra_simple_panel/src/main/session-input-router.ts) is responsible for:

- per-session ordered writes
- stale-write invalidation through generation reset
- raw text passthrough
- raw binary passthrough
- user interrupt detection for agent sessions

It is not responsible for:

- Codex-specific framing
- submit-gap timing
- paste normalization
- protocol rewriting

The effective behavior is:

```ts
async send(sessionId: string, data: string): Promise<void>
async sendBinary(sessionId: string, data: Uint8Array): Promise<void>
resetSession(sessionId: string): void
```

For agent sessions, ETX still reaches the PTY before interrupt-side state updates complete.

## Codex Provider Contract

The provider in [src/extensions/providers/codex-provider.ts](/abs/path/D:/Data/DEV/ultra_simple_panel/src/extensions/providers/codex-provider.ts) now uses:

```text
codex
codex resume --last
codex resume <externalSessionId>
```

It does not add `--no-alt-screen` by default. There is no built-in dual-mode surface in the current runtime/provider contract.

## Removed Behaviors

These are intentionally not part of the terminal core anymore:

- `installScrollbackGuard`
- `registerCsiHandler` interception for `?1049h`, `?1049l`, or `CSI 3J`
- Codex frame splitting
- Codex throttling delays
- Codex submit-gap staging
- parser-side fake scrollback preservation

## Current Limits

The runtime backlog in [src/main/session-runtime-controller.ts](/abs/path/D:/Data/DEV/ultra_simple_panel/src/main/session-runtime-controller.ts) is still a trimmed string buffer capped at `250_000` chars. A chunk ring buffer was discussed during design but is not part of the implemented contract.

No DOM guard is installed in the terminal viewport. The current contract relies on xterm's own event handling plus the existing renderer structure.

## Core Constraint

**Provider hooks and session state events must never mutate the terminal byte stream.**

The hook bridge (`session-event-bridge`, `hook-event-adapter`, `evolver-hook-sidecar`) may:
- patch session state
- update status / metadata
- emit stop / prompt-submitted events

It must never:
- inject text into the terminal
- rewrite terminal output based on hook events
- simulate keyboard input (Enter, Ctrl+C, etc.)
- affect the PTY input queue

## Windows ConPTY Clarification

`windowsPty: { backend: 'conpty' }` is an xterm.js compatibility flag for ConPTY behavior differences, not a statement that xterm.js itself runs on ConPTY. The accurate description is:

- **Frontend:** xterm.js terminal emulator with Windows ConPTY compatibility options
- **Backend:** node-pty using ConPTY on Windows

## Architecture Summary

```text
Renderer Process (Vue 3)
  TerminalViewport.vue
    xterm.js frontend
      - FitAddon / WebGL
      - Search / Serialize
      - Unicode11 / Clipboard
      - onData    → sendSessionInput()
      - onBinary  → sendSessionBinaryInput()
      - onResize  → resizeSession()

Preload
  contextBridge window.stoa
    - sendSessionInput
    - sendSessionBinaryInput
    - resizeSession
    - onTerminalData

Main Process
  SessionInputRouter
    - per-session ordered queue (shared by text + binary)
    - generation invalidation
    - Ctrl+C interrupt notification
    - text input → ptyHost.write()
    - binary input → ptyHost.writeBinary()

  SessionRuntimeController
    - pty onData callback
    - terminal backlog
    - IPC terminal:data fanout

  PtyHost
    - node-pty spawn
    - ConPTY on Windows
    - write(string)
    - writeBinary(Buffer)
    - resize(cols, rows)
    - kill()
```

## Verification Targets

The test suite must keep these assertions green:

- `session:binary-input` is declared and routed end-to-end
- preload exposes `sendSessionBinaryInput`
- `TerminalViewport` forwards `onBinary`
- `SessionInputRouter` preserves ordered passthrough and interrupt semantics
- `PtyHost.writeBinary()` preserves byte writes
- Codex provider no longer injects `--no-alt-screen`
- parser-level scrollback guard is not installed
