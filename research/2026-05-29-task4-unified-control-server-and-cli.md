---
date: 2026-05-29
topic: Task 4 — Unified Control Server, CLI, and Main-Process Wiring
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Task 4 — Unified Control Server And CLI

### Why This Was Gathered

Task 4 creates four new modules (`SessionSupervisor`, `SessionControlServer`, `SessionCommandEnv`, `SessionBootstrapPromptService`), rewrites the CLI, and unwires the entire meta-session stack from `main/index.ts`. This research maps what exists, what must be deleted, what can be extracted into skeletons, and the minimal viable refactoring order.

### Summary

The existing meta-session control plane is a self-contained stack: `MetaSessionManager` + `MetaSessionProposalStore` + `MetaSessionCommandDispatcher` + `MetaSessionContextAssembler` + `MetaSessionControlServer` + `meta-session-command-env` + `meta-session-bootstrap-prompt` + `meta-session-provider-patch` + `meta-session-state-store`. It is wired exclusively from `main/index.ts` (10 import lines) and mounted into the Express app via `SessionEventBridge.configureServerApp`. The CLI (`tools/stoa-ctl/index.ts`) is a standalone HTTP client with no meta-session imports. Task 4 must replace the **server internals** (routes, auth, session resolution) while preserving the **CLI HTTP contract** shape and port-file discovery. The refactoring can be done in a precise order that keeps the build green at each step.

---

### Key Findings

#### 1. Meta-Session Stack Is Fully Self-Contained

All 10 meta-session modules live under `src/core/meta-session-*.ts` and `src/shared/meta-session.ts`. They only import from each other, from `@shared/project-session`, and from `@shared/observability`. No other `src/core` module imports from the meta-session stack (confirmed by grep). The **only external consumer** is `src/main/index.ts`.

| File | Lines | Role |
|------|-------|------|
| `src/core/meta-session-manager.ts` | 243 | CRUD + persistence for `MetaSessionSummary` |
| `src/core/meta-session-state-store.ts` | 517 | Atomic JSON persistence with validation |
| `src/core/meta-session-control-server.ts` | 669 | Express routes for `/ctl/*` |
| `src/core/meta-session-command-dispatcher.ts` | 189 | Prompt/send-keys dispatch + proposal flow |
| `src/core/meta-session-context-assembler.ts` | 163 | Status/bundle/slim/full context assembly |
| `src/core/meta-session-proposal-store.ts` | 320 | In-memory + persisted proposal state machine |
| `src/core/meta-session-command-env.ts` | 24 | Builds `STOA_*` env vars for provider commands |
| `src/core/meta-session-bootstrap-prompt.ts` | 33 | Static bootstrap prompt text |
| `src/core/meta-session-provider-patch.ts` | 137 | Maps `SessionStatePatchEvent` → `MetaSessionRuntimePatch` |
| `src/shared/meta-session.ts` | 199 | Shared types: `MetaSessionSummary`, `PersistedMetaSession*` |

#### 2. `main/index.ts` Wiring Surface (Lines 13-24, 636-718, 1016-1058)

10 imports from meta-session stack. The critical wiring happens at:

- **Line 469**: `metaSessionManager = await MetaSessionManager.create(...)` — initialization
- **Lines 563-594**: `metaSessionContextAssembler`, `metaSessionCommandDispatcher`, `metaSessionProposalStore` — construction
- **Lines 636-718**: `configureServerApp` callback — mounts `createMetaSessionControlServer` onto Express
- **Lines 843-1014**: `launchMetaSessionRuntimeWithGuard`, `createMetaSessionWithRuntime`, `setActiveMetaSessionWithEvent`, `archiveMetaSessionWithRuntime`, `restoreMetaSessionWithRuntime` — lifecycle functions
- **Lines 1546-1645**: IPC handlers for `metaSession:*` channels (bootstrap, create, set-active, archive, restore, proposal CRUD, inspector target)

#### 3. CLI Is a Clean HTTP Client

`tools/stoa-ctl/index.ts` (760 lines) has **zero meta-session imports**. It communicates exclusively via HTTP to `/ctl/*` endpoints. The CLI's contract with the server is:

- Headers: `x-stoa-session-id`, `x-stoa-secret`
- Port discovery: `~/.stoa/ctl.json` → `STOA_CTL_BASE_URL` fallback
- Session resolution: `STOA_META_SESSION_ID` → `STOA_SESSION_ID` → `--session` flag → port file `activeMetaSessionId`

**CLI rewrite scope**: The `meta-sessions *` commands must become `session *` commands. The `work-sessions *` commands should be reviewed for tree-aware semantics. The header `x-stoa-session-id` should become `x-stoa-session-token` (or dual-header). The session resolution chain should drop `STOA_META_SESSION_ID` and `activeMetaSessionId`.

