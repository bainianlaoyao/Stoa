---
date: 2026-05-29
topic: unified-session-tree-e2e-coverage
status: completed
mode: context-gathering
sources: 25
---

## Context Report: Unified Session Tree and Subagent Session Control E2E Coverage

### Why This Was Gathered
Bounded research into what e2e/vitest integration test coverage exists for the three recently-committed features: (1) session tree state persistence, (2) session visibility and runtime auth, and (3) subagent/child session control — and what concrete gaps remain before the branch is shippable.

---

### Summary

The **core session lifecycle pipeline** (projects, sessions, PTY, providers, webhook hooks, store hydration, IPC routing) is well-covered end-to-end across 15+ test files. However, the three recently landed features — session tree, session visibility/auth, and subagent child session control — have **zero e2e/integration coverage**. Unit tests exist in `src/core/` but nothing exercises these through the composed stack. One generated Playwright spec also references a deleted Vue component.

---

### Key Findings

#### 1. Existing E2E Coverage That IS Relevant

| Coverage Area | Files | What It Tests |
|---|---|---|
| Project/session CRUD | `backend-lifecycle.test.ts` | Full pipeline: create project → create session → state persistence → restart recovery → webhook server → session runtime → provider commands |
| Real PTY lifecycle | `session-runtime-lifecycle.test.ts` | Shell sessions with real PtyHost through `startSessionRuntime`, exit codes, concurrent sessions |
| Store-backend sync | `store-lifecycle-sync.test.ts` | Manager → Pinia store hydration, hierarchy, computed active cascading, multi-session lifecycle, disk persistence matching |
| Store projection | `frontend-store-projection.test.ts` | Phase 1–8: hydrate, hierarchy, active cascading, add ops, error states, presence projection |
| IPC round-trips | `ipc-bridge.test.ts` | FakeIpcBus full round-trip: renderer → preload → ipcMain → manager → response; includes meta-session proposal/inspector |
| Composition seam | `composition-seam.test.ts` | PtyHost → `SessionRuntimeController` → `window.webContents.send` push, terminal data, persistence |
| Provider integration | `provider-integration.test.ts` | 4 providers (local-shell, opencode, codex, claude-code), sidecar install/uninstall, hook dispatch spawning, lease-driven env vars, Codex hook delivery pipeline |
| Error/edge cases | `error-edge-cases.test.ts` | Duplicate paths, orphan sessions, state corruption, concurrent managers, rapid ops, recovery plans |
| Config guard | `main-config-guard.test.ts` | WebPreferences sandbox:false, IPC handler registration, preload contract, push channels — includes 1 test for `ctlSecret` init before bridge start (line 232–239) |
| App bridge guard | `app-bridge-guard.test.ts` | App.vue with undefined/partially-defined/null stoa, null responses |
| Push channels | `ipc-push-harness.test.ts` | `FakeIpcPushBus` for terminal:data, session presence, memory notifications, title generation |
| Playwright: lifecycle + hooks | `session-event-journey.test.ts` | Real Electron app: webhook event projection, UI status dot updates, Claude lifecycle hooks (PermissionRequest, Stop, UserPromptSubmit, SessionStart), invalid secret rejection |
| Playwright: session restore | `recovery-journey.test.ts` | Archive/restore sessions through real Electron UI |
| Playwright: project session | `project-session-journey.test.ts` | Shell and opencode sessions through real Electron UI |
| Generated specs | 4 files under `tests/generated/playwright/` | meta-session-surface-session-flow, session-restore, session-telemetry-claude-lifecycle, workspace-quick-access |

#### 2. Session Tree — What EXISTS at E2E Level

**Nothing.** No e2e test creates, navigates, or verifies a session tree (parent-child hierarchy).

Evidence chain:
| Finding | Source | Location |
|---|---|---|
| `SessionNodeSnapshot` type exists but no e2e test creates or uses it | `src/shared/project-session.ts` — added in commit `278c7fc` |
| `SessionVisibilityService` exists with `visibleSessionIds()`, `isVisible()`, `checkAuthority()` — covered only by unit test | `src/core/session-visibility-service.ts:19–29` |
| `SessionSupervisor` with `createChildSession()` — covered only by unit test | `src/core/session-supervisor.ts:1–26` |
| `ctlSecret` initialization is guard-tested but never exercised in a real session-visibility flow | `tests/e2e/main-config-guard.test.ts:232–239` |
| `meta-session-store` hydrated independently in `frontend-store-projection.test.ts:84–176` — but this is the old meta-session (pre-session-tree), not the unified tree |

