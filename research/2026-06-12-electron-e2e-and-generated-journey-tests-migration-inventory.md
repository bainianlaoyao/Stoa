---
date: 2026-06-12
topic: electron-e2e-and-generated-journey-tests-migration-inventory
status: completed
mode: context-gathering
sources: 35
---

## Context Report: Electron UI E2E / Generated Journey Tests — Full Inventory & Migration Authority

### Why This Was Gathered

To understand what Electron UI end-to-end / generated journey tests currently exist, what behaviors and topology they cover, and which files are the authoritative sources for migrating them to the stoa-server web UI (Hono HTTP + WebSocket).

### Summary

The project has a **4-tier test architecture**. The Electron-specific UI E2E tests live in two locations: hand-written Playwright tests under `tests/e2e-playwright/` and deterministically generated Playwright tests under `tests/generated/playwright/`. The generated tests are produced by a pipeline that reads behavior specs, topology specs, and journey specs from the `testing/` directory and emits Playwright `.spec.ts` files. All these tests use Electron-specific APIs (`_electron.launch`, `electronApp.evaluate`, `window.stoa` preload bridge, `__VIBECODING_MAIN_E2E__` debug API) that will need to be replaced with HTTP/WS-based equivalents for the stoa-server web UI.

---

### 1. Test Architecture Overview

| Tier | Location | Technology | Count |
|------|----------|------------|-------|
| Tier 1: Unit | `src/**/*.test.ts` | Vitest | ~15 files |
| Tier 2: E2E Integration | `tests/e2e/*.test.ts` | Vitest | 19 files |
| Tier 3: Generated Journey Assets | `testing/**/*.ts`, `tests/generated/**/*.spec.ts` | Vitest + Playwright | 4 generated specs |
| Tier 3b: Hand-written Playwright E2E | `tests/e2e-playwright/*.test.ts` | Playwright | 11 files |
| Tier 4: Config Guard | `tests/e2e/main-config-guard.test.ts`, `tests/e2e/app-bridge-guard.test.ts` | Static analysis | 2 files |

---

### 2. Generated Playwright Journey Tests (`tests/generated/playwright/`)

These are **AUTO-GENERATED** — do not edit by hand. Source of truth is in `testing/`.

| File | Journey ID | Behaviors Covered | Key UI Interactions |
|------|-----------|-------------------|---------------------|
| `session-restore.generated.spec.ts` | `journey.session.restore.base` | `session.restore` | Create project → create session → archive → navigate to archive surface → restore → verify row removed |
| `session-telemetry-claude-lifecycle.generated.spec.ts` | `journey.session.telemetry.claude-lifecycle` | `session.presence.ready`, `running`, `blocked`, `complete`, `failure` | Install fake Claude → create project → create claude-code session → post hook events (UserPromptSubmit, PermissionRequest, PreToolUse, Stop) → verify status dot transitions → click completed session → verify ready → post runtime.exited_failed → verify failure |
| `stoactl-lifecycle.generated.spec.ts` | `journey.stoactl.disableCleanup` | `stoactl.disableCleanup`, `stoactl.envStrippedWhenDisabled` | Create project/session → navigate to settings advanced tab → toggle stoa-ctl off → verify /ctl/health returns 503 |
| `workspace-quick-access.generated.spec.ts` | `journey.workspace.quick-access.actions` | `workspace.quickAccess` | Create project/session → click open-ide → click open-file-manager → click sidebar-toggle → verify sidebar visible → verify IPC workspace open requests |

**Generator pipeline:**

| File | Role |
|------|------|
| `testing/generators/generate-playwright.ts:1-381` | 4 skeleton generators: `generatePlaywrightSkeleton`, `generateClaudeLifecyclePlaywrightSkeleton`, `generateStoactlLifecyclePlaywrightSkeleton`, `generateWorkspaceQuickAccessPlaywrightSkeleton` |
| `testing/generators/write-generated-playwright.ts:1-37` | Entry point that calls generators and writes output files |
| `testing/generators/behavior-coverage.ts:1-89` | Coverage maturity classification: Declared → Reachable → Verified → Hardened |

**Command:** `npm run test:generate` → runs `tsx testing/generators/write-generated-playwright.ts`

---

### 3. Hand-Written Playwright E2E Tests (`tests/e2e-playwright/`)

