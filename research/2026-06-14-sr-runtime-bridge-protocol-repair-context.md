# SR Runtime Bridge Protocol Repair — Bounded Context Report

**Date:** 2026-06-14
**Scope:** Stoa Server (SR) ↔ Electron runtime bridge WebSocket protocol.
**Purpose:** Inventory every wire-shape disagreement between the two sides of the runtime bridge so the repair can be planned against exact line citations. No fix is proposed here beyond noting which side each mismatch points at; this is context only.

---

## 1. The two sides and their roles

- **Provider (Electron):** `src/main/stoa-runtime-client.ts` — `StoaRuntimeClient`. Connects to SR over WS with `?role=runtime&token=…`. Receives `runtime:*` commands, drives the `PtyHost`, and pushes terminal data / responses back. Constructed and wired in `src/main/index.ts:1452-1502` (`createRuntimeClient`).
- **Server (SR):**
  - `stoa-server/src/ws/runtime-bridge-handler.ts` — `RuntimeBridgeHandler`. Owns provider registry, pending-command bookkeeping, per-command timeouts, and crash-recovery state.
  - `stoa-server/src/services/runtime-bridge-client.ts` — `LiveRuntimeBridgeClient`. Semantic adapter (`launch`, `input`, `createChildSession`, …) that shapes payloads and calls `handler.sendCommand`.
  - `stoa-server/src/routes/runtime-bridge.ts` — `RuntimeBridgeClient` interface + `LaunchOptions` / `ChildSessionOptions` types + stub/live factories.
  - `stoa-server/src/ws/role-router.ts` — `bindRuntimeConnection` forwards every inbound runtime frame to `handler.handleMessage` (`role-router.ts:180-182`).

---

## 2. Command direction SR → Electron (CONSISTENT)

SR builds the wire command flat and Electron reads it flat. **No mismatch on this leg.**

- SR send: `stoa-server/src/ws/runtime-bridge-handler.ts:258-264`
  ```ts
  const wireCommand: RuntimeCommand = {
    type, sessionId, payload: command.payload, replyTo
  }
  provider.ws.send(JSON.stringify(wireCommand))
  ```
- Electron receive: `src/main/stoa-runtime-client.ts:214-223`
  ```ts
  if (message.type.startsWith('runtime:') && typeof message.replyTo === 'string') {
    await this.handleCommand(message)   // destructure { type, sessionId, payload, replyTo }
  }
  ```

The command type union is duplicated identically on both sides:
`stoa-runtime-client.ts:16-28` ≡ `runtime-bridge-handler.ts:23-38`.

---

## 3. Response/data direction Electron → SR (BROKEN — frame envelope)

This is the headline defect. The two sides disagree on the **envelope** of every provider→server frame.

### Electron wraps everything in `{ type, payload }`

- Responses: `src/main/stoa-runtime-client.ts:372-377`
  ```ts
  private sendResponse(response: RuntimeResponse): void {
    this.send({ type: 'runtime:response', payload: response })   // nested
  }
  ```
- Terminal data: `src/main/stoa-runtime-client.ts:361-366`
  ```ts
  forwardTerminalData(sessionId, data): void {
    this.send({ type: 'runtime:terminal-data', payload: { sessionId, data } })  // nested
  }
  ```

### SR reads every field at the TOP LEVEL

`stoa-server/src/ws/runtime-bridge-handler.ts:338-360`:
```ts
const frame = parsed as Record<string, unknown>
if (typeof frame.replyTo === 'string') { this.handleResponse(provider, frame); return }
if (frame.type === 'runtime:terminal-data' && typeof frame.sessionId === 'string' && typeof frame.data === 'string') { ... }
if (frame.type === 'runtime:pty-state' && typeof frame.sessionId === 'string') { ... }
if (frame.type === 'runtime:state-sync' && Array.isArray(frame.sessions)) { ... }
```
`handleResponse` then reads `frame.replyTo`, `frame.ok`, `frame.data`, `frame.error` directly (`runtime-bridge-handler.ts:412-451`).

### Consequence

