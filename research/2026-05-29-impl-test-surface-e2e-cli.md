---
date: 2026-05-29
topic: unified-session-tree-test-surface-e2e-cli
status: completed
mode: context-gathering
sources: 17
---

## Context Report: Unified Session Tree — E2E and CLI Test Surface Impact

### Why This Was Gathered

The unified session tree design (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`) removes the independent meta session concept, replaces `stoa-ctl`'s command surface, introduces session tree/visibility/authority semantics, and upgrades the renderer sync model. This report enumerates every e2e/CLI test that will break or need rewrite, and identifies insertion points for new coverage.

### Summary

Five test files will definitely break (total rewrite required). Three test files need partial rewrites. Seven test files are unaffected. The highest-risk surface is `tests/e2e/ipc-bridge.test.ts` (919 lines, 10 meta-session IPC channels), `tools/stoa-ctl/index.test.ts` (884 lines, entire CLI command surface), and `tests/e2e/main-config-guard.test.ts` (627 lines, static analysis guards for all IPC channels and preload contracts).

---

### Key Findings

#### F1: Five test files will definitely break (require full rewrite)

| File | Lines | Why it breaks | Meta-session surface to delete |
|------|-------|---------------|-------------------------------|
| `tests/e2e/frontend-store-projection.test.ts` | 84–177 | Imports `useMetaSessionStore`, `MetaSessionBootstrapState`, `MetaSessionProposal`, `MetaSessionSummary` | Entire "Meta session surface store projection" describe block |
| `tests/e2e/ipc-bridge.test.ts` | 1–919 | Uses `MetaSessionManager`, `MetaSessionProposalStore`, `MetaSessionCommandDispatcher`, 10 `meta-session:*` IPC channels in `RENDERER_API_INVOKE_CHANNELS` (lines 63–90), meta session round-trip tests (lines 538–663) | Full rewrite of `registerMainHandlers`, `createPreloadApi`, `RENDERER_API_INVOKE_CHANNELS`, `RENDERER_API_SEND_CHANNELS` |
| `tests/e2e/main-config-guard.test.ts` | 193–241, 246–294, 389–465, 526–541, 594–596 | Static analysis checks for `archiveMetaSessionWithRuntime`, `restoreMetaSessionWithRuntime`, `buildMetaSessionBootstrapPrompt`, `META_SESSION_BOOTSTRAP_PROMPT`, `metaSessionCtlSecret`, meta session IPC handler registrations, preload type contract for meta session methods | Replace meta session channel guards with new `session:*` channel guards |
| `tools/stoa-ctl/index.test.ts` | 1–884 | Uses `STOA_META_SESSION_ID` env (line 22), tests old command surface (`work-sessions list/get/events/context/send-keys/create/archive`, `meta-sessions create/archive/restore`, `proposals create/list/wait`, `dispatch preset/proposal`), port file discovery with `activeMetaSessionId` | Full rewrite — entire CLI command surface changes to unified `session list/create/inspect/prompt/destroy` |
| `src/core/meta-session-*.test.ts` (6 unit files) | varies | Source modules (`meta-session-manager`, `meta-session-command-dispatcher`, `meta-session-proposal-store`, `meta-session-control-server`, `meta-session-context-assembler`, `meta-session-state-store`, `meta-session-provider-patch`) are all deleted | Delete these test files along with source |

#### F2: Three test files need partial rewrite (some tests survive)

| File | Surviving tests | What must change |
|------|----------------|------------------|
| `tests/e2e/backend-lifecycle.test.ts` (585 lines) | Project/session CRUD, state persistence, recovery plan, path normalization, rapid operations — all survive | `buildBootstrapRecoveryPlan` tests (lines 524–584) may need adjustment if recovery plan semantics change for tree-aware sessions |
| `tests/e2e/store-lifecycle-sync.test.ts` (491 lines) | Single/multi session lifecycle, store-backend consistency — survive with minor changes | Must adopt `upsertSession` instead of `updateSession`/`addSession` (line 93–95). Must handle `SessionNodeSnapshot` hydration. `projectHierarchy` projection tests must handle parent-child tree structure |
| `tests/e2e/ipc-push-harness.test.ts` (350 lines) | `terminal:data`, `observability:*`, `memory:notification`, `title-generation:notification` push delivery tests all survive | Must add new tests for `session:event` push channel with `SessionGraphEvent` envelope, `graphVersion` deduplication, and `upsertSession` insert semantics |

#### F3: Seven test files are unaffected

| File | Lines | Why unaffected |
|------|-------|---------------|
| `tests/e2e/error-edge-cases.test.ts` | 585 | Pure project/session CRUD edge cases — no meta session concepts |
| `tests/e2e/session-runtime-lifecycle.test.ts` | 492 | PTY lifecycle with mock/fake providers — no meta session concepts |
| `tests/e2e/composition-seam.test.ts` | 210 | PTY→controller→window data flow — no meta session concepts |
| `tests/e2e/webhook-runtime-integration.test.ts` | ~300 | Webhook event pipeline — no meta session concepts |
| `tests/e2e/app-bridge-guard.test.ts` | 444 | Generic `window.stoa` undefined/partial/null bridge guard — no meta session concepts |
| `tests/e2e/sidebar-e2e.test.ts` | ~50 | Sidebar state tests — no meta session concepts |
| `tests/e2e/provider-integration.test.ts` | 1939 | Provider registry, command building, sidecar installation — no meta session concepts |
| `tools/stoa-ctl/send-keys.test.ts` | 29 | Pure key parsing utility — no protocol dependency |

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Frontend store imports `useMetaSessionStore` and meta session types | `tests/e2e/frontend-store-projection.test.ts` | Lines 4, 10, 84–177 |
| IPC bridge uses 10 `meta-session:*` channels in invoke list | `tests/e2e/ipc-bridge.test.ts` | Lines 63–90 (`RENDERER_API_INVOKE_CHANNELS`), lines 71–81 |
| IPC bridge round-trip tests for meta session create/archive/restore/proposal | `tests/e2e/ipc-bridge.test.ts` | Lines 538–663 |
| IPC bridge `registerMainHandlers` creates `MetaSessionManager`, `MetaSessionProposalStore`, `MetaSessionCommandDispatcher` | `tests/e2e/ipc-bridge.test.ts` | Lines 216–298 |
| IPC bridge `createPreloadApi` includes all meta session methods | `tests/e2e/ipc-bridge.test.ts` | Lines 177–189 |
| Config guard checks `archiveMetaSessionWithRuntime` and `restoreMetaSessionWithRuntime` function bodies | `tests/e2e/main-config-guard.test.ts` | Lines 193–201 |
| Config guard checks `META_SESSION_BOOTSTRAP_PROMPT` import | `tests/e2e/main-config-guard.test.ts` | Lines 203–210 |
| Config guard checks `metaSessionCtlSecret` initialization order | `tests/e2e/main-config-guard.test.ts` | Lines 232–241 |
| Config guard checks `workSessionLifecycle` wiring | `tests/e2e/main-config-guard.test.ts` | Lines 224–231 |
| Config guard checks meta session IPC handler registrations | `tests/e2e/main-config-guard.test.ts` | Lines 266–276 (channel-to-method map) |
| Config guard checks meta session preload methods | `tests/e2e/main-config-guard.test.ts` | Lines 418–429 (known invoke methods list) |
| Config guard checks meta session preload channel name mappings | `tests/e2e/main-config-guard.test.ts` | Lines 530–541 |
| Config guard checks `meta-session:event` push channel listener | `tests/e2e/main-config-guard.test.ts` | Lines 594–596 |
| CLI test env uses `STOA_META_SESSION_ID` | `tools/stoa-ctl/index.test.ts` | Lines 19–22 |
| CLI test checks old USAGE_TEXT containing `meta-sessions`, `proposals`, `dispatch`, `work-sessions` | `tools/stoa-ctl/index.test.ts` | Lines 29–51 |
| CLI test `whoami` fetches through `/ctl/whoami` (old endpoint) | `tools/stoa-ctl/index.test.ts` | Lines 53–79 |
| CLI test `bootstrap-prompt` fetches through `/ctl/bootstrap-prompt` (deleted endpoint) | `tools/stoa-ctl/index.test.ts` | Lines 81–107 |
| CLI test `work-sessions events/context` uses old command and URL shape | `tools/stoa-ctl/index.test.ts` | Lines 109–176 |
| CLI test `work-sessions create/archive` uses old command surface | `tools/stoa-ctl/index.test.ts` | Lines 178–277 |
| CLI test `meta-sessions create/archive/restore` tests deleted commands | `tools/stoa-ctl/index.test.ts` | Lines 279–382 |
| CLI test `proposals create/list/wait` tests deleted commands | `tools/stoa-ctl/index.test.ts` | Lines 412–609 |
| CLI test `dispatch preset` tests deleted command | `tools/stoa-ctl/index.test.ts` | Lines 515–549 |
| CLI test port file discovery uses `activeMetaSessionId` | `tools/stoa-ctl/index.test.ts` | Lines 663–714 |
| CLI test `--session` flag uses meta session IDs | `tools/stoa-ctl/index.test.ts` | Lines 776–843 |
| Store lifecycle sync uses `store.updateSession` (must become `upsertSession`) | `tests/e2e/store-lifecycle-sync.test.ts` | Lines 89–95 |
| Spec requires `parentSessionId`, `createdBySessionId` on `SessionSummary` | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 145–159 |
| Spec requires `SessionGraphEvent` with `kind`, `graphVersion`, `origin`, `initiatorSessionId`, `node` | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 707–716 |
| Spec requires `upsertSession` semantics in renderer store | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 729–733 |
| Spec requires `session:event` as unified push channel | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 697–706 |
| Spec requires new CLI commands: `session list/create/inspect/prompt/destroy` | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 377–386 |
| Spec requires `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN` + `STOA_CTL_BASE_URL` env | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 397–411 |
| Spec requires new IPC channels: `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect` | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | Lines 826–833 |

---

### Best Insertion Points for New Integration/E2E Coverage

#### IP1: New file `tests/e2e/session-tree-lifecycle.test.ts`

Tests the session tree data model and lifecycle through the real backend:

- Create root session → verify `parentSessionId = null`, `depth = 0`, `rootSessionId = self`
- Create child session from root → verify `parentSessionId = root.id`, `depth = 1`
- Create grandchild → verify `depth = 2`, tree traversal
- Destroy root → verify recursive subtree destroy (all descendants archived)
- Restore root → verify recursive subtree restore
- Cross-project parent rejection
- `buildBootstrapRecoveryPlan` with tree-aware sessions
- Destroy middle node → verify entire subtree archived, no orphans

#### IP2: New file `tests/e2e/session-graph-event-sync.test.ts`

Tests the `session:event` push channel and renderer sync:

- `SessionGraphEvent` envelope structure (kind, graphVersion, origin, initiatorSessionId, node)
- `graphVersion` monotonic increment and deduplication
- `upsertSession` inserts unknown session (background child creation scenario)
- `upsertSession` updates existing session
- Background child create does not steal active session focus
- Parent auto-expand on child creation
- Badge/count update on background child creation

#### IP3: Rewrite `tests/e2e/ipc-bridge.test.ts`

- Remove all `meta-session:*` channels from `RENDERER_API_INVOKE_CHANNELS`
- Add new channels: `sessionCreateChild`, `sessionPrompt`, `sessionDestroy`, `sessionInspect`
- Remove `MetaSessionManager`, `MetaSessionProposalStore`, `MetaSessionCommandDispatcher` from `registerMainHandlers`
- Add `SessionSupervisor` to `registerMainHandlers`
- Replace meta session round-trip tests with unified session tree round-trip tests
- Replace proposal/dispatch round-trip tests with `session:prompt` round-trip
- Update `createPreloadApi` to new method surface
- Update `RENDERER_API_SEND_CHANNELS` if `session:event` push is renderer→main direction

#### IP4: Rewrite `tools/stoa-ctl/index.test.ts`

- Replace `STOA_META_SESSION_ID` env with `STOA_SESSION_ID` + `STOA_CTL_SESSION_TOKEN` + `STOA_CTL_BASE_URL`
- Replace USAGE_TEXT expectations with new commands: `session list`, `session create`, `session inspect`, `session prompt`, `session destroy`
- Replace URL shape tests: `/ctl/work-sessions/*` → `/ctl/session/*`
- Replace port file discovery tests: `activeMetaSessionId` → local-user secret auth
- Add `whoami` tests for both session caller and local-user caller contexts
- Add `session inspect --view tree` visibility filtering tests
- Add `session destroy` subtree scope tests
- Add `session create` with `--parent` flag tests
- Add `session list --include-archived` tests
- Add authority rejection tests (`unknown_session`, `forbidden_authority_scope`)

#### IP5: Rewrite meta session sections of `tests/e2e/main-config-guard.test.ts`

- Remove checks for `archiveMetaSessionWithRuntime`, `restoreMetaSessionWithRuntime`, `buildMetaSessionBootstrapPrompt`, `META_SESSION_BOOTSTRAP_PROMPT`, `metaSessionCtlSecret`
- Remove `meta-session:*` channel registration checks
- Add checks for new `session:*` channel registrations (create-child, prompt, destroy, inspect)
- Add check for `SessionSupervisor` instantiation
- Add check for `SessionVisibilityService` import
- Add check for `SessionCallerAuthRegistry` token injection in session runtime
- Add check for `STOA_SESSION_ID` / `STOA_CTL_SESSION_TOKEN` / `STOA_CTL_BASE_URL` env injection
- Replace `metaSessionEvent` push channel check with `sessionEvent` push channel check
- Update preload type contract list (remove meta session methods, add new session methods)
- Update preload channel name mapping tests

#### IP6: Extend `tests/e2e/frontend-store-projection.test.ts`

- Remove `useMetaSessionStore` import and meta session surface tests (lines 84–177)
- Add tree projection tests: `projectHierarchy` renders `Project → Root Sessions → Child Sessions` recursively
- Add `SessionNodeSnapshot` hydration tests (verify `tree.rootSessionId`, `tree.depth`, `tree.childCount`)
- Add `upsertSession` insert-unknown-session test
- Add `upsertSession` update-existing-session test
- Add background child create → insert + expand parent + no focus steal test
- Add `graphVersion` deduplication test
- Verify bootstrap returns `SessionNodeSnapshot[]` not bare `SessionSummary[]`

---

### Risks / Unknowns

- [!] **`buildBootstrapRecoveryPlan` fate is unclear.** The spec does not explicitly address whether the recovery plan concept survives or is replaced by tree-aware recovery. The current tests in `tests/e2e/backend-lifecycle.test.ts:524–584` and `tests/e2e/error-edge-cases.test.ts:516–583` depend on this API.
- [!] **`session:event` push channel name is not explicitly specified.** The spec says "session:event 成为统一 upsert 入口" but the exact IPC channel name is not stated. Need to confirm during implementation.
- [!] **`RendererApi` surface change scope.** The spec mentions `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect` as new IPC channels but does not enumerate the full list of RendererApi method additions/removals. The preload type contract test in `main-config-guard.test.ts:389–465` will need the exact method list.
- [?] **Unit test cascade.** Six unit test files in `src/core/meta-session-*.test.ts` will break when their source modules are deleted. This report focused on e2e/CLI tests per the research task scope, but the unit test deletion count is also significant.
- [?] **`tools/stoa-ctl/send-keys.test.ts` survives unchanged** — pure key parsing utility with no protocol dependency. But the `send-keys` CLI command surface may change from `work-sessions send-keys` to `session prompt --text` or similar. Need to confirm during implementation whether `send-keys` survives as a subcommand.
- [?] **Testing tier 3/4 impact.** Generated contract tests under `testing/` and `tests/generated/` may need regeneration if topology/behavior assets reference meta session concepts. This was not examined in this report.
