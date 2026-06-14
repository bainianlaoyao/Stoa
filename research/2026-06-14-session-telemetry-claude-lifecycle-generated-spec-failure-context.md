---
date: 2026-06-14
topic: Failing generated spec session-telemetry-claude-lifecycle.generated.spec.ts — spec assertions, UI selectors, telemetry/session lifecycle data flow, and recent source files
status: completed
mode: context-gathering
depth: 2
sources: 22
related: 2026-06-14-electron-playwright-fixture-debug-contract-and-journey-expectations.md
---

## Context Report: session-telemetry-claude-lifecycle.generated.spec.ts failure context

### Why This Was Gathered

A downstream fix agent needs to repair the failing generated Playwright spec
`tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts`.
The spec drives a full Claude Code session lifecycle (ready → running → blocked →
running → complete → ready-on-click → failure) through HTTP webhook events and
asserts on the status-dot DOM. The codebase has a large **uncommitted** refactor
("Stoa Server/Client separation", commits `9b8f42c` + `b0fd14e`) that changes
the entire telemetry data flow: a child Stoa Server (SR) is now **required**, the
preload was gutted, and the renderer reads presence from the SR over WebSocket
rather than from Electron-local IPC. This report pins the spec's exact
assertions, the selectors it touches, the end-to-end data flow (with intent
mapping), and the recently-changed source files most likely responsible for the
regression — so the fix targets real drift without re-deriving it.

### 1. The spec — assertions and lifecycle steps

File: `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts`

- **Meta** (lines 16-43): `id: 'journey.session.telemetry.claude-lifecycle'`,
  `riskBudget: 'critical'`, `regressionSources: ['claude.raw-hook','session-state-reducer']`,
  `observationLayers: ['ui','renderer-store','main-debug-state','persisted-state']`,
  covers 5 presence states + 5 interruptions. AUTO-GENERATED — do not edit by hand.
- **Bootstrap** (92-113): `launchElectronApp()` → `installFakeClaude()` (writes a
  30 s `ping`/`sleep` stub registered as `providers['claude-code']` via
  `window.stoa.setSetting(...)`) → `createProject(...)` → `createSession(page, projectRow, { type: 'claude-code' })`
  → `waitForSessionState(app, title, s => s.runtimeState === 'alive')` (15 s poll deadline, line 82)
  → reads `debugState.sessionSecrets[sessionState.id]` as the per-session webhook secret.
- **The 7 lifecycle assertions** (all on the same `[data-testid="session-status-dot"]`
  locator bound to `session.row`, lines 115-179):

| Step | Action | Expected HTTP | Expected DOM `data-session-status-testid` | Other DOM | Line |
|---|---|---|---|---|---|
| 1 | (initial, runtime alive) | — | `session-status-ready` | `data-tone='neutral'` | 116-117 |
| 2 | `postClaudeHookEvent` `UserPromptSubmit` | 204 | `session-status-running` | — | 119-126 |
| 3 | `postClaudeHookEvent` `PermissionRequest` | 204 | `session-status-blocked` | — | 128-135 |
| 4 | `postClaudeHookEvent` `PreToolUse` | 204 | `session-status-running` | — | 137-144 |
| 5 | `postClaudeHookEvent` `Stop` | 204 | `session-status-complete` | — | 146-153 |
| 6 | `await session.row.click()` | — | `session-status-ready` | — | 155-156 |
| 7 | `postWebhookEvent` canonical `runtime.exited_failed` (`runtimeExitCode:42`, `runtimeExitReason:'failed'`) | 202 | `session-status-failure` | — | 158-179 |

**Important gaps vs. hand-written journey** (from related report
`2026-06-14-electron-playwright-fixture-debug-contract-and-journey-expectations.md`
§"Generated telemetry spec under-asserts"): the generated spec checks `data-tone`
**only once** (neutral at ready, line 117) and **never** checks `data-phase`,
whereas `session-event-journey.test.ts` checks both on every transition. A phase
regression could pass the generated spec but fail the hand-written one.

### 2. UI selectors touched

