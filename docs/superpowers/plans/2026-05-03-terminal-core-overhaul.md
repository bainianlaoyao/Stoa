# Terminal Core Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip ANSI interception, input tampering, and fake PTY state from the terminal core; wire `onBinary` end-to-end; add DOM guards; fix PTY environment; simplify input routing.

**Architecture:** Core terminal becomes a faithful pass-through between xterm.js and node-pty. No parser hooks, no frame splitting, no throttling. AI session enhancements (replay, search, transcript) remain separate product capabilities layered on top.

**Tech Stack:** xterm.js, node-pty, Electron IPC, Vue 3, TypeScript, Vitest

**Spec:** `docs/engineering/terminal-core-overhaul-spec.md`

---

## File Map

### Files to modify

| File | Change |
|---|---|
| `src/renderer/terminal/xterm-runtime.ts` | Delete `installScrollbackGuard`. Change `scrollback` to 10_000. Add `installTerminalDomGuards`. Remove `allowProposedApi: true` if unused by addons. |
| `src/renderer/terminal/xterm-runtime.test.ts` | Delete `installScrollbackGuard` test block. Add `installTerminalDomGuards` tests. |
| `src/renderer/components/TerminalViewport.vue` | Remove scrollback guard installation. Add DOM guard installation. Add `onBinary` binding. Add `onBinary` dispose. |
| `src/renderer/components/TerminalViewport.test.ts` | Delete scrollback guard test. Update component tests for DOM guard and onBinary. |
| `src/main/session-input-router.ts` | Delete Codex frame splitting, throttling, sleep, nowMs. Add `sendBinary()`. Simplify `send()` to passthrough + queue. |
| `src/main/session-input-router.test.ts` | Delete Codex-specific tests. Keep interrupt + queue tests. Add `sendBinary` test. |
| `src/core/pty-host.ts` | Add `writeBinary()`. Add `TERM` to env. |
| `src/core/pty-host.test.ts` | Add `writeBinary` tests. |
| `src/core/ipc-channels.ts` | Add `sessionBinaryInput`. |
| `src/preload/index.ts` | Add `sendSessionBinaryInput`. |
| `src/shared/project-session.ts` | Add `sendSessionBinaryInput` to `RendererApi`. Add `initialCols`/`initialRows` to `ProviderCommand`. |
| `src/main/index.ts` | Add `sessionBinaryInput` IPC handler. Route through input router. Add `writeBinary` to transport. |
| `src/main/session-runtime-controller.ts` | Change backlog from string concat to chunk ring buffer. |
| `src/extensions/providers/codex-provider.ts` | Remove `--no-alt-screen` from `buildStartCommand` and resume commands. Add `buildHistoryCommand`. |
| `src/extensions/providers/index.ts` | Add `buildHistoryCommand?` to `ProviderDefinition`. |
| `docs/engineering/terminal-spec.md` | Update to match actual implementation. |

### Files to read for context only (not modify)

| File | Why |
|---|---|
| `src/core/session-runtime.ts` | Understand how `PtyHost.start` is called, where `runtimeId` naming comes from |
| `src/main/launch-tracked-session-runtime.ts` | Entry point for session creation flow |

---

## Task 1: Remove `installScrollbackGuard` from default path

**Files:**
- Modify: `src/renderer/terminal/xterm-runtime.ts`
- Modify: `src/renderer/terminal/xterm-runtime.test.ts`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Delete `installScrollbackGuard` from `xterm-runtime.ts`**

Delete lines 236–283 (the JSDoc comment + function body + closing brace). The function is `installScrollbackGuard` starting at line 244.

If `IDisposable` import (line 9) is no longer used after this deletion, keep it for now — `installTerminalDomGuards` (Task 5) will use it.

- [ ] **Step 2: Delete `installScrollbackGuard` test block from `xterm-runtime.test.ts`**

Delete the entire `describe('installScrollbackGuard', ...)` block (lines 257–429).

- [ ] **Step 3: Remove scrollback guard from `TerminalViewport.vue`**

Three changes in `TerminalViewport.vue`:

(a) Remove the import. Delete `installScrollbackGuard` from the import on line 4:

```typescript
// Before:
import { createTerminalRuntime, installScrollbackGuard } from '@renderer/terminal/xterm-runtime'
// After:
import { createTerminalRuntime } from '@renderer/terminal/xterm-runtime'
```

(b) Delete the `scrollbackGuard` variable declaration (line 31):

```typescript
// DELETE this line:
let scrollbackGuard: IDisposable | null = null
```