An Electron response frame `{ type: 'runtime:response', payload: { replyTo, ok, data } }`:
- `frame.replyTo` is `undefined` (nested) → response branch skipped.
- No `type` matches terminal-data/pty-state/state-sync with valid top-level fields → **frame silently dropped**.

→ **Every `sendCommand` from SR times out** (`runtime:launch` 30s, `runtime:input` 5s, … per `runtime-bridge-handler.ts:68-76`). Terminal-data forwarding is likewise dropped. The bridge is non-functional end-to-end as wired.

### What the existing tests encode

Both server-side test files assert the **flat** shape, confirming it is the server's intended contract:
- `stoa-server/src/ws/runtime-bridge-handler.test.ts:501-505` — response `{ replyTo, ok, data }` flat.
- `stoa-server/src/ws/runtime-bridge-handler.test.ts:516-520` — terminal-data `{ type, sessionId, data }` flat.
- `stoa-server/src/ws/role-router.test.ts:250-254` — provider response `{ replyTo, ok, data }` flat.

The Electron client test asserts the **nested** shape:
- `src/main/stoa-runtime-client.test.ts:605-619` — `forwardTerminalData` emits `{ type: 'runtime:terminal-data', payload: { sessionId, data } }`.
- `src/main/stoa-runtime-client.test.ts:269-274` — response emitted as `{ type: 'runtime:response', payload: { replyTo, ok, data } }`.

**Repair must pick one envelope and update the losing side + its tests.** Either flatten Electron's `sendResponse`/`forwardTerminalData` (and the two tests above), or teach SR's `handleMessage` to unwrap `payload`. Server-side contract has more tests behind it and matches the `WsClientMessage` `{ type, payload }` shape declared in `stoa-server/src/ws/events.ts:39-43` only for the *web* role — note `runtime:response` is listed as a client message type (`events.ts:25`) but the runtime-bridge handler does not consult that enum.

---

## 4. `runtime:create-child-session` — three-way field mismatch

### 4a. Request payload fields

SR sends (`stoa-server/src/services/runtime-bridge-client.ts:70-75`):
```ts
await this.dispatch(parentId, 'runtime:create-child-session', {
  type: options.type,
  command: options.command ?? null,
  cwd: options.cwd ?? null
})
```
`parentId` is carried as the wire command's top-level `sessionId` (via `dispatch` → `handler.sendCommand(parentId, …)`), **not** inside `payload`.

Electron reads (`src/main/stoa-runtime-client.ts:325-340`):
```ts
const parentId = payload.parentId            // never sent → undefined
if (typeof parentId !== 'string') {
  throw new Error('runtime:create-child-session requires payload.parentId')
}
... projectId, title, subagentName, externalSessionId, initialCols, initialRows ...
```

Result: **Electron ALWAYS throws `requires payload.parentId`** for this command. The command can never succeed even after the envelope (§3) is fixed.

The fields Electron reads (`projectId`, `title`, `subagentName`, `externalSessionId`, `initialCols`, `initialRows`) come from the `RuntimeClientDeps.createChildSession` contract at `src/main/stoa-runtime-client.ts:67-76`, and are all consumed by the wiring at `src/main/index.ts:1473-1495` (`createWorkSessionWithRuntime({ projectId, parentSessionId: payload.parentId, createdBySessionId: payload.parentId, type, title, subagentName, externalSessionId, initialCols, initialRows }, …)`). SR's `ChildSessionOptions` (`stoa-server/src/routes/runtime-bridge.ts:35-39`) only declares `{ type, command?, cwd? }` — so SR cannot express any of the fields Electron needs.

### 4b. Response field name

- Electron returns `{ sessionId }` (`src/main/stoa-runtime-client.ts:343`; dep returns a bare string per `stoa-runtime-client.ts:76`, handler wraps it).
- SR reads `result.childSessionId` (`stoa-server/src/services/runtime-bridge-client.ts:78-81`):
  ```ts
  const candidate = (result as { childSessionId?: unknown }).childSessionId
  if (typeof candidate === 'string') return candidate
  ... throw RuntimeBridgeError('malformed_response', ...)
  ```