| Selector / testid | Source | Purpose |
|---|---|---|
| `[data-testid="session-status-dot"]` | `WorkspaceHierarchyPanel.vue:561-568` | The dot element. Carries `data-tone`, `data-phase`, `data-session-status-testid`, `data-attention-reason`. |
| `data-session-status-testid="session-status-${phase}"` | `WorkspaceHierarchyPanel.vue:566` | **Derived** from `sessionPhase(row.session)`. |
| `data-tone` | `WorkspaceHierarchyPanel.vue:564` | From `sessionTone(row.session)`; `neutral` if locally-seen-complete or no view model. |
| `data-phase` | `WorkspaceHierarchyPanel.vue:565` | From `sessionPhase(row.session)`; **not asserted** by this spec. |
| `[data-testid="session-row"]` | `WorkspaceHierarchyPanel.vue:552` | The clickable row; `.click()` triggers locally-seen-completion (step 6). |
| `[data-testid="project-row"][data-project-name=...]` | `ui-actions.ts:39` | `createProject` resolves the project row. |
| `[data-testid="workspace.new-project"]` | `ui-actions.ts:30` | Opens the New Project dialog. |
| `app-viewport`, `command-panel` | `electron-app.ts:132-133` | App readiness testids awaited by `launchElectronApp`. |
| Status IDs `ready\|running\|complete\|blocked\|failure` | `testing/topology/session-status.topology.ts:10-16` | Authoritative topology contract. |

### 3. Status-dot derivation logic (recently refactored)

File: `src/renderer/components/command/WorkspaceHierarchyPanel.vue` (modified, +19/-? uncommitted).

- `sessionPhase(session)` (250-255): returns `props.sessionRowViewModels[session.id]?.phase`,
  **unless** `locallySeenCompletionSessionIds` contains the id AND the view-model
  phase is `'complete'` — in which case it returns `'ready'`. Fallback:
  `session.runtimeState === 'exited' ? 'complete' : 'unknown'`.
- `sessionTone(session)` (228-233): same locally-seen override → `'neutral'`;
  otherwise `viewModel.tone ?? 'neutral'`.
- `locallySeenCompletionSessionIds` (line 82, ref Set): populated on row click
  via `handleSessionClick` → line 266. This is what makes step 6 (click → ready) work.
- `sessionRowViewModel(sessionId)` (224-226): reads from
  `props.sessionRowViewModels?.[sessionId]` — a `Record<string, SessionRowViewModel>`
  passed in as a prop. Type imported from `@shared/observability` (line 4).

### 4. End-to-end telemetry/session-lifecycle data flow (post-refactor)

**Architecture change**: SR (Stoa Server) is now a **required** child process.
`stoaServerEnabled` was **removed** from `AppSettings` (`src/shared/project-session.ts`
diff: lines 211, 255 deleted). The spawner comment now reads "SR is a required
child service for the Electron shell" (`stoa-server-spawner.ts:17`). The preload
was gutted from ~40 methods to just `getServerInfo` + `openWorkspace`
(`src/preload/index.ts` diff). All session/presence/terminal data now flows over
the SR's HTTP+WS instead of Electron-local `ipcRenderer.invoke`.

**Startup wiring** (`src/main/index.ts`, +290 uncommitted):
- `srSpawner = new StoaServerSpawner(srConfig, srDeps)` (line 1611) →
  `srSpawner.spawn()` (1612) → `waitForHealth()` (1614) → `connectRuntime()` (1615).
- SR entry point: `stoa-server/dist/index.cjs` (`stoa-server-spawner.ts:316`).
  Spawned with `--port` + `--web` flags, env `STOA_AUTH_TOKEN` + `STOA_DIR`
  (`createChildEnv`, spawner diff). In dev, `fork` uses `process.env.npm_node_execpath`
  as execPath (`getNodeExecPath`, spawner diff) so the child does not run under
  Electron's Node ABI.
- `connectRuntime()` now **throws** if no runtime client is provided (spawner
  diff: was a `console.warn` + return, now `throw new Error('No runtime client
  provided for Stoa Server runtime bridge')`). A runtime client is created at
  `main/index.ts:1560` connecting to `ws://127.0.0.1:${port}`.
- `getStoaServerWebInfo(srSpawner)` serves `IPC_CHANNELS.serverGetInfo`
  (`main/index.ts:1979-1980`), returning `{ available, port, url, token }` after
  hitting `/api/v1/discovery` to confirm the web client flag
  (`src/main/stoa-server-web-info.ts`).