(c) Delete the guard installation block (lines 115–121):

```typescript
// DELETE this entire block:
if (
  props.session.type === 'opencode'
  || props.session.type === 'codex'
  || props.session.type === 'claude-code'
) {
  scrollbackGuard = installScrollbackGuard(localTerminal)
}
```

(d) Delete the guard dispose in `disposeTerminal()` (line 46):

```typescript
// DELETE this line:
scrollbackGuard?.dispose()
```

(e) Delete the `scrollbackGuard = null` line if present.

- [ ] **Step 4: Delete scrollback guard test from `TerminalViewport.test.ts`**

Delete the test at lines 604–629:

```typescript
// DELETE this test:
test('installs scrollback guard for codex sessions so TUI output keeps scrollback history', async () => { ... })
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts src/renderer/components/TerminalViewport.test.ts`

Expected: All pass. No remaining references to `installScrollbackGuard` in test files.

- [ ] **Step 6: Verify no remaining references**

Run: `grep -r "installScrollbackGuard" src/`

Expected: No matches.

- [ ] **Step 7: Commit**

```
feat(terminal): remove installScrollbackGuard from default terminal path

The scrollback guard used parser-level CSI handler interception to block
alternate screen sequences (DECSET ?1049h, DECRST ?1049l) and scrollback
clear (CSI 3J). This violated the terminal program-emulator contract:
programs sent sequences expecting specific behavior, but xterm.js silently
swallowed them, causing state machine divergence (program thinks it's on
alt screen, terminal is on normal buffer).

Codex already uses --no-alt-screen for scrollback preservation. Other
providers should use their own CLI flags, not parser interception.
```

---

## Task 2: Remove Codex frame splitting and throttling from `SessionInputRouter`

**Files:**
- Modify: `src/main/session-input-router.ts`
- Modify: `src/main/session-input-router.test.ts`

- [ ] **Step 1: Write failing test for simplified `send()`**

In `src/main/session-input-router.test.ts`, add a new test that verifies Codex input is NOT split:

```typescript
test('passes codex input unchanged (no frame splitting)', async () => {
  const writes: Array<{ sessionId: string; data: string }> = []
  const router = new SessionInputRouter(
    { getSessionType: () => 'codex' },
    {
      write(sessionId, data) {
        writes.push({ sessionId, data })
      }
    }
  )

  await router.send('codex-1', 'hello')

  expect(writes).toEqual([{ sessionId: 'codex-1', data: 'hello' }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/session-input-router.test.ts`

Expected: FAIL — `expandCodexFrames` splits `'hello'` into individual characters.

- [ ] **Step 3: Simplify `SessionInputRouter`**

In `src/main/session-input-router.ts`, make these changes:

(a) Delete these top-level functions and constants:

```typescript
// DELETE:
const ESCAPE = '\u001b'
const DEFAULT_CODEX_PLAIN_INPUT_MIN_INTERVAL_MS = 35
```

Delete `expandCodexFrames`, `isCodexPlainFrame`, `isCodexSubmitFrame` (lines 136–155).

(b) Delete these fields from the class:

```typescript
// DELETE from class body:
private readonly lastCodexPlainWriteAt = new Map<string, number>()
private readonly codexPlainInputMinIntervalMs: number
private readonly codexSubmitInputMinIntervalMs: number
private readonly nowMs: () => number
private readonly sleep: (ms: number) => Promise<void>
```

(c) Delete corresponding constructor assignments:

```typescript
// DELETE from constructor body:
this.codexPlainInputMinIntervalMs = options.codexPlainInputMinIntervalMs ?? DEFAULT_CODEX_PLAIN_INPUT_MIN_INTERVAL_MS
this.codexSubmitInputMinIntervalMs = options.codexSubmitInputMinIntervalMs ?? 120
this.nowMs = options.nowMs ?? (() => Date.now())
this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
```

(d) Delete from `SessionInputRouterOptions`:

```typescript
// DELETE these fields from the interface:
codexPlainInputMinIntervalMs?: number
codexSubmitInputMinIntervalMs?: number
nowMs?: () => number
sleep?: (ms: number) => Promise<void>
```

(e) Replace the `send()` method body:

```typescript
async send(sessionId: string, data: string): Promise<void> {
  if (!data) {
    return
  }

  const sessionType = this.sessions.getSessionType(sessionId)
  if (isAgentSessionType(sessionType) && isUserInterruptInput(data)) {
    this.resetSession(sessionId)
    this.transport.write(sessionId, data)
    await this.onUserInterrupt?.(sessionId, sessionType)
    return
  }

  this.enqueue(sessionId, () => {
    this.transport.write(sessionId, data)
  })
}
```

