---
date: 2026-05-29
topic: Task 5 renderer sync gaps — spec vs frontend bootstrap/event/store behavior for background-created child sessions
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Task 5 Renderer Sync Gaps

### Why This Was Gathered

Task 5 of the unified session tree plan requires background-created child sessions (via `stoa-ctl session create` or `SessionControlServer.createChildSession`) to appear in the renderer's session tree without a manual `createSession` flow from the UI. This audit traces the full data path — spec → preload → App.vue → store — to identify exact gaps.

### Summary

The spec defines `SessionGraphEvent` as the push envelope for session tree mutations, but the current preload bridge only exposes `onSessionEvent` carrying `SessionSummaryEvent`. The store's `updateSession` silently drops events for unknown session IDs. The `projectHierarchy` computed is a flat filter with no parent-child nesting. Together, these three gaps completely block background-created child sessions from appearing in the renderer.

### Key Findings

#### Gap 1: No `SessionGraphEvent` IPC channel or preload bridge method

The spec defines `SessionGraphEvent` (`src/shared/project-session.ts:315-321`) with fields `kind`, `graphVersion`, `origin`, `initiatorSessionId`, `node: SessionNodeSnapshot`. Neither `IPC_CHANNELS` nor `preload/index.ts` expose this event type. The existing `sessionEvent` channel carries `SessionSummaryEvent { session: SessionSummary }` — a structurally incompatible shape.

| Aspect | Spec expects | Current state |
|--------|-------------|---------------|
| Event type | `SessionGraphEvent` | `SessionSummaryEvent` |
| Payload shape | `{ kind, node: SessionNodeSnapshot }` | `{ session: SessionSummary }` |
| IPC channel | `sessionGraphEvent` (new) | `sessionEvent` (existing) |
| Preload method | `onSessionGraphEvent` | `onSessionEvent` |

#### Gap 2: Store `updateSession` drops unknown session IDs

`workspaces.ts:270-275` — `updateSession` finds an existing session and patches it. If no match, it returns silently. Background-created children are not in `sessions.value` at push time, so the event is lost.

```ts
function updateSession(sessionId: string, patch: Partial<SessionSummary>): void {
  const session = sessions.value.find((s) => s.id === sessionId)
  if (!session) return  // ← child session silently dropped
  Object.assign(session, patch)
}
```

No `upsertSession` or `applySessionGraphEvent` method exists. The plan's Task 5 Step 3 calls for `store.upsertSession and recursive tree projection`.

#### Gap 3: `projectHierarchy` is flat — no parent-child nesting

`workspaces.ts:64-87` — `projectHierarchy` computed maps projects to a flat filtered array of sessions. There is no `children` field, no tree recursion based on `parentSessionId`, and no grouping by lineage.

The `ProjectHierarchyNode` interface (`workspaces.ts:11-15`) defines:
```ts
sessions: Array<SessionSummary & { active: boolean }>
```

Task 5 requires this to become a recursive structure where sessions have `children: SessionHierarchyNode[]`. The plan's Step 1 test expects:
```ts
store.projectHierarchy[0].sessions[0].children[0].session.id
```

#### Gap 4: Backend does not emit graph events on child creation

`session-runtime-controller.ts:150` sends `IPC_CHANNELS.sessionEvent` with `{ session }` on state patch. `session-control-server.ts:224` calls `supervisor.createChildSession` which delegates to `deps.createChildSession`. Neither path emits a `SessionGraphEvent` with `kind: 'created'` to the renderer window.

The control server successfully creates the child in the backend persistence layer, but the renderer is never notified.

#### Gap 5: No active/focus guard for background children

The plan specifies that background child creation must not steal the active session. Currently, no code path exists that could steal focus (because the event is silently dropped). But once upsert is implemented, `applySessionGraphEvent` must check `event.kind === 'created'` and skip `setActiveSession` — only the renderer-initiated `handleSessionCreate` (App.vue:69-86) should auto-activate.

#### Gap 6: Meta-session bridge still wired in preload and App.vue

