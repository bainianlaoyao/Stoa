---
date: 2026-06-14
topic: SR sessions routes lifecycle takeover — existing route behavior, runtimeBridge API, manager lifecycle methods, and test patterns
status: completed
mode: context-gathering
sources: 18
---

## Context Report: SR `/api/v1/sessions/*` lifecycle takeover

### Why This Was Gathered

Implementation work is expected to make the Stoa Server `/api/v1/sessions/*` route
group "take over" full session lifecycle (create → launch runtime; archive/restore;
delete/destroy with runtime kill) instead of the current split where persistence
lifecycle lives in `sessions.ts` but runtime lifecycle lives in the separate
`/ctl/*` control routes. This report nails down the exact current route behavior,
the injectable `runtimeBridge` shape, the `ProjectSessionManager` lifecycle methods,
and the test patterns the implementation must follow.

### Summary

`stoa-server/src/routes/sessions.ts` owns **persistence-only** session lifecycle
(create, setActive, archive, restore, title, restart/terminal/input/resize stubs).
It is injected `{ manager, runtimeBridge }` via `SessionsRouteDeps`
(`sessions.ts:32-35`). The `manager` (`ProjectSessionManager`) exposes
`createSession`, `archiveSession`, `restoreSession`, `deleteSessionRecord`, plus
runtime-state mutators. The `runtimeBridge` is typed by `RuntimeBridgeClient`
(`runtime-bridge.ts:17-25`) with `launch / kill / input / resize / interrupt /
getTerminalReplay / createChildSession`. Today **no DELETE session route exists**,
**create does not launch the runtime**, and **`kill`/`deleteSessionRecord` are
unwired to any HTTP route** — those are the three obvious takeover gaps. Tests use
Hono `app.request()` with `ProjectSessionManager.createForTest()` and either the
default `createStubRuntimeBridge()` (returns 503) or a custom `RuntimeBridgeClient`
mock via `vi.fn` (`api-routes.test.ts:71-108`, `control-routes.test.ts:98-130`).

---

### Key Findings

#### 1. Existing route inventory in `sessions.ts`

All routes mount under `/api/v1` (`app.ts:72`). Envelope helper: `envelope()`
returns `{ ok, data, meta: { requestId, timestamp, pagination? } }`
(`sessions.ts:40-50`). Two existence guards:
- `ensureSessionExists(state, sessionId)` → throws `AppError` code
  `session_not_found`, HTTP 404 (`sessions.ts:52-63`).
- `ensureProjectExists(state, projectId)` → throws `AppError` code `not_found`,
  HTTP 404 (`sessions.ts:65-75`).

| Method + Path | Behavior | Source |
|---|---|---|
| `GET /sessions` | If `?archive=archived` → paginated cursor slice of `manager.getArchivedSessions()`; else `manager.snapshot().sessions`. `limit` clamped 1–200, default 50. | `sessions.ts:81-110` |
| `POST /sessions` | Validates `projectId` (non-empty string, else 422) + `type` ∈ `{shell, opencode, codex, claude-code}` (else 422). Body non-JSON → 422. Calls `manager.createSession(request)`, returns 201. Manager throw → `AppError` code `conflict` HTTP 409. | `sessions.ts:112-161` |
| `PUT /sessions/:id/active` | Ensure exists → `manager.setActiveSession(id)` → `{ id, active: true }`. | `sessions.ts:163-169` |
| `PUT /sessions/:id/archive` | Ensure exists → `manager.archiveSession(id)` → `{ id, archived: true }`. | `sessions.ts:171-177` |
| `PUT /sessions/:id/restore` | Ensure exists → `manager.restoreSession(id)` → `{ id, restored: true }`. | `sessions.ts:179-185` |
| `POST /sessions/:id/restart` | Ensure exists → `runtimeBridge.launch(sessionId, {})` → `{ id, restarted: true }`. **Note: empty options object; does NOT pass cwd/cols/rows/env.** Only call site of `runtimeBridge.launch` in the entire `stoa-server`. | `sessions.ts:187-194` |
| `PUT /sessions/:id/title` | Ensure exists → `manager.updateSessionTitle(id, title, options?)`; returns updated session. `updated === null` → 404. | `sessions.ts:196-214` |
| `GET /sessions/:id/terminal-replay` | Ensure exists → `runtimeBridge.getTerminalReplay(id)` → `{ sessionId, replay }`. | `sessions.ts:216-223` |
| `POST /sessions/:id/input` | Validate `data` non-empty (422) → ensure exists → `runtimeBridge.input(id, data)` → `{ sessionId, sent: true }`. | `sessions.ts:225-242` |
| `POST /sessions/:id/resize` | Validate `cols>0 && rows>0` (422) → ensure exists → `runtimeBridge.resize(id, cols, rows)` → `{ sessionId, resized: true }`. | `sessions.ts:244-262` |
| `DELETE /projects/:id/sidecar` | Ensure project exists → throws 503 ("not available in Stoa Server mode"). | `sessions.ts:265-276` |
| `GET /sessions/:id/evidence` | Ensure exists → returns empty `[]` with empty pagination. | `sessions.ts:279-285` |
| `GET /sessions/:id/context/full` | Ensure exists → placeholder `{ sessionId, text:'', truncated:false, totalTurns:0, maxChars }`. | `sessions.ts:288-305` |
| `GET /sessions/:id/context/slim` | Same placeholder shape as `/context/full`. | `sessions.ts:307-322` |

