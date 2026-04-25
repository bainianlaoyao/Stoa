# Codex Input Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex sessions entered through Stoa trigger real provider hooks by normalizing Codex plain-text input before it reaches the PTY.

**Architecture:** Add a main-process `SessionInputRouter` that sits between `IPC_CHANNELS.sessionInput` and `ptyHost.write(...)`. The router will leave non-Codex input untouched, preserve Codex control sequences, and serialize Codex plain-text input into a per-session queued character stream with a 35ms minimum inter-frame gap plus a 120ms submit gap before `\r`/`\n`. Existing hook parsing, reducer, observability, and renderer status display remain unchanged.

**Tech Stack:** Electron main process, TypeScript, Vitest, Playwright-based manual repro scripts, existing PTY runtime stack.

---

## File Structure

- Create: `src/main/session-input-router.ts`
- Create: `src/main/session-input-router.test.ts`
- Modify: `src/main/index.ts`
- Modify: `docs/architecture/hook-signal-chain.md`
- Modify: `docs/architecture/provider-observable-information.md`

## Task 1: Write Router Regression Tests First

**Files:**
- Create: `src/main/session-input-router.test.ts`

- [ ] **Step 1: Write the failing test for non-Codex passthrough**

Add this test:

```ts
test('passes through non-codex input unchanged', async () => {
  const writes: Array<{ sessionId: string; data: string }> = []
  const router = new SessionInputRouter(
    {
      getSessionType(sessionId) {
        return sessionId === 'shell-1' ? 'shell' : null
      }
    },
    {
      write(sessionId, data) {
        writes.push({ sessionId, data })
      }
    }
  )

  await router.send('shell-1', 'echo ok\r')

  expect(writes).toEqual([{ sessionId: 'shell-1', data: 'echo ok\r' }])
})
```

Run:

```bash
npx vitest run src/main/session-input-router.test.ts
```

Expected: FAIL because `SessionInputRouter` does not exist yet.

- [ ] **Step 2: Add the failing test for Codex plain-text chunk splitting**

Add this test in the same file:

```ts
test('splits codex plain-text chunks into ordered frames', async () => {
  let now = 0
  const writes: string[] = []
  const sleeps: number[] = []

  const router = new SessionInputRouter(
    {
      getSessionType() {
        return 'codex'
      }
    },
    {
      write(_sessionId, data) {
        writes.push(data)
      }
    },
      {
        codexPlainInputMinIntervalMs: 35,
        codexSubmitInputMinIntervalMs: 120,
        nowMs: () => now,
        sleep: async (ms) => {
          sleeps.push(ms)
          now += ms
        }
    }
  )

  await router.send('codex-1', 'OK\r')

  expect(writes).toEqual(['O', 'K', '\r'])
  expect(sleeps).toEqual([35, 120])
})
```

Run:

```bash
npx vitest run src/main/session-input-router.test.ts
```

Expected: FAIL because the router is still missing.

- [ ] **Step 3: Add the failing test for Codex control-sequence passthrough**

Add this test:

```ts
test('does not split codex control sequences containing escape', async () => {
  const writes: string[] = []
  const router = new SessionInputRouter(
    { getSessionType: () => 'codex' },
    {
      write(_sessionId, data) {
        writes.push(data)
      }
    }
  )

  await router.send('codex-1', '\u001b[A')

  expect(writes).toEqual(['\u001b[A'])
})
```

Run:

```bash
npx vitest run src/main/session-input-router.test.ts
```

Expected: FAIL because the router is still missing.

- [ ] **Step 4: Add the failing test for per-session reset**

Add this test:

```ts
test('resetSession cancels queued stale codex frames', async () => {
  let releaseSleep: (() => void) | null = null
  const writes: string[] = []

  const router = new SessionInputRouter(
    { getSessionType: () => 'codex' },
    {
      write(_sessionId, data) {
        writes.push(data)
      }
    },
    {
      codexPlainInputMinIntervalMs: 35,
      nowMs: () => 0,
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSleep = resolve
        })
    }
  )

  const pending = router.send('codex-1', 'AB')
  expect(writes).toEqual(['A'])

  router.resetSession('codex-1')
  releaseSleep?.()
  await pending

  expect(writes).toEqual(['A'])
})
```

Run:

```bash
npx vitest run src/main/session-input-router.test.ts
```

Expected: FAIL because reset behavior is not implemented yet.

## Task 2: Implement the Minimal Router

**Files:**
- Create: `src/main/session-input-router.ts`
- Test: `src/main/session-input-router.test.ts`

- [ ] **Step 1: Implement the router API**

Create `src/main/session-input-router.ts` with these exported interfaces and class skeleton:

```ts
import type { SessionType } from '@shared/project-session'

export interface SessionInputSessionLookup {
  getSessionType: (sessionId: string) => SessionType | null
}

export interface SessionInputTransport {
  write: (sessionId: string, data: string) => void
}

export interface SessionInputRouterOptions {
  codexPlainInputMinIntervalMs?: number
  codexSubmitInputMinIntervalMs?: number
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
}

export class SessionInputRouter {
  constructor(
    private readonly sessions: SessionInputSessionLookup,
    private readonly transport: SessionInputTransport,
    private readonly options: SessionInputRouterOptions = {}
  ) {}

  async send(sessionId: string, data: string): Promise<void> {}
  resetSession(sessionId: string): void {}
  dispose(): void {}
}
```

- [ ] **Step 2: Implement Codex frame expansion and throttling**

Use this behavior:

```ts
function expandCodexFrames(data: string): string[] {
  if (!data) return []
  if (data.includes('\u001b')) return [data]
  if ([...data].length <= 1) return [data]
  return [...data]
}
```

Inside `send()`:

```ts
const sessionType = this.sessions.getSessionType(sessionId)
const frames = sessionType === 'codex' ? expandCodexFrames(data) : (data ? [data] : [])
```

For Codex plain frames, serialize writes through a per-session promise chain and enforce:

```ts
const minGapMs = this.options.codexPlainInputMinIntervalMs ?? 35
const submitGapMs = this.options.codexSubmitInputMinIntervalMs ?? 120
```

Before each Codex plain frame after the previous plain write:

```ts
const requiredGapMs = frame === '\r' || frame === '\n' ? submitGapMs : minGapMs
const elapsed = this.nowMs() - previousWriteAt
const waitMs = Math.max(0, requiredGapMs - elapsed)
if (waitMs > 0) {
  await this.sleep(waitMs)
}
```

Then:

```ts
this.transport.write(sessionId, frame)
```

- [ ] **Step 3: Implement generation-based reset**

Use a per-session generation token:

```ts
const nextGeneration = (this.generations.get(sessionId) ?? 0) + 1
this.generations.set(sessionId, nextGeneration)
```

Capture the current generation when `send()` starts. Before each queued frame write, and again after any awaited sleep, verify the generation still matches; if not, stop flushing the stale queue.

- [ ] **Step 4: Verify the new unit test file turns green**

Run:

```bash
npx vitest run src/main/session-input-router.test.ts
```

Expected: PASS.

## Task 3: Wire the Router into Electron Main

**Files:**
- Modify: `src/main/index.ts`
- Test: `src/main/session-input-router.test.ts`

- [ ] **Step 1: Instantiate one router in main**

Add an import:

```ts
import { SessionInputRouter } from './session-input-router'
```

Add a module-scoped variable near the other singletons:

```ts
let sessionInputRouter: SessionInputRouter | null = null
```

After `projectSessionManager` and `ptyHost` are ready, initialize:

```ts
sessionInputRouter = new SessionInputRouter(
  {
    getSessionType(sessionId) {
      return projectSessionManager?.snapshot().sessions.find((candidate) => candidate.id === sessionId)?.type ?? null
    }
  },
  {
    write(sessionId, data) {
      ptyHost?.write(sessionId, data)
    }
  }
)
```

