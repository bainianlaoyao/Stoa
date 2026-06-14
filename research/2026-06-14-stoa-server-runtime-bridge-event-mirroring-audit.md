# Stoa Server — Bootstrap / Discovery / Sessions / Runtime-Bridge & Event-Mirroring Audit

**Date:** 2026-06-14
**Scope (read-only):** Trace `stoa-server` bootstrap wiring, discovery, sessions, and runtime-bridge routes/services as they relate to (a) Electron-local runtime fields, (b) event mirroring, (c) replay / append / `markExited` visibility.
**Sources read directly:** `stoa-server/src/{index,app}.ts`, `routes/{discovery,runtime-bridge,sessions,webhooks,control,observability}.ts`, `services/{runtime-bridge-client,session-event-processor,session-supervisor,session-visibility-service,project-session-manager}.ts`, `ws/{hub,events,role-router,runtime-bridge-handler}.ts`, `middleware/auth.ts`, `db/{schema,connection}.ts`, `src/shared/project-session.ts`.

---

## 0. TL;DR — the five load-bearing findings

1. **The `SessionSupervisor` + `SessionVisibilityService` (the only place that enforces session-scoped visibility on terminal-replay / output / completion-report) is NOT mounted in the running server.** `app.ts` mounts only `healthRoutes` under `/ctl`; `createControlRoutes` is referenced solely by its own test (`control-routes.test.ts:135`). So in production SR, **replay/output/markExited reads have no visibility enforcement and no HTTP entry point**.
2. **Terminal replay is never stored server-side.** It is a live 15s-timeout round-trip to the Electron runtime provider (`runtime:get-terminal-replay`). The SR keeps no append buffer; "appended" terminal data exists only as a live `session:terminal-data` WS broadcast held in a 1000-event rolling in-memory history (`hub.ts:21,64-67`).
3. **The `markRuntime{Starting,Alive,Exited,FailedToStart}` / `markCompletionSeen` helpers on the SR `ProjectSessionManager` are dead code on the server.** They are defined (`project-session-manager.ts:567-592`) but called by nothing under `stoa-server/src`. SR state mutation flows exclusively through the generic `applySessionStatePatch` path driven by `SessionEventProcessor`.
4. **Session-scoped auth is a Phase-1 stub.** The auth middleware accepts any non-empty `x-stoa-session-id`+`x-stoa-session-token` pair (`auth.ts:50-56`), even though the `session_tokens` table now exists (`schema.ts:229`, `connection.ts:138`). Visibility restriction therefore depends entirely on the (unmounted) control layer.
5. **What IS mirrored server-side** is the *derived* runtime state — `runtimeState`, `runtimeExitCode`, `runtimeExitReason`, `hasUnseenCompletion`, `lastStateSequence`, `turnEpoch`, etc. — via `session:state-patch` broadcasts. What stays Electron-local is the **PTY buffer / live terminal bytes**, the **crash-recovery PTY state**, and the **runtime provider connection itself**.

---

## 1. Bootstrap wiring (`index.ts` → `app.ts`)

### 1.1 `start()` composition (`index.ts:66-255`)

The entry point assembles the service graph in this order:

| # | Step | Citation | Notes |
|---|------|----------|-------|
| 1 | Persistence backend (SQLite → JSON fallback) | `index.ts:74-84` | `~/.stoa/server.db`; **hard-exits if SQLite/meta-session init fails** (`index.ts:146-149`). |
| 2 | `WsHub` (broadcast + 1000-event history) | `index.ts:87` | In-memory only. |
| 3 | `ProjectSessionManager.create(backend, { webhookPort: null, wsHub })` | `index.ts:90-93` | Note `webhookPort: null` — SR does not run its own webhook port; it ingests events via `/events` + `/hooks/*`. |
| 4 | `RuntimeBridgeHandler` (provider registry) + `createLiveRuntimeBridge(handler)` | `index.ts:96-97` | The `RuntimeBridgeClient` handed to the sessions route is the **live** client; the Stub (503) is not used at runtime. |
| 5 | Sidebar state (in-memory) | `index.ts:100-106` | Not persisted. |
| 6 | Observability stubs — all return null/empty | `index.ts:108-131` | `getSessionPresence`→null, `getProjectObservability`→null, `getAppObservability`→zeroed, `listSessionEvents`→empty. |
| 7 | `MetaSessionManager` / `MetaSessionProposalStore` (require DB) | `index.ts:134-149` | |
| 8 | `SessionEventProcessor({ manager, db, wsHub, runtimeBridge: runtimeBridgeHandler })` | `index.ts:151-156` | **This is the critical wiring:** the processor's constructor calls `runtimeBridge.setHooks(...)` (`session-event-processor.ts:172-174`), attaching the `onTerminalData` / `onProviderDisconnected` / `onProviderReady` / `onPtyState` hooks. This is how provider-pushed terminal bytes become WS broadcasts. |
| 9 | `AppDeps` assembled; `webhooks.onEvent = sessionEventProcessor.processEvent` | `index.ts:170-202` | Webhook auth = `getSessionSecret` returns the **global** `authToken` for any known session (`index.ts:196-200`). `authorizeHookRequest` is **not wired** (only `onEvent`/`onMemoryNotification`/`getSessionSecret` provided). |
| 10 | `createApp(deps, { discovery, cors:true, webClient })` | `index.ts:207-211` | |
| 11 | `serve(...)` + `attachWebSocketServer` | `index.ts:217-255` | WS upgrade → `routeConnection(req, conn, roleRouterHandlers)`; role-router handlers wire `hub`, `runtimeBridge`, `expectedToken`, and `dispatchBinaryInput` (base64→`runtimeBridge.input`). |

### 1.2 `app.ts` route mounting (`app.ts:51-87`) — what is and isn't exposed

```
onError → CORS → auth(*) →
  /api/v1/discovery   (unauth, see §2)
  /ctl                → healthRoutes ONLY          ← control.ts NOT mounted
  /                   → webhookRoutes (/events, /hooks/*, /memory-notifications)
  /api/v1             → projects, sessions, settings, observability,
                        meta-sessions, sidebar, fs, git
  /                   → staticRoutes (web SPA, last, only if webClient)
```

**`createControlRoutes` is never imported by `app.ts`** (verified: only `control-routes.test.ts:135` mounts it). Consequence: the `/ctl/session/*` family (list/inspect/status/**output**/wait/completion-report) and `/ctl/subagent/*` family defined in `control.ts` are library code with no live HTTP surface in SR.

### 1.3 Auth model (`auth.ts`) — unauthenticated paths

Skipped entirely (`auth.ts:26-36`): `/api/v1/discovery`, `/events`, `/memory-notifications`, `/hooks/*`, `/`, `/assets/*`. All other paths require either a Bearer token equal to `authToken`, or a **non-empty** `x-stoa-session-id`+`x-stoa-session-token` pair — the latter is still the Phase-1 "accept anything" stub (`auth.ts:50-56`), despite `session_tokens` now existing in the schema (`schema.ts:229`).

---

## 2. Discovery (`routes/discovery.ts`)

- Factory `createDiscoveryRoutes({ webClient?, lanMode? })` (`discovery.ts:18-41`). Mounted at `/api/v1/discovery` (`app.ts:66`), unauthenticated by design (`auth.ts:27-28`; file header cites "Plan section 9.4").
- Returns `{ ok, data: { name, version, port, uptime, webClient, lanMode } }`. `port` is parsed from the `Host` header with fallback `3270` (`discovery.ts:28`); `uptime` from a module-load `startTime` (`discovery.ts:9,22`).
- No runtime/session/provider info is exposed here — it is purely server identity. **There is no "bootstrap" route** beyond discovery; the real bootstrap surface for clients is the WS `ws:initial-state` envelope (`events.ts:57-67`), which is defined but not emitted by the current hub/role-router wiring (hub only `broadcast`s typed events; no initial-state send on connect was found).

---

## 3. Sessions route (`routes/sessions.ts`)

Deps: `{ manager: ProjectSessionManager; runtimeBridge: RuntimeBridgeClient }` (`sessions.ts:32-35`). Mounted at `/api/v1` (`app.ts:72`).

