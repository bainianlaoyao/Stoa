---
date: 2026-05-29
topic: unified-session-tree Task 5 renderer sync — main-process IPC/event emission path for background child sessions
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Task 5 Renderer Sync — Main-Process IPC Push Gaps for Background Child Sessions

### Why This Was Gathered

Task 5 requires the renderer to see background-created child sessions (created by provider agents via `stoa-ctl session create`, not by user IPC). This audit traces the main-process IPC/event emission path to identify exactly where such sessions become visible (or invisible) to the renderer.

### Summary

Background child sessions created via the HTTP control server are **invisible to the renderer until their first runtime state change** — and even then, the renderer's `updateSession` silently drops them because they were never `addSession`'d. The new `session-control-server.ts` (Task 4) is not wired into `main/index.ts` at all. No `SessionGraphEvent` IPC channel exists. The gap chain is: no creation event → no upsert in store → child sessions never appear in the UI.

---

### Key Findings

#### Finding 1 — `createWorkSessionWithRuntime` does not push `sessionEvent`

When a session is created via `createWorkSessionWithRuntime` (`src/main/index.ts:1060-1070`), it calls:
1. `projectSessionManager.createSession(payload)` — persists the session
2. `syncObservabilityAndPushForSession(session.id)` — pushes observability snapshots only
3. `launchSessionRuntimeWithGuard(...)` — launches PTY/runtime (async, fire-and-forget via `void`)

It does **NOT** push `IPC_CHANNELS.sessionEvent` with the new session. The `sessionEvent` is only pushed later when `SessionRuntimeController.finishSessionStateChange` fires (e.g., `markRuntimeStarting` inside `launchTrackedSessionRuntime`).

| Claim | Source | Location |
|-------|--------|----------|
| No `sessionEvent` push on creation | `src/main/index.ts` | lines 1060-1070, `createWorkSessionWithRuntime` |
| Observability pushed, not sessionEvent | `src/main/index.ts:1066` | `syncObservabilityAndPushForSession(session.id)` |
| sessionEvent pushed on state change only | `src/main/session-runtime-controller.ts:133-151` | `finishSessionStateChange` → `pushSessionEvent` |

**Impact**: For user-initiated sessions, the IPC response carries the session back to the renderer, which calls `addSession` directly (`src/renderer/app/App.vue:81`). For background child sessions, there is no renderer IPC caller — the HTTP response goes to the agent that issued `stoa-ctl session create`.

---

#### Finding 2 — New `session-control-server.ts` is not wired into `main/index.ts`

`src/main/index.ts` imports `createMetaSessionControlServer` (line 15) and wires it via the `configureServerApp` callback (lines 662-717). The new `createSessionControlServer` from `src/core/session-control-server.ts` is **never imported or referenced**.

| Claim | Source | Location |
|-------|--------|----------|
| No import of `createSessionControlServer` | `src/main/index.ts` | all imports (lines 1-53) |
| Old meta-session control server still wired | `src/main/index.ts:15` | `import { createMetaSessionControlServer }` |
| `createSessionControlServer` exists but unused | `src/core/session-control-server.ts:52` | exported function |

**Impact**: The `POST /ctl/session/create` route defined in `session-control-server.ts` (line 189) is not accessible. Even when wired, the `createChildSession` dependency must route to a main-process function that emits renderer-visible events.

---

#### Finding 3 — No `SessionGraphEvent` IPC channel exists

`SessionGraphEvent` is defined in `src/shared/project-session.ts:315` but:
- `IPC_CHANNELS` (`src/core/ipc-channels.ts`) has no `sessionGraphEvent` entry
- `RendererApi` has no `onSessionGraphEvent` method
- `src/preload/index.ts` has no subscription hook for graph events

| Claim | Source | Location |
|-------|--------|----------|
| `SessionGraphEvent` defined | `src/shared/project-session.ts:315` | interface |
| No `sessionGraphEvent` in `IPC_CHANNELS` | `src/core/ipc-channels.ts` | all channels (lines 1-95) |
| No `onSessionGraphEvent` in preload | `src/preload/index.ts` | all API (lines 58-349) |
| No `onSessionGraphEvent` in `RendererApi` | `src/shared/project-session.ts` | RendererApi interface |

**Impact**: Even if the main process emits a `SessionGraphEvent` with `kind='created'`, there is no channel to deliver it to the renderer.

---

#### Finding 4 — Store `updateSession` silently drops unknown sessions

The renderer's session event handler in `App.vue:224-226`:
```ts
unsubscribeSessionEvents = window.stoa.onSessionEvent((event) => {
  workspaceStore.updateSession(event.session.id, event.session)
})
```

The store's `updateSession` (`src/renderer/stores/workspaces.ts:270-275`):
```ts
function updateSession(sessionId: string, patch: Partial<SessionSummary>): void {
  const session = sessions.value.find((s) => s.id === sessionId)
  if (!session) return  // <-- SILENTLY DROPS
  Object.assign(session, patch)
}
```

| Claim | Source | Location |
|-------|--------|----------|
| `onSessionEvent` handler calls `updateSession` | `src/renderer/app/App.vue:224-226` | event subscription |
| `updateSession` drops unknown sessions | `src/renderer/stores/workspaces.ts:270-272` | early return |
| No `upsertSession` exists | `src/renderer/stores/workspaces.ts` | entire store |

**Impact**: When the runtime eventually pushes the first `sessionEvent` for a background-created child, the renderer drops it because the session was never inserted into `sessions.value`.

