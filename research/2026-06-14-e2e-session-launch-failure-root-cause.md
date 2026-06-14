# E2E Session-Launch Failure — Root-Cause Report (Cited)

**Date:** 2026-06-14
**Scope:** Read-only diagnosis of the two `npm run test:e2e` failures recorded in `test-results/.last-run.json`, both in `tests/e2e-playwright/project-session-journey.test.ts`.
**Companion doc:** `research/2026-06-14-e2e-hang-diagnosis-context.md` (process-lifecycle context; its R1–R9 hang hypotheses do **not** explain this failure — see §6).
**Depth:** gathered at depth=2 / max_depth=2; no further headless dispatched.

---

## 1. TL;DR

The two failures are **not a process hang** — they are a fast (sub-second) **session-creation failure**. The app launches fine, the project is created fine, the provider picker opens, the provider is clicked — but the resulting `session-row` never appears because:

> **Architectural desync after the "Stoa Server/Client separation" (commit `9b8f42c`).** Session *records* are now created on the Stoa Server side (renderer → HTTP → SR SQLite at `~/.stoa/server.db`), but session *runtime launch* is still commanded into Electron and resolved against Electron's **local** `ProjectSessionManager` (JSON at `{VIBECODING_STATE_DIR}/global.json`). The SR→Electron `runtime:launch` RPC carries only `{ sessionId, cols, rows, cwd }` and **no session record**, and there is **no SR→Electron session-state provisioning**. So Electron's `launchTrackedSessionRuntime` cannot find the session (`launch-tracked-session-runtime.ts:38-42`), returns `false`, the launch RPC throws, SR rolls the session back (`stoa-server/src/routes/sessions.ts:194-201`), the renderer's HTTP call rejects, `workspaceStore.addSession` is never called (`src/renderer/app/App.vue:90`), and no `session-row` is ever rendered. Playwright then times out at the 10 s `expect` (`project-session-journey.test.ts` → `helpers/ui-actions.ts:69`).

---

## 2. Exact failure symptoms (from artifacts)

### `test-results/.last-run.json`
```json
{ "status": "failed",
  "failedTests": ["0097543471ffe684a313-d93a23988d1286fc89d9", "0097543471ffe684a313-8b273217725c1330b0eb"] }
```
Two test IDs failed. `status` is `failed`, **not** `timedout`/`interrupted` — this is a completed (not hung) run for these two tests.

### Test 1 — `tests/e2e-playwright/project-session-journey.test.ts:7` "shell journey"
Artifact dir: `test-results/e2e-playwright-project-ses-c2fd5-sion-journeys-shell-journey-electron/`
From `error-context.md`:
```
Error: expect(locator).toBeVisible() failed
Locator: locator('[data-testid="session-row"][data-session-title="shell-1"]').first()
Expected: visible   Timeout: 10000ms   Error: element(s) not found
  at helpers/ui-actions.ts:69 (createSession)
```

### Test 2 — `tests/e2e-playwright/project-session-journey.test.ts:34` "opencode journey"
Artifact dir: `test-results/e2e-playwright-project-ses-069a7-n-journeys-opencode-journey-electron/`
From `error-context.md`:
```
Error: expect(locator).toBeVisible() failed
Locator: locator('[data-testid="session-row"][data-session-title="opencode-demo-opencode-project"]').first()
Expected: visible   Timeout: 10000ms   Error: element(s) not found
  at helpers/ui-actions.ts:69 (createSession)
```

Both fail at the **same line** (`helpers/ui-actions.ts:69`) with the same shape: the expected `session-row` is never created.

---

## 3. Execution trace reconstruction (what succeeded, what failed)

Decoded from `test.trace` (JSON-lines) in the shell-journey artifact. Step titles in order:

1. ✅ Launch electron
2. ✅ Wait for event "window" (`firstWindow`)
3. ✅ Expect `app-viewport` visible
4. ✅ Expect `command-panel` visible
5. ✅ Evaluate `queueNextFolderPick`
6. ✅ Click `workspace.new-project`
7. ✅ Expect "New project" dialog visible
8. ✅ Fill Project name
9. ✅ Click Browse → ✅ Expect Project path value
10. ✅ Click Create
11. ✅ **Expect `project-row[data-project-name="demo-shell-project"]` visible** ← project creation **succeeded**
12. ✅ Expect attribute `data-project-name`
13. ✅ Get attribute (resolve projectName)
14. ✅ Query `count('[data-testid="session-row"]')` (= 0)
15. ✅ Evaluate `dispatchQuickAddSessionPress` (deterministic short-press on `workspace.add-session`)
16. ✅ **Expect `provider-card` visible** ← provider picker **opened**
17. ✅ **Click `provider-card [data-provider-type="shell"]`** ← provider **was clicked**
18. ❌ **Expect `session-row[data-session-title="shell-1"]` visible → FAILED (10 s, element not found)**

**Inference:** everything up to and including the provider click works. The failure is purely in the backend session-creation/launch round-trip that the click triggers. (Identical sequence holds for the opencode journey; the only difference is the expected title.)

Also note: because steps 1–4 succeeded, `src/main/index.ts:1879 createMainWindow()` was reached, which means the SR bootstrap chain (`index.ts:1481-1484`: `srSpawner.spawn()` → `waitForHealth()` → `connectRuntime()`) **completed**. The runtime-bridge WebSocket was connected at startup. SR was healthy enough to create the project (step 11).

---

## 4. Root cause — architectural desync (cited evidence chain)

### 4a. Renderer creates sessions over HTTP to SR (not via Electron IPC)

- `src/renderer/app/App.vue:77-95` `handleSessionCreate`:
  ```ts
  const stoa = requireRendererApi()
  const created = await stoa.createSession({ projectId, type, title })  // App.vue:81
  if (!created) { workspaceStore.lastError = ...; return }              // App.vue:86-88
  workspaceStore.addSession(created)                                    // App.vue:90  ← never reached on failure
  workspaceStore.setActiveSession(created.id)                           // App.vue:91
  ```
  On rejection: `catch (err) { workspaceStore.lastError = ... }` (`App.vue:93-94`). The error is swallowed into `lastError`; no session is added; **no DOM element is produced for the test to observe.**

- `requireRendererApi()` resolves to the `StoaClientPreloadAdapter` (`src/renderer/bootstrap-electron.ts:34` → `window.stoa = adapter`; `src/renderer/app/App.vue:22` imports it from `@renderer/stores/stoa-store-plugin`).

- `src/renderer/lib/stoa-client-preload-adapter.ts:98-100`:
  ```ts
  async createSession(request: CreateSessionRequest): Promise<SessionSummary> {
    const res = await this.client.post<SessionSummary>('/api/v1/sessions', request)
    return res.data!
  }
  ```
  → HTTP `POST /api/v1/sessions` to the SR child process.

### 4b. SR creates the session in its own store, then asks Electron to launch it

- `stoa-server/src/routes/sessions.ts:140-202` `POST /sessions`:
  ```ts
  session = await manager.createSession(request)                        // sessions.ts:182  ← SR-side record
  ...
  await runtimeBridge.launch(session.id, buildLaunchOptions(...))       // sessions.ts:194  ← RPC to Electron
  return c.json(envelope(session), 201)
  ```
  with rollback on launch failure:
  ```ts
  } catch (error) {
    await manager.deleteSessionRecord(session.id)                       // sessions.ts:200  ← rollback
    throw error                                                         // sessions.ts:201  → 500 to renderer
  }
  ```

- `buildLaunchOptions` (`stoa-server/src/routes/sessions.ts:84-92`) returns only `{ cwd, cols, rows }`. **The session record (type/title/projectId) is NOT included in the launch command.**

### 4c. The `runtime:launch` wire payload carries no session record