| Endpoint | Behavior | Citation | Visibility / runtime-bridge coupling |
|----------|----------|----------|--------------------------------------|
| `GET /sessions` | Snapshot sessions, or `?archive=archived` paginated | `sessions.ts:113-142` | Bearer-gated; **no session-scoped visibility** (returns all). |
| `POST /sessions` | Validate → `manager.createSession` → `runtimeBridge.launch(...)`; on launch failure, `manager.deleteSessionRecord` (rollback) | `sessions.ts:144-207` | Launch goes through the live bridge; failure rolls back the record. `buildLaunchOptions` pulls `cwd` from the project path (`sessions.ts:92-107`). |
| `PUT /sessions/:id/active` | `manager.setActiveSession` | `sessions.ts:209-215` | |
| `PUT /sessions/:id/archive` | `runtimeBridge.kill` then `manager.archiveSession` | `sessions.ts:217-224` | |
| `PUT /sessions/:id/restore` | `manager.restoreSession` then `runtimeBridge.launch(id, {})` — **empty options, no cwd/cols** | `sessions.ts:226-233` | ⚠ Restore launches with `{}`; cwd/type/title are NOT re-derived (contrast with `restart` which calls `buildLaunchOptions`). |
| `POST /sessions/:id/restart` | `kill` then `launch(buildLaunchOptions(...))` | `sessions.ts:235-242` | |
| `PUT /sessions/:id/title` | `manager.updateSessionTitle(id, title, options)` | `sessions.ts:244-262` | `options` carries `prompt`/`assistantSnippet`/`autoGeneratedTurnEpoch`/`contextUpdatedAt`. |
| `GET /sessions/:id/terminal-replay` | `runtimeBridge.getTerminalReplay(id)` — **live provider round-trip, 15s timeout** | `sessions.ts:264-270`; `runtime-bridge-client.ts:64-72`; `runtime-bridge-handler.ts:75` | No server-side buffer; returns `''` on non-string response (`runtime-bridge-client.ts:71`). |
| `POST /sessions/:id/input` | `runtimeBridge.input` | `sessions.ts:272-288` | |
| `POST /sessions/:id/resize` | `runtimeBridge.resize` | `sessions.ts:290-307` | |
| `DELETE /projects/:id/sidecar` | 503 stub ("Electron-only") | `sessions.ts:310-321` | Explicit Electron-only marker. |
| `GET /sessions/:id/evidence` | Empty stub | `sessions.ts:324-330` | Observation store integration pending. |
| `GET /sessions/:id/context/{full,slim}` | Placeholder stub (`text:''`) | `sessions.ts:333-367` | "Requires MetaSessionContextAssembler wired to observation store." |

**Visibility gap:** every read here is gated only by the global auth middleware. Nothing in `sessions.ts` consults `SessionVisibilityService`.

---

## 4. Runtime bridge — three layers

### 4.1 `routes/runtime-bridge.ts` — interface + factories

Defines the semantic `RuntimeBridgeClient` interface (`runtime-bridge.ts:17-25`): `launch / kill / input / resize / interrupt / getTerminalReplay / createChildSession`. `LaunchOptions` (`runtime-bridge.ts:27-37`) carries `command/cwd/projectId/title/type/externalSessionId/cols/rows/env`.

- `createStubRuntimeBridge()` → all methods throw `AppError(503, "Runtime bridge not connected")` (`runtime-bridge.ts:49-84`).
- `createLiveRuntimeBridge(handler)` → `createLiveRuntimeBridgeClient(handler)` (`runtime-bridge.ts:95-100`).

### 4.2 `services/runtime-bridge-client.ts` — `LiveRuntimeBridgeClient`

Thin translation from semantic methods to `runtime:*` wire commands:

| Semantic | Wire command | Payload shaping | Citation |
|----------|--------------|-----------------|----------|
| `launch` | `runtime:launch` | null-coalesces every `LaunchOptions` field | `runtime-bridge-client.ts:34-46` |
| `kill` | `runtime:kill` | adds `killedAt: nowIso()` | `runtime-bridge-client.ts:48-50` |
| `input` | `runtime:input` | `{ data }` | `runtime-bridge-client.ts:52-54` |
| `resize` | `runtime:resize` | `{ cols, rows }` | `runtime-bridge-client.ts:56-58` |
| `interrupt` | `runtime:interrupt` | adds `interruptedAt` | `runtime-bridge-client.ts:60-62` |
| `getTerminalReplay` | `runtime:get-terminal-replay` | unwraps `string` or `{ text }` → `''` | `runtime-bridge-client.ts:64-72` |
| `createChildSession` | `runtime:create-child-session` | unwraps `string` or `{ childSessionId }`, else `RuntimeBridgeError('malformed_response')` | `runtime-bridge-client.ts:74-91` |

All go through `dispatch` → `handler.sendCommand(sessionId, { type, payload })` (`runtime-bridge-client.ts:93-99`).

### 4.3 `ws/runtime-bridge-handler.ts` — provider registry, command dispatch, hooks

**Wire protocol** (`runtime-bridge-handler.ts:22-63`):
- SR → provider `RuntimeCommand { type, sessionId, payload, replyTo }`.
- provider → SR: `runtime:response { replyTo, ok, data?, error? }`, `runtime:terminal-data { sessionId, data }`, `runtime:pty-state { sessionId, state }`, `runtime:state-sync { sessions[] }`.
- `ProviderPtyState { alive, exitCode?, exitReason?('clean'|'failed'), cols?, rows?, startedAt? }` (`:56-63`) — crash-recovery state.

**Per-command timeouts** (`:69-82`): launch 30s, kill 10s, input/resize/interrupt 5s, get-terminal-replay 15s, create-child-session 30s. `runtime:resize` is "silent" — a timeout resolves `null` rather than rejecting (`:80-82, 275-278`).

**Hooks** (`RuntimeBridgeHooks`, `:147-159`) — what the host wires to translate provider pushes into side effects:
- `onTerminalData({ sessionId, data, providerId })` — PTY bytes.
- `onPtyState({ sessionId, providerId, state })` — per-session PTY state.
- `onProviderDisconnected({ providerId, orphanedSessionIds })` — disconnect → orphan list.
- `onProviderReady({ providerId, ptyStates[] })` — initial state-sync handshake.

**Key behaviors:**
- `registerProvider` mints `provider_<uuid>` and an empty `managedSessions` set (`:181-190`).
- `sendCommand` resolves "no provider" for non-launch commands when the session isn't managed; for `runtime:launch` it falls back to "any provider" (`getProviderForCommand`, `:376-381`) — so the first provider receives launches for unassigned sessions.
- `handleResponse` auto-assigns the session to the provider on successful `runtime:launch`/`create-child-session` (`:452-460`).
- `removeProvider` rejects all pending commands for that provider (or silently resolves silent ones), clears `managedSessions` + per-session `lastKnownPtyState`, fires `onProviderDisconnected` (`:197-235`).
- `handleStateSync` rebuilds `managedSessions` + `lastKnownPtyState` from the provider's handshake frame and fires `onProviderReady` (`:488-505`).

---

## 5. Event mirroring — the two pipelines

### 5.1 Canonical-event pipeline (webhook → state → WS)

```
POST /events  (webhooks.ts:316-334)
  └─ isCanonicalSessionEvent validate (webhooks.ts:137-238)   ← enforces intent enum, runtime fields, no legacy fields
  └─ x-stoa-secret == getSessionSecret(session) == authToken  (index.ts:196-200)
  └─ deps.onEvent → sessionEventProcessor.processEvent        (index.ts:188-191)
       └─ per-session serialized queue                         (session-event-processor.ts:181-195)
       └─ doProcessEvent:
            1. manager.applySessionStatePatch(patch)           (:245-246)
            2. db.insert(sessionEvents)                        (:248-249, persist raw event)
            3. wsHub.broadcast('session:state-patch', {sessionId, patch})  (:252-259)
            4. wsHub.broadcast('observability:presence', ...)  (:262-275)  ← presence-category intents only
            5. titleGenerator.onTurnCompleted? (on agent.turn_completed)   (:278-290)
```

