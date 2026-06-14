---
date: 2026-06-14
topic: Electron Playwright E2E fixture debug helper contract + recovery/session-event/terminal/generated journey expectations
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Electron Playwright E2E fixture debug contract & journey expectation matrix

### Why This Was Gathered
A downstream agent needs to repair failing Playwright E2E journeys. The fix surface spans the
Electron main-process debug bridge (`__VIBECODING_MAIN_E2E__`), the shared fixture that wraps it
(`tests/e2e-playwright/fixtures/electron-app.ts`), and the expectations asserted by
`recovery-journey`, `session-event-journey`, `terminal-journey`, and the two generated specs
`session-restore.generated.spec.ts` / `session-telemetry-claude-lifecycle.generated.spec.ts`.
This report pins the contract surface and the exact expectation matrix so the fix can target the
real drift without re-deriving it.

### Summary
The debug helper contract is a single global `globalThis.__VIBECODING_MAIN_E2E__` exposed by the
Electron main process **only in E2E mode**, with 7 methods. The fixture declares its **own local
6-method `MainE2EDebugApi`** that has drifted (missing `getDebugModeActive`); it only type-checks
because the main process also emits an ambient `declare global`. Journeys assert against two
distinct surfaces: (1) the debug-state snapshot (`getMainE2EDebugState().snapshot.sessions[*]`) for
state machine fields, and (2) DOM attributes on the status dot (`data-session-status-testid`,
`data-phase`, `data-tone`, `.route-session-label`). The status-id is **derived** from phase
(`"session-status-" + phase`), so phase and status-id cannot disagree at the source.

### The debug bridge contract

**Canonical 7-method interface — source of truth.** Defined once in the main process and gated on
`isE2EMode`:

- Interface: `src/main/index.ts:197-205` — `getDebugState`, `queueDialogPickFolder`,
  `getTerminalReplay`, `appendTerminalData`, **`getDebugModeActive`** (line 202),
  `getWorkspaceOpenRequests`, `clearWorkspaceOpenRequests`.
- Ambient global: `src/main/index.ts:207-209` — `declare global { var __VIBECODING_MAIN_E2E__: MainE2EDebugApi | undefined }`.
- Installer: `src/main/index.ts:211-243` (`installMainE2EDebugApi`, no-op unless `isE2EMode`).
  - `getDebugState` → `{ webhookPort, sessionSecrets, snapshot }` from
    `projectSessionManager.snapshot()` + `hookLeaseManager`/`sessionEventBridge.debugSnapshotSessionSecrets()`.
  - `getDebugModeActive` → returns the `debugModeActive` flag (line 233-235).
  - `getTerminalReplay`/`appendTerminalData` → delegate to `runtimeController`.

**Fixture-local 6-method interface — DRIFTED duplicate.**
`tests/e2e-playwright/fixtures/electron-app.ts:30-37` declares `MainE2EDebugApi` with only 6
methods — **`getDebugModeActive` is absent**. Every helper casts `globalThis as typeof globalThis &
{ __VIBECODING_MAIN_E2E__?: MainE2EDebugApi }`. Because the main process's ambient global intersects
in, the property resolves to `(7-method) & (6-method) | undefined`, so `api?.getDebugModeActive()`
at `electron-app.ts:261` still compiles. The fixture's local interface is a misleading,
hand-maintained copy that is already one method behind the main process.

**Exported fixture helpers (the consumer-facing contract).** All in
`tests/e2e-playwright/fixtures/electron-app.ts`:

| Helper | Line | Purpose |
|---|---|---|
| `createStateDir` | 39 | temp dir via `createTestTempDir` |
| `resolveElectronMainEntrypoint` / `ensureElectronMainEntrypoint` | 43 / 47 | `out/main/index.cjs`; throws if missing ("run `npm run build` first") |
| `launchElectronApp` | 110 | env `NODE_ENV=test`,`VIBECODING_E2E=1`,`VIBECODING_STATE_DIR`; deletes `ELECTRON_RENDERER_URL`; waits for `app-viewport` + `command-panel` testids |
| `cleanupStateDir` | 164 | 20 retries, tolerates `EBUSY` |
| `readTerminalBuffer` / `appendTerminalData` / `waitForTerminalBufferText` | 179 / 191 / 204 | terminal replay channel |
| `getMainE2EDebugState` | 214 | snapshot + port + secrets (see below) |
| `getDebugModeActive` | 256 | **references the drifted method** |
| `queueNextFolderPick` / `clearWorkspaceOpenRequests` / `getWorkspaceOpenRequests` | 265 / 277 / 286 | E2E dialog interception |
| `postWebhookEvent` | 297 | POST `/events`, header `x-stoa-secret`, body = canonical event |
| `postClaudeHookEvent` | 318 | POST `/hooks/claude-code`, headers `x-stoa-secret` + `x-stoa-session-id` + `x-stoa-project-id`, body = raw hook |