---

#### Finding 5 — Background child sessions would steal active session if upserted without guard

If `upsertSession` were added to the store without an active-session guard, and `createWorkSessionWithRuntime` were modified to push a session creation event, the current `setActiveSession` (`workspaces.ts:238-246`) has no guard against background sessions stealing focus.

The spec (Task 5 step 1) explicitly asserts: "background child create does not steal active session".

| Claim | Source | Location |
|-------|--------|----------|
| `setActiveSession` has no origin guard | `src/renderer/stores/workspaces.ts:238-246` | function |
| Spec requires no-steal behavior | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | Task 5 step 1 |

**Impact**: The creation event must carry metadata distinguishing user-initiated from background-initiated, and the store must only auto-select user-initiated sessions.

---

#### Finding 6 — `metaSessionControlServer.workSessionLifecycle.createSession` is the current background creation path

The existing wiring in `main/index.ts:696-710` passes `workSessionLifecycle.createSession` to the meta-session control server. This function calls `createWorkSessionWithRuntime` — the same function that lacks creation event emission. When the unified `session-control-server.ts` replaces the meta-session server, the same gap applies to its `deps.createChildSession` callback.

| Claim | Source | Location |
|-------|--------|----------|
| `workSessionLifecycle.createSession` calls `createWorkSessionWithRuntime` | `src/main/index.ts:701` | control server wiring |
| Same gap applies to unified server | `src/core/session-control-server.ts:224` | `deps.createChildSession(request)` |

---

### Evidence Chain

| # | Finding | Source | Location |
|---|---------|--------|----------|
| 1 | No `sessionEvent` push on creation | `src/main/index.ts` | lines 1060-1070 |
| 2 | Observability pushed but not sessionEvent | `src/main/index.ts:1066` | `syncObservabilityAndPushForSession` |
| 3 | `sessionEvent` pushed on runtime state change only | `src/main/session-runtime-controller.ts:133-151` | `finishSessionStateChange` |
| 4 | New control server not wired | `src/main/index.ts` | no import of `createSessionControlServer` |
| 5 | Old meta-session server still in use | `src/main/index.ts:15,662` | `createMetaSessionControlServer` |
| 6 | No `sessionGraphEvent` IPC channel | `src/core/ipc-channels.ts` | no entry |
| 7 | No `onSessionGraphEvent` in preload | `src/preload/index.ts` | no subscription |
| 8 | Store drops unknown sessions | `src/renderer/stores/workspaces.ts:271` | early return |
| 9 | No upsert in store | `src/renderer/stores/workspaces.ts` | entire store |
| 10 | `setActiveSession` has no origin guard | `src/renderer/stores/workspaces.ts:238-246` | function |

### Risks / Unknowns

- **[!] Critical timing gap**: Between session creation in the manager and the first `sessionEvent` push (which happens when runtime reaches `markRuntimeStarting`), the session exists in the backend but is invisible to the renderer. If runtime launch fails, the session never becomes visible at all.
- **[!] Double-gap for failed launches**: If `launchSessionRuntimeWithGuard` fails for a background child, `markRuntimeFailedToStart` fires, which pushes `sessionEvent` — but the renderer drops it (Finding 4). The failed session is permanently invisible.
- **[?] Whether to add a new `sessionGraphEvent` channel or repurpose `sessionEvent`**: The spec defines `SessionGraphEvent` as a distinct type, but adding a new IPC channel requires preload + RendererApi + config-guard updates. An alternative is to extend the existing `sessionEvent` envelope with a `kind` field to distinguish created/updated.
- **[?] Whether creation event should come from `createWorkSessionWithRuntime` or from a dedicated supervisor event bus**: The supervisor could own a `SessionGraphEventBus` that `createWorkSessionWithRuntime` publishes to, decoupling event emission from the creation function itself.

---

### Minimal File-Local Modification Suggestions (Not Implemented)

1. **`src/core/ipc-channels.ts`** — Add `sessionGraphEvent: 'session:graph-event'` channel.

2. **`src/main/index.ts`** — In `createWorkSessionWithRuntime`, after creating the session and before launching runtime, add:
   ```ts
   const win = mainWindow
   if (win && !win.isDestroyed()) {
     win.webContents.send(IPC_CHANNELS.sessionGraphEvent, {
       kind: 'created',
       session,
       parentSessionId: session.parentSessionId,
       createdBySessionId: session.createdBySessionId,
       occurredAt: new Date().toISOString()
     })
   }
   ```
   Also wire `createSessionControlServer` into the `configureServerApp` callback, replacing the meta-session control server.

3. **`src/shared/project-session.ts`** — Add `onSessionGraphEvent?: (callback: (event: SessionGraphEvent) => void) => () => void` to `RendererApi`.

4. **`src/preload/index.ts`** — Add the `onSessionGraphEvent` subscription hook.

5. **`src/renderer/stores/workspaces.ts`** — Add `upsertSession(session)` that does insert-or-update, and `applySessionGraphEvent(event)` that calls `upsertSession` but does NOT call `setActiveSession` for background-created children (check `event.kind === 'created'` and `event.createdBySessionId !== null`).

6. **`src/renderer/app/App.vue`** — Subscribe to `onSessionGraphEvent` in `onMounted`, call `workspaceStore.applySessionGraphEvent(event)`.

---

## Context Handoff: Task 5 renderer sync — main-process IPC push path

Start here: `research/2026-05-29-task5-renderer-sync-main-subagent.md`

Context only. Use the saved report as the source of truth.
