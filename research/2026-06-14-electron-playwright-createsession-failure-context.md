---
date: 2026-06-14
topic: Electron Playwright createSession helper failure — provider-card click → session-row not created / provider button outside viewport, after SR startup fix
status: completed
mode: context-gathering
depth: 2
max_depth: 2
sources: 28
---

# Context Report: Electron Playwright `createSession` Helper Failure After SR Startup Fix

## Why This Was Gathered

After the Stoa Server (SR) startup path was fixed (SR is now spawned unconditionally,
`createRuntimeClient` fully implemented — see
[[research/2026-06-14-sr-mandatory-interface-consistency-audit]] F6), the Electron
Playwright tests that call `createSession` from `tests/e2e-playwright/helpers/ui-actions.ts`
report two failure modes:

1. **Provider button is outside viewport** — the click on the `provider-card` shell fails.
2. **Session-row is not created** — after the provider click, no `[data-testid="session-row"]`
   with the predicted `data-session-title` appears.

This report traces the full chain — renderer createSession event → `StoaClientPreloadAdapter` →
Electron bootstrap → SR sessions route → `RuntimeBridgeHandler` → test helpers — and
identifies the most likely root causes with cited file:line evidence. Read-only; no code
changes proposed.

---

## Summary

Two independent, well-evidenced root causes map onto the two reported symptoms:

- **"Provider button is outside viewport"** = a CSS positioning defect in
  `ProviderFloatingCard.vue`. The card is `position: fixed` at
  `top = button.top + button.height` (directly **below** the add-session button). For any
  project sitting in the lower half of the scrollable sidebar, the card extends below the
  fold and, because it is `position: fixed`, Playwright **cannot scroll it into view**. The
  provider `<button>` cells (52×52px) are clipped or off-screen, so `.click()` errors.

- **"Session-row is not created"** = the server-to-renderer **session-graph WebSocket event
  is doubly broken**: the server emits `kind: 'session_created'` with a `{kind, projectId,
  sessionId, graphVersion}` shape, but the renderer's `SessionGraphEvent` type declares
  `kind: 'created'` and expects a `{kind, graphVersion, origin, initiatorSessionId, node}`
  shape. The store's `applySessionGraphEvent` switch silently falls through. **WS-driven
  projection is dead.** The direct REST path (`handleSessionCreate` → `addSession(created)`)
  is an alternate route that *should* still render the row — so when the row still does not
  appear, the most likely residual causes are (a) the REST call failing silently
  (`workspaceStore.lastError` is set, `addSession` never called), or (b) a shell-title
  count mismatch between the helper and the server.

The WS shape mismatch is independently confirmed by the prior audit F4 (runtime-bridge WS
shape) — the codebase has a systemic envelope-vs-flat framing problem across its WS
protocols.

---

## Full Trace: `createSession` helper → session-row

### Step 0 — Test helper entry (`tests/e2e-playwright/helpers/ui-actions.ts:44-74`)

```
createSession(page, projectRow, { type })
├─ projectName = projectRow.getAttribute('data-project-name')           // :49
├─ existingSessions = page.locator('[data-testid="session-row"]').count()  // :54  ← counts ALL projects
├─ sessionTitle =
│    type === 'shell' ? `shell-${existingSessions + 1}`                 // :56-57
│                      : `${descriptor.titlePrefix}-${projectName}`     // :58
├─ addSessionButton = projectRow.locator('..').locator('[data-testid="workspace.add-session"]')  // :61
├─ dispatchQuickAddSessionPress(addSessionButton)                       // :62  → synthetic mousedown@1000ms / mouseup@1050ms
├─ providerGroup = page.getByTestId('provider-card')                    // :64
├─ await expect(providerGroup).toBeVisible()                            // :65
├─ await providerGroup.locator(`[data-provider-type="${type}"]`).click() // :66  ← FAILURE POINT A
└─ await expect(sessionRow[data-session-title=sessionTitle]).toBeVisible()  // :68-69  ← FAILURE POINT B
```

