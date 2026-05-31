---
date: 2026-05-29
topic: Task 5 App.vue / preload bridge / App.test.ts cutover context
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Task 5 App.vue + Preload Bridge + App.test.ts Cutover

### Why This Was Gathered

Task 5 of the unified session tree plan replaces the flat `SessionSummaryEvent` subscription in the preload/App.vue bridge with `SessionGraphEvent`, and adds no-active-steal behavior for background child sessions. This report traces the exact code paths that must change and identifies the existing App.test.ts tests that will break (RED-first).

### Summary

The current flow is: main process broadcasts `{ session: SessionSummary }` on `session:event` IPC channel → preload's `onSessionEvent` relays it → `App.vue` subscribes in `onMounted` and calls `workspaceStore.updateSession()`. The cutover replaces `SessionSummaryEvent` with `SessionGraphEvent` (which wraps `SessionNodeSnapshot` containing both `session` and `tree` metadata) across all three files, plus adds new subscription methods for graph events. No new IPC channel has been created yet for graph events.

### Key Findings

#### 1. Current Bootstrap / Subscription Flow

**Preload bridge (`src/preload/index.ts`):**
- `onSessionEvent` (line 183-187): typed as `(callback: (event: SessionSummaryEvent) => void) => () => void`, listens on `IPC_CHANNELS.sessionEvent` (`session:event`)
- `SessionSummaryEvent` imported from `@shared/project-session` (line 12)
- No `onSessionGraphEvent` method exists yet

**App.vue (`src/renderer/app/App.vue`):**
- Imports nothing related to `SessionSummaryEvent` or `SessionGraphEvent` directly — it receives the typed callback through `window.stoa`
- Subscribes in `onMounted` (line 224-226): `unsubscribeSessionEvents = window.stoa.onSessionEvent((event) => { workspaceStore.updateSession(event.session.id, event.session) })`
- Cleanup in `onBeforeUnmount` (line 269): `unsubscribeSessionEvents?.()`
- Variable declared at line 157: `let unsubscribeSessionEvents: (() => void) | null = null`

**Main process broadcast (`src/main/session-runtime-controller.ts:150`):**
- `win.webContents.send(IPC_CHANNELS.sessionEvent, { session })` — sends `SessionSummaryEvent` shape

**Replacement path:** `SessionSummaryEvent` → `SessionGraphEvent` across:
1. Preload import type (line 12) and `onSessionEvent` callback type (line 183)
2. App.vue handler body (line 224-226): extract `event.node.session` and also handle tree metadata
3. RendererApi interface in `src/shared/project-session.ts:374` — change callback param type
4. Main process sender shape in `session-runtime-controller.ts:150`

#### 2. Existing App.test.ts Tests That Must Go RED

These existing tests directly test `onSessionEvent` subscription and will fail when the type/shape changes:

| Test | Lines | Why it breaks |
|------|-------|---------------|
| `on mount subscribes to pushed session events` | 358-366 | Tests that `onSessionEvent` is called — the method name itself may change to `onSessionGraphEvent` |
| `applies pushed session events to the workspace store` | 521-548 | Pushes `{ session: SessionSummary }` shape to listener — must change to `SessionGraphEvent` shape with `kind`, `graphVersion`, `origin`, `node` |
| `unsubscribes observability listeners on unmount` | 1137-1172 | Indirectly — if `onSessionEvent` becomes `onSessionGraphEvent`, mock setup must follow |
| Cleanup tests that verify `unsubscribeSessionEvents` | 1062-1072, 1109-1121 | Must verify cleanup of the new graph event listener instead |

**Mock setup in `setupStoa()` (lines 158-242):**
- `onSessionEvent: vi.fn().mockReturnValue(() => {})` at line 185 — must be renamed/replaced with `onSessionGraphEvent`

#### 3. Minimal RED-First Test Cases to Add

Per the plan (Task 5 Step 1), these tests should be written before implementation:

**a) Graph event subscription replaces session event subscription:**
```ts
it('on mount subscribes to pushed session graph events', async () => {
  const onSessionGraphEvent = vi.fn().mockReturnValue(() => {})
  setupStoa({ onSessionGraphEvent })
  wrapper = await mountApp(pinia)
  await flush()
  expect(onSessionGraphEvent).toHaveBeenCalledOnce()
})
```

**b) Applies graph event node to workspace store:**
```ts
it('applies pushed session graph events to the workspace store', async () => {
  let listener: ((event: SessionGraphEvent) => void) | undefined
  // setup with hydrated state containing session s1
  setupStoa({
    onSessionGraphEvent: vi.fn().mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
  })
  wrapper = await mountApp(pinia)
  await flush()
  listener?.({
    kind: 'updated',
    graphVersion: 2,
    origin: 'session',
    initiatorSessionId: null,
    node: { session: createSessionSummary({ id: 's1', title: 'Updated' }), tree: { rootSessionId: 's1', depth: 0, childCount: 0, descendantCount: 0 } }
  })
  await flush()
  expect(useWorkspaceStore(pinia).sessions[0].title).toBe('Updated')
})
```

