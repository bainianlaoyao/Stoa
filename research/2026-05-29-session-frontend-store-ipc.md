---
date: 2026-05-29
topic: Pinia store + preload/main IPC hydration and refresh flow for workspaces/projects/sessions
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Frontend Store IPC Hydration and Refresh Flow

### Why This Was Gathered
Bounded trace of how workspaces/projects/sessions data flows from main process to renderer Pinia stores during bootstrap, on subsequent mutations, and via push-based live updates.

### Summary
The renderer bootstraps by calling `window.stoa.getBootstrapState()` (IPC invoke → main → `ProjectSessionManager.snapshot()`), populating `useWorkspaceStore` via `hydrate()`. Live updates arrive via `onSessionEvent` push channels wired in `App.vue` onMounted. Observability (presence, project health, app health) follows a separate but parallel subscribe/pull pattern.

### Key Findings

**Bootstrap — one-shot hydration**

1. `App.vue onMounted` (line 228) calls `window.stoa.getBootstrapState()`.
2. Preload translates this to `ipcRenderer.invoke(IPC_CHANNELS.projectBootstrap)` (`src/preload/index.ts:61`).
3. Main process handler (line 1251) returns `projectSessionManager.snapshot()` — the canonical source of truth: `{ activeProjectId, activeSessionId, projects[], sessions[], terminalWebhookPort }` (`src/shared/project-session.ts:265–271`).
4. `useWorkspaceStore.hydrate()` (line 89) writes `projects`, `sessions`, `activeProjectId`, `activeSessionId`, `terminalWebhookPort` into reactive refs.
5. `hydrateObservability()` (line 101) immediately subscribes push listeners and issues parallel `getSessionPresence` + `getProjectObservability` + `getAppObservability` IPC invocations for each existing project/session to backfill observability state before any events arrive.

**Live session updates — push channel**

6. `App.vue onMounted` (line 224) subscribes via `window.stoa.onSessionEvent(callback)`.
7. Preload wraps this as `ipcRenderer.on(IPC_CHANNELS.sessionEvent, handler)` returning a cleanup function (`src/preload/index.ts:183–186`).
8. `SessionRuntimeController.pushSessionEvent()` (line 124) is called inside every state-mutation path (`markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited`, `markRuntimeFailedToStart`, `applyProviderStatePatch`, `markAgentTurnInterrupted`, `setActiveSession`) — all triggered after `manager.applySessionStatePatch()` or equivalent. It sends the full updated `SessionSummary` object via `IPC_CHANNELS.sessionEvent`.
9. `App.vue` handler `workspaceStore.updateSession(event.session.id, event.session)` (line 225) patches the in-memory session record.

**Observability push — parallel channel**

10. `SessionRuntimeController.pushObservabilitySnapshots()` (line 138) is called in the same `finishSessionStateChange()` path as `pushSessionEvent()`. It calls three IPC send channels:
    - `IPC_CHANNELS.observabilitySessionPresenceChanged` (line 154)
    - `IPC_CHANNELS.observabilityProjectChanged` (line 162)
    - `IPC_CHANNELS.observabilityAppChanged` (line 165)
11. `useWorkspaceStore.subscribeToObservability()` (line 148) registers listeners for all three channels in `onMounted`. Each handler calls the corresponding `apply*Snapshot` method.

**Staleness guard**

12. All three `apply*Snapshot` methods check `isStaleSnapshot()` (`src/renderer/stores/workspaces.ts:22–28`) before writing — rejects updates where `sourceSequence` is not strictly greater or `updatedAt` is not strictly later.
13. Backend-driven presence snapshots are marked with `backendSessionPresenceIds.add(sessionId)` on first write, preventing store-initiated presence updates (from `syncSessionPresenceFromSummary`) from overwriting authoritative backend presence.

**Refresh triggers**

14. No polling exists for project/session data. Refresh is exclusively push-based via the channels above.
15. For settings and sidebar, `App.vue` issues `Promise.all([settingsStore.loadSettings(), updateStore.refresh(), sidebarStore.hydrate()])` in `onMounted` after workspace bootstrap (line 248–252).

**Renderer actions calling IPC**

| Action | Preload method | IPC channel | Main handler |
|---|---|---|---|
| Set active project | `setActiveProject` | `project:set-active` | `src/main/index.ts:1325` |
| Set active session | `setActiveSession` | `session:set-active` | `src/main/index.ts:1334` |
| Create project | `createProject` | `project:create` | `src/main/index.ts:1261` |
| Create session | `createSession` | `session:create` | `src/main/index.ts:1295` |
| Archive session | `archiveSession` | `session:archive` | `src/main/index.ts:1484` |
| Restore session | `restoreSession` | `session:restore` | `src/main/index.ts:1492` |
| Restart session | `restartSession` | `session:restart` | `src/main/index.ts:1504` |
| Delete project | `deleteProject` | `project:delete` | `src/main/index.ts:1265` |
| Regenerate title | `regenerateSessionTitle` | `session:regenerate-title` | `src/main/index.ts:1488` |
| Open workspace | `openWorkspace` | `workspace:open` | `src/main/index.ts:1304` |