- `stoa-server/src/ws/runtime-bridge-handler.ts`:
  - `RuntimeCommand` shape = `{ type, sessionId, payload, replyTo }` (`runtime-bridge-handler.ts:33-38`). No session fields.
  - Launch routing (`runtime-bridge-handler.ts:378-381`) just picks the provider; `assignSession` (`runtime-bridge-handler.ts:386-393`) only records the sessionId→provider mapping **after** a successful launch.
  - `runtime:launch` timeout = 30 s (`runtime-bridge-handler.ts:70`). (Irrelevant here — the failure is fast, not a timeout; see §5.)

### 4d. Electron resolves the launch against its LOCAL manager — which never received the SR-created session

- `src/main/stoa-runtime-client.ts:271-295` `handleLaunch`:
  ```ts
  const launched = await this.deps.launchSession(sessionId, {...})      // runtime-client.ts:286
  if (!launched) { throw new Error(`Failed to launch session ${sessionId}`) }  // runtime-client.ts:290-292
  ```
- `launchSession` dep is wired at `src/main/index.ts:1444-1447`:
  ```ts
  launchSession: async (sessionId, options) => {
    return await launchSessionRuntimeWithGuard(sessionId, 'session-restart', { initialDimensions: ... })
  }
  ```
- `src/main/launch-tracked-session-runtime.ts:37-46`:
  ```ts
  const snapshot = options.manager.snapshot()                           // launch-tracked-session-runtime.ts:38
  const session = snapshot.sessions.find((c) => c.id === options.sessionId)  // :39
  if (!session) { return false }                                        // :40-42  ← returns false for SR-created sessions
  const project = snapshot.projects.find((c) => c.id === session.projectId)  // :44
  if (!project) { return false }                                        // :45-46
  ```
  `options.manager` is Electron's local `projectSessionManager` (`src/main/index.ts:1100` passes `manager: projectSessionManager`).

### 4e. The two managers use completely separate state stores

- Electron local manager: `src/main/index.ts:498-500`
  ```ts
  projectSessionManager = await ProjectSessionManager.create({
    webhookPort: null,
    globalStatePath: e2eGlobalStatePath     // index.ts:500
  })
  ```
  `e2eGlobalStatePath` (`src/main/index.ts:164-165`):
  ```ts
  const e2eGlobalStatePath = process.env.VIBECODING_STATE_DIR
    ? join(process.env.VIBECODING_STATE_DIR, 'global.json') : ...
  ```
  → **JSON file** at `{tempStateDir}/global.json`.

- SR manager: `stoa-server/src/index.ts:66-68`
  ```ts
  const STOA_DIR = join(homedir(), '.stoa')          // hardcoded; does NOT read VIBECODING_STATE_DIR
  const DB_PATH = join(STOA_DIR, 'server.db')         // SQLite
  ```
  → **SQLite** at `~/.stoa/server.db`, env-independent.