| File | Description | Electron-specific? |
|------|-------------|--------------------|
| `app-smoke.test.ts:1-68` | Boot shell, empty state, activity icons stability | YES — `launchElectronApp()`, `app-viewport` |
| `project-session-journey.test.ts:1-62` | Shell journey, OpenCode journey | YES — `launchElectronApp()`, `createProject()`, `createSession()` |
| `session-event-journey.test.ts:1-80+` | Session event projection, webhook push events | YES — `launchElectronApp()`, `postWebhookEvent()`, `postClaudeHookEvent()` |
| `terminal-journey.test.ts:1-30+` | Fake Codex install, terminal write, buffer replay | YES — `launchElectronApp()`, `readTerminalBuffer()`, `appendTerminalData()` |
| `recovery-journey.test.ts:1-30+` | Session state recovery, kill-and-relaunch | YES — `killAndRelaunch()`, `waitForSessionState()` |
| `debug-devtools.test.ts:1-33` | Debug mode toggle via key sequence | YES — `getDebugModeActive()` |
| `sidebar-interaction.test.ts:1-32` | Sidebar open/close, tab switching | YES — `launchElectronApp()`, sidebar helpers |
| `file-explorer.test.ts:1-31` | File tree expand, collapse, create file/folder | YES — `launchElectronApp()`, `createSidebarTestProject()` |
| `git-panel.test.ts:1-31` | Source control panel (SKIPPED — needs rg) | YES — `launchElectronApp()` |
| `search-panel.test.ts:1-30` | Search panel, filters, result counts | YES — `launchElectronApp()` |
| `settings-modal-ui.test.ts:1-30` | Settings tabs, modal open/close | YES — `launchElectronApp()` |

---

### 4. Behavior Specs (`testing/behavior/`)

**File:** `testing/behavior/session.behavior.ts:1-233` — 13 behaviors defined:

| Behavior ID | Actor | Risk | Coverage Budget |
|-------------|-------|------|-----------------|
| `workspace.quickAccess` | user | medium | high |
| `session.restore` | user | high | critical |
| `session.telemetry.complete` | system | high | critical |
| `session.telemetry.blocked` | system | high | critical |
| `session.memory-notification` | system | medium | high |
| `session.presence.ready` | system | medium | high |
| `session.presence.running` | system | medium | high |
| `session.presence.complete` | system | high | critical |
| `session.presence.blocked` | system | high | critical |
| `session.presence.failure` | system | high | critical |

**File:** `testing/behavior/meta-session.behavior.ts:1-23` — 1 behavior:

| Behavior ID | Actor | Risk | Coverage Budget |
|-------------|-------|------|-----------------|
| `meta-session.read-full-context-and-gate-prompt` | system | high | critical |

**File:** `testing/behavior/stoactl-lifecycle.ts:1-101` — 5 behaviors:

| Behavior ID | Actor | Risk | Coverage Budget |
|-------------|-------|------|-----------------|
| `stoactl.disabledAtStartup` | system | medium | high |
| `stoactl.enableThenRestart` | user | medium | high |
| `stoactl.disableCleanup` | user | medium | high |
| `stoactl.http503WhenDisabled` | system | low | standard |
| `stoactl.envStrippedWhenDisabled` | system | low | standard |

---

### 5. Topology Specs (`testing/topology/`)

| File | Surface | Key testIds |
|------|---------|-------------|
| `activity-bar.topology.ts:1-11` | activity-bar | `activity-bar`, `activity-cluster-top`, `activity-cluster-bottom` |
| `provider.topology.ts:1-11` | provider-selection | `provider-card`, `provider-card.item`, `provider-radial`, `provider-radial.item` |
| `terminal.topology.ts:1-16` | terminal | `terminal-viewport`, `terminal-xterm`, `terminal-shell`, `workspace.quick-actions`, `workspace.open-ide`, `workspace.open-file-manager`, `workspace.sidebar-toggle` |
| `session-status.topology.ts:1-17` | command-route-status | `session-status-dot`, `data-session-status-testid`, `session-status-ready/running/complete/blocked/failure` |
| `memory-notification.topology.ts:1-9` | memory-notification | `memory-toast-host`, `memory-toast` |
| `archive.topology.ts:1-10` | archive | `surface.archive`, `archive.session.row`, `archive.session.restore` |
| `command.topology.ts:1-20` | command | `command-panel`, `command-body`, `workspace-hierarchy-panel`, `project-row`, `session-row`, `session-status-dot` |
| `modal.topology.ts:1-15` | modal | `modal-root`, `modal-overlay`, `modal-panel`, `new-project.submit/cancel` |
| `stoactl-topology.ts:1-9` | stoactl-lifecycle | `settings-stoactl-toggle`, `settings-advanced-tab` |

---

### 6. Journey Specs (`testing/journeys/`)