**Meta-session hydration (separate store)**

16. `useMetaSessionStore.bootstrapFromBridge()` (line 136) fetches `getMetaSessionBootstrapState()` and `listMetaSessionProposals()` on mount, subscribes `onMetaSessionEvent` push channel. This is independent of `useWorkspaceStore`.

**Bootstrap recovery**

17. After creating the main window (line 1713), main calls `projectSessionManager.buildBootstrapRecoveryPlan()` (line 1731) — re-launches any sessions that were running at shutdown — and `metaSessionManager.buildBootstrapRecoveryPlan()` (line 1735). Each plan triggers `launchSessionRuntimeWithGuard` asynchronously.

**Terminal data (separate channel)**

18. Terminal replay data flows through `IPC_CHANNELS.terminalData` (push from main, batched every 16 ms via `SessionRuntimeController`) to the renderer via `window.stoa.onTerminalData()` (`src/preload/index.ts:168–171`).

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Bootstrap calls `stoa.getBootstrapState()` | `src/renderer/app/App.vue` | line 228 |
| Preload forwards `projectBootstrap` invoke | `src/preload/index.ts` | line 61 |
| Main returns `manager.snapshot()` | `src/main/index.ts` | line 1251–1258 |
| `BootstrapState` shape | `src/shared/project-session.ts` | line 265–271 |
| `useWorkspaceStore.hydrate()` writes refs | `src/renderer/stores/workspaces.ts` | line 89–98 |
| `hydrateObservability()` subscribes + pulls | `src/renderer/stores/workspaces.ts` | line 101–146 |
| `subscribeToObservability()` registers push listeners | `src/renderer/stores/workspaces.ts` | line 148–162 |
| `onSessionEvent` wrapped in preload | `src/preload/index.ts` | line 183–186 |
| `pushSessionEvent()` called from all mutation paths | `src/main/session-runtime-controller.ts` | line 124–136 |
| All state mutations call `finishSessionStateChange()` | `src/main/session-runtime-controller.ts` | line 118–122 |
| `pushObservabilitySnapshots()` sends three channels | `src/main/session-runtime-controller.ts` | line 138–166 |
| Three observability push channels in preload | `src/preload/index.ts` | line 208–221 |
| `isStaleSnapshot()` guard rejects non-advancing updates | `src/renderer/stores/workspaces.ts` | line 22–28 |
| `backendSessionPresenceIds` prevents store-overwrite | `src/renderer/stores/workspaces.ts` | line 43, 166–170, 278–280 |
| Settings/sidebar hydrate after workspace bootstrap | `src/renderer/app/App.vue` | line 248–252 |
| Meta-session bootstrap is separate store | `src/renderer/stores/meta-session.ts` | line 136–152 |
| Bootstrap recovery plan re-launches sessions | `src/main/index.ts` | line 1731–1737 |
| Terminal data push channel | `src/preload/index.ts` | line 168–171 |
| Terminal batching 16 ms interval | `src/main/session-runtime-controller.ts` | line 25, 85–94 |
| IPC channel constants | `src/core/ipc-channels.ts` | lines 1–95 |
| `RendererApi` interface | `src/shared/project-session.ts` | line 330–425 |

### Risks / Unknowns

- [!] **No active session refresh on `setActiveProject`/`setActiveSession` failure**: main handlers (lines 1325, 1334) fire-and-forget — if the IPC call fails, the store has already mutated optimistically, creating a split-brain window.
- [!] **`hydrateObservability()` backfill on every mount**: every component that mounts triggers a `getSessionPresence` + `getProjectObservability` for every session/project. On a large session list, this generates N+3 IPC invocations. No dedup or debounce.
- [?] **No teardown of `hydrateObservability()` subscription**: `subscribeToObservability()` stores cleanup functions but they are not called when `hydrateObservability()` is called again (only `unsubscribeObservability()` is exposed). If `hydrateObservability()` is called twice, listeners will stack.
- [?] **Session summary push does not include observability**: `pushSessionEvent` sends the full `SessionSummary` but NOT the `SessionPresenceSnapshot`. Components consuming presence data rely on the parallel observability push channel, which may arrive in different order relative to the session summary update.
- [?] **No explicit polling or reconnect logic** for observability channels. If a push channel is dropped (unlikely in Electron but possible across window reloads), the store state becomes stale until the next state-mutation event fires.

## Context Handoff: Frontend Store IPC Hydration

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-05-29-session-frontend-store-ipc.md`

Context only. Use the saved report as the source of truth.