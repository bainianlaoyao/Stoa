# Electron Main-Process Session Runtime / Event / Debug-State Trace

**Scope:** Trace the Electron main-process session-runtime, session-event, and E2E
debug-state path that the failing Electron Playwright journeys
(`recovery-journey`, `terminal-journey`, `session-event-journey`) depend on.

**Focus files:** `src/main/index.ts`, `src/main/session-event-bridge.ts`, plus the
runtime-bridge wiring (`stoa-runtime-client.ts`, `stoa-server-spawner.ts`,
`stoa-server-web-info.ts`) and the SR side they connect to.

**Mode:** Read-only context research. No code was modified. This report records
the verified control/data flow and flags the concrete break points most likely
to cause the failing journeys, with file:line citations.

---

## 1. The three failing journeys and what they assert

All three live in `tests/e2e-playwright/` and share a common harness contract:

- They launch a real Electron app via `launchElectronApp()` (`tests/e2e-playwright/fixtures/electron-app.ts:110`).
- They poll session state through `getMainE2EDebugState(app.electronApp)` (`fixtures/electron-app.ts:214`).
- They post webhook events to the port reported by that debug state via `postWebhookEvent` / `postClaudeHookEvent` (`fixtures/electron-app.ts:297`, `:318`).

| Journey | File | Core assertions |
|---|---|---|
| Recovery | `recovery-journey.test.ts` | After `killAndRelaunch()`/`relaunch()`, recovered session keeps the same `id`, `recoveryMode`, and reaches `runtimeState === 'alive'`; terminal viewport mounts xterm. |
| Terminal | `terminal-journey.test.ts` | Shell sessions reach `alive`; terminal replay/buffer contains injected markers; claude/codex status dots transition ready→running→complete via hook events. |
| Session-event | `session-event-journey.test.ts` | `webhookPort` truthy; webhook POST returns `202`/`204`; polled snapshot reaches `runtimeState:'alive'`, `turnState:'idle'`, `lastTurnOutcome:'completed'`, `hasUnseenCompletion:true`, etc. |

Every state assertion ultimately polls the **debug snapshot**. Where that snapshot
comes from is the heart of the problem (see §4).

---

## 2. Main-process startup sequence (`src/main/index.ts`)

The `app.whenReady().then(...)` block (`index.ts:495`) constructs, in order:

1. **Electron-local `ProjectSessionManager`** — `ProjectSessionManager.create({ webhookPort: null, globalStatePath: e2eGlobalStatePath })` (`index.ts:500`). In E2E mode `globalStatePath` = `<VIBECODING_STATE_DIR>/global.json` (`index.ts:166`). This is Electron's OWN session/project store, separate from SR.
2. `observationStore`, `observabilityService`, `evidenceStore` (`index.ts:509-511`).
3. `ptyHost` (lazy-imported), `sessionInputRouter` (`index.ts:515-536`).
4. `runtimeController = new SessionRuntimeController(manager, () => mainWindow, …)` (`index.ts:578`). Several of its methods are monkey-patched to also push `sessionGraphEvent`s to the renderer and forward terminal data to SR (`index.ts:694-767`).
5. `hookLeaseManager = createHookLeaseManager(...)` (`index.ts:595`).
6. **`sessionEventBridge = new SessionEventBridge(manager, controller, observabilityService, {…})`** (`index.ts:890`) with options that wire: `captureObservation`, `mirrorCanonicalEvent → mirrorCanonicalEventToStoaServer` (`index.ts:895-897`), `authorizeHookRequest → hookLeaseManager.authorizeHookRequest` (`index.ts:898-900`), `getSessionBootstrapPrompt`, `isCtlEnabled`, `configureServerApp` (installs the local session-control server).
7. `updateService` (`index.ts:966`).
8. **`const webhookPort = await sessionEventBridge.start()`** (`index.ts:990`) — starts the Electron-local webhook HTTP server and calls `manager.setTerminalWebhookPort(port)` (`session-event-bridge.ts:151`). **This is the `webhookPort` the tests read and POST to.**
9. `refreshCtlPortFile()` writes the stoa-ctl port file (`index.ts:992-1000`).
10. `installMainE2EDebugApi()` (`index.ts:1007`) — installs `globalThis.__VIBECODING_MAIN_E2E__` (only when `VIBECODING_E2E === '1'`, `index.ts:103/107/212`).
11. **SR spawn:** `srSpawner = new StoaServerSpawner(srConfig, srDeps)` → `srSpawner.spawn()` → `waitForHealth()` → `connectRuntime()` (`index.ts:1553-1558`). Config: `portRange: [3270, 3280]`, `stoaDir = <stateDir>/.stoa-server` (`index.ts:1484-1491`).
12. IPC handler registration (`index.ts:1561-1950`), including `serverGetInfo → getStoaServerWebInfo(srSpawner)` (`index.ts:1921-1923`).
13. `mainWindow = createMainWindow()` (`index.ts:1952`).
14. **Bootstrap recovery loop:** for each plan from `projectSessionManager.buildBootstrapRecoveryPlan()`, call `launchSessionRuntimeWithGuard(plan.sessionId, 'bootstrap-recovery')` (`index.ts:1970-1972`).