(f) Replace `flushFrames` with a private `enqueue` method. Delete `flushFrames` entirely. Add:

```typescript
private enqueue(sessionId: string, fn: () => void): void {
  const previous = this.queues.get(sessionId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => fn())
  this.queues.set(sessionId, next)
  const cleanup = () => {
    if (this.queues.get(sessionId) === next) {
      this.queues.delete(sessionId)
    }
  }
  next.then(cleanup, cleanup)
}
```

(g) Delete `isGenerationCurrent` method if `generations` map is still needed by `resetSession` — keep `generations` and `resetSession` as-is.

(h) Keep these functions unchanged: `isAgentSessionType`, `isUserInterruptInput`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/session-input-router.test.ts`

The new test should now PASS. The old Codex-specific tests will FAIL — delete them in the next step.

- [ ] **Step 5: Delete Codex-specific tests**

In `src/main/session-input-router.test.ts`, delete these tests:

- `'splits codex plain-text chunks into ordered frames'` (L25–56)
- `'does not split codex control sequences containing escape'` (L58–72)
- `'applies minimum spacing across separate codex sends'` (L74–102)
- `'resetSession cancels queued stale codex frames'` (L104–137)

Keep these tests:
- `'passes through non-codex input unchanged'` (L5–23)
- `'codex interrupt input cancels queued draft frames and reports user interruption immediately'` (L139–177) — but this test uses `codexPlainInputMinIntervalMs` option which no longer exists. Simplify it:

```typescript
test('interrupt input (Ctrl+C) is sent immediately and triggers callback', async () => {
  const writes: string[] = []
  const interruptions: Array<{ sessionId: string; sessionType: string }> = []

  const router = new SessionInputRouter(
    { getSessionType: () => 'codex' },
    {
      write(_sessionId, data) {
        writes.push(data)
      }
    },
    {
      onUserInterrupt(sessionId, sessionType) {
        interruptions.push({ sessionId, sessionType })
      }
    }
  )

  await router.send('codex-1', '\u0003')

  expect(writes).toEqual(['\u0003'])
  expect(interruptions).toEqual([{ sessionId: 'codex-1', sessionType: 'codex' }])
})
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run src/main/session-input-router.test.ts`

Expected: All pass.

- [ ] **Step 7: Commit**

```
feat(terminal): remove Codex frame splitting and input throttling

Codex input was split into individual characters with 35ms throttling
between each character. This was unnecessary for normal typing (each
onData is already a single character), harmful for paste without
bracketed paste mode (100 chars = 3.5s delay), and made no difference
for bracketed paste (escape sequences bypass splitting).

Codex uses crossterm raw mode which handles multi-character stdin
correctly. The PTY buffers writes properly. No per-character injection
is needed.
```

---

## Task 3: Change `scrollback` from 100_000 to 10_000

**Files:**
- Modify: `src/renderer/terminal/xterm-runtime.ts`

- [ ] **Step 1: Change the value**

In `src/renderer/terminal/xterm-runtime.ts`, find:

```typescript
scrollback: 100_000,
```

Replace with:

```typescript
scrollback: 10_000,
```

- [ ] **Step 2: Update any test that asserts on scrollback value**

Search for `100_000` or `scrollback` in test files:

Run: `grep -r "100_000\|scrollback" src/renderer/ --include="*.test.ts"`

If any test asserts `scrollback: 100_000`, update to `10_000`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts`

Expected: All pass.

- [ ] **Step 4: Commit**

```
feat(terminal): reduce scrollback from 100k to 10k

100k lines of scrollback consumes excessive memory. Long-term history
is served by terminal backlog (replay) and future transcript logging.
xterm scrollback handles current-session scrolling only.
```

---

## Task 4: Add `onBinary` end-to-end path