#### 4. Port File (`stoa-ctl-port-file.ts`) Must Be Updated

Currently carries `activeMetaSessionId: string | null` (line 9). Task 4 replaces this with the unified session model. The field should become `activeSessionId` or be removed entirely in favor of the tree's root session.

#### 5. Control Server Auth Must Change

Current auth (`meta-session-control-server.ts:83-96`): accepts either a `ctlSecret` (64-char hex from port file) **or** a valid `x-stoa-session-id` header pointing to an existing meta-session. Task 4 shifts to **session-scoped tokens**: each live provider session gets a `STOA_CTL_SESSION_TOKEN` (hook lease secret). The control server validates this token against the runtime controller's registry. The `ctlSecret` global fallback should be preserved for CLI/external use.

#### 6. `SessionEventBridge` Mounting Point

The control server is mounted via the `configureServerApp` callback on `SessionEventBridge` constructor options (`session-event-bridge.ts:50,107`). This callback receives the Express app and registers routes. The unified `SessionControlServer` should use the same mounting mechanism — no changes needed to `SessionEventBridge` itself.

#### 7. `SessionBootstrapPromptService` Replaces Static Prompt

`meta-session-bootstrap-prompt.ts` is a single exported string constant. The new `SessionBootstrapPromptService` should be a thin service that can return different prompts based on session type (claude-code vs codex vs opencode vs shell), rather than one static prompt. The `main/index.ts:843-845, 972-1011` already has provider-specific logic (OpenCode gets prompt via `\r` send, Claude Code gets it via initialPrompt, Codex gets it via bootstrap-pending webhook).

#### 8. Test Surface for Task 4

**Existing tests to delete/replace:**
- `src/core/meta-session-control-server.test.ts` (1078 lines, 6 test cases) → replaced by `src/core/session-control-server.test.ts`
- `src/core/meta-session-command-dispatcher.test.ts` → replaced by `src/core/session-supervisor.test.ts`
- `src/core/meta-session-command-env.test.ts` (23 lines) → replaced by `src/core/session-command-env.test.ts`
- `src/core/meta-session-manager.test.ts` → deleted (manager is removed)
- `src/core/meta-session-proposal-store.test.ts` → deleted or adapted if proposals survive
- `src/core/meta-session-context-assembler.test.ts` → deleted (assembler is removed)
- `src/core/meta-session-provider-patch.test.ts` → deleted (patch is removed)
- `src/core/meta-session-state-store.test.ts` → deleted (state store is removed)
- `tools/stoa-ctl/index.test.ts` (884 lines) → heavily modified for new `session` commands

**New test files:**
- `src/core/session-supervisor.test.ts`
- `src/core/session-control-server.test.ts`
- `src/core/session-command-env.test.ts`
- `src/core/session-bootstrap-prompt-service.test.ts`

---

### Minimal Viable Refactoring Order

This order keeps the build green at each step and minimizes merge conflicts.

#### Phase A: Create New Skeletons (Additive Only)

1. **Create `src/core/session-command-env.ts`** — Extract from `meta-session-command-env.ts`. Replace `STOA_META_SESSION`/`STOA_META_SESSION_ID` with `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN`. Keep PATH prepending. ~30 lines.

2. **Create `src/core/session-bootstrap-prompt-service.ts`** — Thin service wrapping provider-aware prompt selection. Can initially return the existing `META_SESSION_BOOTSTRAP_PROMPT` unchanged. ~20 lines.

3. **Create `src/core/session-supervisor.ts`** — New. This is the **orchestration layer** that replaces `MetaSessionManager` + `MetaSessionCommandDispatcher` + `MetaSessionContextAssembler`. It should:
   - Accept `ProjectSessionManager` (already has tree semantics from Task 2)
   - Accept `SessionVisibilityService` (from Task 3)
   - Accept `SessionInputLike` (from existing dispatcher)
   - Provide `createChildSession`, `inspectSession`, `promptSession`, `destroySession`, `listVisibleSessions`
   - Enforce authority scope via visibility service

4. **Create `src/core/session-control-server.ts`** — Extract route structure from `meta-session-control-server.ts`. Replace `MetaSessionSource` interface with `SessionSupervisor`. Update auth to validate `x-stoa-session-token` against the runtime controller's token registry. Routes change from `/ctl/work-sessions/*` + `/ctl/meta-sessions/*` to unified `/ctl/session/*`.

#### Phase B: Wire New Stack Into Main (Replace, Not Adapt)