#### 3. Session Visibility and Runtime Auth — What EXISTS at E2E Level

**Nothing.** No e2e test validates visibility boundaries, authority checks, or runtime auth enforcement.

Evidence chain:
| Finding | Source | Location |
|---|---|---|
| `AuthorityAction = 'inspect' \| 'prompt' \| 'create' \| 'destroy'` defined | `src/core/session-visibility-service.ts:3` |
| `checkAuthority(viewerId, targetId, action)` returns `{ allowed, reason }` | `src/core/session-visibility-service.ts:12` |
| `CallerIdentity = { type: 'local-user' } \| { type: 'session'; sessionId }` | `src/core/session-supervisor.ts:4–6` |
| All session-visibility unit tests live in `session-visibility-service.test.ts` (Tier 1) | `src/core/session-visibility-service.test.ts` |
| No e2e file imports or calls any visibility/authority method | Grep across `tests/e2e/**` — 0 matches for `visibility`, `authority`, `checkAuthority` |

#### 4. Subagent / Child Session Control — What EXISTS at E2E Level

**Nothing.** No e2e test creates a child session from a running parent, or exercises `SessionControlServer` REST endpoints.

Evidence chain:
| Finding | Source | Location |
|---|---|---|
| `SessionControlServer` uses Express with routes: `/api/sessions`, `/api/sessions/:id/input`, `/api/sessions/:id/visible-ids`, `/api/sessions/:id/children` | `src/core/session-control-server.ts:1–29` |
| `stoa-ctl port-file` (`src/core/stoa-ctl-port-file.ts`) manages the control server port — unit tested, NOT e2e tested | `src/core/stoa-ctl-port-file.test.ts` (Tier 1) |
| `ctlSecret` passes from main index to `SessionControlServer` for auth | `src/core/session-control-server.ts:17` |
| No e2e test issues an HTTP request to a control server endpoint | Grep across `tests/e2e/**` — 0 matches for `session-control`, `stoa-ctl`, `ctlSecret` in IPC context |
| `workSessionLifecycle.createWorkSessionWithRuntime()` and `archiveWorkSessionWithRuntime()` are guard-tested (config) but never called in a scenario with visible children or subagents | `tests/e2e/main-config-guard.test.ts:224–230` |

#### 5. Generated Playwright Spec Targeting Deleted Components

| File | Issue |
|---|---|
| `tests/generated/playwright/meta-session-surface-session-flow.generated.spec.ts` | References `data-testid="surface.meta-session"`, `meta-session-session-list`, `meta-session-terminal-deck`, `meta-session-inspector-panel` — all deleted in current branch (`git status` shows `D src/renderer/components/meta-session/*.vue`). This spec was auto-generated but targets components that no longer exist. |

Generated specs for `session-restore` and `session-telemetry-claude-lifecycle` appear structurally sound (referencing existing selectors like `session-status-dot`, `terminal-viewport`).

---

### Risks / Unknowns

- [!] **Generated Playwright spec targets deleted components.** `meta-session-surface-session-flow.generated.spec.ts` will fail against the current codebase because it references deleted Vue components. Running `npm run test:e2e` or `npm run test:generate` without regenerating will produce failures.
- [!] **Session tree state is persisted but not verified.** `workspace-store` snapshot is tested for hydration but `SessionNodeSnapshot` tree structure (`depth`, `rootSessionId`, `parentId`) is never asserted at Tier 2. Session tree data could silently be missing from snapshots.
- [!] **Visibility authority is unit-tested in isolation only.** If `SessionControlServer` does not wire `checkAuthority` correctly to Express middleware, the auth layer could be bypassed end-to-end without any e2e failing.
- [!] **StoaCtlPortFile and control server port lifecycle is Tier 1 only.** If the port file is corrupted, deleted, or the server fails to start, the subagent control plane has no integration-level recovery test.
- [?] **Whether `ctlSecret` is actually passed to `SessionControlServer` in the running app** — only guard-tested in `main-config-guard.test.ts:232–239`, not exercised in a real app launch.
- [?] **Whether the session tree hierarchy is exposed in the renderer store** — `useWorkspaceStore` has no `treeDepth` or `rootSessionId` computed that could be tested at Tier 2.
- [?] **Behavior coverage budgets** — `testing/behavior/` assets for `session-visibility`, `session-tree`, and `subagent-control` behavior IDs have not been checked; they may be declared but not verified.