**Gap confirmed by grep:** there is **no `DELETE /sessions/:id`** anywhere in
`stoa-server/src` (only DB `ON DELETE` cascade FK declarations and
`DELETE /projects/:id` in `projects.ts:114`). The `deleteSessionRecord` manager
method (`project-session-manager.ts:661-691`) is currently unreachable from HTTP.

#### 2. Injectable `runtimeBridge` shape (`RuntimeBridgeClient`)

```ts
// stoa-server/src/routes/runtime-bridge.ts:17-39
export interface RuntimeBridgeClient {
  launch(sessionId: string, options: LaunchOptions): Promise<void>
  kill(sessionId: string): Promise<void>
  input(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  interrupt(sessionId: string): Promise<void>
  getTerminalReplay(sessionId: string): Promise<string>
  createChildSession(parentId: string, options: ChildSessionOptions): Promise<string>
}
export interface LaunchOptions {
  command?: string; cwd?: string; cols?: number; rows?: number; env?: Record<string, string>
}
export interface ChildSessionOptions { type: string; command?: string; cwd?: string }
```

Three construction modes (`runtime-bridge.ts`):
- `createStubRuntimeBridge()` → every method throws `AppError` code
  `internal_error`, HTTP **503**, message "Runtime bridge not connected"
  (`runtime-bridge.ts:45-80`). This is the default in `api-routes.test.ts:78`.
- `createLiveRuntimeBridge(handler)` → wraps a `RuntimeBridgeHandler` via
  `LiveRuntimeBridgeClient` (`runtime-bridge.ts:91-93`,
  `runtime-bridge-client.ts:28-107`). Used in production wiring
  (`index.ts:96-97`).
- Tests can pass **any** object satisfying the interface (e.g. `vi.fn` stubs) —
  the dep is structural, not class-based.

Live translation map (`runtime-bridge-client.ts`): semantic method → wire command:
`launch→runtime:launch`, `kill→runtime:kill` (payload `{ killedAt }`),
`input→runtime:input`, `resize→runtime:resize`, `interrupt→runtime:interrupt`,
`getTerminalReplay→runtime:get-terminal-replay`, `createChildSession→runtime:create-child-session`.

**Important difference vs `/ctl/*` control routes:** the control route group
defines its **own** `RuntimeBridgeClient` interface (`control.ts:23-46`) with a
different shape (`sendInput`, `createChildSession`, `destroySession`,
`dispatchSubagent`, `sendSubagentInput`, `stopSubagent`, `isConnected`). That one
is gated by `requireConnectedBridge()` → 503 when `isConnected()` is false
(`control.ts:136-149`). The sessions-route `RuntimeBridgeClient` has **no**
`isConnected()` method — its stub just throws per-call.

#### 3. `ProjectSessionManager` lifecycle methods (the `manager` dep)