`dispatchQuickAddSessionPress` bypasses Playwright actionability by calling
`element.evaluate(el => el.dispatchEvent(...))` with a forged `timeStamp` so the
short-press (<220ms) branch fires (`ui-actions.ts:76-99`).

### Step 1 — Add-session button → floating card (`WorkspaceHierarchyPanel.vue:308-353`)

- `@mousedown="onAddButtonMouseDown($event, project.id)"` (template `:514`).
- `onAddButtonMouseDown` reads `buttonEl.getBoundingClientRect()` and stores
  `floatingCardPosition = { x: rect.left, y: rect.top, width, height }`
  (`:308-326`). Also sets `floatingCardProjectId = projectId` (`:313`).
- A 220ms `longPressTimer` is started (`:320-325`).
- `onAddButtonMouseUp` computes `pressDuration = event.timeStamp - addButtonPressStartedAt`.
  If `< 220ms`, sets `floatingCardVisible = true` (short press → floating card) (`:343-352`).
  The helper's 50ms synthetic press trips this branch. ✓

### Step 2 — Floating card renders below the button (`ProviderFloatingCard.vue`)

```vue
const cardStyle = computed(() => ({
  left: `${props.position.x}px`,
  top: `${props.position.y + props.position.height}px`   // ← :37: directly BELOW the button
}))
```
CSS: `.provider-floating-card { position: fixed; z-index: 100; padding: 6px; }` (`:77-89`).
Each provider cell is `52×52px` (`:91-103`). Card is `<Teleport to="body">` (`:46`).

### Step 3 — Provider button → `create` event (`ProviderFloatingCard.vue:40-42, 55-63`)

```vue
<button ... data-testid="provider-card.item" :data-provider-type="provider.type"
        @click="emitCreate(provider.type)">   <!-- :63 -->
```
`emitCreate` → `emit('create', { type })` (`:40-42`).

### Step 4 — `create` → `createSession` emit chain

- `WorkspaceHierarchyPanel.handleFloatingCardCreate` (`:164-167`):
  `emit('createSession', { projectId: floatingCardProjectId.value, type, title: '' })`.
- `CommandSurface` re-emits (`CommandSurface.vue:104`).
- `App.vue.handleSessionCreate` (`App.vue:77-96`):
  ```ts
  const created = await stoa.createSession({ projectId, type, title: '' })
  if (!created) { workspaceStore.lastError = '...'; return }   // :86-88
  workspaceStore.addSession(created)                            // :90
  workspaceStore.setActiveSession(created.id)                   // :91
  void stoa.setActiveSession(created.id)                        // :92
  ```

### Step 5 — `StoaClientPreloadAdapter.createSession` → REST

```ts
async createSession(request: CreateSessionRequest): Promise<SessionSummary> {
  const res = await this.client.post<SessionSummary>('/api/v1/sessions', request)  // :99
  return res.data!                                                                   // :100
}
```
`StoaClient.request` throws `StoaClientError` if `!json.ok || json.error`
(`src/renderer/lib/stoa-client.ts:115-122`). So a server error propagates to
`handleSessionCreate`'s `catch` → `workspaceStore.lastError` is set, `addSession` is
**never called** (`App.vue:93-95`).

### Step 6 — SR sessions route (`stoa-server/src/routes/sessions.ts:140-166`)

- Validates `projectId` non-empty string (422) and `type ∈ {shell, opencode, codex,
  claude-code}` (422).
- Calls `manager.createSession(request)` → returns 201 with the created `SessionSummary`.
- Manager throw → `AppError` code `conflict`, HTTP 409.

### Step 7 — `manager.createSession` — persistence only (`stoa-server/src/services/project-session-manager.ts:716-804`)