**Event flow for the two webhook paths the spec exercises:**

**Path A — Claude raw hooks** (`postClaudeHookEvent` → `/hooks/claude-code` on the
Electron-local webhook port, lines 119-153):
1. POST to `http://127.0.0.1:${debugState.webhookPort}/hooks/claude-code` with
   headers `x-stoa-secret`, `x-stoa-session-id`, `x-stoa-project-id`
   (`electron-app.ts:420-443`). The `webhookPort` always comes from the
   Electron-local debug state, even when SR is available
   (`getMainE2EDebugState`, `electron-app.ts:244`).
2. Electron-local `createHookEndpoint(adaptClaudeCodeHook, 'claude-code')`
   (`webhook-server.ts:441`) authenticates via `authorizeHookRequest`
   (hook lease manager) OR `getSessionSecret`.
3. Adapts the raw hook → `CanonicalSessionEvent` via `adaptClaudeCodeHook`
   (`src/core/hook-event-adapter.ts`). Mapping (`claudeHookIntent`, lines 227-248):
   `UserPromptSubmit→agent.turn_started`, `PermissionRequest→agent.permission_requested`,
   `PreToolUse→agent.tool_started` (or `permission_requested` if elicitation),
   `Stop→agent.turn_completed`, `SessionEnd→runtime.exited_clean`.
4. Calls `options.onEvent(event)` (`webhook-server.ts:431`) — **NOT** `proxyEvent`.
   `onEvent` is wired to `SessionEventBridge.enqueueSessionEvent`
   (`session-event-bridge.ts:133-135`).
5. Local bridge processes: normalizes → `mirrorCanonicalEvent(normalized)`
   (`session-event-bridge.ts:183`, NEW) → local state patch → lifecycle handling.
6. `mirrorCanonicalEvent` → `mirrorCanonicalEventToStoaServer(event)`
   (`main/index.ts:899-900, 1017-1035`): POSTs the normalized event to
   `http://127.0.0.1:${srSpawner.getPort()}/events` with
   `Authorization: Bearer ${authToken}` + `x-stoa-secret: ${authToken}`. Throws on
   non-OK. Returns 204 to the HTTP caller (because `onEvent` returns void/undefined →
   `webhook-server.ts:432-434`).

**Path B — canonical events** (`postWebhookEvent` → `/events`,
line 158-178 of the spec):
1. `postWebhookEvent` (`electron-app.ts:297-347`) calls
   `page.evaluate(stoaElectron.getServerInfo())`; **if SR is available**, it
   **retargets** `targetPort = serverInfo.port` and `targetSecret = serverInfo.token`
   (lines 317-321), sets `usesStoaServer = true`.
2. POSTs to `http://127.0.0.1:${srPort}/events` with `x-stoa-secret: ${srToken}`.
3. `/events` is **unauthenticated** on the SR (`stoa-server/src/middleware/auth.ts:29`
   — explicitly skipped), so the token is ignored; the event is accepted.
4. If SR path, `waitForStoaServerEventProjection` (`electron-app.ts:375-395`) polls
   SR `/api/v1/bootstrap` until `runtimeState === 'exited' && runtimeExitReason === 'failed' && runtimeExitCode === 42` (for `runtime.exited_failed`, `isEventProjected` line 406-410).
5. On the Electron-local side, `/events` uses `proxyEvent ?? onEvent`
   (`webhook-server.ts` diff line ~312). When SR is spawned, `proxyCanonicalEvent`
   is set (`session-event-bridge.ts` diff), so canonical events are **proxied to SR
   only** (not processed locally). The proxy target is the same
   `mirrorCanonicalEventToStoaServer`. Returns 202.

**SR processing + presence broadcast** (`stoa-server/src/services/session-event-processor.ts:241-293`):
1. `doProcessEvent` looks up the session → `toSessionStatePatch` (line 247) → applies.
2. `resolveIntent` (364-379) uses `event.payload.intent` **directly** (does not re-derive
   from `event_type`) except for `agent.turn_completed` special handling. So the mirrored
   event's `payload.intent` must be correct.