**Conclusion:** SR writes the session to `~/.stoa/server.db` (SR's in-memory + SQLite). Electron's `projectSessionManager` reads from `{VIBECODING_STATE_DIR}/global.json` (Electron's in-memory + JSON). They share **no** state. There is **no** SR→Electron session-record provisioning anywhere in the codebase (confirmed by grep: the only inbound messages the runtime client handles are `runtime:*` commands — `src/main/stoa-runtime-client.ts:219-224`; graph events flow Electron→renderer via `IPC_CHANNELS.sessionGraphEvent` at `src/main/index.ts:654`, and Electron→SR via `mirrorCanonicalEvent` at `src/main/index.ts:893-894`).

### 4f. Title generation is NOT the cause (ruled out)

The expected titles (`shell-1`, `opencode-demo-opencode-project`) match SR's resolver exactly:
- `stoa-server/src/services/project-session-manager.ts:354-373` `resolveDefaultWorkSessionTitle`:
  - shell → `shell-${shellCount+1}` → `shell-1` for the first shell (`:361-366`).
  - others → `${titlePrefix}-${project.name}` → `opencode-demo-opencode-project` (`:368-373`, `titlePrefix='opencode'` at `:355`).
- This mirrors `src/shared/provider-descriptors.ts` `titlePrefix: 'opencode'` and the test's own computation at `tests/e2e-playwright/helpers/ui-actions.ts:56-58`. Titles are consistent; the session simply does not exist long enough to be rendered (it is rolled back at `sessions.ts:200`).

---

## 5. Why this manifests as a 10 s `expect` failure, not a 30 s launch timeout

The launch failure is **fast and synchronous-looking** from the renderer's perspective:

1. Renderer `POST /api/v1/sessions` → SR.
2. SR `manager.createSession` (fast, in-memory + DB write).
3. SR `runtimeBridge.launch` → WS round-trip to Electron (local loopback, ms).
4. Electron `launchTrackedSessionRuntime` `snapshot().sessions.find()` → `undefined` → returns `false` immediately (`launch-tracked-session-runtime.ts:40-42`).
5. `handleLaunch` throws (`stoa-runtime-client.ts:291`), runtime client replies `{ok:false}` (`stoa-runtime-client.ts:262-263`).
6. SR `runtimeBridge.launch` rejects with `provider_rejected` (`runtime-bridge-handler.ts:437-445`).
7. SR `catch` → `deleteSessionRecord` + rethrow → HTTP 409/500 (`sessions.ts:198-201`).
8. Renderer `stoa.createSession` rejects → `handleSessionCreate` catch → `lastError` set, **no `addSession`** (`App.vue:93-94`).

Total: well under 1 s. The test's `await expect(sessionRow).toBeVisible()` (`helpers/ui-actions.ts:69`) then polls for the full 10 s `expect.timeout` (`playwright.config.ts:8`) on a locator that will never match, and reports "element(s) not found". The 30 s `runtime:launch` timeout (`runtime-bridge-handler.ts:70`) is never reached because the provider **rejects** rather than going silent.

---

## 6. Why the prior hang hypotheses (R1–R9) do not explain *this* failure

`research/2026-06-14-e2e-hang-diagnosis-context.md` lists nine hang/leak risks (webhook `stop()` unbounded, SR `process.exit(1)` on SQLite ABI, `before-quit` re-entrancy, orphaned SR, etc.). None match the observed evidence:

| Hypothesis | Why it does not fit these two failures |
|---|---|
| R1 webhook `stop()` hang | Would manifest at **teardown** (`before-quit`), after a session exists. Here no session is ever created; teardown is not the failure point. |
| R2 SR `process.exit(1)` on SQLite ABI | SR booted and **created a project** successfully (trace step 11). SR did not exit. |
| R3 `before-quit` re-entrancy | Teardown issue; irrelevant to creation. |
| R4 port-range exhaustion | Would surface as `app.exit(1)` with no window; the window opened (trace steps 1–4). |
| R5 orphaned SR on Windows SIGKILL | Process-leak/teardown issue; does not prevent the first session creation. |
| R6 runtime-client reconnect storm | Self-limiting noise; not a creation blocker. |
| R7 `firstWindow()` no timeout | `firstWindow()` **resolved** (trace step 2). |

The actual failure is a **functional/architectural** bug in the session-creation path introduced by the SR/Client separation, not a process-lifecycle hang. (A separate hang *could* co-exist in other journey specs at teardown — see §8 — but it is not what `test-results/` currently records.)

---

## 7. Evidence index (file:line)

| Claim | Citation |
|---|---|
| Last run = 2 failed tests, status `failed` | `test-results/.last-run.json` |
| Both fail at `helpers/ui-actions.ts:69` `expect(sessionRow).toBeVisible()` | `test-results/e2e-playwright-project-ses-*/error-context.md` |
| Test bodies | `tests/e2e-playwright/project-session-journey.test.ts:7,34` |
| Trace: project created, provider clicked, session-row never appears | `test-results/e2e-playwright-project-ses-c2fd5-sion-journeys-shell-journey-electron/test.trace` |
| Renderer `handleSessionCreate` → `stoa.createSession` → `addSession` (skipped on reject) | `src/renderer/app/App.vue:77-95` |
| Renderer API = `StoaClientPreloadAdapter` (HTTP) | `src/renderer/bootstrap-electron.ts:34`; `src/renderer/lib/stoa-client-preload-adapter.ts:98-100` |
| SR `POST /sessions`: create → `runtimeBridge.launch` → rollback on error | `stoa-server/src/routes/sessions.ts:140-202` (esp. `:182,194,200,201`) |
| `runtime:launch` carries no session record | `stoa-server/src/ws/runtime-bridge-handler.ts:33-38,378-381`; `buildLaunchOptions` `sessions.ts:84-92` |
| Electron `handleLaunch` throws if `launchSession` returns false | `src/main/stoa-runtime-client.ts:286-292` |
| `launchSession` dep → `launchSessionRuntimeWithGuard` | `src/main/index.ts:1444-1447` |
| `launchTrackedSessionRuntime` looks up session in local manager, returns false if absent | `src/main/launch-tracked-session-runtime.ts:37-46` |
| Electron local manager state = JSON at `VIBECODING_STATE_DIR/global.json` | `src/main/index.ts:164-165,498-500` |
| SR state = SQLite at `~/.stoa/server.db` (hardcoded) | `stoa-server/src/index.ts:66-68` |
| SR title resolver matches expected titles | `stoa-server/src/services/project-session-manager.ts:354-373` |
| No SR→Electron session provisioning (only `runtime:*` inbound) | `src/main/stoa-runtime-client.ts:205-224` |
| App launched ⇒ SR bootstrap + `connectRuntime` completed (window created) | `src/main/index.ts:1481-1484,1879` |

---

## 8. Notes for the fix agent (not implementation, just direction)

The split moved session **state** to SR but left session **launch** resolved against Electron's local manager. Reconciling requires one of (each is a breaking design decision — out of scope to pick here, but the gap is precisely defined):

1. **Provision the session record to Electron before launch.** Either include the full session (and its project) in the `runtime:launch` payload, or add an SR→Electron "session upsert" message that `stoa-runtime-client` applies to the local `projectSessionManager` before `handleLaunch` runs. (Note: the local manager is a JSON-backed `ProjectSessionManager`; SR is SQLite-backed — the record shapes must be reconciled.)
2. **Make launch not depend on the local manager.** Refactor `launchTrackedSessionRuntime` to receive the session/project it needs via the RPC payload (or a fetch-back to SR) instead of `manager.snapshot()`.
3. **Re-unify state ownership.** Either Electron stops maintaining a local session store (becomes purely a runtime provider), or SR stops owning session records. (Heaviest change.)

Additional things to verify once a fix is chosen:
- Confirm whether **other** Electron-project specs that create sessions (`recovery-journey`, `session-event-journey`, `terminal-journey`, `tests/generated/playwright/*`) hit the same path and will flip green together — or use a different creation route.
- Confirm the perceived "hang" (task title) is not a **separate** teardown hang in a later spec that runs after these two under `workers:1` (R1/R5 territory). The current `test-results/` only captures the two creation failures; if the full `npm run test:e2e` was interrupted, the hang evidence would be in console output, not in `test-results/`.

---

## Context Handoff

- **Saved report path:** `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-e2e-session-launch-failure-root-cause.md`
- **One-line root cause:** SR creates the session record (HTTP/SQLite `~/.stoa`) but `runtime:launch` (SR→Electron WS) carries no record and Electron resolves launch against its own local JSON manager (`VIBECODING_STATE_DIR/global.json`) where the session does not exist → `launchTrackedSessionRuntime` returns false (`src/main/launch-tracked-session-runtime.ts:40-42`) → SR rolls back (`stoa-server/src/routes/sessions.ts:200-201`) → renderer never calls `addSession` (`src/renderer/app/App.vue:90`) → no `session-row` → 10 s `expect` failure.
- **Highest-value fix locus:** the SR→Electron session-record provisioning gap — either in the `runtime:launch` payload (`stoa-server/src/routes/sessions.ts:84-92` + `stoa-server/src/ws/runtime-bridge-handler.ts:33-38`) or in `launch-tracked-session-runtime.ts:37-46` (stop depending on the local manager).
- **Depth note:** gathered at depth=2/max_depth=2; no further headless dispatched.
