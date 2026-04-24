# Frontend Observability Status Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make frontend session status display reflect the observability pipeline instead of falling back to neutral/legacy status UI.

**Architecture:** App startup must hydrate and subscribe to observability snapshots after bootstrap. `CommandSurface` must derive both row and active-session view models from the same `SessionPresenceSnapshot` source and render `TerminalMetaBar` above `TerminalViewport`. Tests verify the end-to-end renderer path: mocked bridge snapshots arrive, store updates, row dot tone changes, and the active meta bar shows the rich phase.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Electron preload bridge mocks, Vitest + Vue Test Utils, Playwright for final verification.

---

## File Structure

- `src/renderer/app/App.vue`: Call `workspaceStore.hydrateObservability()` after bootstrap and call `workspaceStore.unsubscribeObservability()` on unmount.
- `src/renderer/app/App.test.ts`: Assert app startup calls `getSessionPresence`, registers observability subscriptions, applies pushed status, and cleans up observability listeners.
- `src/renderer/components/command/CommandSurface.vue`: Render `TerminalMetaBar` and derive `ActiveSessionViewModel` from `activeSession + activeSessionPresence`.
- `src/renderer/components/command/CommandSurface.test.ts`: Assert active meta bar displays rich observability phase and session row dot uses non-neutral tone.
- `src/renderer/components/AppShell.vue`: Pass through any new props required by `CommandSurface`; keep shell as composition-only surface.
- `src/renderer/components/AppShell.test.ts`: Update contracts if new prop wiring is needed.
- `tests/e2e-playwright/session-event-journey.test.ts`: Add or adjust assertion that a Claude `PermissionRequest` hook produces blocked/warning UI in the row and active status bar.
- `testing/topology/command.topology.ts`: Add the active terminal status bar test id if it is not already declared.
- `testing/behavior/*` and `testing/journeys/*`: Update only if behavior coverage requires explicit active status bar semantics.

## Task 1: App Starts Observability Hydration

**Files:**
- Modify: `src/renderer/app/App.test.ts`
- Modify: `src/renderer/app/App.vue`

- [ ] **Step 1: Add failing App startup test**

Add a test that mounts `App.vue` with a mocked `window.stoa` containing:
- one project
- one active session
- `getSessionPresence` returning a `SessionPresenceSnapshot` with `phase: 'blocked'`, `tone` implied by projection, `sourceSequence: 2`
- `onSessionPresenceChanged` capturing a listener

Assert after mount:
- `window.stoa.getSessionPresence` was called with the active session id
- `window.stoa.onSessionPresenceChanged` was registered
- the store active session presence is no longer `null`
- invoking the captured `onSessionPresenceChanged` listener with a newer `sourceSequence` updates `store.activeSessionPresence.phase` to `blocked`

Run:

```bash
npx vitest run src/renderer/app/App.test.ts
```

Expected: FAIL because `App.vue` currently never calls `workspaceStore.hydrateObservability()`.

- [ ] **Step 2: Implement startup hydration**

In `App.vue`, after `workspaceStore.hydrate(bootstrapState)` and before/alongside settings/update refresh, call:

```ts
await workspaceStore.hydrateObservability()
```

Keep existing `onSessionEvent` subscription because it updates canonical `SessionSummary.status`; observability subscription provides richer snapshots.

In `onBeforeUnmount`, call:

```ts
workspaceStore.unsubscribeObservability()
```

This prevents remounts and tests from accumulating stale bridge listeners.

- [ ] **Step 3: Verify**

Run:

```bash
npx vitest run src/renderer/app/App.test.ts src/renderer/stores/workspaces.test.ts
```

Expected: PASS.

## Task 2: Command Surface Renders Active Session Meta