**`getMainE2EDebugState` precedence (line 214-254).** Always returns
`{ webhookPort, sessionSecrets, snapshot }` where `webhookPort` + `sessionSecrets` come from the
**Electron-local** `getDebugState()`. The `snapshot` is **upgraded** from the Stoa Runtime (SR)
`/api/v1/bootstrap` endpoint when `page.evaluate(stoaElectron.getServerInfo())` reports a server
available; otherwise the Electron-local snapshot is returned. So `webhookPort`/`sessionSecrets`
do **not** require SR to be spawned.

**`LaunchedElectronApp` lifecycle (line 14-22, 135-162).**
- `close()` (139) — `closeElectronAppWithTimeout` 5 s race, SIGKILL fallback, then `waitForProcessExit`.
- `kill()` (143) — SIGKILL + `waitForProcessExit` + `disposeElectronAppConnection`.
- `killAndRelaunch()` (149) — hard kill then relaunch with **same `stateDir` + same `options.env`** (used by recovery-journey shell test).
- `relaunch()` (156) — graceful close then relaunch with **same `stateDir` + same `options.env`** (used by recovery-journey opencode test).

### Status-dot DOM contract (shared by all 4 journeys)

Rendered once at `src/renderer/components/command/WorkspaceHierarchyPanel.vue:546-555`:
- `data-testid="session-status-dot"`
- `:data-tone="sessionTone"` — `sessionRowViewModel.tone ?? 'neutral'` (line 227-229).
- `:data-phase="sessionPhase"` — `sessionRowViewModel.phase ?? (runtimeState==='exited' ? 'complete' : 'unknown')` (line 246-248).
- `:data-session-status-testid="session-status-${sessionPhase}"` — **derived from phase** (line 549).
- `.route-session-label` — `sessionStatusLabel` (line 235-244): `primaryLabel + updatedAgoLabel`.

Topology source-of-truth: `testing/topology/session-status.topology.ts:10-16` — status IDs
`ready|running|complete|blocked|failure`.

Snapshot field shape (what `getMainE2EDebugState().snapshot.sessions[*]` returns):
`SessionSummary` at `src/shared/project-session.ts:122-149` — `runtimeState`, `turnState`,
`turnEpoch`, `lastTurnOutcome`, `blockingReason`, `failureReason`, `hasUnseenCompletion`,
`runtimeExitCode`, `runtimeExitReason ('clean'|'failed'|null)`, `recoveryMode` (`SessionRecoveryMode`
= `'fresh-shell'|'resume-external'`, line 42), `externalSessionId`.

### Expectation matrix — recovery-journey (`tests/e2e-playwright/recovery-journey.test.ts`)

Helpers: `waitForSessionState(app, title, predicate)` (line 10) and `waitForSessionByTitle` (line 22),
both built on `getMainE2EDebugState`.

- **"shell recovery" (37)**: create `shell` session → assert `recoveryMode === 'fresh-shell'` (53) →
  `killAndRelaunch()` (55) → recovered row visible + `aria-current='true'` → id preserved (65),
  `recoveryMode === 'fresh-shell'` (66), `runtimeState === 'alive'` (67) → terminal viewport shows
  `terminal-xterm` + `terminal-xterm-mount`, zero `terminal-empty-state` (71-73) → nav to settings
  and back keeps terminal mounted (75-80).
- **"opencode recovery" (86)**: create `opencode` session → `recoveryMode === 'resume-external'` (100) →
  `relaunch()` (102) → id preserved (112), `recoveryMode === 'resume-external'` (113),
  `externalSessionId` preserved (114), `data-session-type='opencode'` (117) → `terminal-xterm` +
  `terminal-xterm-mount` visible (120-121).

### Expectation matrix — session-event-journey (`tests/e2e-playwright/session-event-journey.test.ts`)

All tests follow `createSession` → wait `runtimeState==='alive'` → read `webhookPort` + per-session
`secret` → POST event → assert status + DOM + polled snapshot.

1. **"session event projection" (78)** — canonical `session.completed` (`agent.turn_completed`,
   `summary:'session.idle'`) → HTTP 202; status `session-status-complete`; snapshot
   `{ runtimeState:'alive', turnState:'idle', lastTurnOutcome:'completed', hasUnseenCompletion:true, summary:'session.idle' }` (126-132).
2. **"webhook-driven UI update" (140)** — canonical `session.completed` (`runtime.exited_clean`,
   `runtimeExitCode:0`, `runtimeExitReason:'clean'`, `summary:'session.completed'`) → 202; status
   `session-status-ready`; snapshot `{ runtimeState:'exited', runtimeExitReason:'clean', summary:'session.completed' }` (186-190).