Class: `stoa-server/src/services/project-session-manager.ts:395`. Constructed via
`ProjectSessionManager.create(backend, { webhookPort, wsHub })` in production
(`index.ts:90-93`) or `ProjectSessionManager.createForTest(wsHub?)` in tests
(`project-session-manager.ts:464-477`, disables persistence, no-op WS hub).

Lifecycle methods relevant to the takeover:

| Method | Signature | Side effects | Source |
|---|---|---|---|
| `createSession` | `(request: CreateSessionRequest) => Promise<SessionSummary>` | Validates project/parent/creator existence & scope; resolves default title; pushes session; sets active project+session; persists; broadcasts `session_created`. Throws `Error` on validation failure (route maps to 409). | `project-session-manager.ts:716-804` |
| `setActiveSession` | `(sessionId: string) => Promise<void>` | No-op if missing; sets active ids; auto-marks `agent.completion_seen` if applicable. | `project-session-manager.ts:609-619` |
| `archiveSession` | `(sessionId: string) => Promise<void>` | **Subtree-aware** via `getSessionSubtree()` — archives whole subtree, clears active if needed; broadcasts `session_archived`. | `project-session-manager.ts:641-659` |
| `restoreSession` | `(sessionId: string) => Promise<void>` | **Subtree-aware** — un-archives subtree; re-activates project+session; broadcasts `session_restored`. | `project-session-manager.ts:693-710` |
| `deleteSessionRecord` | `(sessionId: string) => Promise<boolean>` | **Subtree-aware**; removes whole subtree; reconciles active project/session; persists; broadcasts `session_destroyed`. Returns `false` if not found. | `project-session-manager.ts:661-691` |
| `updateSessionTitle` | `(sessionId, title, options?) => Promise<SessionSummary \| null>` | Updates title + titleGenerationContext; broadcasts `session_updated`. Null if missing. | `project-session-manager.ts:847-907` |
| `getArchivedSessions` | `() => SessionSummary[]` | Pure read of `archived === true`. | `project-session-manager.ts:712-714` |
| `snapshot` | `() => BootstrapState` | Deep-cloned `{ activeProjectId, activeSessionId, terminalWebhookPort, projects, sessions }`. | `project-session-manager.ts:493-495` |

Other runtime-state mutators the takeover may need to chain (broadcast
`session_state_changed`): `markRuntimeStarting`, `markRuntimeAlive`,
`markRuntimeExited`, `markRuntimeFailedToStart`, `markCompletionSeen`,
`markAgentTurnInterrupted`, `applySessionStatePatch`
(`project-session-manager.ts:563-596`).

WS event kinds emitted (`SessionGraphWsEvent.kind`,
`project-session-manager.ts:51-64`): `project_created`, `project_deleted`,
`session_created`, `session_archived`, `session_restored`, `session_destroyed`,
`session_updated`, `session_state_changed`. Every mutating method also calls
`this.persist()` (debounced via `persistChain`, `project-session-manager.ts:1019-1038`).

#### 4. Expected test patterns

**Primary test file: `stoa-server/src/routes/api-routes.test.ts`** (629 lines).
Factory pattern (`api-routes.test.ts:71-108`):

```ts
function createTestApp(overrides: { manager?; runtimeBridge?; sidebarState?; setSidebarState? }) {
  const manager = overrides.manager ?? ProjectSessionManager.createForTest();
  const runtimeBridge = overrides.runtimeBridge ?? createStubRuntimeBridge();
  // ... Hono app with createErrorHandler + createAuthMiddleware('test-token')
  app.route('/api/v1', createSessionsRoutes({ manager, runtimeBridge }));
  return { app, manager };
}
const AUTH = { Authorization: 'Bearer test-token' };
```

Established conventions:
- HTTP-level tests via `app.request(path, { method, headers, body })`.
- Status assertions: 200 success, 201 create, 404 missing, 409 conflict, 422
  validation, 503 runtime bridge stub.
- `vi.spyOn(manager, 'methodName')` to assert a manager method was called
  (e.g. `api-routes.test.ts:152, 371`).
- Real `manager.createProject`/`createSession` to seed fixtures — no manual mock
  state.