5. **Modify `src/main/index.ts`** — This is the largest single change:
   - Remove 10 meta-session imports (lines 13-22)
   - Remove `metaSessionManager`, `metaSessionBootstrapPending` declarations
   - Replace `configureServerApp` callback to use `SessionControlServer`
   - Replace `launchMetaSessionRuntimeWithGuard` with unified session launch using `SessionCommandEnv` and `SessionBootstrapPromptService`
   - Remove `createMetaSessionWithRuntime`, `setActiveMetaSessionWithEvent`, `archiveMetaSessionWithRuntime`, `restoreMetaSessionWithRuntime`
   - Remove all `metaSession:*` IPC handlers (lines 1546-1645)
   - Remove `pushMetaSessionEvent` helper
   - Remove `compositeRuntimeController` meta-session branch

6. **Modify `src/core/ipc-channels.ts`** — Remove all `metaSession*` channel names (8 entries, lines 17-28). Add any new session-tree channels if needed.

7. **Modify `src/core/stoa-ctl-port-file.ts`** — Replace `activeMetaSessionId` with `activeSessionId` (or remove).

#### Phase C: Rewrite CLI

8. **Modify `tools/stoa-ctl/index.ts`** — Replace `meta-sessions *` commands with `session *` commands. Update header from `x-stoa-session-id` to `x-stoa-session-token` (or dual). Remove `STOA_META_SESSION_ID` from session resolution chain. Update usage text.

#### Phase D: Clean Up Meta-Session Stack

9. **Delete meta-session modules** — After main/index.ts no longer imports them:
   - `src/core/meta-session-manager.ts` + `.test.ts`
   - `src/core/meta-session-state-store.ts` + `.test.ts`
   - `src/core/meta-session-control-server.ts` + `.test.ts`
   - `src/core/meta-session-command-dispatcher.ts` + `.test.ts`
   - `src/core/meta-session-context-assembler.ts` + `.test.ts`
   - `src/core/meta-session-proposal-store.ts` + `.test.ts`
   - `src/core/meta-session-command-env.ts` + `.test.ts`
   - `src/core/meta-session-bootstrap-prompt.ts`
   - `src/core/meta-session-provider-patch.ts` + `.test.ts`
   - `src/shared/meta-session.ts`

---

### What Old Interfaces Must Be Directly Deleted

These interfaces have no path to adaptation — they encode meta-session semantics that fundamentally conflict with the unified tree model:

| Interface/File | Why Delete |
|----------------|-----------|
| `MetaSessionSource` (control-server.ts:15-22) | Encodes separate meta-session CRUD, not unified session tree |
| `MetaSessionBootstrapState` (meta-session.ts:177-181) | Separate bootstrap state for meta-sessions |
| `CreateMetaSessionRequest` (meta-session.ts:183-187) | Replaced by tree-aware child session creation |
| `MetaSessionSnapshot` (meta-session.ts:189) | Separate snapshot type |
| `MetaSessionEvent` (meta-session.ts:191-193) | Replaced by `SessionGraphEvent` |
| `MetaSessionDispatchError` (dispatcher.ts:50-58) | Replace with unified `SessionControlError` |
| `PromptDispatchInput` / `SendKeysDispatchInput` (dispatcher.ts:13-23) | Meta-session ID in interface |
| `MetaSessionContextAssembler` class | Entire class replaced by supervisor |
| `MetaSessionProposalStore` class | Proposal system may survive but without `meta_session_id` coupling |
| `buildMetaSessionCommandEnv()` | Replaced by `buildSessionCommandEnv()` |
| `META_SESSION_BOOTSTRAP_PROMPT` constant | Replaced by `SessionBootstrapPromptService` |
| `deriveMetaSessionProviderSessionPatch()` | No more separate meta-session runtime patch path |
| `MetaSessionManager` class | Entire class replaced by `ProjectSessionManager` tree semantics |
| All IPC channels: `metaSession*` | 8 channels removed from `ipc-channels.ts` |

---

### What Existing Implementation Can Be Extracted Into Skeletons