3. **"completion webhook projection" (198)** — codex session, `session.completed`
   (`agent.turn_completed`, `summary:'Turn complete'`) → 202; status `session-status-complete`;
   snapshot `{ runtimeState:'alive', turnState:'idle', lastTurnOutcome:'completed', hasUnseenCompletion:true, summary:'Turn complete' }` (243-249).
4. **"claude raw Stop hook without an open turn …" (257)** — `postClaudeHookEvent`
   `{ hook_event_name:'Stop' }` → HTTP 204; status `session-status-ready`; snapshot
   `{ runtimeState:'alive', turnState:'idle', lastTurnOutcome:'none', hasUnseenCompletion:false, summary:'Stop' }` (297-303).
5. **"claude activity hook moves a ready session back to running" (311)** — `UserPromptSubmit`→204→
   `session-status-running`; `Stop`→204→`session-status-complete`; row click→`session-status-ready`;
   `UserPromptSubmit`→204→`session-status-running`, asserts `data-phase='running'`,
   `data-tone='success'`, `.route-session-label` contains `'Running'` (375-377).
6. **"claude PermissionRequest hook keeps the terminal mounted …" (385)** — `PermissionRequest`→204;
   `session-status-blocked`, `data-phase='blocked'`, `data-tone='warning'`, **no** `terminal-status-bar`
   (422), terminal still mounted (424-426); snapshot `{ runtimeState:'alive', turnState:'running', blockingReason:'permission', summary:'PermissionRequest' }` (431-436).
7. **"invalid webhook secret does not update UI" (444)** — wrong `x-stoa-secret` → HTTP 401; status
   dot unchanged; polled snapshot deep-equals the pre-event snapshot (490).

### Expectation matrix — terminal-journey (`tests/e2e-playwright/terminal-journey.test.ts`)

Uses `installFakeCodex` (15) which writes a `fake-codex.cmd/.sh` wrapper + `fake-codex-driver.mjs`
that spawns `.stoa/hook-dispatch.mjs` with codex hook events (`SessionStart`, `UserPromptSubmit`,
`Stop`) and prints `__FAKE_CODEX_RUNNING__` / `__FAKE_CODEX_COMPLETE__`. The wrapper is registered
via `window.stoa.setSetting('providers', { codex: path })` (93).

1. **"terminal live output …" (127)** — `appendTerminalData('…\\r\\n__PLAYWRIGHT_OK__\\r\\n')` →
   `waitForTerminalBufferText` + `readTerminalBuffer` contains marker; `terminal-xterm` visible, no empty-state.
2. **"claude live session without agent telemetry shows Ready …" (158)** — claude-code session with
   no telemetry → `session-status-ready`, `data-phase='ready'`, `data-tone='neutral'`, `.route-session-label` contains `'Ready'` (176).
3. **"codex live session derives row status from hook events" (184)** — fake-codex lifecycle:
   ready → (on `__FAKE_CODEX_RUNNING__`) `session-status-running` with `data-phase='running'`, label `'Running'`
   → (on `__FAKE_CODEX_COMPLETE__`) `session-status-complete` → row click → `session-status-ready`;
   polled snapshot `{ runtimeState:'alive', turnState:'idle', lastTurnOutcome:'completed' }` (225-229).
4. **"session isolation" (237)** — two shell sessions; append `__PLAYWRIGHT_A__` to A, assert absent
   from B's buffer, then append `__PLAYWRIGHT_B__` to B; switch back to A, assert A still has marker
   and not B's.
5. **"terminal viewport visual integrity" (291)** — append `__PLAYWRIGHT_VISUAL__`; assert
   `terminal-xterm`, `terminal-shell`, `terminal-xterm-mount`, `.xterm` (third-party class), zero
   `terminal-empty-state` (308-315).

### Expectation matrix — generated specs

**`tests/generated/playwright/session-restore.generated.spec.ts`** (meta id
`journey.session.restore.base`, riskBudget `critical`, observationLayers `['ui']`). Shell session →
click `Archive ${title}` button → open `[data-activity-item="archive"]` → expect `surface.archive`
visible, `archive.session.row` count 1 → hover → `archive.session.restore` visible → click → count 0.
Pure UI; does not touch the debug bridge.

**`tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts`** (meta id
`journey.session.telemetry.claude-lifecycle`, riskBudget `critical`, regressionSources
`['claude.raw-hook','session-state-reducer']`, observationLayers
`['ui','renderer-store','main-debug-state','persisted-state']`). Uses `installFakeClaude` (45) — a
30 s `ping`/`sleep` stub for the `claude-code` provider. Full lifecycle via `postClaudeHookEvent` +
`postWebhookEvent`:

1. ready → `data-tone='neutral'` (117); **note: no `data-phase` assertion here**.
2. `UserPromptSubmit`→204→`session-status-running` (126).
3. `PermissionRequest`→204→`session-status-blocked` (135).
4. `PreToolUse`→204→`session-status-running` (144) — blocked→running resolution.
5. `Stop`→204→`session-status-complete` (153).
6. row click→`session-status-ready` (156).
7. canonical `runtime.exited_failed` webhook (event_type `runtime.exited_failed`, payload
   `intent:'runtime.exited_failed'`, `runtimeExitCode:42`, `runtimeExitReason:'failed'`,
   `summary:'Runtime failed'`) → 202 → `session-status-failure` (178).

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Canonical 7-method `MainE2EDebugApi` (incl. `getDebugModeActive`) | `src/main/index.ts` | 197-205 |
| Ambient global declaration | `src/main/index.ts` | 207-209 |
| Debug API installer, E2E-gated | `src/main/index.ts` | 211-243 |
| Fixture local 6-method `MainE2EDebugApi` (missing `getDebugModeActive`) | `electron-app.ts` | 30-37 |
| `getDebugModeActive` helper references drifted method | `electron-app.ts` | 256-263 |
| Launch env + readiness testids | `electron-app.ts` | 110-133 |
| `getMainE2EDebugState` SR-vs-local snapshot precedence | `electron-app.ts` | 214-254 |
| `LaunchedElectronApp` relaunch keeps stateDir+env | `electron-app.ts` | 149-160 |
| `postWebhookEvent` / `/events` + `x-stoa-secret` | `electron-app.ts` | 297-316 |
| `postClaudeHookEvent` / `/hooks/claude-code` + 3 headers | `electron-app.ts` | 318-341 |
| Fixture type-checked under tsconfig.node | `tsconfig.node.json` | 20 |
| Status dot DOM render + derived status-id | `WorkspaceHierarchyPanel.vue` | 546-549 |
| `sessionPhase` / `sessionTone` / `sessionStatusLabel` | `WorkspaceHierarchyPanel.vue` | 227-248 |
| Status topology status IDs | `session-status.topology.ts` | 10-16 |
| `SessionRecoveryMode` literal union | `src/shared/project-session.ts` | 42 |
| `SessionSummary` snapshot shape | `src/shared/project-session.ts` | 122-149 |
| recovery-journey expectations (shell + opencode) | `recovery-journey.test.ts` | 37-130 |
| session-event-journey 7-case expectations | `session-event-journey.test.ts` | 78-496 |
| terminal-journey `installFakeCodex` + 5 cases | `terminal-journey.test.ts` | 15-321 |
| Generated restore spec (archive→restore UI) | `session-restore.generated.spec.ts` | 19-50 |
| Generated telemetry lifecycle (7-step) | `session-telemetry-claude-lifecycle.generated.spec.ts` | 92-184 |

### Risks / Unknowns

- [!] **Contract drift**: fixture `MainE2EDebugApi` (6 methods) is behind the main process (7
  methods). It compiles only via the ambient `declare global` intersection. If the main process
  global is renamed/removed, or the fixture stops casting against its local type, `getDebugModeActive`
  (used by `debug-devtools.test.ts`) breaks at compile time. Recommend deleting the fixture-local
  interface and importing from the main process, or treating the main process interface as the single source.
- [!] **Generated telemetry spec under-asserts vs. hand-written**: it checks `data-tone` only once
  (neutral at ready) and never checks `data-phase`, whereas `session-event-journey` checks both on
  every transition. A phase/tone regression could pass the generated spec while failing the hand-written one.
- [!] **`getMainE2EDebugState` dual path**: when SR is spawned, `snapshot` comes from
  `/api/v1/bootstrap`; when not, from Electron-local `projectSessionManager.snapshot()`. Journeys
  that fail may be sensitive to which snapshot path is active. `webhookPort` + `sessionSecrets`
  always come from the Electron-local path regardless.
- [!] **`installFakeCodex` / `installFakeClaude` are platform-branching** (`fake-codex.cmd` on win32,
  `fake-codex.sh` else). codex driver invokes `.stoa/hook-dispatch.mjs` via `process.execPath`; a
  missing/dispatcher path change would break terminal-journey test 3 and any codex-driven generated spec.
- [?] `waitForSessionState` timeout: hand-written uses default `expect.poll` (10 s deadline loops in
  session-event-journey lines 33/62); generated telemetry uses explicit `{ timeout: 15_000 }` (line
  82). On slow Windows CI cold-start, the 10 s hand-written deadline may flake while the generated 15 s passes.
- [?] `waitForSessionByTitle` in `recovery-journey` resolves sessions by `title`; if duplicate titles
  appear across projects the `.find` returns the first match — could mis-identify the recovered session.
