---
date: 2026-05-29
topic: unified-session-tree-unit-coverage
status: completed
mode: context-gathering
sources: 25
---

## Context Report: Unified Session Tree Unit Test Coverage

### Why This Was Gathered
Bounded coverage audit for unified session tree, session visibility/authority, session caller auth, command env, bootstrap prompt, and tree projection on `feature/unified-session-tree`.

### Summary
Strong core-unit coverage exists for session visibility service, supervisor, control server, command env, and bootstrap prompt. The renderer store `workspaces.test.ts` has extensive tree projection coverage via `applySessionGraphEvent`. Critical gaps remain in: (1) `meta-session` store (deleted, no replacement), (2) multi-tree isolation in the supervisor, (3) bootstrap prompt integration with the actual context assembler, and (4) `SessionBootstrapPromptService` content validation.

### Key Findings

#### Session Visibility (`SessionVisibilityService`)
- **File**: `src/core/session-visibility-service.test.ts` (256 lines)
- **Coverage**: `visibleSessionIds` for root/single/leaf/cross-tree callers (lines 52–118); `checkAuthority` for inspect/prompt/create/destroy on self/descendant/same-depth-peer/ancestor (lines 134–255)
- **Gaps**: None in core authority rules; multi-tree peer cross-visibility is tested (line 98–111)

#### Session Supervisor (`SessionSupervisor`)
- **File**: `src/core/session-supervisor.test.ts` (302 lines)
- **Coverage**: `listSessions` for local-user vs session caller (lines 88–108); `inspectSession` for existing/invisible/unknown (lines 110–136); `promptSession` dispatch + rejection branches (lines 138–193); `createChildSession` local-user rewrite and session-caller redirect (lines 195–248); `destroySession` delegation + peer rejection + descendant allowed (lines 250–300)
- **Gaps**: No test for supervisor when `getSnapshot` returns nodes from *multiple* distinct session trees (root-1 + root-2) and a session caller from root-1 prompts/destroys a node that is visible but in a different tree. The mock at line 75 returns *all* nodes always — the real service's multi-tree isolation is never exercised.

#### Session Control Server (Loopback HTTP)
- **File**: `src/core/session-control-server.test.ts` (416 lines)
- **Coverage**: Auth (no-credentials 401 / secret / token / invalid token / unknown session) (lines 130–160); `/ctl/health`, `/ctl/whoami`, `/ctl/capabilities` (lines 162–201); `/ctl/session/list` (lines 203–211); `/ctl/session/:id/inspect` (lines 213–244); `/ctl/session/:id/prompt` (lines 246–285); `/ctl/session/:id/destroy` (lines 287–311); `/ctl/session/create` all variants (lines 313–414)
- **Gaps**: No test for `/ctl/session/:id/prompt` with empty `text` body (validation boundary). No test for malformed JSON body on any POST route.

#### Session Command Env
- **File**: `src/core/session-command-env.test.ts` (70 lines)
- **Coverage**: Full env output with all variables (lines 6–20); negative cases for old meta-session vars (lines 22–32); `basePath` null/empty/fallback (lines 34–68)
- **Gaps**: None significant — edge cases for `basePath` are covered