`mirrorCanonicalEventToStoaServer` is declared at `index.ts:1010-1028` as an inner async function (hoisted within the `.then` scope, so the closure passed at `index.ts:896` resolves correctly). It is a no-op while `srSpawner` is null, and otherwise:

```ts
// index.ts:1010-1028
const response = await fetch(`http://127.0.0.1:${srSpawner.getPort()}/events`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${srSpawner.getAuthToken()}`,
    'Content-Type': 'application/json',
    'x-stoa-secret': event.session_id     // ⚠ uses the SESSION ID as the secret
  },
  body: JSON.stringify(event)
})
if (!response.ok) {
  throw new Error(`Stoa event mirror failed with status ${response.status}`)
}
```

---

## 3. Session-event ingestion path (`src/main/session-event-bridge.ts`)

`SessionEventBridge` owns the Electron-local webhook server and the canonical-event pipeline:

- `start()` (`session-event-bridge.ts:119`) builds `createLocalWebhookServer({ getSessionSecret, authorizeHookRequest, onEvent: enqueueSessionEvent, onMemoryNotification, configureApp })` and starts it. The per-session secret map is `this.sessionSecrets` (`session-event-bridge.ts:67`), exposed via `issueSessionSecret`/`registerSessionSecret`/`debugSnapshotSessionSecrets` (`session-event-bridge.ts:729-749`).
- Every inbound event funnels through `enqueueSessionEvent` (`session-event-bridge.ts:159`), which serializes per-session via `sessionEventQueues`. Inside the chain:
  1. `shouldAcceptCanonicalEvent` (`:234`) — codex rebind/trust gating.
  2. `attachResolvedTurnId` (`:204`).
  3. `persistEvidenceIfPresent` (`:501`).
  4. `toObservationEvent` → `observability.ingest` → `captureObservation` tap (`:292-176`).
  5. `controller.applyProviderStatePatch(toSessionStatePatch(event))` (`:177`) — **updates Electron's manager state.**
  6. `handleLifecycle` (`:178`, `:543`) — Stop-hook turn sealing + turn maintenance jobs.
  7. `mirrorCanonicalEvent?.(normalized)` (`:179`) — **forwards to SR. If this throws, the whole per-session queue rejects.**

The patch's `turnEpoch`/`sequence` are derived in `resolveTurnEpoch` / `allocateProviderPatchSequence` (`:375-373`). `mapIntentToObservation` (`:767`) defines the intent→observation mapping the terminal-journey status dots rely on (e.g. `agent.turn_completed → presence.complete`).

> **Queue-throws note:** because `enqueueSessionEvent` does `return await next` (`:201`), any throw in step 6/7 (including a failing SR mirror) rejects the promise returned to the webhook server. Whether the Electron webhook still answers `202` then depends on `createLocalWebhookServer`'s error handling (not opened in this trace — see §8 verification step V1).

---

## 4. The E2E debug-state path — the crux

### 4a. Electron-local debug API (`index.ts:191-243`)

`installMainE2EDebugApi()` installs `globalThis.__VIBECODING_MAIN_E2E__` with `getDebugState()` returning (`index.ts:217-223`):

```ts
{
  webhookPort: projectSessionManager?.snapshot().terminalWebhookPort ?? null,
  sessionSecrets: hookLeaseManager?.debugSnapshotSessionSecrets()
                  ?? sessionEventBridge?.debugSnapshotSessionSecrets() ?? {},
  snapshot: projectSessionManager?.snapshot() ?? null
}
```

So the **Electron-local** debug state is fully self-consistent: webhookPort is Electron's local webhook port, secrets are Electron's per-session secrets, and the snapshot is Electron's manager snapshot.

### 4b. The fixture overrides the snapshot with SR (`fixtures/electron-app.ts:214-254`)

`getMainE2EDebugState` does two evaluations:

1. Electron-local `getDebugState()` (above).
2. `window.stoaElectron.getServerInfo()` → IPC `serverGetInfo` → `getStoaServerWebInfo(srSpawner)` (`index.ts:1921`, `stoa-server-web-info.ts:33`). This returns `available:true` iff SR's `/api/v1/discovery` replies `{ok:true, data:{webClient:true}}` (`stoa-server-web-info.ts:44-61`). **SR is spawned with `--web`** (`stoa-server-spawner.ts:191`), so `available` is `true` in this app.

When `available`, the fixture **fetches SR's `/api/v1/bootstrap`** and returns:

```ts
{
  webhookPort: debugState?.webhookPort ?? null,     // still Electron-local
  sessionSecrets: debugState?.sessionSecrets ?? {}, // still Electron-local
  snapshot: body.data                                // ⚠ SR's snapshot, NOT Electron's
}
```

**Consequence:** every `expect.poll(...)` in the three journeys that reads
`debugState.snapshot.sessions[...]` is polling **SR's** `ProjectSessionManager`
state, while `webhookPort` and `sessionSecrets` still come from Electron. For the
tests to pass, SR's snapshot must reflect (a) sessions created through the UI and
(b) every webhook-driven state transition.

### 4c. Where do sessions and state transitions actually live?

- **Renderer now routes through SR.** `StoaClientPreloadAdapter` (`src/renderer/lib/stoa-client-preload-adapter.ts:98`) maps `createSession` → `POST /api/v1/sessions`, `createProject` → `POST /api/v1/projects`, `getBootstrapState` → `GET /api/v1/bootstrap` (`:72`,`:77`,`:98`). The UI helpers (`tests/e2e-playwright/helpers/ui-actions.ts:25-74`) drive the renderer UI, so **session/project creation lands in SR's manager.** SR persists to its own SQLite DB at `<STOA_DIR>/server.db` (`stoa-server/src/index.ts:68`, `:77-84`). SR's `/bootstrap` returns `manager.snapshot()` (`stoa-server/src/routes/projects.ts:81-84`). So freshly-created sessions DO appear in SR's snapshot — good for the "session exists" assertions.
- **Webhook-driven state transitions live in Electron.** The sidecar env is built with `webhookPort` = Electron-local (`index.ts:1112-1118`, `buildSessionCommandEnv`), and the tests POST to that same Electron port. Electron's `SessionEventBridge` updates **Electron's** manager (`session-event-bridge.ts:177`). SR only learns about these transitions via the **mirror** in step 7 above. (SR's own webhook at `/events`/`/hooks/*` is a *different* server — `stoa-server/src/app.ts:68` — and the tests never post to it.)

So the entire test contract reduces to: **does Electron's mirror successfully push every transition into SR's snapshot?**

---

## 5. The runtime bridge (Electron ⇄ SR)

### 5a. Spawner (`stoa-server-spawner.ts`)

- `spawn()` probes `[3270,3280]` for a free port (`:102-113`), then `fork(entryPoint, ['--port', port, '--web'], { env: { STOA_AUTH_TOKEN, STOA_DIR }, execPath: <node, dev only> })` (`:181-195`). Entry point: `stoa-server/dist/index.cjs` in dev, `resources/stoa-server/index.cjs` packaged (`:310-317`).
- `waitForHealth()` polls `GET /ctl/health` up to 30s (`:119-147`, `:218`).
- `connectRuntime()` calls `deps.createRuntimeClient(port, authToken)` and `client.connect()` (`:245-253`). In `index.ts` that factory (`:1497-1550`) constructs the `StoaRuntimeClient` with deps that delegate back into Electron: `appendTerminalData`, `getTerminalReplay`, `launchSession` (→ `launchSrOwnedSessionRuntime` or `launchSessionRuntimeWithGuard`), `createChildSession`, `markRuntimeExited`.
- Exit/crash handling: on non-zero exit, one auto-restart attempt (`handleCrash`/`restart`, `:337-390`). Graceful shutdown SIGTERM→10s→SIGKILL (`:258-304`); invoked from `before-quit` (`index.ts:1987-2004`).

### 5b. Runtime client (`stoa-runtime-client.ts`)

WebSocket client connecting to `ws://127.0.0.1:<port>/ws?token=<authToken>&role=runtime` (`:138-184`). It handles inbound `runtime:*` commands (`:211-271`) — launch/kill/input/resize/interrupt/get-terminal-replay/create-child-session — and forwards PTY output via `forwardTerminalData` (`:372-378`). Reconnects with exponential backoff (`:404-427`).

### 5c. SR-owned session launch is a "thin" manager (`index.ts:1138-1201`)

When SR sends `runtime:launch` with `{projectId, cwd, type}`, Electron uses `launchSrOwnedSessionRuntime` (`index.ts:1138`), which constructs a `runtimeManager` whose lifecycle hooks are **all no-ops**:

```ts
// index.ts:1161-1170
const runtimeManager: SessionRuntimeManager = {
  async markRuntimeStarting() {},
  async markRuntimeAlive() {},
  async markRuntimeFailedToStart() {},
  async markRuntimeExited() {},
  async appendTerminalData(chunk) { … }
}
```

So Electron's `runtimeController` is **never** told an SR-owned session went starting→alive→exited. The only SR→Electron→SR feedback is terminal-data forwarding (`index.ts:726-730`) and `markRuntimeExited` (`index.ts:1544-1546`). For initial `runtimeState:'alive'`, SR must set that itself when its own `POST /sessions`/launch flow succeeds (SR side not opened here — see V3).

---

## 6. CONFIRMED failure point: the mirror secret mismatch

**This is the strongest finding.** The Electron→SR event mirror is wired with a
secret that SR will reject.

Electron sends (`index.ts:1020`):
```
x-stoa-secret: <event.session_id>
```

SR's `/events` handler validates (`stoa-server/src/routes/webhooks.ts:316-334`):
```ts
const expectedSecret = deps.getSessionSecret?.(body.session_id) ?? null
if (!expectedSecret || c.req.header('x-stoa-secret') !== expectedSecret) {
  return c.json({ accepted:false, reason:'invalid_secret' }, 401)
}
```

And SR wires `getSessionSecret` as (`stoa-server/src/index.ts:196-200`):
```ts
getSessionSecret: (sessionId) => (
  manager.snapshot().sessions.some((s) => s.id === sessionId)
    ? authToken            // ← the SR process auth token
    : null
),
```

with `authToken = process.env.STOA_AUTH_TOKEN ?? 'stoa-dev-token'` (`stoa-server/src/index.ts:60`). The spawner sets `STOA_AUTH_TOKEN` to the generated/loaded token (`stoa-server-spawner.ts:170`,`:319-325`).

➡ **`event.session_id` will never equal `authToken`**, so every mirrored event gets **HTTP 401 `invalid_secret`** from SR, `mirrorCanonicalEventToStoaServer` throws (`index.ts:1025-1027`), and SR's session state for that event is **never applied**. The `SessionEventProcessor` (`stoa-server/src/index.ts:188-191`) is the intended applier (`onEvent → sessionEventProcessor.processEvent`), but it never runs for mirrored events.

**Downstream impact on the journeys (high confidence):**

- **session-event-journey**: All state assertions poll SR's snapshot. After a webhook event is processed by Electron, the mirror throws, SR's snapshot is unchanged, so `toMatchObject({ runtimeState:'alive', turnState:'idle', lastTurnOutcome:'completed', hasUnseenCompletion:true, … })` (`session-event-journey.test.ts:123-132`, `:183-190`, `:240-249`, `:294-303`, `:428-436`, `:487-490`) never matches → `expect.poll` times out. The 401 may additionally break the Electron webhook's `202`/`204` response (depends on V1).
- **terminal-journey (codex hooks)**: The fake-codex driver (`terminal-journey.test.ts:15-95`) invokes the local hook dispatcher, which hits Electron's webhook. The ready→running→complete status-dot transitions (`:207-229`) depend on those events reaching SR's snapshot (which feeds the renderer via SR WS) — blocked by the same 401.
- **recovery-journey**: State propagation for `runtimeState:'alive'` after relaunch has the same dependency (see §7).

**Likely intended wiring (to confirm):** Electron should mirror with
`x-stoa-secret: srSpawner.getAuthToken()` (matching SR's `getSessionSecret`), not
`event.session_id`. Note SR's secret model is "one shared authToken for any known
session" — so the per-session secret Electron keeps (`sessionEventBridge.sessionSecrets`)
is irrelevant on the SR side.

---

## 7. Secondary risks / open questions

- **R1 — Bootstrap-recovery does not reach SR.** `buildBootstrapRecoveryPlan()` runs against **Electron's** manager (`index.ts:1970`) and calls `launchSessionRuntimeWithGuard(...,'bootstrap-recovery')`. This updates Electron's manager via `runtimeController.markRuntimeStarting/Alive` (patched, `index.ts:700-710`) but generates no canonical event to mirror. SR would only learn the session is alive if SR independently re-launches or if the recovered session emits terminal data. For `recovery-journey`'s `waitForSessionState(... 'alive')` against SR's snapshot after relaunch, this is a second plausible timeout (independent of §6). [V3]
- **R2 — Secrets come from Electron, snapshot from SR.** Even with §6 fixed, `session-event-journey`'s `invalid webhook secret does not update UI` test (`session-event-journey.test.ts:444-496`) posts with a deliberately wrong secret and asserts the snapshot is unchanged. That works only if the secret the test reads (`debugState.sessionSecrets[id]`) is the secret the **Electron** webhook expects. It is (Electron-local), so this specific sub-test is internally consistent. But any future test that posts to SR's webhook would need SR's authToken, not Electron's per-session secret — a latent footgun. [V2]
- **R3 — `connectRuntime()` failure mode.** If the WS connection fails, `srSpawner.connectRuntime()` throws (`stoa-server-spawner.ts:245-253`) and the whole `app.whenReady()` promise rejects → `app.exit(1)` (`index.ts:1980-1985`), so the app would never reach the window — every journey would fail to launch. Worth ruling out if journeys fail at `app-viewport` visibility rather than at state polling.
- **R4 — Dual `applyProviderStatePatch` patching.** `index.ts:732-736` and `:761-767` both reassign `runtimeController.applyProviderStatePatch`; the second (`:761`) wins and also triggers title generation. Functionally fine, but the double-override is fragile and worth noting for anyone editing this region.
- **R5 — `mirrorCanonicalEvent` is best-effort by design but throws.** The option type allows `void` return (`session-event-bridge.ts:46`), but the implementation throws on non-OK. If the intent was "mirror is best-effort, never break ingestion," the throw at `index.ts:1026` contradicts that. [V1]

---

## 8. Suggested verification steps (do NOT require this trace's assumptions)

- **V1** — Open `src/core/webhook-server.ts` and confirm what HTTP status `createLocalWebhookServer` returns when `onEvent` rejects. This decides whether §6 manifests as a wrong status code (failing `expect(response.status).toBe(202)`) or a silent snapshot stall (failing `expect.poll`).
- **V2** — Add a temporary log in `mirrorCanonicalEventToStoaServer` printing `response.status` + `event.session_id`; run one `session-event-journey` test. Expectation per this trace: `401`. This is the fastest confirmation of §6.
- **V3** — Open `stoa-server/src/routes/sessions.ts` `POST /sessions` + `SessionEventProcessor.processEvent` to confirm (a) whether SR marks a freshly-created session `alive` on its own, and (b) whether SR ever learns `runtimeState` for sessions whose runtime Electron owns. This bounds R1.
- **V4** — Confirm the renderer in this Electron build actually uses `StoaClientPreloadAdapter` (vs. the Electron IPC `RendererApi`). `src/renderer/main.ts` / the store plugin wiring decides which backend the UI hits; if the renderer still uses IPC, then sessions land in Electron's manager (not SR), SR's `/bootstrap` is empty, and §4b's snapshot override would return no sessions at all — a different but equally breaking failure.

---

## 9. File / citation map

| Concern | File:line |
|---|---|
| App startup order, manager/bridge/spawner construction | `src/main/index.ts:495-1008` |
| SR spawn + runtime connect | `src/main/index.ts:1481-1558`, `stoa-server-spawner.ts:181-253` |
| `webhookPort` origin + test POST target | `session-event-bridge.ts:119-153`, `index.ts:990`, `fixtures/electron-app.ts:297` |
| Electron-local debug API (`__VIBECODING_MAIN_E2E__`) | `index.ts:191-243`, `index.ts:1007` |
| Fixture dual-source debug snapshot (SR override) | `fixtures/electron-app.ts:214-254` |
| `getServerInfo` / `available` flag | `index.ts:1921-1923`, `stoa-server-web-info.ts:33-65`, `src/preload/index.ts:23-25/87` |
| Event ingestion + mirror trigger | `session-event-bridge.ts:159-202`, `:177-179` |
| **Mirror secret = session_id (BUG)** | `index.ts:1010-1028` (esp. `:1020`) |
| SR `/events` secret check | `stoa-server/src/routes/webhooks.ts:316-334` |
| **SR `getSessionSecret = authToken` (mismatch)** | `stoa-server/src/index.ts:196-200`, `:60` |
| SR `/bootstrap` returns SR manager | `stoa-server/src/routes/projects.ts:81-84` |
| Renderer routes create/bootstrap through SR | `src/renderer/lib/stoa-client-preload-adapter.ts:72/77/98` |
| SR-owned runtime launch (no-op lifecycle hooks) | `index.ts:1138-1201` (esp. `:1161-1170`) |
| Terminal-data forwarding to SR | `index.ts:726-730`, `stoa-runtime-client.ts:372-378` |
| Bootstrap recovery (Electron-local) | `index.ts:1970-1972`, `project-session-manager.ts:370-383` |
| `buildBootstrapRecoveryPlan` actions | `src/core/project-session-manager.ts:370-383` |
| SR persistence (SQLite, own DB) | `stoa-server/src/index.ts:67-84` |
| Journey test assertions | `tests/e2e-playwright/{recovery,terminal,session-event}-journey.test.ts` |

---

## 10. One-line summary

The journeys poll SR's `/api/v1/bootstrap` snapshot (via the fixture's SR override),
but webhook-driven state transitions are processed only in Electron and mirrored
to SR with `x-stoa-secret: <session_id>` (`index.ts:1020`), which SR rejects
because its `getSessionSecret` returns the SR `authToken` for known sessions
(`stoa-server/src/index.ts:196-200`). The mirror therefore returns 401 for every
event, SR's snapshot stays stale, and every `expect.poll` against
`runtimeState`/`lastTurnOutcome`/`hasUnseenCompletion` times out.