- Validates project/parent/creator existence (`:717-748`).
- Resolves title: `request.title?.trim() ? request.title.trim() :
  resolveDefaultWorkSessionTitle({ project, sessions, projectId, type })` (`:750-757`).
  The helper sends `title: ''` → falsy → default title is used.
- `resolveDefaultWorkSessionTitle` (`src/core/work-session-title.ts:4-19`):
  - shell → `shell-${same-project-shell-count + 1}` (`:10-15`).
  - else → `${descriptor.titlePrefix}-${project.name}` (`:17-18`).
- Creates the `SessionSummary` record, pushes it, sets active, persists, **broadcasts
  `session_created`** (`:793-802`). **Does NOT launch a runtime** (confirmed by prior audit
  F5; the only launch trigger is `POST /sessions/:id/restart`).

### Step 8 — REST response → `addSession` → `session-row` renders

- `workspaceStore.addSession(created)` → `upsertSession` (`workspaces.ts:530-532, 510-528`).
- `upsertSession` pushes into `sessions.value` and calls `reprojectSessions` (`:506-508,
  526`).
- `projectHierarchy` computed regroups sessions by project.
- `WorkspaceHierarchyPanel` template renders `[data-testid="session-row"]` with
  `:data-session-title="row.session.title"` for each row in `project.liveRows`
  (`:523-557`), **but only when `!isProjectCollapsed(project.id)`** (`:523`).

### Step 9 — (Parallel, broken) WS `session:graph` event

Server: `broadcastGraph` sends the raw `SessionGraphWsEvent` via
`wsHub.broadcast('session:graph', event)` (`project-session-manager.ts:1102-1108`).
Renderer: `App.vue` subscribes via `stoa.onSessionGraphEvent(cb)` →
`applySessionGraphEvent` (`App.vue:237-240`, `workspaces.ts:586-622`).

---

## ROOT CAUSE A — Provider button outside viewport (CONFIRMED)

### Evidence

| Fact | Source | Location |
|---|---|---|
| Card `top` = `position.y + position.height` (below the button) | `ProviderFloatingCard.vue` | `:36-38` |
| `position` set from `getBoundingClientRect()` of the add-session button | `WorkspaceHierarchyPanel.vue` | `:308-314` |
| `.provider-floating-card { position: fixed }` | `ProviderFloatingCard.vue` | `:77-78` |
| Provider cells are 52×52px; card padding 6px + gap 4px → ~64px card height | `ProviderFloatingCard.vue` | `:86-103` |
| Add-session button lives in `.route-project-actions` with `opacity: 0` until `.route-project:hover`/`:focus-within` | `WorkspaceHierarchyPanel.vue` | `:701-714`, template `:507-520` |
| Helper dispatches synthetic events via `.evaluate()` (bypasses Playwright visibility, so card DOES appear) | `ui-actions.ts` | `:76-99` |

### Mechanism

The floating card is anchored `position: fixed` at the **bottom edge** of the add-session
button and extends ~64px downward. For any project row in the lower ~70px of the viewport
(the scrollable `.route-body` has `overflow-y-auto`, `:451`), the card's lower edge (and
therefore all provider buttons) fall below the viewport's bottom.

Because the card is `position: fixed`, it does **not** participate in document scroll —
Playwright's default `scrollIntoViewIfNeeded` action before `.click()` has no effect on it.
When the button's center is outside the viewport, Playwright throws:
> `element is not clickable ... the point (X, Y) is outside the viewport`

The symptom is intermittent: it depends on which project the helper targets and how many
projects exist. A single-project test (project near the top) passes; a multi-project or
multi-session test (last project pushed toward the bottom) fails.

### Why it surfaced after the SR startup fix

Before the fix, the test never reached the provider-card click (bootstrap threw on
unavailable SR — see ROOT CAUSE B context). Now that bootstrap succeeds, the test reaches
the click and exposes this pre-existing layout defect.

---

## ROOT CAUSE B — Session-row not created