#### Bootstrap Prompt Service
- **File**: `src/core/session-bootstrap-prompt-service.test.ts` (37 lines)
- **Coverage**: Non-empty prompt (line 7); no "meta session" wording (line 12); mentions tree-local visibility (line 19); mentions stoa-ctl session commands (line 25); contains "metadata is not content" rule (line 31)
- **Gaps**: Only string-inclusion checks. No test that the prompt contains session-specific content (e.g., the session's own ID or tree metadata). No test that the prompt length is bounded or within reasonable LLM context limits.

#### Meta Session Command Dispatcher
- **File**: `src/core/meta-session-command-dispatcher.test.ts` (387 lines)
- **Coverage**: Freeform prompts gate through proposal store with approval required (lines 13–123); stale proposal dispatch rejection (lines 125–184); state-change staleness detection (lines 186–248); preset dispatch bypasses approval (lines 250–305); send-keys bypasses approval (lines 307–359); unknown session rejection (lines 361–386)
- **Gaps**: No test for `promptWorkSession` when the target session's `turnState` is `running` (blocking state) — only `idle`+`completed` cases are tested.

#### Meta Session Control Server (Separate from SessionControlServer)
- **File**: `src/core/meta-session-control-server.test.ts` (1079 lines)
- **Coverage**: Context routes (slim/full/brief) (lines 163–258); whoami/capabilities/collections (lines 260–419); create/activate/archive/restore meta sessions (lines 421–555); work-session lifecycle (lines 557–681); validation rejection (lines 683–782); attention queue + proposals (lines 784–969); secret auth acceptance + rejection (lines 971–1047); bootstrap prompt text content (lines 1049–1078)
- **Gaps**: No test for `/ctl/meta-sessions/:id/prompt` (prompting a meta session's backend itself). No test for meta session with `capabilityLevel` boundary values (0, max).

#### Renderer Store (`workspaces.test.ts`) — Tree Projection
- **File**: `src/renderer/stores/workspaces.test.ts` (1749 lines)
- **Coverage**:
  - Hydrate + `projectHierarchy` derivation (lines 268–433)
  - Archive/restore (lines 435–568)
  - Observability snapshots: hydrate, push, sourceSequence ordering (lines 570–1372)
  - **Tree projection via `applySessionGraphEvent`**: child upsert (lines 1375–1435), recursive hierarchy with `treeDepth`/`treeRootSessionId`/`treeChildCount`/`treeDescendantCount` (lines 1437–1517), archived tree sections (lines 1519–1562), non-renderer origin does not steal active (lines 1564–1626), update event (lines 1628–1686), archived event (lines 1688–1747)
- **Gaps**: No test for `applySessionGraphEvent` with `kind: 'restored'` (only `created`, `updated`, `archived` are tested). No test for concurrent graph events arriving out-of-order (sequence/gapfill).

#### Renderer App (`App.test.ts`)
- **File**: `src/renderer/app/App.test.ts` (1253 lines)
- **Coverage**: Bootstrap hydration (lines 280–386); push subscriptions (memory/title/session notifications) (lines 388–504); `onSessionGraphEvent` subscription and graph event application (lines 589–626); session archiving/restoring (lines 863–995)
- **Gaps**: App-level test does NOT cover what happens when `onSessionGraphEvent` is `undefined` (graceful fallback tested at store level but not at App level). No App-level test for `applySessionGraphEvent` with a `SessionGraphEvent` that contains a session node with `tree.depth > 1` (deep tree projection through App).

#### Session State Reducer
- **File**: `src/shared/session-state-reducer.test.ts` (596 lines)
- **Coverage**: Comprehensive: ready/running/blocked/failure/complete phase derivation; turn lifecycle; permission flow; completion retention; stale sequence rejection; duplicate patches; `runtime.alive` behavior (lines 72–594)
- **Gaps**: None significant for reducer logic

#### Project Session Manager
- **File**: `src/core/project-session-manager.test.ts` (2031 lines)
- **Coverage**: Session lineage: parent/child/creator validation (lines 849–982); `getSessionNodeSnapshot` with tree metadata (depth, childCount, descendantCount) (lines 984–1047); archive/restore full subtree (lines 1677–1796); `buildBootstrapRecoveryPlan` with archive/exclusion/ordering (lines 1798–1918); lineage cycle tolerance (lines 1920–2028)
- **Gaps**: No test for `getSessionNodeSnapshot` when the session has a `parentSessionId` that points to a session in a *different project* (cross-project parent edge case — the creation guard is tested but the snapshot derivation is not).

#### Session Runtime
- **File**: `src/core/session-runtime.test.ts` (769 lines)
- **Coverage**: Spawn paths (shell/opencode/codex/claude-code), resume vs fresh-start, `commandEnv` merge (line 659), fast exit, markRuntimeAlive/Exited call ordering, `requireExternalSessionIdForResume` rejection, provider defaults (providerPort, sessionSecret, providerPath)
- **Gaps**: No test for `startSessionRuntime` when `commandEnv` has conflicting keys (e.g., `PATH` override vs `stoaCtlBinDir` prepend). No test for shell sessions when `shellPath` is explicitly `null` vs omitted.

#### Session Runtime Callbacks
- **File**: `src/core/session-runtime-callbacks.test.ts` (728 lines)
- **Coverage**: `onData` → `appendTerminalData` (lines 61–112); `onExit` → `markRuntimeExited` (lines 114–221); call order (lines 223–249); providerPort/sessionSecret/providerPath defaults (lines 251–456); `canResume` logic branches (lines 458–623); `markRuntimeAlive` externalSessionId passthrough (lines 625–686); `toProviderTarget` mapping (lines 688–727)
- **Gaps**: No test for what happens when `ptyHost.start()` throws synchronously (unhandled error propagation path).

#### Session Input Router
- **File**: `src/main/session-input-router.test.ts` (164 lines)
- **Coverage**: Non-codex passthrough, codex text, multiline paste, bracketed paste sequences, stale write reset, Ctrl+C interruption, binary forwarding
- **Gaps**: No test for what happens when `write()` returns a rejected Promise (error handling path).

#### Session Event Bridge
- **File**: `src/main/session-event-bridge.test.ts` (2398 lines)
- **Coverage**: Extremely comprehensive: secret auth, canonical events, hook adaptation (Claude/Codex/OpenCode), observability ingestion, evidence persistence, turn maintenance, lease auth, event ordering, sequence allocation, session rebind, memory notifications, graceful shutdown path verification
- **Gaps**: No test for event bridge when the session ID in the hook header does not match the session secret's session ID (auth cross-check). No test for the shutdown path itself actually awaiting `bridge.stop()`.

#### Meta Session Context Assembler
- **File**: `src/core/meta-session-context-assembler.test.ts` (163 lines)
- **Coverage**: Full context with terminal replay merge, tool payload exclusion (lines 108–162)
- **Gaps**: No test for `getFullContext` with `maxChars` truncation boundary. No test for when `getTerminalReplay` returns a string longer than `maxChars`.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Supervisor multi-tree isolation not tested | `session-supervisor.test.ts` | line 75 (mock returns all nodes) |
| Bootstrap prompt length/unbounded test | `session-bootstrap-prompt-service.test.ts` | lines 7–35 (string inclusion only) |
| Meta-session store deleted, no replacement test | `src/renderer/stores/meta-session.ts` | (D)eleted per git status |
| Deep tree projection at App level | `App.test.ts` | lines 589–626 (max depth tested = 0) |
| `applySessionGraphEvent` missing `restored` kind | `workspaces.test.ts` | lines 1374–1747 (only created/updated/archived) |
| Concurrent graph events out-of-order | `workspaces.test.ts` | no test found |
| `promptWorkSession` blocked-state case | `meta-session-command-dispatcher.test.ts` | lines 13–386 (idle/completed only) |
| `getSessionNodeSnapshot` cross-project parent | `project-session-manager.test.ts` | lines 984–1047 (creation guard, not snapshot) |
| Bootstrap prompt session-specific content | `session-bootstrap-prompt-service.test.ts` | lines 7–35 (no session ID in prompt) |
| HTTP POST malformed JSON body | `session-control-server.test.ts` | no test found |
| `write()` Promise rejection path | `session-input-router.test.ts` | no test found |
| Event bridge session ID cross-check | `session-event-bridge.test.ts` | no test found |
| `startSessionRuntime` sync throw | `session-runtime.test.ts` | no test found |
| Meta session capabilityLevel boundaries | `meta-session-control-server.test.ts` | no boundary test |

### Risks / Unknowns

- **[!] `meta-session.ts` deleted** — `src/renderer/stores/meta-session.ts` is deleted (git status). No replacement test file exists. If the meta-session store was refactored out in favor of `workspaces.ts`, the `SessionGraphEvent` handler in `App.test.ts` (lines 589–626) exercises the store directly, but there is no standalone store test for meta-session state.
- **[!] Supervisor multi-tree isolation is mocked** — The test fixture at `session-supervisor.test.ts:75` always returns all nodes from `getSnapshot`, meaning `SessionSupervisor` never actually exercises visibility filtering in multi-tree scenarios. A regression where a session caller from tree-1 could see/affect tree-2 would not be caught.
- **[!] Bootstrap prompt content is not session-contextual** — Tests only verify string inclusion, not that the prompt is personalized to the session being bootstrapped. A stale/generic prompt would pass all current tests.
- **[?] `applySessionGraphEvent` with `restored` kind** — Only `created`, `updated`, `archived` are tested. If a `restored` graph event type exists or is added, it has no coverage.
- **[?] Concurrent graph events** — Events arriving out-of-order with gaps are not tested at the renderer store level.