Provider hook adapters (`/hooks/claude-code|codex|opencode`, `webhooks.ts:337-416`) adapt provider-specific bodies into the same `CanonicalSessionEvent` and feed `deps.onEvent`. `authorizeHookRequest` is optional and **not wired** in `index.ts`, so these fall back to the global-secret check (`webhooks.ts:366-371`).

`toSessionStatePatch` (`session-event-processor.ts:298-322`) carries `runtimeExitCode`, `runtimeExitReason`, `blockingReason`, `failureReason`, `summary`, `externalSessionId`, `source:'provider'`, `sourceEventType`, and a sequence from `EventSequenceAllocator` (seeded from `lastStateSequence`, `:90-103`).

### 5.2 Terminal-data pipeline (provider push → WS)

```
provider ws frame { type:'runtime:terminal-data', sessionId, data }
  └─ RuntimeBridgeHandler.handleMessage → handleTerminalData  (runtime-bridge-handler.ts:347-349, 465-471)
  └─ hooks.onTerminalData
  └─ SessionEventProcessor.buildBridgeHooks().onTerminalData  (session-event-processor.ts:203-212)
  └─ wsHub.broadcast('session:terminal-data', { sessionId, data })
       └─ stored in rolling 1000-event history                 (hub.ts:64-67)
       └─ delivered to web clients subscribed w/ optional sessionId filter  (hub.ts:71-92)
```

**No persistence, no per-session append buffer on the server.** Clients that connect late and want history get either the rolling 1000-event window via `getMissedEvents(lastEventId)` (`hub.ts:127-135`) — which returns `[]` if the gap is too large — or must call `GET /sessions/:id/terminal-replay` for a **live** provider round-trip.

### 5.3 Provider-disconnect mirroring

`onProviderDisconnected` (`session-event-processor.ts:213-225`) broadcasts `session:state-patch` with `{ runtimeState:'exited', runtimeExitReason:'provider_disconnected' }` for each orphaned session. **This is the only place `runtimeExitReason:'provider_disconnected'` is produced**, and it is *not* in the webhook validation enum (`webhooks.ts:97` only allows `'clean'|'failed'`) — it is a server-internal patch, not a webhook-originated value.

### 5.4 Role router — runtime vs web connections (`ws/role-router.ts`)

`routeConnection` (`:144-168`): requires `?token=` == `expectedToken` (else WS close `4401`), then:
- `role=runtime` → `bindRuntimeConnection` → `runtimeBridge.registerProvider` + forward every frame to `runtimeBridge.handleMessage(provider.id, raw)` (`:174-192`). **This is how the Electron provider registers.**
- `role=web` (default for missing/unknown) → `bindWebConnection` → joins `WsHub`, handles `subscribe`/`unsubscribe`/`session:binary-input` (`:209-312`). `session:binary-input` → `dispatchBinaryInput(sessionId, base64)` → `runtimeBridge.input(sessionId, decoded)` (`index.ts:230-238`).

---

## 6. Services relevant to visibility & runtime fields

### 6.1 `SessionSupervisor` (`services/session-supervisor.ts`) — the visibility-enforcing layer (NOT MOUNTED)

- Constructor takes `SessionSupervisorDeps` including `getSnapshot()`, `visibilityService: SessionVisibilityReader`, `sessionInput`, `createChildSession`, `destroySession`, `getTerminalReplay`, optional `waitForSessionStateChange`, `recordSubagentInput` (`:44-56`).
- `listSessions` / `inspectSession` apply `sanitizeSessionNodeSnapshotForGenericProjection` and, for `session` callers, filter to `visibilityService.visibleSessionIds` (`:82-107`).
- `getSessionOutput` (`:147-155`) → `getTerminalReplay`, gated by `assertSubagentBodyAuthority` + `assertReadableCurrentSubagentTerminal`.
- `getCompletionReport` (`:157-166`) and `waitForSession` (`:168-195`) similarly gate on visibility + readable-terminal-result (`hasCurrentTerminalResult`, `:346-356`, which checks `subagentInputEpoch` vs `subagentLatestInputStateSequence` vs `lastStateSequence`).
- `toStatusSnapshot` (`:240-265`) projects `runtimeState / turnState / turnEpoch / lastTurnOutcome / blockingReason / failureReason / runtimeExitCode / runtimeExitReason / hasUnseenCompletion` into a `SessionStatusSnapshot` with a derived `phase`.