- Auth tests: missing header → 401; wrong token → 401; `x-stoa-session-id` +
  `x-stoa-session-token` pair → 200 (`api-routes.test.ts:551-576`).
- Response envelope typed inline as `{ ok; data; meta: { requestId; timestamp; pagination? } }`
  (`api-routes.test.ts:117-127`).

Existing lifecycle coverage in `api-routes.test.ts`:
- `POST /sessions` 201 + 422 (missing projectId, invalid type) — `:248-283`.
- `PUT /sessions/:id/archive` 200 + 404 — `:285-309`.
- `PUT /sessions/:id/restore` 200 — `:311-327`.
- `GET /sessions` snapshot + archived list — `:329-354`.
- Runtime bridge stubs: restart / terminal-replay / input / resize all return
  **503** via the stub bridge — `:500-549`. **This is the contract a takeover
  must update:** once launch/kill become real, these tests either get a custom
  bridge or move to assert the new behavior.

**Sibling pattern — `/ctl/*` destroy test** (`control-routes.test.ts:335-346`):
`POST /ctl/session/:id/destroy` returns 503 when
`createMockRuntimeBridge(false)` (i.e. `isConnected()` false). Mock factory at
`control-routes.test.ts:98-108` shows how to stub the control-side bridge.

**Sibling pattern — `DELETE /projects/:id`** (`api-routes.test.ts:198-221`,
route at `projects.ts:114`): returns `{ data: { id, deleted: true } }`, 404 for
unknown. This is the closest existing precedent for a future
`DELETE /sessions/:id` route shape.

#### 5. The two-route split (why "takeover" is meaningful)

- `sessions.ts` (`/api/v1/sessions/*`) = **persistence plane**, authed by
  `STOA_AUTH_TOKEN` Bearer / session-token pair via global
  `createAuthMiddleware()` (`app.ts:63`, `middleware/auth.ts`).
- `control.ts` (`/ctl/session/*`) = **runtime/control plane**, authed by
  `x-stoa-secret` (ctlSecret) or session-token pair, gated by
  `isCtlEnabled()`, with a **separate** `RuntimeBridgeClient` interface that
  includes `isConnected()` and `destroySession` (`control.ts:23-46, 145-149,
  357-373`).

Today only `/ctl/session/:id/destroy` actually tears down a runtime session, and
it delegates to the injected `ControlDeps.destroySession`
(`session-supervisor.ts:134-140`). `sessions.ts` has no destroy/kill path at all.
A "lifecycle takeover" by the sessions route group means: create should also
launch the runtime; a delete route should `runtimeBridge.kill` then
`manager.deleteSessionRecord`; restart should pass real `LaunchOptions` (cwd,
cols, rows) instead of `{}`.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| `SessionsRouteDeps = { manager, runtimeBridge }` | `stoa-server/src/routes/sessions.ts` | `sessions.ts:32-35` |
| Full route list + status codes | `stoa-server/src/routes/sessions.ts` | `sessions.ts:77-324` |
| Only `runtimeBridge.launch` call site, with empty `{}` | `stoa-server/src/routes/sessions.ts` | `sessions.ts:187-194` |
| `RuntimeBridgeClient` interface + `LaunchOptions` | `stoa-server/src/routes/runtime-bridge.ts` | `runtime-bridge.ts:17-39` |
| Stub throws 503 "Runtime bridge not connected" | `stoa-server/src/routes/runtime-bridge.ts` | `runtime-bridge.ts:45-80` |
| Live bridge wires to `RuntimeBridgeHandler` | `stoa-server/src/services/runtime-bridge-client.ts` | `runtime-bridge-client.ts:28-107` |
| Manager `createSession` (validation, broadcast `session_created`) | `stoa-server/src/services/project-session-manager.ts` | `project-session-manager.ts:716-804` |
| Manager `archiveSession` (subtree, `session_archived`) | `stoa-server/src/services/project-session-manager.ts` | `project-session-manager.ts:641-659` |
| Manager `restoreSession` (subtree, `session_restored`) | `stoa-server/src/services/project-session-manager.ts` | `project-session-manager.ts:693-710` |
| Manager `deleteSessionRecord` (subtree, `session_destroyed`, unwired to HTTP) | `stoa-server/src/services/project-session-manager.ts` | `project-session-manager.ts:661-691` |
| `SessionGraphWsEvent` kinds include `session_destroyed` | `stoa-server/src/services/project-session-manager.ts` | `project-session-manager.ts:51-64` |
| `api-routes.test.ts` factory + stub bridge + auth header | `stoa-server/src/routes/api-routes.test.ts` | `api-routes.test.ts:71-110` |
| Existing archive/restore/restart/input/resize test cases | `stoa-server/src/routes/api-routes.test.ts` | `api-routes.test.ts:248-549` |
| `/ctl/session/:id/destroy` 503-when-disconnected test | `stoa-server/src/routes/control-routes.test.ts` | `control-routes.test.ts:335-346` |
| Control-side `RuntimeBridgeClient` (different shape, has `isConnected`) | `stoa-server/src/routes/control.ts` | `control.ts:23-46` |
| `DELETE /projects/:id` precedent (returns `{ id, deleted }`) | `stoa-server/src/routes/projects.ts` + test | `projects.ts:114`, `api-routes.test.ts:198-221` |
| Production wiring (`createLiveRuntimeBridge` + manager.create) | `stoa-server/src/index.ts` | `index.ts:90-97, 170-202` |
| App route mounting order | `stoa-server/src/app.ts` | `app.ts:51-87` |
| `AppError`/`ApiResponse` envelope + error code → HTTP map | `stoa-server/src/shared/errors.ts` | `errors.ts:7-92` |
| Webhook events drive state patches via `SessionEventProcessor` (not routes) | `stoa-server/src/services/session-event-processor.ts` | `session-event-processor.ts:145-291` |