3. Broadcasts `session:state-patch` (255) then — if
   `mapIntentToObservation(intent).category === 'presence'` — broadcasts
   `observability:presence` (267-273) with a **lightweight** payload:
   `{ sessionId, projectId, phase: observation.type.split('.')[1] ?? 'unknown', intent, timestamp }`.

**SR intent→presence mapping** (`session-event-processor.ts:49-81`):
`agent.turn_started/tool_started/tool_completed → presence.running`;
`agent.turn_completed → presence.complete`;
`agent.permission_requested → presence.blocked`;
`agent.permission_resolved/recovered/turn_interrupted/turn_cancelled → presence.ready`;
`agent.turn_failed → presence.failure`;
`runtime.exited_failed → presence.failure` (line 68-69, was previously `lifecycle.session_exited`
in the bridge before the diff; the bridge was updated to match at
`session-event-bridge.ts:793-797`).

**Renderer presence subscription** (`src/renderer/stores/workspaces.ts`, +106 uncommitted):
- Subscribes `client.subscribe('observability:presence', ...)` (line ~316).
- **NEW**: handler now branches on payload shape:
  `isSessionPresenceSnapshot(payload)` (full snapshot) → `applySessionPresenceSnapshot`;
  else `isLightweightSessionPresenceEvent(payload)` (`{sessionId,projectId,phase,timestamp?}`)
  → `applyLightweightSessionPresenceEvent` (new function, lines ~480-516).
- `applyLightweightSessionPresenceEvent` builds a `SessionPresenceSnapshot` via
  `buildSessionPresenceSnapshot` using the local `SessionSummary`, force-sets
  `next.phase = event.phase`, sets `health='lost'` for failure, `hasUnreadTurn=true`
  for complete. Then a **staleness guard** (line ~513): `if (current && current.sourceSequence > next.sourceSequence) return`.
- `applySessionPresenceSnapshot` has a **NEW** `isFailureEscalation` bypass
  (line ~54-57, ~462-467): even a stale snapshot is applied if it escalates to `failure`.
- `next.sourceSequence = Math.max(current?.sourceSequence ?? 0, session.lastStateSequence)`
  (line ~509). `session.lastStateSequence` exists on `SessionSummary`
  (`src/shared/project-session.ts:137`).

### 5. Recent likely source files (uncommitted modifications on `main`)

All from `git diff --stat HEAD` (the Stoa Server/Client separation, uncommitted on top of `b0fd14e`):