**c) No-active-steal on background child created:**
```ts
it('does not steal active session when a background child is created', async () => {
  let listener: ((event: SessionGraphEvent) => void) | undefined
  // setup with active session s1
  setupStoa({
    getBootstrapState: vi.fn().mockResolvedValue(hydratedState),
    onSessionGraphEvent: vi.fn().mockImplementation((cb) => {
      listener = cb
      return () => {}
    })
  })
  wrapper = await mountApp(pinia)
  await flush()
  const originalActive = useWorkspaceStore(pinia).activeSessionId
  listener?.({
    kind: 'created',
    graphVersion: 3,
    origin: 'session',
    initiatorSessionId: 's1',
    node: { session: createSessionSummary({ id: 's2', projectId: 'p1', title: 'Child' }), tree: { rootSessionId: 's1', depth: 1, childCount: 0, descendantCount: 0 } }
  })
  await flush()
  expect(useWorkspaceStore(pinia).activeSessionId).toBe(originalActive)
})
```

**d) Unsubscribe on unmount for graph events:**
```ts
it('unsubscribes session graph event listeners on unmount', async () => {
  const unsubscribeGraphEvent = vi.fn()
  setupStoa({ onSessionGraphEvent: vi.fn().mockReturnValue(unsubscribeGraphEvent) })
  wrapper = await mountApp(pinia)
  await flush()
  wrapper.unmount()
  wrapper = undefined
  expect(unsubscribeGraphEvent).toHaveBeenCalledOnce()
})
```

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `onSessionEvent` typed as `SessionSummaryEvent` | `src/preload/index.ts` | :183-187 |
| `SessionSummaryEvent` shape `{ session: SessionSummary }` | `src/shared/project-session.ts` | :299-301 |
| `SessionGraphEvent` shape defined | `src/shared/project-session.ts` | :315-321 |
| `SessionNodeSnapshot` contains `session` + `tree` | `src/shared/project-session.ts` | :310-313 |
| `SessionTreeMeta` fields | `src/shared/project-session.ts` | :303-308 |
| `RendererApi.onSessionEvent` signature | `src/shared/project-session.ts` | :374 |
| App.vue subscribes via `window.stoa.onSessionEvent` | `src/renderer/app/App.vue` | :224-226 |
| App.vue cleanup `unsubscribeSessionEvents` | `src/renderer/app/App.vue` | :269 |
| Main process sends `{ session }` on `sessionEvent` channel | `src/main/session-runtime-controller.ts` | :150 |
| IPC channel `sessionEvent` = `'session:event'` | `src/core/ipc-channels.ts` | :31 |
| No `sessionGraph` IPC channel exists yet | `src/core/ipc-channels.ts` | grep: no match |
| Test `on mount subscribes to pushed session events` | `src/renderer/app/App.test.ts` | :358-366 |
| Test `applies pushed session events to the workspace store` | `src/renderer/app/App.test.ts` | :521-548 |
| `setupStoa` mock for `onSessionEvent` | `src/renderer/app/App.test.ts` | :185 |
| `workspaceStore.updateSession(id, patch)` does `Object.assign` | `src/renderer/stores/workspaces.ts` | :270-274 |
| Plan Task 5 Step 1 spec for tests | `docs/superpowers/plans/...implementation.md` | :321-338 |

### Risks / Unknowns

- [!] `RendererApi` is used by `setupStoa()` mock and preload both — changing the interface type will require updating the mock's type signature. The mock in App.test.ts uses `Partial<typeof window.stoa>` spread, so adding new methods is safe, but renaming `onSessionEvent` to `onSessionGraphEvent` will break existing mock consumers silently if old tests aren't updated.
- [!] The main process `session-runtime-controller.ts:150` still sends `SessionSummaryEvent` shape. Task 4 (control plane) may or may not have changed this already. The implementation agent must verify the main process sender before wiring the renderer side.
- [?] Whether a new IPC channel `sessionGraphEvent` will be created or the existing `sessionEvent` channel will be reused with a new payload shape. The plan says "preload bridge updates for node snapshots and graph events" — this could be either approach.
- [?] The `onSessionEvent` mock in `setupStoa()` (App.test.ts:185) is used by cleanup tests that reference `unsubscribeSessionEvents` — those tests verify the cleanup variable exists and is called, but they don't directly assert on `onSessionEvent` mock. They should still pass if the variable is renamed to `unsubscribeSessionGraphEvents`.