**Files:**
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/CommandSurface.test.ts`

- [ ] **Step 1: Add failing CommandSurface test**

Mount `CommandSurface` with a Pinia store whose `sessionPresenceById.session_1` is a blocked snapshot. Assert:
- `[data-testid="terminal-status-bar"]` exists outside/above terminal viewport within the command surface
- it contains `Blocked`
- `[data-testid="session-status-dot"]` has `data-tone="warning"` and `data-phase="blocked"`

Run:

```bash
npx vitest run src/renderer/components/command/CommandSurface.test.ts
```

Expected: FAIL because `TerminalMetaBar` is not rendered by `CommandSurface`.

- [ ] **Step 2: Implement active view model**

In `CommandSurface.vue`:
- import `TerminalMetaBar`
- import `toActiveSessionViewModel`
- read `activeSessionPresence` from `storeToRefs(workspaceStore)`
- compute `activeSessionViewModel` when both `props.activeSession` and `activeSessionPresence.value` exist
- render:

```vue
<div class="command-main">
  <TerminalMetaBar
    :project="activeProject"
    :session="activeSession"
    :active-view-model="activeSessionViewModel"
  />
  <TerminalViewport :project="activeProject" :session="activeSession" />
</div>
```

The wrapper must preserve terminal layout with `min-h-0` and two vertical rows (`auto` status bar, `minmax(0, 1fr)` viewport). Keep `TerminalMetaBar` outside `[data-testid="terminal-viewport"]`.

Use existing design tokens or utility classes already present in the command surface. Do not hardcode new visual primitives.

- [ ] **Step 3: Verify**

Run:

```bash
npx vitest run src/renderer/components/command/CommandSurface.test.ts src/renderer/components/command/TerminalMetaBar.test.ts
```

Expected: PASS.

## Task 3: Shell Wiring Contract

**Files:**
- Modify only if tests require: `src/renderer/components/AppShell.vue`
- Modify only if tests require: `src/renderer/components/AppShell.test.ts`

- [ ] **Step 1: Check if AppShell needs new props**

If `CommandSurface` can read `activeSessionPresence` from the store directly, do not add props to `AppShell`.

- [ ] **Step 2: Run shell tests**

Run:

```bash
npx vitest run src/renderer/components/AppShell.test.ts
```

Expected: PASS.

## Task 4: E2E Status Assertion

**Files:**
- Modify: `tests/e2e-playwright/session-event-journey.test.ts`

- [ ] **Step 1: Add failing E2E assertion**

In the existing `claude PermissionRequest hook keeps the terminal mounted` journey, after posting the hook and waiting for state:
- use Playwright auto-waiting on the renderer UI, not backend polling, to assert active session row dot is `data-tone="warning"` and `data-phase="blocked"`
- assert `[data-testid="terminal-status-bar"]` contains `Blocked`

Run:

```bash
npm run build
npx playwright test tests/e2e-playwright/session-event-journey.test.ts
```

Expected before Task 1/2 implementation: FAIL. Expected after implementation: PASS.

## Task 5: Topology and Behavior Assets

**Files:**
- Modify if missing: `testing/topology/command.topology.ts`
- Modify if required by coverage: `testing/behavior/session.behavior.ts`
- Modify if required by coverage: `testing/journeys/session-telemetry.journey.ts`

- [ ] **Step 1: Declare active status bar topology**

If `terminal-status-bar` is not declared in command topology, add it so the renderer-facing telemetry surface is covered by stable test-id contracts.

- [ ] **Step 2: Check behavior coverage**

Run `npm run test:generate` after edits. If behavior coverage expects the active blocked/warning status bar as a named behavior, update behavior and journey assets. Do not hand-edit files under `tests/generated/`.

## Task 6: Full Verification and Commit

**Files:**
- No additional source files unless failures identify required changes.

- [ ] **Step 1: Mandatory gate**

Run each command separately:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected: all exit 0.

- [ ] **Step 2: Commit**

Commit only files changed in this worktree for this fix:

```bash
git add src/renderer/app/App.vue src/renderer/app/App.test.ts src/renderer/components/command/CommandSurface.vue src/renderer/components/command/CommandSurface.test.ts tests/e2e-playwright/session-event-journey.test.ts testing/topology/command.topology.ts docs/superpowers/plans/2026-04-24-frontend-observability-status-fix.md
git commit -m "fix: connect frontend observability status display"
```

## Review Checklist

- App startup calls observability hydrate once per mount.
- Renderer row status and active meta bar use the same snapshot source.
- Fallback status remains for sessions before snapshots arrive.
- PermissionRequest shows blocked/warning, not neutral.
- Running shows working/success, not neutral.
- No provider-specific parsing is added to Vue components.
- No hardcoded visual primitives are added.