| New Skeleton | Source | What To Extract |
|-------------|--------|-----------------|
| `SessionCommandEnv` | `meta-session-command-env.ts` (24 lines) | Nearly identical, just rename env vars: drop `STOA_META_SESSION`/`STOA_META_SESSION_ID`, keep `STOA_SESSION_ID` + `STOA_CTL_BASE_URL` + `STOA_CTL_COMMAND` + `STOA_CTL_SESSION_TOKEN` (new), PATH prepend |
| `SessionBootstrapPromptService` | `meta-session-bootstrap-prompt.ts` (33 lines) | Wrap the static string in a class with a `getPrompt(sessionType)` method. Initially returns the same text for all types. |
| `SessionSupervisor` | `meta-session-command-dispatcher.ts` (189 lines) + parts of `meta-session-manager.ts` | Extract the dispatch logic (sendKeys, prompt via sessionInput). Replace `metaSessionId` with caller session ID + visibility authority check. Add `createChildSession` from tree semantics. |
| `SessionControlServer` | `meta-session-control-server.ts` (669 lines) | Extract the Express app factory pattern, `jsonEnvelope` helper, `authorize` middleware structure, route registration pattern. Replace `MetaSessionSource` with `SessionSupervisor`. Change auth from session-id-lookup to token validation. Restructure routes: `/ctl/session/:id/*` replaces `/ctl/work-sessions/*` + `/ctl/meta-sessions/*`. |

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 10 meta-session imports in main | Import block | `src/main/index.ts:13-24` |
| Control server mounted via configureServerApp | Constructor option | `src/main/index.ts:661-718` |
| Meta-session lifecycle functions | Function definitions | `src/main/index.ts:843-1058` |
| IPC handlers for meta-session channels | Handler registrations | `src/main/index.ts:1546-1645` |
| CLI has zero meta-session imports | Module body | `tools/stoa-ctl/index.ts:1-760` |
| CLI session resolution chain | `resolveHeaders()` | `tools/stoa-ctl/index.ts:93-113` |
| Port file carries activeMetaSessionId | Interface | `src/core/stoa-ctl-port-file.ts:9` |
| Control server auth accepts session-id or secret | `authorize()` | `src/core/meta-session-control-server.ts:83-96` |
| SessionEventBridge configureServerApp mount | Constructor option | `src/main/session-event-bridge.ts:50,107` |
| Bootstrap prompt is a static string | Module body | `src/core/meta-session-bootstrap-prompt.ts:1-33` |
| Provider-specific bootstrap logic | Launch function | `src/main/index.ts:972-1011` |
| commandEnv pattern for STOA_* vars | `buildMetaSessionCommandEnv` | `src/core/meta-session-command-env.ts:10-24` |
| Existing test: control server (1078 lines) | Test file | `src/core/meta-session-control-server.test.ts` |
| Existing test: CLI (884 lines) | Test file | `tools/stoa-ctl/index.test.ts` |
| Existing test: dispatcher | Test file | `src/core/meta-session-command-dispatcher.test.ts` |
| Existing test: command env (23 lines) | Test file | `src/core/meta-session-command-env.test.ts` |
| Renderer meta-session files (15 files) | Grep results | `src/renderer/**/*meta-session*`, `AppShell.vue`, `GlobalActivityBar.vue`, `App.vue` |
| Preload meta-session references | Grep result | `src/preload/index.ts` |
| 8 meta-session IPC channels | Channel definitions | `src/core/ipc-channels.ts:17-28` |
| Task 3 research completed | Report file | `research/2026-05-29-task3-visibility-and-runtime-auth.md` |

---

### Risks / Unknowns

- [!] **Proposal system may need to survive** — `MetaSessionProposalStore` has a full state machine (pending → approved → executing → completed/failed/stale). The plan doesn't explicitly say whether proposals are unified or dropped. The CLI still has `proposals *` commands. Likely: proposals survive but are keyed by `sessionId` instead of `metaSessionId`. This needs confirmation during implementation.

- [!] **Renderer cleanup is Task 5, not Task 4** — 15 renderer files reference meta-session. Task 4 should NOT touch these files. The `main/index.ts` IPC handler removal will break the renderer at runtime, but Task 5 fixes the renderer. This means the app won't be fully runnable between Task 4 and Task 5.

- [!] **`configureServerApp` callback is the only mount point** — If `SessionControlServer` needs to change how Express routes are registered (e.g., adding middleware or changing the app-level auth), the `SessionEventBridge` API must be accommodated. Currently the callback receives the raw Express app — this is sufficient.

- [?] **`SessionSupervisor` scope** — The plan's test example shows `session destroy rejects same-depth peer target`. This means the supervisor must enforce authority rules. But the plan doesn't show a `SessionSupervisor` constructor or interface. The implementation must define: what dependencies does it take? Likely: `ProjectSessionManager`, `SessionVisibilityService`, `SessionInputLike`, and the runtime controller's token registry.

- [?] **CLI `x-stoa-session-id` → `x-stoa-session-token` migration** — The plan says "no `activeMetaSessionId` fallback" and implies token-based auth. But the existing CLI sends `x-stoa-session-id` header, not a token. The server must accept both during migration, or the CLI and server must change simultaneously.

- [?] **`session-event-bridge.ts` has `configureServerApp` but no access to the resulting port until `start()`** — The control server's port is determined when `SessionEventBridge.start()` calls `app.listen(0)`. The port file is written after this. This sequence is unchanged and compatible.