### B1 — WS `session:graph` kind + shape mismatch (CONFIRMED — breaks WS projection)

| Layer | `kind` value | Shape | Source |
|---|---|---|---|
| **Server broadcasts** | `'session_created'` (also `session_archived`, `session_restored`, `session_destroyed`, `session_updated`, `session_state_changed`, `project_created`, `project_deleted`) | `{ kind, projectId, sessionId, graphVersion }` | `stoa-server/.../project-session-manager.ts:51-64`, broadcast at `:798-802, 1102-1108` |
| **Renderer expects** | `'created' \| 'updated' \| 'archived' \| 'restored' \| 'destroyed'` | `{ kind, graphVersion, origin, initiatorSessionId, node: SessionNodeSnapshot }` | `src/shared/project-session.ts:378-384` |
| **Store switch** | matches `'created'`, `'updated'`, `'archived'`, `'restored'`, `'destroyed'` | reads `event.node.session` | `src/renderer/stores/workspaces.ts:586-622` |

**Two independent mismatches:**
1. `kind`: `'session_created'` (server) vs `'created'` (renderer) — the switch at
   `workspaces.ts:590-621` has **no case** for `'session_created'` → falls through silently.
2. Shape: the server payload is missing `origin`, `initiatorSessionId`, and `node`. Even if
   the kind matched, `event.node` would be `undefined` → `upsertSession(undefined)`.

`sanitizeSessionGraphEventForGenericProjection` (`project-session.ts:409`) does **not**
translate the kind or synthesize `node` — it is a field-sanitiser, not a mapper.

**Consequence:** the WS `session:graph` channel delivers zero usable session-graph events to
the renderer. Any flow that depends on WS-driven projection (e.g. sessions created by
another client, or by the local CLI, or whose REST response is somehow not processed) will
not render a `session-row`.

**Mitigation for the direct create flow:** `handleSessionCreate` calls
`workspaceStore.addSession(created)` synchronously from the REST response (`App.vue:90`).
So for the `createSession` helper specifically, the row *can* still appear via REST. If it
does not, see B2/B3 below.

This is the same class of bug as the prior audit's **F4** (runtime-bridge WS envelope vs
flat frame — `StoaRuntimeClient` wraps outbound frames in `{type, payload}` but
`RuntimeBridgeHandler.handleMessage` reads `frame.replyTo`/`frame.sessionId` at top level,
`runtime-bridge-handler.ts:342-360`). The codebase has a systemic WS-protocol disagreement.

### B2 — REST call fails → `addSession` never called

`handleSessionCreate`'s try/catch (`App.vue:79-95`): if `stoa.createSession()` throws
(StoaClientError from any non-`ok` response, `stoa-client.ts:115-122`), execution jumps to
the catch, `workspaceStore.lastError` is set, and `addSession` is **never reached**. The
session-row never appears, and the failure is **silent** at the Playwright level (the test
just sees a missing row).

Candidate failure triggers for the REST call:
- **Auth token mismatch.** `StoaClient` sends `Authorization: Bearer ${token}`
  (`stoa-client.ts:102-104`); SR validates via `createAuthMiddleware(STOA_AUTH_TOKEN)`
  (`app.ts:63`). The token flows: spawner `readOrGenerateAuthToken` → env `STOA_AUTH_TOKEN`
  → SR; spawner `getAuthToken()` → `getStoaServerWebInfo` → preload `getServerInfo` →
  `bootstrapDesktopRenderer` → `StoaClient` (`stoa-server-spawner.ts:67-85,170`,
  `stoa-server-web-info.ts:40-61`, `bootstrap-electron.ts:19-28`). A stale token file or a
  race between spawner token-write and SR token-read could desync — worth verifying at
  runtime.