**Because `createControlRoutes` is not mounted (§1.2), none of these visibility checks run in the live SR.**

### 6.2 `SessionVisibilityService` (`services/session-visibility-service.ts`)

Tree-based visibility: a viewer session sees same-depth siblings and all descendants within the same `rootSessionId` (`visibleSessionIds`, `:25-48`). `checkAuthority` (`:55-116`) allows read-class actions for visible targets; `create` only on self; `subagentInterrupt/Destroy` on self-or-descendant; `submitOwnResult` always denied.

### 6.3 `ProjectSessionManager` — mark* helpers (dead on server) + the live path

- **Live path:** `applySessionStatePatch(patch)` → `applySessionStateReduction` → `reduceSessionState` + `shouldApplyPatchSummary`, then `persist()` + `broadcastGraph({ kind:'session_state_changed', ... })` (`:563-565, 1139-1151`). State reductions also broadcast `session:graph` (graphVersion bump).
- **mark* helpers defined but uncalled in SR** (`:567-596`): `markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited` (picks `runtime.exited_clean` vs `runtime.exited_failed` by `exitCode`, `:575-582`), `markRuntimeFailedToStart`, `markCompletionSeen`, `markAgentTurnInterrupted`. These are Electron-side patterns mirrored into the SR manager; the SR never invokes them. Verified by grep: no callers under `stoa-server/src` except the definitions themselves.
- `setActiveSession` has a side path: if the activated session is `idle` + `lastTurnOutcome==='completed'` + `hasUnseenCompletion`, it synthesizes an `agent.completion_seen` patch inline (`:614-617`) — **this is a server-side markCompletionSeen, done directly, not via the helper**.

---

## 7. Electron-local vs server-mirrored runtime fields

`SessionSummary` (`src/shared/project-session.ts:128-149`) server-mirrored fields: `runtimeState`, `runtimeExitCode`, `runtimeExitReason`, `hasUnseenCompletion`, `lastStateSequence`, `turnEpoch`, `lastTurnOutcome`, `blockingReason`, `failureReason`, `externalSessionId`, `titleGenerationContext`, `subagentInputEpoch`, `subagentLatestInputStateSequence`.

**Electron-local only (NOT mirrored to SR):**
- The **PTY process and its raw output buffer** — SR fetches via `runtime:get-terminal-replay` on demand.
- **Live terminal bytes** — SR only re-broadcasts them (`session:terminal-data`), never owns them.
- **PTY dimensions / `startedAt` / crash-recovery `alive`** — held as `ProviderPtyState` inside `RuntimeBridgeHandler.lastKnownPtyState` (`runtime-bridge-handler.ts:170, 480`) for reconnect reconciliation; not exposed over HTTP.
- **The `markRuntime*` state-machine call sites** — these exist Electron-side (e.g. `src/main/session-event-bridge.ts`) and drive local PTY lifecycle; on SR they are inert definitions.

The boundary is explicit in `session-event-processor.ts:23`: *"PTY data forwarding and webhook server lifecycle remain in Electron."*

---

## 8. Replay / append / markExited — visibility map