**Files:**
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/core/pty-host.ts`
- Modify: `src/core/pty-host.test.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/session-input-router.ts`
- Modify: `src/renderer/components/TerminalViewport.vue`

- [ ] **Step 1: Add IPC channel**

In `src/core/ipc-channels.ts`, add after `sessionInput`:

```typescript
sessionBinaryInput: 'session:binary-input',
```

- [ ] **Step 2: Add `sendSessionBinaryInput` to `RendererApi`**

In `src/shared/project-session.ts`, add to `RendererApi` interface after `sendSessionInput`:

```typescript
sendSessionBinaryInput: (sessionId: string, data: Uint8Array) => void
```

- [ ] **Step 3: Add `writeBinary` to `PtyHost`**

In `src/core/pty-host.ts`, add method after `write`:

```typescript
writeBinary(sessionId: string, data: Uint8Array | Buffer | string): void {
  const terminal = this.sessions.get(sessionId)
  if (!terminal) return

  if (typeof data === 'string') {
    terminal.write(Buffer.from(data, 'binary'))
    return
  }

  terminal.write(Buffer.from(data))
}
```

- [ ] **Step 4: Add `writeBinary` tests to `pty-host.test.ts`**

In `src/core/pty-host.test.ts`, add:

```typescript
describe('writeBinary()', () => {
  test('writes Buffer to the terminal', () => {
    const host = new PtyHost(mockPty)
    host.start('rt-1', { command: 'cmd', args: [], cwd: '/tmp' }, vi.fn(), vi.fn())

    host.writeBinary('rt-1', Buffer.from('binary-data'))

    expect(lastTerminal().write).toHaveBeenCalledWith(Buffer.from('binary-data'))
  })

  test('converts string data to binary Buffer', () => {
    const host = new PtyHost(mockPty)
    host.start('rt-1', { command: 'cmd', args: [], cwd: '/tmp' }, vi.fn(), vi.fn())

    host.writeBinary('rt-1', 'binary-string')

    expect(lastTerminal().write).toHaveBeenCalledWith(Buffer.from('binary-string', 'binary'))
  })

  test('does not throw for unknown session', () => {
    const host = new PtyHost(mockPty)

    expect(() => host.writeBinary('unknown', Buffer.from('x'))).not.toThrow()
  })
})
```

Read `src/core/pty-host.test.ts` first to understand the mock pattern and use the same setup.

- [ ] **Step 5: Run PtyHost tests**

Run: `npx vitest run src/core/pty-host.test.ts`

Expected: All pass (including new tests).

- [ ] **Step 6: Add `writeBinary` to `SessionInputTransport` interface**

In `src/main/session-input-router.ts`, update:

```typescript
export interface SessionInputTransport {
  write: (sessionId: string, data: string) => void
  writeBinary: (sessionId: string, data: Uint8Array) => void
}
```

- [ ] **Step 7: Add `sendBinary` to `SessionInputRouter`**

In `src/main/session-input-router.ts`, add method:

```typescript
sendBinary(sessionId: string, data: Uint8Array): void {
  this.enqueue(sessionId, () => {
    this.transport.writeBinary(sessionId, data)
  })
}
```

- [ ] **Step 8: Add preload bridge method**

In `src/preload/index.ts`, add after `sendSessionInput`:

```typescript
sendSessionBinaryInput(sessionId, data) {
  ipcRenderer.send(IPC_CHANNELS.sessionBinaryInput, { sessionId, data })
},
```

- [ ] **Step 9: Add main process IPC handler and update transport**

In `src/main/index.ts`:

(a) Find the existing `sessionInput` handler:

```typescript
ipcMain.on(IPC_CHANNELS.sessionInput, (_event, sessionId: string, data: string) => {
```

Note how it routes through `inputRouter`. Add a similar handler for binary:

```typescript
ipcMain.on(IPC_CHANNELS.sessionBinaryInput, (_event, payload: { sessionId: string; data: Uint8Array }) => {
  inputRouter.sendBinary(payload.sessionId, payload.data)
})
```

(b) Find the transport object that implements `SessionInputTransport` and add `writeBinary`:

```typescript
write(sessionId, data) {
  ptyHost?.write(sessionId, data)
},
writeBinary(sessionId, data) {
  ptyHost?.writeBinary(sessionId, data)
},
```

- [ ] **Step 10: Add `onBinary` binding in `TerminalViewport.vue`**

In `src/renderer/components/TerminalViewport.vue`:

(a) Add a variable for the binary disposable alongside the existing `dataDisposable`:

```typescript
let binaryDisposable: { dispose(): void } | null = null
```

(b) In `setupTerminal()`, after the existing `dataDisposable` binding (around line 186–188), add:

```typescript
binaryDisposable = localTerminal.onBinary(data => {
  stoa.sendSessionBinaryInput(sessionId, Uint8Array.from(data, ch => ch.charCodeAt(0) & 0xff))
})
```

(c) In `disposeTerminal()`, add dispose:

```typescript
binaryDisposable?.dispose()
binaryDisposable = null
```

- [ ] **Step 11: Run full test suite**

Run: `npx vitest run`

Expected: All pass. Fix any type errors in `RendererApi` mock objects in test files — they now need a `sendSessionBinaryInput` method.

The mock in test files typically looks like:

```typescript
sendSessionBinaryInput: vi.fn(),
```

Search for all files that create `RendererApi` mocks and add the method:

Run: `grep -r "sendSessionInput:" src/ --include="*.test.ts" -l`

For each file found, add `sendSessionBinaryInput: vi.fn(),` right after `sendSessionInput`.

- [ ] **Step 12: Commit**

```
feat(terminal): wire onBinary end-to-end from xterm.js to PTY

Binary input path: xterm.js onBinary → IPC sendSessionBinaryInput →
SessionInputRouter.sendBinary → PtyHost.writeBinary → node-pty write.

This enables TUI programs (vim, tmux, codex TUI) to receive mouse
reports, which are non-UTF-8 binary data that flows through the
onBinary channel rather than onData.
```

---

## Task 5: Add DOM Guard

**Files:**
- Modify: `src/renderer/terminal/xterm-runtime.ts`
- Modify: `src/renderer/terminal/xterm-runtime.test.ts`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write failing tests for `installTerminalDomGuards`**

In `src/renderer/terminal/xterm-runtime.test.ts`, add a new describe block:

```typescript
describe('installTerminalDomGuards', () => {
  function createMockTerminal() {
    return {
      focus: vi.fn(),
    }
  }

  test('installs event listeners on container that stop propagation and focus terminal', () => {
    const { installTerminalDomGuards } = await import('./xterm-runtime')
    const container = document.createElement('div')
    const terminal = createMockTerminal()

    installTerminalDomGuards(container, terminal as unknown as Terminal)

    expect(container.tabIndex).toBe(0)

    // Test pointerdown
    const pointerEvent = new Event('pointerdown', { bubbles: true })
    const pointerSpy = vi.spyOn(pointerEvent, 'stopPropagation')
    container.dispatchEvent(pointerEvent)
    expect(terminal.focus).toHaveBeenCalled()
    expect(pointerSpy).toHaveBeenCalled()

    terminal.focus.mockClear()

    // Test mousedown
    const mouseEvent = new Event('mousedown', { bubbles: true })
    const mouseSpy = vi.spyOn(mouseEvent, 'stopPropagation')
    container.dispatchEvent(mouseEvent)
    expect(terminal.focus).toHaveBeenCalled()
    expect(mouseSpy).toHaveBeenCalled()

    terminal.focus.mockClear()

    // Test contextmenu
    const contextEvent = new Event('contextmenu', { bubbles: true })
    const contextSpy = vi.spyOn(contextEvent, 'stopPropagation')
    container.dispatchEvent(contextEvent)
    expect(contextSpy).toHaveBeenCalled()
  })

  test('dispose removes all event listeners', () => {
    const { installTerminalDomGuards } = await import('./xterm-runtime')
    const container = document.createElement('div')
    const terminal = createMockTerminal()

    const guard = installTerminalDomGuards(container, terminal as unknown as Terminal)
    guard.dispose()

    terminal.focus.mockClear()

    const pointerEvent = new Event('pointerdown', { bubbles: true })
    container.dispatchEvent(pointerEvent)
    expect(terminal.focus).not.toHaveBeenCalled()
  })
})
```

Note: Adjust the test to use `await import` pattern matching the existing test file conventions. Read the test file first to match the exact mock/import style.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts`

Expected: FAIL — `installTerminalDomGuards` is not exported.

- [ ] **Step 3: Implement `installTerminalDomGuards`**

In `src/renderer/terminal/xterm-runtime.ts`, add after `createTerminalRuntime`:

```typescript
export function installTerminalDomGuards(
  container: HTMLElement,
  terminal: Terminal,
): IDisposable {
  container.tabIndex = 0

  const onPointerDown = (event: Event) => {
    terminal.focus()
    event.stopPropagation()
  }

  const onMouseDown = (event: Event) => {
    terminal.focus()
    event.stopPropagation()
  }

  const onWheel = (event: WheelEvent) => {
    event.stopPropagation()
  }

  const onContextMenu = (event: Event) => {
    event.stopPropagation()
  }

  container.addEventListener('pointerdown', onPointerDown, { capture: true })
  container.addEventListener('mousedown', onMouseDown, { capture: true })
  container.addEventListener('wheel', onWheel, { capture: true })
  container.addEventListener('contextmenu', onContextMenu, { capture: true })

  return {
    dispose() {
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      container.removeEventListener('mousedown', onMouseDown, { capture: true })
      container.removeEventListener('wheel', onWheel, { capture: true })
      container.removeEventListener('contextmenu', onContextMenu, { capture: true })
    },
  }
}
```

Ensure `IDisposable` is imported from `@xterm/xterm` — it was already imported previously and may still be in the file.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/terminal/xterm-runtime.test.ts`

Expected: All pass.

- [ ] **Step 5: Install DOM guard in `TerminalViewport.vue`**

In `src/renderer/components/TerminalViewport.vue`:

(a) Update the import:

```typescript
// Before:
import { createTerminalRuntime } from '@renderer/terminal/xterm-runtime'
// After:
import { createTerminalRuntime, installTerminalDomGuards } from '@renderer/terminal/xterm-runtime'
```

(b) Add variable alongside existing disposables:

```typescript
let domGuard: IDisposable | null = null
```

(c) In `setupTerminal()`, after `localTerminal.open(terminalContainer.value)` and `localTerminal.focus()`, add:

```typescript
domGuard = installTerminalDomGuards(terminalContainer.value, localTerminal)
```

(d) In `disposeTerminal()`, add:

```typescript
domGuard?.dispose()
domGuard = null
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: All pass.

- [ ] **Step 7: Commit**

```
feat(terminal): add DOM guard to prevent host UI from stealing terminal events

When xterm.js is embedded inside a Vue component tree, parent components
can intercept pointerdown, mousedown, wheel, and contextmenu events
before they reach the terminal. The DOM guard uses stopPropagation on
capture phase to ensure the terminal receives all mouse interactions.

This is NOT an ANSI hack — it only prevents the host UI framework from
interfering with terminal events. The terminal protocol itself is
untouched.
```

---

## Task 6: Fix PTY environment — add `TERM`

**Files:**
- Modify: `src/core/pty-host.ts`

- [ ] **Step 1: Add `TERM` to env**

In `src/core/pty-host.ts`, find the `env` object in `start()`:

```typescript
env: { ...command.env, COLORTERM: 'truecolor', TERM_PROGRAM: 'xterm.js' }
```

Replace with:

```typescript
env: {
  ...command.env,
  TERM: command.env?.TERM ?? 'xterm-256color',
  COLORTERM: command.env?.COLORTERM ?? 'truecolor',
  TERM_PROGRAM: 'xterm.js',
}
```

The `...command.env` spread comes first so provider overrides win. The explicit `TERM` fallback ensures it's always set even if the provider doesn't include it.

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/core/pty-host.test.ts`

Expected: All pass. Check if any test asserts the env object — update if needed.

- [ ] **Step 3: Commit**

```
fix(pty): add TERM=xterm-256color to PTY environment

node-pty's `name` option sets the PTY terminal name, but the TERM
environment variable is a separate concern. Some TUI programs use
TERM to determine color depth and mouse protocol support via terminfo.
Both must be set for reliable TUI behavior.
```

---

## Task 7: Simplify Codex Provider — remove default `--no-alt-screen`

**Files:**
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `src/extensions/providers/index.ts`

- [ ] **Step 1: Add `buildHistoryCommand` to `ProviderDefinition`**

In `src/extensions/providers/index.ts`, add to the interface:

```typescript
buildHistoryCommand?(
  target: ProviderRuntimeTarget,
  context: ProviderCommandContext
): Promise<ProviderCommand>
```

- [ ] **Step 2: Update Codex provider**

In `src/extensions/providers/codex-provider.ts`:

Change `buildStartCommand`:

```typescript
async buildStartCommand(target, context) {
  return createCommand(target, context, [])
},
```

Change `buildFallbackResumeCommand`:

```typescript
async buildFallbackResumeCommand(target, context) {
  return createCommand(target, context, ['resume', '--last'])
},
```

Change `buildResumeCommand`:

```typescript
async buildResumeCommand(target, externalSessionId, context) {
  return createCommand(target, context, ['resume', externalSessionId])
},
```

Add `buildHistoryCommand`:

```typescript
async buildHistoryCommand(target, context) {
  return createCommand(target, context, ['--no-alt-screen'])
},
```

- [ ] **Step 3: Run provider tests**

Run: `npx vitest run src/extensions/providers/`

Expected: Tests that assert `args` containing `'--no-alt-screen'` in `buildStartCommand` will FAIL. Update those tests to expect `args: []`.

Any test for `buildFallbackResumeCommand` asserting `--no-alt-screen` should also be updated to expect no flag.

Add a new test for `buildHistoryCommand`:

```typescript
test('buildHistoryCommand returns codex with --no-alt-screen', async () => {
  const command = await provider.buildHistoryCommand(baseTarget, baseContext)
  expect(command.args).toContain('--no-alt-screen')
})
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`

Expected: All pass.

- [ ] **Step 5: Commit**

```
feat(codex): default to native TUI mode, add history profile

Codex now starts in native TUI mode (with alternate screen) by default.
The --no-alt-screen flag moves to buildHistoryCommand as a separate
profile for users who prefer inline scrollback preservation.

Resume commands also drop --no-alt-screen to match the original session
mode.
```

---

## Task 8: Refactor backlog to chunk ring buffer

**Files:**
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/main/session-runtime-controller.test.ts`

- [ ] **Step 1: Read the existing test file**

Read `src/main/session-runtime-controller.test.ts` to understand the test patterns and mock setup.

- [ ] **Step 2: Write failing test for chunk ring buffer**

Add a test that verifies the backlog does not grow unbounded:

```typescript
test('backlog evicts old chunks when exceeding MAX_TERMINAL_BACKLOG_CHARS', async () => {
  // ... setup controller with mock window

  // Append data exceeding the limit
  for (let i = 0; i < 100; i++) {
    await controller.appendTerminalData({ sessionId: 's-1', data: 'x'.repeat(5000) })
  }

  const replay = await controller.getTerminalReplay('s-1')
  expect(replay.length).toBeLessThanOrEqual(250_000 + 5000) // allows one chunk over limit
})
```

Read the test file first and match the existing mock/window pattern.

- [ ] **Step 3: Implement chunk ring buffer**

In `src/main/session-runtime-controller.ts`:

(a) Add interface:

```typescript
interface TerminalBacklog {
  chunks: string[]
  totalChars: number
}
```

(b) Change the map type:

```typescript
// Before:
private readonly terminalBacklogs = new Map<string, string>()
// After:
private readonly terminalBacklogs = new Map<string, TerminalBacklog>()
```

(c) Replace `appendTerminalData`:

```typescript
async appendTerminalData(chunk: { sessionId: string; data: string }): Promise<void> {
  let backlog = this.terminalBacklogs.get(chunk.sessionId)
  if (!backlog) {
    backlog = { chunks: [], totalChars: 0 }
    this.terminalBacklogs.set(chunk.sessionId, backlog)
  }

  backlog.chunks.push(chunk.data)
  backlog.totalChars += chunk.data.length

  while (backlog.totalChars > MAX_TERMINAL_BACKLOG_CHARS && backlog.chunks.length > 1) {
    const removed = backlog.chunks.shift()!
    backlog.totalChars -= removed.length
  }

  const win = this.getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.terminalData, chunk)
  }
}
```

(d) Replace `getTerminalReplay`:

```typescript
async getTerminalReplay(sessionId: string): Promise<string> {
  const backlog = this.terminalBacklogs.get(sessionId)
  return backlog ? backlog.chunks.join('') : ''
}
```

(e) Update `markRuntimeStarting` where it deletes the backlog:

```typescript
// Before:
this.terminalBacklogs.delete(sessionId)
// After — same call works, Map.delete handles any value type
```

(f) Delete the `trimBacklog` function at the bottom of the file.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/session-runtime-controller.test.ts`

Expected: All pass.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`

Expected: All pass.

- [ ] **Step 6: Commit**

```
perf(terminal): refactor backlog from string concat to chunk ring buffer

The previous implementation concatenated all terminal output into a
single growing string and sliced it when exceeding the limit. This
caused O(n) string operations on every append.

The new implementation stores chunks individually and evicts from the
front when the total character count exceeds the limit. Serialization
(join) happens only on replay requests.
```

---

## Task 9: Add `initialCols` / `initialRows` to `ProviderCommand`

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/pty-host.ts`

- [ ] **Step 1: Extend `ProviderCommand` interface**

In `src/shared/project-session.ts`, add optional fields:

```typescript
export interface ProviderCommand {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  initialCols?: number
  initialRows?: number
}
```

- [ ] **Step 2: Use in `PtyHost.start`**

In `src/core/pty-host.ts`, change:

```typescript
// Before:
cols: 120,
rows: 30,
// After:
cols: command.initialCols ?? 120,
rows: command.initialRows ?? 30,
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/core/pty-host.test.ts`

Expected: All pass. The default 120×30 is unchanged when no initialCols/initialRows is provided.

- [ ] **Step 4: Commit**

```
feat(pty): support initial terminal dimensions in ProviderCommand

PTY now accepts optional initialCols and initialRows in the command
object, defaulting to 120x30. This enables the frontend to spawn PTY
sessions at the correct terminal size from the start, avoiding a
subsequent resize-and-reflow cycle.
```

---

## Task 10: Update `terminal-spec.md`

**Files:**
- Modify: `docs/engineering/terminal-spec.md`

- [ ] **Step 1: Rewrite the spec to match reality**

Replace the entire file content with the actual current implementation. Key sections:

1. **Terminal options**: Use the values from `createTerminalRuntime` in `xterm-runtime.ts` — `lineHeight: 1`, `scrollback: 10_000`, `convertEol: false`, `windowsPty: { backend: 'conpty' }`, theme from CSS variables, fontFamily from CSS variable.

2. **Required addons**: Fit, WebLinks, Search, Serialize, Unicode11, Clipboard, WebGL (with context loss fallback).

3. **Required: onBinary wired end-to-end** — both `onData` and `onBinary` must be bound.

4. **Required: DOM guard** — `installTerminalDomGuards` must be installed on the terminal container.

5. **PTY environment**: Both `name: 'xterm-256color'` and `env.TERM: 'xterm-256color'`.

6. **Forbidden patterns**:
   - `registerCsiHandler` for ANSI interception in default path
   - Input frame splitting or throttling
   - `lineHeight > 1` (breaks TUI cell-grid)
   - `convertEol: true` (PTY output must pass unchanged)
   - Hardcoded hex colors in theme (use CSS variables)

- [ ] **Step 2: Commit**

```
docs: update terminal-spec.md to match core overhaul

Remove outdated options (windowsMode, hardcoded fontFamily/fontSize).
Add new requirements (onBinary, DOM guard, TERM env). Document
forbidden patterns for ANSI interception and input tampering.
```

---

## Task 11: Final verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`

Expected: All pass.

- [ ] **Step 3: Generate deterministic test assets**

Run: `npm run test:generate`

Expected: Deterministic output.

- [ ] **Step 4: Run E2E tests**

Run: `npm run test:e2e`

Expected: All pass.

- [ ] **Step 5: Run behavior coverage**

Run: `npm run test:behavior-coverage`

Expected: Budgets satisfied.

- [ ] **Step 6: Search for remaining violations**

```bash
grep -r "installScrollbackGuard" src/
grep -r "expandCodexFrames" src/
grep -r "codexPlainInputMinIntervalMs" src/
grep -r "registerCsiHandler" src/renderer/
```

Expected: No matches (except possibly in comments or docs).

---

## Self-Review Checklist

### Spec coverage

| Spec section | Task |
|---|---|
| §1 Remove scrollback guard | Task 1 |
| §2 xterm-runtime scrollback change | Task 3 |
| §3 onBinary end-to-end | Task 4 |
| §4 SessionInputRouter simplify + sendBinary | Task 2, Task 4 |
| §5 DOM guard | Task 5 |
| §6 TERM env fix | Task 6 |
| §7 initialCols/initialRows | Task 9 |
| §8 Codex provider --no-alt-screen removal | Task 7 |
| §9 Backlog ring buffer | Task 8 |
| §10 Session creation order | Deferred (V2) |
| §11 Transcript | Out of scope |
| §12 terminal-spec.md update | Task 10 |

### Placeholder scan

No TBD, TODO, or "implement later" in task steps. Every step has concrete code or commands.

### Type consistency

- `PtyHost.writeBinary(sessionId: string, data: Uint8Array | Buffer | string)` — used consistently across transport, router, and preload.
- `SessionInputTransport.writeBinary(sessionId: string, data: Uint8Array)` — narrower type than PtyHost, which is fine (router only sends Uint8Array).
- `RendererApi.sendSessionBinaryInput(sessionId: string, data: Uint8Array)` — matches preload implementation.
- `ProviderCommand.initialCols?: number / initialRows?: number` — optional, defaults in PtyHost.
- `TerminalBacklog` interface defined in session-runtime-controller.ts — local, not exported.

### Out of scope confirmed

- No transcript implementation
- No Shift+wheel handler
- No session creation order optimization
- No MessagePortMain upgrade
- No PowerShell provider (still uses local-shell)