- **`projectId` invalid.** Sent from `floatingCardProjectId.value`, set in
  `onAddButtonMouseDown` from `project.id` (`WorkspaceHierarchyPanel.vue:313`). Should be
  valid if `createProject` succeeded. If the project was created in Electron-main's
  `projectSessionManager` (IPC path) but NOT in SR's manager, the SR `POST /sessions`
  would 409 (`project not found`). Check whether `createProject` in this SR-mandatory world
  actually hits `POST /api/v1/projects` (SR) vs the old `IPC_CHANNELS.projectCreate`
  (`index.ts:1500-1502`, which mutates Electron-main state only).
- **`type` validation.** Passed from the provider descriptor; always one of the valid set.
  Unlikely to fail.

### B3 — Shell-title count mismatch (CONFIRMED off-by for shell type)

| Counter | Scope | Source |
|---|---|---|
| **Helper** | `page.locator('[data-testid="session-row"]').count()` — **all session-rows across all projects** | `ui-actions.ts:54` |
| **Server** | `sessions.filter(s => s.projectId === input.projectId && s.type === 'shell' && !s.archived).length` — **same-project shells only** | `work-session-title.ts:11-14` |

For `type === 'shell'`: if any other project already has ≥1 live shell, the helper predicts
`shell-N+1` while the server assigns `shell-1`. The locator
`[data-session-title="shell-N+1"]` never matches → `toBeVisible()` times out → reported as
"session-row not created" even though a `shell-1` row **does** exist.

For non-shell types: `${descriptor.titlePrefix}-${projectName}` — helper and server agree
(provider-descriptors.ts:21,32,43,54 titlePrefix values), so this branch is safe.

### B4 — Runtime never starts (context, not a row-creation blocker)

Per prior audit F5 and confirmed here: `POST /sessions` → `manager.createSession` does not
launch a PTY. `getProviderForCommand` has a launch-only fallback
(`runtime-bridge-handler.ts:376-381`), so a launch is *routable* — but the runtime-bridge
WS response shape is broken (F4), so any launch attempt times out. This does not block
`session-row` creation (the row is driven by the persistence record), but it means any
downstream terminal/telemetry/presence assertion in the same test will fail. Tests like
`session-telemetry-claude-lifecycle.generated.spec.ts` that create a session then post hook
events may see the row appear but never transition status.

---

## Supporting Context

### Electron bootstrap gating (now passing)

- `main.ts:10-17`: `await bootstrapDesktopRenderer()` before `mount('#app')`.
- `bootstrap-electron.ts:19-28`: `requireServerConnection` calls
  `nativeBridge.getServerInfo()` and throws if `!info.available`.
- `preload/index.ts:23-25`: `getServerInfo` → `ipcRenderer.invoke(IPC_CHANNELS.serverGetInfo)`.
- `src/main/index.ts:1849-1851`: handler returns `getStoaServerWebInfo(srSpawner)`.
- `stoa-server-web-info.ts:43-54`: probes `GET /api/v1/discovery`, returns
  `available: true` only if `body.data.webClient === true`.
- SR is spawned with `--web` (`stoa-server-spawner.ts:191,365`), and `serveWeb` is true when
  `isWebClientAvailable()` and `web` flag (`stoa-server/src/index.ts:204-211`). So discovery
  reports `webClient: true` → bootstrap passes. ✓
- SR WebSocket upgrade IS wired (`stoa-server/src/index.ts:17, 241` —
  `attachWebSocketServer`), so the renderer's `StoaClient.connectWs()` (`:145-191`)
  succeeds in opening the socket — the WS path reaches the hub but the payload is
  semantically wrong (B1).

### Which tests exercise `createSession`

| File | Calls `createSession` | Via |
|---|---|---|
| `tests/e2e-playwright/project-session-journey.test.ts` | yes | `ui-actions.ts` helper |
| `tests/generated/playwright/workspace-quick-access.generated.spec.ts` | yes (`:34`) | helper |
| `tests/generated/playwright/stoactl-lifecycle.generated.spec.ts` | yes (`:32`) | helper |
| `tests/generated/playwright/session-telemetry-claude-lifecycle.generated.spec.ts` | yes (`:102`) | helper |
| `tests/generated/playwright/session-restore.generated.spec.ts` | yes (`:28`) | helper |