### Risks / Unknowns

- **[!] Subtree semantics must be preserved.** `archiveSession`,
  `restoreSession`, and `deleteSessionRecord` all operate on the whole subtree
  (`getSessionSubtree`, `project-session-manager.ts:1202-1222`). A new
  `DELETE /sessions/:id` that also calls `runtimeBridge.kill` must decide
  whether to kill only the root or every node in the subtree — the manager side
  already cascades the record deletion.
- **[!] Two `RuntimeBridgeClient` interfaces exist.** The sessions-route one
  (`runtime-bridge.ts:17`) has `kill`; the control-route one (`control.ts:23`)
  has `destroySession` + `isConnected`. A takeover should reuse the
  sessions-route `kill` (it maps to `runtime:kill`), not introduce a third shape.
- **[!] Stub bridge returns 503 by throwing.** Any new route that calls
  `runtimeBridge.kill`/`launch` will automatically 503 under the default test
  factory — existing `api-routes.test.ts` tests that don't pass a custom bridge
  will need either a non-stub bridge or updated assertions.
- **[!] `restart` passes `{}` LaunchOptions.** If create takes over launch, it
  must source `cwd`/`cols`/`rows`/`env`/`command` from somewhere —
  `CreateSessionRequest` already carries `initialCols`/`initialRows`
  (`sessions.ts:147-148`) but no `cwd`/`command`/`env`. Project `path` is the
  natural `cwd`.
- **[?] Auth model for a destroy route.** `/api/v1/sessions/*` uses the global
  bearer/session-token auth, not the `x-stoa-secret` ctlSecret model. Confirm
  whether the takeover keeps destroy behind the global auth or whether it must
  also accept ctl-style callers.
- **[?] WS broadcast on destroy.** `deleteSessionRecord` already broadcasts
  `session_destroyed`. If the new route additionally kills the runtime, confirm
  whether `kill` itself emits any state patch via
  `SessionEventProcessor`/bridge hooks (`session-event-processor.ts:201-233`) so
  the UI doesn't receive duplicate teardown signals.
- **[?] Plan reference.** The route header comments reference "plan section 5.6"
  and "Phase 3" (`sessions.ts:1-19`, `runtime-bridge.ts:1-8`). No plan doc was
  inspected in this run; if a written plan defines the exact takeover contract
  (e.g. which endpoints gain runtime side-effects), the implementation agent
  should locate it before coding.