Preload exposes `getMetaSessionBootstrapState`, `createMetaSession`, `onMetaSessionEvent`, etc. (preload/index.ts:108-191). App.vue bootstraps `metaSessionStore` (App.vue:240). Task 5 requires removing all meta-session surface wiring. The `RendererApi` type still marks these methods as optional (`src/shared/project-session.ts:411-422`).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionGraphEvent` defined with kind/node/origin | `src/shared/project-session.ts` | :303-321 |
| `SessionNodeSnapshot` has session + tree meta | `src/shared/project-session.ts` | :310-313 |
| `SessionSummaryEvent` is `{ session: SessionSummary }` | `src/shared/project-session.ts` | :299-301 |
| Preload `onSessionEvent` maps to `sessionEvent` channel | `src/preload/index.ts` | :183-187 |
| No `onSessionGraphEvent` in preload | `src/preload/index.ts` | (entire file) |
| App.vue subscribes `onSessionEvent` → `updateSession` | `src/renderer/app/App.vue` | :224-226 |
| `updateSession` drops unknown session IDs | `src/renderer/stores/workspaces.ts` | :270-275 |
| `projectHierarchy` is flat per-project filter | `src/renderer/stores/workspaces.ts` | :64-87 |
| `ProjectHierarchyNode` has no `children` field | `src/renderer/stores/workspaces.ts` | :11-15 |
| `addSession` only called from App.vue `handleSessionCreate` | `src/renderer/app/App.vue` | :69-86, store :265-268 |
| Runtime controller sends `SessionSummaryEvent` on patch | `src/main/session-runtime-controller.ts` | :150 |
| Control server `createChildSession` has no renderer push | `src/core/session-control-server.ts` | :224 |
| `IPC_CHANNELS` has no `sessionGraphEvent` channel | `src/core/ipc-channels.ts` | (entire file) |
| Meta-session methods still in preload + RendererApi | `src/preload/index.ts` | :108-191 |
| App.vue bootstraps `metaSessionStore` | `src/renderer/app/App.vue` | :240 |
| Plan Task 5 Step 3 specifies upsert + recursive projection | Plan document | :347-352 |

### Risks / Unknowns

- [!] **Gap ordering matters.** The backend must emit `SessionGraphEvent` before the store can upsert. If the control server's `createChildSession` doesn't trigger a graph event push, fixing only the store is insufficient.
- [!] **`SessionSummary` already has `parentSessionId` and `createdBySessionId`** (project-session.ts:125-126), meaning Tasks 1-2 have landed the lineage fields. The renderer gap is purely in the event bridge, store upsert, and hierarchy projection.
- [?] **Bootstrap state gap.** If the app restarts while background children exist, `getBootstrapState` must return the full tree. Current `BootstrapState` (project-session.ts:269-275) returns `SessionSummary[]` which already carries lineage fields — this path likely works after restart. The gap is only in live push.
- [?] **Observability backfill.** `hydrateObservability` (workspaces.ts:101-146) fetches presence per session. If upsert adds new sessions, the observability subscription won't cover them unless `hydrateObservability` is re-run or upsert triggers presence backfill for the new session.

### Minimal File-Local Modification Suggestions

These are suggestions only — no implementation.

#### 1. `src/core/ipc-channels.ts` — Add graph event channel
Add `sessionGraphEvent: 'session:graph-event'` to `IPC_CHANNELS`.

#### 2. `src/preload/index.ts` — Add `onSessionGraphEvent` bridge method
Add an `onSessionGraphEvent` listener mapping to the new channel, typed to `SessionGraphEvent`. Wire into `RendererApi`.

#### 3. `src/renderer/stores/workspaces.ts` — Add upsert + tree projection
- Add `applySessionGraphEvent(event: SessionGraphEvent)` method:
  - `kind === 'created'`: push `event.node.session` into `sessions.value` if not present; skip `setActiveSession`.
  - `kind === 'updated'`: upsert the session.
  - `kind === 'archived'`/`'restored'`/`'destroyed'`: delegate to existing archive/restore/remove logic.
- Change `ProjectHierarchyNode.sessions` to a recursive `SessionTreeNode[]` where each node has `{ session, active, children }`.
- Rewrite `projectHierarchy` computed to group by `parentSessionId`.

#### 4. `src/renderer/app/App.vue` — Subscribe to graph events
Add `unsubscribeSessionGraphEvents` alongside `unsubscribeSessionEvents`. In `onMounted`, subscribe `window.stoa.onSessionGraphEvent` → `workspaceStore.applySessionGraphEvent(event)`. Remove meta-session bootstrap (`metaSessionStore.bootstrapFromBridge`) and related unsubscribe.

#### 5. Backend emit — `session-runtime-controller.ts` or `project-session-manager.ts`
After `createChildSession` succeeds, emit `IPC_CHANNELS.sessionGraphEvent` with `{ kind: 'created', node, ... }` to the renderer window. This likely needs to happen at the manager layer since the control server doesn't have window access.

#### 6. Cleanup — Remove meta-session surface
In App.vue, drop `metaSessionStore` import, bootstrap, and unsubscribe. In preload, mark meta-session methods for removal or keep as no-ops during transition.