All five are Electron-bound (use `launchElectronApp`). The web `tests/e2e-web/*` tests use
`createSessionViaApi` (direct HTTP), bypassing the UI helper entirely.

### `provider-card` shell structure

The `provider-card` is the `ProviderFloatingCard` root (`data-testid="provider-card"`,
`ProviderFloatingCard.vue:50`). Provider buttons inside carry `data-testid="provider-card.item"`
and `:data-provider-type` (`:55-63`). The radial variant (`provider-radial` /
`provider-radial.item`) is triggered by the long-press branch (`>220ms`) — the helper's 50ms
press avoids it.

---

## Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Helper predicts title, dispatches synthetic press, clicks provider, waits for row | `ui-actions.ts` | `:44-74, 76-99` |
| Card `top` below button; `position: fixed` | `ProviderFloatingCard.vue` | `:36-38, 77-78` |
| Position from `getBoundingClientRect()` of add-session button | `WorkspaceHierarchyPanel.vue` | `:308-314` |
| Add-session actions hidden until hover (`opacity:0`) | `WorkspaceHierarchyPanel.vue` | `:701-714` |
| Short-press threshold 220ms; helper uses 50ms | `WorkspaceHierarchyPanel.vue` / `ui-actions.ts` | `:64, 343-352` / `:9-10, 94-97` |
| `create` → `createSession` emit chain | 3 files | `ProviderFloatingCard.vue:40-42,63`; `WorkspaceHierarchyPanel.vue:164-167`; `CommandSurface.vue:104`; `App.vue:77-96` |
| `handleSessionCreate` try/catch — silent on REST failure | `App.vue` | `:77-96` |
| `createSession` → `POST /api/v1/sessions`; throws on non-ok | adapter + client | `stoa-client-preload-adapter.ts:98-101`; `stoa-client.ts:115-122` |
| SR route validates + delegates to manager | sessions route | `sessions.ts:140-166` |
| Manager resolves default title, creates record, broadcasts `session_created` | manager | `project-session-manager.ts:716-804` |
| Default title: shell=same-project count, else prefix-name | title resolver | `work-session-title.ts:4-19` |
| `addSession` → `upsertSession` → `reprojectSessions` renders row | store | `workspaces.ts:506-528` |
| session-row rendered only when project not collapsed | template | `WorkspaceHierarchyPanel.vue:523-557` |
| Server `SessionGraphWsEvent.kind` = `session_created` etc. | manager types | `project-session-manager.ts:51-64` |
| Server `broadcastGraph` sends raw event via `wsHub.broadcast('session:graph', ...)` | manager | `project-session-manager.ts:1102-1108, 798-802` |
| Renderer `SessionGraphEvent.kind` = `created` etc.; expects `node` | shared types | `project-session.ts:378-384` |
| Store switch matches `created`/`updated`/... only — no `session_created` | store | `workspaces.ts:586-622` |
| `sanitizeSessionGraphEventForGenericProjection` does not translate kind | shared types | `project-session.ts:409` |
| Shell count scope: helper=all rows, server=same-project shells | helper + resolver | `ui-actions.ts:54`; `work-session-title.ts:11-14` |
| `createSession` does NOT launch runtime; only `restart` does | route + audit F5 | `sessions.ts:187-194`; prior audit F5 |
| Runtime-bridge WS shape mismatch (envelope vs flat) — F4 | handler + client | `runtime-bridge-handler.ts:342-360`; prior audit F4 |
| SR spawned unconditionally; `createRuntimeClient` fully implemented | main + audit F6 | `src/main/index.ts:1481-1486, 1428-1478` |
| SR WebSocket upgrade wired | SR index | `stoa-server/src/index.ts:17, 241` |
| Bootstrap gated on `getServerInfo().available` | bootstrap + web-info | `bootstrap-electron.ts:19-28`; `stoa-server-web-info.ts:43-54` |
| `--web` flag + `webClient` discovery → bootstrap passes | spawner + index | `stoa-server-spawner.ts:191`; `stoa-server/src/index.ts:204-211` |
| Provider descriptors titlePrefix values | descriptors | `provider-descriptors.ts:21,32,43,54` |