- [ ] **Step 2: Replace direct PTY writes in the session input IPC handler**

Change:

```ts
ptyHost?.write(sessionId, data)
```

to:

```ts
await sessionInputRouter?.send(sessionId, data)
```

This keeps the IPC contract unchanged while moving provider-specific input logic out of `index.ts`.

- [ ] **Step 3: Reset queue state at runtime boundaries**

Before killing or restarting a session, call:

```ts
sessionInputRouter?.resetSession(sessionId)
```

Apply this in:

- `IPC_CHANNELS.sessionArchive`
- `IPC_CHANNELS.sessionRestore`
- `launchSessionRuntimeWithGuard(...)` before launching a runtime for an existing session id

On shutdown, call:

```ts
sessionInputRouter?.dispose()
sessionInputRouter = null
```

- [ ] **Step 4: Run the focused main-process tests**

Run:

```bash
npx vitest run src/main/session-input-router.test.ts src/main/session-runtime-controller.test.ts tests/e2e/ipc-bridge.test.ts
```

Expected: PASS.

## Task 4: Update the Architecture Docs

**Files:**
- Modify: `docs/architecture/hook-signal-chain.md`
- Modify: `docs/architecture/provider-observable-information.md`

- [ ] **Step 1: Document the corrected boundary**

In `docs/architecture/hook-signal-chain.md`, update the “Critical Boundary” section so it no longer says only that PTY write is unreliable. Make it explicit that current Stoa repair strategy for Codex on Windows is:

```md
- raw batch PTY write is not a reliable submit primitive
- Stoa now normalizes Codex plain-text input into ordered character frames before PTY write
- hook/state correctness still depends on provider-emitted events, not terminal parsing
```

- [ ] **Step 2: Document provider ingress behavior**

In `docs/architecture/provider-observable-information.md`, update the “Terminal Input (all providers)” section so Codex is called out as a special case:

```md
- For Codex on Windows, Stoa applies provider-specific plain-text input normalization before PTY write.
- Escape/control sequences remain raw.
- This is an ingress workaround, not a state inference mechanism.
```

- [ ] **Step 3: Verify docs-only diff is clean**

Run:

```bash
git diff -- docs/architecture/hook-signal-chain.md docs/architecture/provider-observable-information.md
```

Expected: only Codex ingress wording changes.

## Task 5: Full Verification and Manual Codex Repro

**Files:**
- No new files unless verification reveals missing coverage.

- [ ] **Step 1: Run the mandatory repository gates**

Run each command separately:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected: all exit `0`.

- [ ] **Step 2: Run the live Codex repro**

Use the existing Electron repro script pattern and verify:

- a fresh Codex session reaches `runtimeState = 'alive'`
- one-shot `window.stoa.sendSessionInput(sessionId, 'Reply with exactly OK.\r')`
- session transitions away from `agentState = 'unknown'`
- Codex hook path produces `SessionStart` / `UserPromptSubmit`

Expected: session enters provider-driven `working`.

- [ ] **Step 3: Commit**

Commit only the files for this fix:

```bash
git add src/main/session-input-router.ts src/main/session-input-router.test.ts src/main/index.ts docs/architecture/hook-signal-chain.md docs/architecture/provider-observable-information.md docs/superpowers/specs/2026-04-25-codex-input-normalization-design.md docs/superpowers/plans/2026-04-25-codex-input-normalization.md
git commit -m "fix: normalize codex session input"
```

## Self-Review

- The plan covers both the new router module and the `index.ts` integration.
- The tests directly lock the proven failure boundary: chunk splitting, control-sequence passthrough, throttling, and reset.
- The plan does not modify renderer/UI state logic.
- The plan keeps the long-term `app-server` migration out of this bugfix.