| File | Journey IDs |
|------|-------------|
| `session-restore.journey.ts:1-11` | `journey.session.restore.base` |
| `session-telemetry.journey.ts:1-104` | `journey.session.telemetry.complete`, `journey.session.telemetry.blocked`, `journey.session.presence.ready`, `journey.session.presence.running`, `journey.session.presence.ready-after-interrupt`, `journey.session.presence.blocked`, `journey.session.presence.failure`, `journey.session.telemetry.claude-lifecycle` |
| `workspace-quick-access.journey.ts:1-11` | `journey.workspace.quick-access.actions` |
| `session-memory-notification.journey.ts:1-11` | `journey.session.memory-notification` |
| `stoactl-lifecycle.journey.ts:1-40` | `stoactl.disableCleanup`, `stoactl.envStrippedWhenDisabled` |
| `meta-session.journey.ts:1-11` | `journey.meta-session.read-full-context-and-gate-prompt` |

---

### 7. Playwright Infrastructure (`tests/e2e-playwright/`)

| File | Role |
|------|------|
| `fixtures/electron-app.ts:1-308` | **Core fixture**: `launchElectronApp()`, `cleanupStateDir()`, `readTerminalBuffer()`, `appendTerminalData()`, `getMainE2EDebugState()`, `queueNextFolderPick()`, `postWebhookEvent()`, `postClaudeHookEvent()`, `getWorkspaceOpenRequests()`, `clearWorkspaceOpenRequests()`, `getDebugModeActive()` |
| `fixtures/sidebar-test-project.ts:1-73` | Creates temp git project with staged/modified/untracked files for sidebar testing |
| `helpers/ui-actions.ts:1-119` | `createProject()`, `createSession()`, `focusTerminalInput()`, `runTerminalCommand()` |
| `helpers/sidebar-actions.ts:1-257` | Sidebar open/close, FileExplorer CRUD, SearchPanel, SourceControlPanel, Git operations |

---

### 8. Migration Target: stoa-server

| File | Role |
|------|------|
| `stoa-server/src/app.ts:1-91` | Hono app factory with deps injection — route groups: projects, sessions, settings, observability, metaSessions, sidebar, webhooks, discovery, health, static |
| `stoa-server/src/index.ts:1-217` | Entry point — wires SQLite/JSON backend, WsHub, services, starts `@hono/node-server` |
| `stoa-server/src/ws/hub.ts` | WebSocket hub for real-time push to web client |
| `stoa-shared/types/index.ts:1-11` | Re-exports from `src/shared/` — all shared types |
| `stoa-server/src/routes/sessions.ts` | Session CRUD routes |
| `stoa-server/src/routes/webhooks.ts` | Webhook event ingestion |
| `stoa-server/src/routes/sidebar.ts` | Sidebar state routes |

**Key migration differences (Electron → Web):**

1. **Launch:** `_electron.launch()` → HTTP client + browser page pointing at `http://localhost:{port}`
2. **Debug state:** `electronApp.evaluate(() => __VIBECODING_MAIN_E2E__.getDebugState())` → `GET /api/v1/observability/...` or WebSocket subscription
3. **Hook events:** `postClaudeHookEvent()` already uses HTTP → same endpoint, different origin
4. **Webhook events:** `postWebhookEvent()` already uses HTTP → same endpoint, different origin
5. **Terminal buffer:** `readTerminalBuffer()` / `appendTerminalData()` via Electron evaluate → WebSocket stream or SSE endpoint
6. **Folder picker:** `queueNextFolderPick()` via Electron dialog mock → HTTP API or browser file picker
7. **Window preload bridge:** `window.stoa` → not applicable in web; use HTTP API directly
8. **IPC:** Electron IPC channels → HTTP REST + WebSocket
9. **Test IDs:** `data-testid` attributes on Vue components → same test IDs still work in Playwright browser mode

---

### 9. Authoritative Files for Migration

The following files are the **source of truth** that must be adapted or preserved:

| Migration Concern | Authoritative Source | Notes |
|-------------------|---------------------|-------|
| Behavior specs (what to test) | `testing/behavior/session.behavior.ts`, `testing/behavior/meta-session.behavior.ts`, `testing/behavior/stoactl-lifecycle.ts` | Platform-agnostic — keep as-is |
| Topology specs (UI element IDs) | `testing/topology/*.topology.ts` | `data-testid` values transfer to web Playwright |
| Journey specs (test sequences) | `testing/journeys/*.journey.ts` | Setup/act/assert steps are declarative — adapt only platform-specific setup |
| Contract DSL | `testing/contracts/testing-contracts.ts:1-164` | `defineBehavior`, `defineTopology`, `defineJourney`, `defineGeneratedTestMeta` — keep as-is |
| Generator pipeline | `testing/generators/generate-playwright.ts`, `testing/generators/write-generated-playwright.ts` | Templates generate Electron-specific code — must be rewritten to target browser Playwright |
| Coverage classification | `testing/generators/behavior-coverage.ts` | Platform-agnostic — keep as-is |
| Playwright fixtures | `tests/e2e-playwright/fixtures/electron-app.ts` | Must be replaced with HTTP/browser fixtures |
| Playwright helpers | `tests/e2e-playwright/helpers/ui-actions.ts`, `tests/e2e-playwright/helpers/sidebar-actions.ts` | UI interaction helpers largely transfer — only project creation (folder picker) needs adaptation |
| stoa-server API surface | `stoa-server/src/app.ts`, `stoa-server/src/routes/*.ts`, `stoa-server/src/ws/hub.ts` | Target API surface for the new tests |

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 4 generated Playwright specs exist | `tests/generated/playwright/*.generated.spec.ts` | Glob match |
| 11 hand-written Playwright E2E test files exist | `tests/e2e-playwright/*.test.ts` | Glob match |
| 19 total declared behaviors across 3 files | `testing/behavior/*.ts` | File read |
| 9 topology surfaces with testIds | `testing/topology/*.topology.ts` | File read |
| 12 journey specs across 6 files | `testing/journeys/*.journey.ts` | File read |
| Generator writes 4 spec files | `testing/generators/write-generated-playwright.ts:13-36` | Lines 13-36 |
| All Playwright tests use `launchElectronApp()` | `tests/e2e-playwright/fixtures/electron-app.ts:110-162` | Function definition |
| Debug API uses `__VIBECODING_MAIN_E2E__` global | `tests/e2e-playwright/fixtures/electron-app.ts:214-221` | `getMainE2EDebugState()` |
| stoa-server uses Hono + WebSocket hub | `stoa-server/src/index.ts:174-179` | `serve()` + `WsHub` |
| stoa-server serves web client via `--web` flag | `stoa-server/src/index.ts:42-43`, `stoa-server/src/app.ts:74-76` | CLI parsing + static mount |
| Shared types re-exported from stoa-shared | `stoa-shared/types/index.ts:1-11` | Re-exports |
| Coverage maturity: Declared → Reachable → Verified → Hardened | `testing/generators/behavior-coverage.ts:28-51` | `classifyBehavior()` |
| Git panel tests are skipped (needs rg) | `tests/e2e-playwright/git-panel.test.ts:22` | `test.skip()` |

---

### Risks / Unknowns

- [!] **All Playwright E2E tests are Electron-only.** Every test file calls `launchElectronApp()` which uses `_electron.launch()`. None can run against a browser URL without fixture replacement.
- [!] **Generator templates hardcode Electron APIs.** `generate-playwright.ts` emits code importing `launchElectronApp`, `createProject` (which requires Electron folder picker mock), and `electronApp.evaluate()`. The entire generator must be rewritten for web Playwright.
- [!] **`createProject()` uses `queueNextFolderPick()`** which mocks the Electron native dialog. In web mode, project creation likely uses a different API endpoint or browser file picker.
- [!] **Terminal buffer access** uses `electronApp.evaluate()` to call `__VIBECODING_MAIN_E2E__.getTerminalReplay()`. Web mode needs an HTTP/SSE/WebSocket equivalent.
- [?] **stoa-server web client readiness** — `stoa-server/src/index.ts:161-168` has `--web` flag and `isWebClientAvailable()` but no web client build is visible in the repo. Unknown if the Vue renderer has been adapted to work standalone.
- [?] **WebSocket subscription API** — `stoa-server/src/ws/hub.ts` exists but the subscription protocol for real-time state push is not documented in the files read.
- [?] **Session runtime bridge** — `stoa-server/src/routes/runtime-bridge.ts` and `stoa-server/src/services/runtime-bridge-client.ts` exist but weren't fully read; the stoa-server currently uses `createStubRuntimeBridge()` (returns 503), meaning session lifecycle via web is not yet connected.

---

### Key Takeaway

The **behavior/topology/journey declarations** in `testing/` are **platform-agnostic** and transfer directly. The **generator templates** and **Playwright fixtures** are deeply Electron-specific and require full replacement. The stoa-server has the HTTP+WS API surface ready but session lifecycle integration (terminal, PTY, runtime bridge) appears stubbed.