---

## Risks / Unknowns

- [!] **ROOT CAUSE A is a hard CSS/layout defect.** It will affect any `createSession`
  invocation whose target project is in the lower viewport region. It cannot be fixed by
  test-side retries; it requires the card to flip above the button when near the bottom
  edge, or to render inline instead of `position: fixed`.
- [!] **B1 (WS kind+shape mismatch) is a confirmed systemic bug.** It breaks WS-driven
  projection for *all* session graph events, not just creation. Any test asserting
  real-time projection (presence transitions, archive/restore from another client, local-CLI
  side effects) will fail. The REST-response mitigation only covers the renderer's own
  direct mutations.
- [!] **B2 (silent REST failure) is the highest-uncertainty item.** Without a runtime
  capture of `workspaceStore.lastError` or the SR response body, the exact failure trigger
  (auth desync vs project-not-in-SR vs other) cannot be pinned from static reading alone.
  The Electron-main `projectSessionManager` and SR's `ProjectSessionManager` are **separate
  instances** — sessions/projects created via one are invisible to the other. If
  `createProject` in the SR-mandatory renderer still routes through an IPC path that mutates
  Electron-main state, the SR `POST /sessions` will 409. This needs runtime confirmation.
- [?] **B3 (shell title)** only affects `type === 'shell'` and only when shells exist in
  other projects. Non-shell `createSession` calls are immune.
- [?] The provider-card `.route-project-actions` hover-gating (`opacity: 0`) means the
  add-session button is not "visible" by Playwright's actionability model — the helper
  sidesteps this with `.evaluate()` synthetic events, but if the card's anchor button has a
  zero-size or off-screen rect (e.g. the project row is itself scrolled out), the card
  renders at a degenerate position. Confirm the project row is scrolled into view before the
  add-session press.

---

## Context Handoff

Start here: `research/2026-06-14-electron-playwright-createsession-failure-context.md`

Highest-priority fix targets:
1. **ROOT CAUSE A** — `ProviderFloatingCard.vue:36-38` card anchor (flip above button near
   viewport bottom, or use inline positioning).
2. **B1** — reconcile `SessionGraphWsEvent` (server) ↔ `SessionGraphEvent` (renderer):
   either translate the kind + synthesize `node` server-side before broadcast, or widen the
   store switch + adapt the shape consumer. Related to prior audit F4 — consider a single
   WS-envelope convention pass.
3. **B2** — verify at runtime whether `handleSessionCreate`'s REST call throws; capture
   `workspaceStore.lastError` and the SR `/api/v1/sessions` response. Check whether
   `createProject` mutates Electron-main state (invisible to SR) vs SR state.
4. **B3** — align the helper's shell count to same-project scope (or have the server count
   globally).

Related prior research: [[research/2026-06-14-sr-mandatory-interface-consistency-audit]] (F4
runtime-bridge WS shape, F5 no create→launch, F6 SR startup fixed),
[[research/2026-06-14-sr-sessions-routes-lifecycle-takeover-context]] (route behavior + test
patterns), [[research/2026-06-13-playwright-browser-test-migration-progress-audit]] (WS
upgrade was not wired as of 06-13 — now wired per `stoa-server/src/index.ts:241`),
[[research/2026-06-12-electron-e2e-and-generated-journey-tests-migration-inventory]] (which
tests use `createSession`).