| Concern | Server-side reality | Visibility enforcement |
|---------|---------------------|------------------------|
| **Replay** (full terminal history) | Live round-trip `runtime:get-terminal-replay`, 15s timeout (`sessions.ts:264-270`, `runtime-bridge-handler.ts:75`). Returns `''` on malformed/non-string. | `sessions.ts` route: **none** (global auth). `control.ts` `/ctl/session/:id/output` (`control.ts:274-288`) would enforce via `SessionSupervisor.getSessionOutput`, but **not mounted**. |
| **Append** (incremental terminal bytes) | `session:terminal-data` WS broadcast from `onTerminalData` hook (`session-event-processor.ts:203-212`); rolling 1000-event history (`hub.ts:21,64-67`); no per-session DB buffer. | Web clients only receive if they `subscribe` to `session:terminal-data` with optional `sessionId` filter (`hub.ts:71-92`). No auth-scoping of subscription. |
| **markExited** (runtime exit state) | Produced two ways: (a) webhook `runtime.exited_clean/failed` → `SessionEventProcessor` → state patch + `session:state-patch` broadcast; (b) provider disconnect → `runtimeExitReason:'provider_disconnected'` patch (`session-event-processor.ts:213-225`). The `markRuntimeExited` helper exists but is unused SR-side. | Exit fields (`runtimeExitCode/Reason`) are in every `session:state-patch` and `session:graph` projection — no per-viewer scoping. The `SessionSupervisor.toStatusSnapshot` (`session-supervisor.ts:240-265`) is the only structured exit-status projection, and it is behind the unmounted `/ctl/session/:id/status`. |
| **Completion visibility** (`hasUnseenCompletion`, completion report) | `hasUnseenCompletion` is server-mirrored; `completion-report` assembly (`toCompletionReport`, `session-supervisor.ts:267-292`) + readability gating (`hasCurrentSubagentTerminalResult`, `:358-373`) live in the unmounted supervisor. The `/sessions/:id/context/{full,slim}` and `/sessions/:id/evidence` routes are **stubs** (`sessions.ts:324-367`). | Enforced only in the unmounted control layer. |

---

## 9. Gaps & open questions (for the planning agent)

1. **Control surface unmounted** — is `/ctl/session/*` intended to be exposed in SR, or is `control.ts` Electron-shared library code that SR ships but doesn't serve? If it should be served, `app.ts` needs `app.route('/ctl', createControlRoutes(deps))` **and** the deps (`getSnapshot`, `visibilityService`, `sessionInput`, `createChildSession`, `destroySession`, `getTerminalReplay`, `sessionTokenRegistry`, `runtimeBridge`) must be wired in `index.ts` — currently none are.
2. **Session-scoped auth still stubbed** (`auth.ts:50-56`) despite `session_tokens` table existing. Any visibility design depending on session-scoped reads must first close this.
3. **Restore launches with `{}`** (`sessions.ts:231`) — no cwd/type/cols re-derivation, unlike `restart`. Likely a bug or an intentional "provider remembers" assumption; worth confirming against the Electron restore path.
4. **No `ws:initial-state` emission** — `WsInitialState`/`WsMissedEvents` envelopes are defined (`events.ts:57-73`) but no code path in `hub.ts`/`role-router.ts`/`index.ts` sends them on connect. Reconnecting clients cannot reconcile bootstrap state via WS today; they must hit REST snapshots.
5. **`onProviderReady` / `onPtyState` hooks are no-ops** (`session-event-processor.ts:226-231`) — crash-recovery reconciliation ("Future: reconcile provider PTY state with in-memory state") is not implemented.
6. **Observability is fully stubbed** (`index.ts:108-131`) — presence/project/app/session-events all return empty. Any "presence phase" projection the supervisor computes (`derivePresencePhase`) is not reachable via `/api/v1/observability/*`.

---

## Context Handoff

- **Report path (this file):** `research/2026-06-14-stoa-server-runtime-bridge-event-mirroring-audit.md`
- **Depth:** child subagent depth=2, max_depth=2 (no further subagents dispatched; no headless run launched).
- **Method:** direct read-only file inspection of the 14 files listed in the header; targeted greps for `markRuntime*`, `createControlRoutes`, `session:terminal-data`, `session_tokens`, `runtimeExit*`, `terminal-replay`.
- **Highest-leverage follow-up files** (not fully read, recommended for the planning agent): `src/main/session-event-bridge.ts` (the Electron-side original of `SessionEventProcessor`, where `markRuntime*` is actually invoked and PTY forwarding lives), `src/main/stoa-runtime-client.ts` + `src/main/stoa-server-spawner.ts` (the Electron-side provider that connects as `role=runtime`), `src/shared/project-session.ts:120-160` (full `SessionSummary` field list), `stoa-server/src/services/meta-session-context.ts` (the one place that calls `getTerminalReplay` server-side, at `:169`).