Result: even if the request were fixed, SR would throw `malformed_response` because Electron returns `sessionId`, not `childSessionId`.

### 4c. Tests covering this command

- `src/main/stoa-runtime-client.test.ts:486-522` — sends `{ parentId, type, title, initialCols, initialRows }`, asserts `createChildSession` called with those and response `data: { sessionId: 'child-session-123' }`. Locks in the Electron (losing) shape on both legs.
- `src/main/stoa-runtime-client.test.ts:524-544` — asserts the `requires payload.parentId` error. Premise disappears if `parentId` moves to the top-level `sessionId`.
- `stoa-server/src/ws/runtime-bridge-handler.test.ts:232-251` — "auto-assigns session on successful runtime:create-child-session response". Sends `data: { childId: 'sess-child' }` and asserts `managedSessions.has('sess-child')`. This passes only because the test reuses the same id for parent (`sess-child`) and child; it does **not** verify that the *child id returned in the response* gets assigned (see §5).
- **No test file exists for `LiveRuntimeBridgeClient`** (`stoa-server/src/services/runtime-bridge-client.test.ts` is absent — confirmed via glob). The payload-shaping and response-unpacking logic in `runtime-bridge-client.ts` is currently untested.

---

## 5. `runtime:get-terminal-replay` — response shape mismatch

- Electron returns `{ data: replay }` (`src/main/stoa-runtime-client.ts:320-323`).
- SR unpacks (`stoa-server/src/services/runtime-bridge-client.ts:60-68`):
  ```ts
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const candidate = (result as { text?: unknown }).text
    if (typeof candidate === 'string') return candidate
  }
  return ''        // ← falls through; replay silently lost
  ```

`{ data }` matches neither branch → SR always returns `''`. Covered by `src/main/stoa-runtime-client.test.ts:462-484` (asserts `data: { data: 'replay-buffer-data' }`).

---

## 6. `runtime:launch` — payload fields partially dropped

- SR sends `{ command, cwd, cols, rows, env }` (`stoa-server/src/services/runtime-bridge-client.ts:34-42`).
- Electron reads **only** `payload.cols` and `payload.rows` (`src/main/stoa-runtime-client.ts:273-283`); `command`, `cwd`, `env` are ignored.

This is likely *partially* intentional — Electron's `launchSession` dep (`src/main/index.ts:1468-1472`) resolves the command/cwd/env from the session record via `launchSessionRuntimeWithGuard`, so the server-supplied values are redundant for the current single-provider topology. But the wire contract still leaks fields the receiver discards, which matters if the repair wants SR to be authoritative over launch params. Flagged for the plan, not necessarily a bug.

Covered by `src/main/stoa-runtime-client.test.ts:244-275` (only asserts `cols`/`rows` forwarding).

---

## 7. Benign one-way payload ignores (no action required, noted for completeness)

- `runtime:kill`: SR sends `{ killedAt }` (`runtime-bridge-client.ts:45`); Electron ignores payload, just calls `ptyHost.killAndWait` (`stoa-runtime-client.ts:293-296`).
- `runtime:interrupt`: SR sends `{ interruptedAt }` (`runtime-bridge-client.ts:57`); Electron ignores payload, writes ETX (`stoa-runtime-client.ts:315-318`).

---

## 8. Provider-assignment gap for child sessions

`RuntimeBridgeHandler.handleResponse` auto-registers the touched session on success (`stoa-server/src/ws/runtime-bridge-handler.ts:444-449`):
```ts
if (
  pending.command.type === 'runtime:launch'
  || pending.command.type === 'runtime:create-child-session'
) {
  provider.managedSessions.add(pending.command.sessionId)   // ← the PARENT id
}
```

For `runtime:create-child-session`, `pending.command.sessionId` is the **parent** (the command was dispatched with `parentId` as `sessionId`, see §4a). The newly-created **child** id is only present in the response data and is **never assigned** to `provider.managedSessions`.