| File | Δ lines | Why relevant |
|---|---|---|
| `src/main/index.ts` | +290 | SR spawn wiring (`srSpawner`), `mirrorCanonicalEventToStoaServer` (1017-1035), `mirror/proxyCanonicalEvent` options (899-904), `serverGetInfo` handler (1979-1980), `createRuntimeClient` (1555-1590). Largest blast radius. |
| `src/preload/index.ts` | -277 | Gutted to `getServerInfo`+`openWorkspace`. If the renderer still references an old `window.vibecoding.*` method, it breaks. |
| `src/renderer/stores/workspaces.ts` | +106 | Lightweight presence handling, `isFailureEscalation`, staleness guard — direct driver of the status dot. |
| `src/main/stoa-runtime-client.ts` | +90 | WS protocol: `RuntimeResponse.type`, `RuntimeOutboundMessage` union, 5 s `CONNECT_TIMEOUT_MS`, settle-guard. If connect fails/throws, SR runtime bridge is dead. |
| `src/main/stoa-server-spawner.ts` | +41 | `--web` flag, `getNodeExecPath` for dev fork, `connectRuntime` now throws, `createChildEnv`. |
| `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | +19 | `locallySeenCompletionSessionIds`, function-based view models (phase/tone override). |
| `src/main/session-event-bridge.ts` | +13 | `mirrorCanonicalEvent` + `proxyCanonicalEvent` hooks; `runtime.exited_failed` reclassified presence.failure. |
| `src/core/webhook-server.ts` | +13 | `proxyEvent` option; `/events` now uses `proxyEvent ?? onEvent`. Claude hook endpoint still uses `onEvent` only. |
| `src/shared/project-session.ts` | +26/-? | Removed `stoaServerEnabled` from `AppSettings` + `DEFAULT_SETTINGS`; added `ElectronRendererNativeApi`. |
| `src/shared/index.d.ts` | +3 | `window` typing for new minimal preload API. |

### 6. Risks / likely failure modes (for the fix agent)

1. **[!] SR spawn or runtime-client connect failure in E2E.** SR is now required and
   `connectRuntime()` throws (no longer warns) if the client is absent. If the WS
   connect fails (the new 5 s `CONNECT_TIMEOUT_MS` or the "connection closed before
   opening" rejection in `stoa-runtime-client.ts` diff), the Electron app startup
   itself can throw, or `getServerInfo` reports unavailable → renderer has no data
   source → status dot never leaves `ready`. **First thing to check**: does the SR
   actually come up and accept the runtime WS connection during `launchElectronApp`?
   The fixture waits only for `app-viewport` + `command-panel` (`electron-app.ts:132`),
   not for SR health. Enable `WEBHOOK_DEBUG` (referenced in `webhook-server.ts` diff)
   to confirm event receipt.

2. **[!] Claude hook mirror must reach SR for the dot to update.** Because the dot now
   reads from SR's `observability:presence` WS broadcast, and Claude hooks are
   processed locally then mirrored (`mirrorCanonicalEvent`), **every** step 2-5
   depends on the HTTP mirror succeeding AND the SR broadcasting presence AND the
   renderer WS being subscribed. Any silent mirror failure (e.g.
   `mirrorCanonicalEventToStoaServer` throwing inside the async `onEvent`, which is
   awaited at `webhook-server.ts:431`) would turn the 204 into a 500 or swallow the
   error, and the dot would not move.

3. **[!] Lightweight presence staleness guard may drop the first update.**
   `applyLightweightSessionPresenceEvent` sets
   `next.sourceSequence = Math.max(current?.sourceSequence ?? 0, session.lastStateSequence)`
   then bails if `current.sourceSequence > next.sourceSequence`
   (`workspaces.ts` diff, ~line 513). If a prior full `SessionPresenceSnapshot`
   already established a higher `sourceSequence` than the session's
   `lastStateSequence` at the time of the lightweight event, the update is
   silently dropped and the dot never reaches `running`/`blocked`/`complete`.

4. **[!] Step 6 (row click → ready) depends on timing of `sessionPhase==='complete'`.**
   `sessionPhase` only overrides to `'ready'` when
   `locallySeenCompletionSessionIds.has(id) && viewModel.phase === 'complete'`
   (`WorkspaceHierarchyPanel.vue:251-253`). If step 5's `complete` presence has
   not yet projected into `sessionRowViewModels` by the time the click handler
   reads it, the override does not fire and the dot stays `complete` (fail). The
   spec does not poll for `complete` before clicking — it only asserts
   `toHaveAttribute('complete')` which resolves on the DOM, then immediately
   clicks. A race is possible if the click handler runs before the view-model
   prop propagates.

5. **[!] Step 7 (failure) projection path.** `postWebhookEvent` retargets to SR and
   waits for `runtime.exited_failed` projection via `/api/v1/bootstrap`
   (`isEventProjected`, `electron-app.ts:406-410`). If the SR's
   `session-event-processor` does not reach `runtimeState==='exited' &&
   runtimeExitReason==='failed'` (e.g., intent mis-resolution, or the
   `toSessionStatePatch` not setting these fields from the payload), the helper
   throws a 5 s timeout. Separately, the renderer's `isFailureEscalation` bypass
   is the only thing that lets `failure` override a stale snapshot — confirm it is
   wired for the lightweight path too (it currently guards
   `applySessionPresenceSnapshot`, not `applyLightweightSessionPresenceEvent`).

6. **[!] Generated spec is fragile vs. hand-written.** As noted in the related
   report, this spec under-asserts (no `data-phase` checks, `data-tone` checked
   once). When fixing, prefer to also run
   `tests/e2e-playwright/session-event-journey.test.ts` cases 5-7 (lines 311-496)
   which assert the same transitions with full phase+tone+label checks — they will
   surface regressions the generated spec masks.

7. **[?] Renderer WS connect timing.** Nothing in the fixture waits for the
   renderer's stoa-client to establish the WS subscription to SR before events are
   posted. On a cold Windows CI start, the first Claude hook (step 2) could be
   processed by the SR and broadcast before the renderer has subscribed, losing
   the update. The 15 s `waitForSessionState` poll (line 82) covers the initial
   `alive`, but steps 2-7 rely on `expect(statusDot).toHaveAttribute(...)` which
   retries on the DOM — if the presence event was missed entirely (not just
   late), the retry will never converge.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Generated spec 7-step lifecycle + meta | `session-telemetry-claude-lifecycle.generated.spec.ts` | 16-184 |
| `installFakeClaude` 30s stub + `setSetting('providers', ...)` | same | 45-62 |
| `waitForSessionState` 15 s poll on debug snapshot | same | 64-90 |
| Status dot DOM render + derived status-id | `WorkspaceHierarchyPanel.vue` | 546-568 |
| `sessionPhase` / `sessionTone` + locally-seen override | `WorkspaceHierarchyPanel.vue` | 228-266 |
| `sessionRowViewModel` prop read | `WorkspaceHierarchyPanel.vue` | 224-226 |
| Fixture `launchElectronApp` env + readiness testids | `electron-app.ts` | 110-133 |
| `getMainE2EDebugState` SR-vs-local snapshot precedence | `electron-app.ts` | 214-254 |
| `postWebhookEvent` SR retarget + projection wait | `electron-app.ts` | 297-418 |
| `postClaudeHookEvent` 3-header POST to `/hooks/claude-code` | `electron-app.ts` | 420-443 |
| Claude hook endpoint uses `onEvent` only (not proxy) | `webhook-server.ts` | 431 |
| `/events` uses `proxyEvent ?? onEvent` | `webhook-server.ts` | diff ~312 |
| `mirror/proxyCanonicalEvent` wired into bridge | `session-event-bridge.ts` | diff 43-186 |
| `runtime.exited_failed` reclassified presence.failure (bridge) | `session-event-bridge.ts` | diff 793-797 |
| `mirrorCanonicalEventToStoaServer` HTTP POST to SR `/events` | `main/index.ts` | 899-904, 1017-1035 |
| SR spawn (required) + runtime client + `serverGetInfo` | `main/index.ts` | 1545-1615, 1979-1980 |
| Preload gutted to `getServerInfo`+`openWorkspace` | `preload/index.ts` | diff |
| `stoaServerEnabled` removed from AppSettings | `project-session.ts` | diff 211, 255 |
| `connectRuntime` now throws (was warn) | `stoa-server-spawner.ts` | diff 245-250 |
| SR dev fork uses `npm_node_execpath`; `--web` flag | `stoa-server-spawner.ts` | diff 187-191, 316-334 |
| Runtime client WS protocol + 5 s connect timeout | `stoa-runtime-client.ts` | diff 29-215 |
| SR `/events` + `/hooks/*` unauthenticated | `auth.ts` | 26-36 |
| SR webhook routes (mirror of webhook-server) | `stoa-server/src/routes/webhooks.ts` | 1-80 |
| SR `doProcessEvent` + lightweight presence broadcast | `session-event-processor.ts` | 241-293 |
| SR intent→presence map (incl. `runtime.exited_failed`) | `session-event-processor.ts` | 49-81 |
| SR `resolveIntent` uses `event.payload.intent` directly | `session-event-processor.ts` | 364-379 |
| Claude hook → intent mapping | `src/core/hook-event-adapter.ts` | 227-248 |
| Renderer lightweight presence handler + staleness guard | `workspaces.ts` | diff 54-57, 316-516 |
| `isFailureEscalation` bypass | `workspaces.ts` | diff 459-467 |
| Status topology IDs | `session-status.topology.ts` | 10-16 |
| `SessionSummary.lastStateSequence` field | `project-session.ts` | 137 |
| Build pipeline builds SR before Playwright | `package.json` | 12, 14, 36 |
| SR dist built (today) | `stoa-server/dist/index.cjs` | filesystem |

### Context Handoff

Report saved at: `D:\Data\DEV\ultra_simple_panel\research\2026-06-14-session-telemetry-claude-lifecycle-generated-spec-failure-context.md`

Companion report (fixture contract + journey expectation matrix):
`D:\Data\DEV\ultra_simple_panel\research\2026-06-14-electron-playwright-fixture-debug-contract-and-journey-expectations.md`