Consequence: after a (hypothetically successful) child-session creation, any subsequent `runtime:input` / `runtime:resize` / `runtime:kill` targeting the child hits `getProviderForSession(childId) === null` → `RuntimeBridgeError('no_provider')` (`runtime-bridge-handler.ts:249-256`). Electron does track the child locally (`activeSessions.add(sessionId)` at `stoa-runtime-client.ts:342`) but the server-side routing table never learns it.

The existing test `runtime-bridge-handler.test.ts:232-251` does **not** catch this because it sets parent id == child id (`sess-child`). A regression test that uses a distinct child id (e.g. `data: { childId: 'real-child' }` with parent `sess-parent`) and then asserts `getProviderForSession('real-child')` would fail against current code.

`assignSession` is a public method (`runtime-bridge-handler.ts:381-385`) — the caller that issues `createChildSession` (or the response handler) could assign the returned child id, but nothing currently does.

---

## 9. Tests that will need to change (consolidated)

| File | Lines | What it locks in | Affected by |
|---|---|---|---|
| `src/main/stoa-runtime-client.test.ts` | 486-522 | create-child payload `{parentId,type,title,initialCols,initialRows}` + resp `{sessionId}` | §4a, §4b |
| `src/main/stoa-runtime-client.test.ts` | 524-544 | error when `payload.parentId` missing | §4a |
| `src/main/stoa-runtime-client.test.ts` | 462-484 | replay resp `data: { data }` | §5 |
| `src/main/stoa-runtime-client.test.ts` | 605-619 | terminal-data frame `{type,payload:{sessionId,data}}` | §3 |
| `src/main/stoa-runtime-client.test.ts` | 269-274 (and every `runtime:response` assertion) | response frame `{type:'runtime:response',payload:{…}}` | §3 |
| `src/main/stoa-runtime-client.test.ts` | 244-275 | launch only forwards `cols`/`rows` | §6 |
| `src/main/stoa-runtime-client.ts` | 67-76 | `RuntimeClientDeps.createChildSession` payload shape | §4a |
| `stoa-server/src/ws/runtime-bridge-handler.test.ts` | 232-251 | parent id re-added as "child"; does not assert child assignment | §4c, §8 |
| `stoa-server/src/ws/role-router.test.ts` | 232-258 | flat provider response frame | §3 (only if envelope moves server-side) |
| **NEW** `stoa-server/src/services/runtime-bridge-client.test.ts` | — | does not exist; `LiveRuntimeBridgeClient` payload shaping + response unpacking untested | §4, §5, §6 |

Server-side flat-frame tests (`runtime-bridge-handler.test.ts:489-682`, `role-router.test.ts:232-258`) stay valid **if** the repair flattens Electron's outbound frames. They would need envelope variants **if** the repair instead makes SR unwrap `payload`.

---

## 10. Contract surfaces the repair will touch

- `src/main/stoa-runtime-client.ts:67-76` — `RuntimeClientDeps.createChildSession` payload type.
- `src/main/stoa-runtime-client.ts:325-344` — `handleCreateChildSession` field reads + return shape.
- `src/main/stoa-runtime-client.ts:320-323` — `handleGetTerminalReplay` return shape.
- `src/main/stoa-runtime-client.ts:361-377` — outbound `forwardTerminalData` / `sendResponse` envelope.
- `src/main/index.ts:1473-1495` — `createChildSession` wiring consuming `payload.parentId` etc.
- `stoa-server/src/services/runtime-bridge-client.ts:34-87` — `launch`/`createChildSession`/`getTerminalReplay` payload + response unpacking.
- `stoa-server/src/routes/runtime-bridge.ts:27-39` — `LaunchOptions` / `ChildSessionOptions` (if child-session needs more fields).
- `stoa-server/src/ws/runtime-bridge-handler.ts:444-449` — auto-assign gate (child-session branch).
- `stoa-server/src/ws/runtime-bridge-handler.ts:338-360` — inbound frame parsing (only if envelope moves server-side).

---

## Context Handoff

Saved report path:

```
D:\Data\DEV\ultra_simple_panel\research\2026-06-14-sr-runtime-bridge-protocol-repair-context.md
```
