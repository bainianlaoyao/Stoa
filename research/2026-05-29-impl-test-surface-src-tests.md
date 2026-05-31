---
date: 2026-05-29
topic: impl-test-surface-src-tests
status: completed
mode: context-gathering
sources: 20
---

# Test Surface Impact: Unified Session Tree Design

## Why This Was Gathered

Before implementing the unified session tree / session read-model / event envelope breaking change, the implementation team needs a precise enumeration of which `src/**/*.test.ts` files must be rewritten, updated, or newly authored, with exact file paths and line-number citations.

## Summary

The spec mandates removing the entire `meta-session` product concept and replacing it with a unified `SessionSummary` extended by `parentSessionId`/`createdBySessionId`, a new `SessionNodeSnapshot` read-model, a `SessionGraphEvent` envelope, and new host-side services (`SessionSupervisor`, `SessionVisibilityService`, `SessionControlServer`). Of the ~90 unit/component test files under `src/`, **8 files are full rewrites** (all tests delete, replace with new coverage), **5 files need targeted fixture updates**, and **~7 new test files** must be authored. Tests unrelated to session/meta-session topology are unaffected.

---

## Category 1: Full Rewrite — Tests That Must Be Deleted and Replaced

These files test the old meta-session stack exclusively. Every test is invalidated by the spec's "删除独立 meta session 持久化" (delete independent meta session persistence) and "移除独立 Meta Session Surface" (remove independent Meta Session Surface) non-goals. They test concepts that no longer exist.

### 1. `src/core/meta-session-manager.test.ts` (172 lines)

| Line | Test | Spec mapping |
|------|------|-------------|
| 23–39 | `creates a meta session and persists it separately from project sessions` | Replaced by unified `SessionSupervisor.createSession` with `parentSessionId=null` |
| 41–59 | `does not seed backendSessionId for providers without seedsExternalSessionId` | Same; re-covered under unified session creation |
| 61–74 | `tracks active meta session independently from work-session state` | `activeMetaSessionId` concept deleted; replaced by renderer-side active selection |
| 76–96 | `closes a meta session and excludes it from the bootstrap recovery plan` | `closeSession` + `buildBootstrapRecoveryPlan` semantic shifts |
| 98–111 | `archives a meta session and excludes it from active sessions` | Archive/restore now recursive on subtree; `archived` field survives on session |
| 113–125 | `restore a meta session marks it as not archived and makes it active again` | Restore now recursive; no `activeMetaSessionId` |
| 127–140 | `setActiveSession does not mutate updatedAt` | Active session selection moved to renderer, not host manager |
| 142–154 | `archiving the active session falls back to another non-archived session` | No auto-fallback; renderer/user selects |
| 156–171 | `buildBootstrapRecoveryPlan skips archived meta sessions` | Bootstrap recovery plan shifts |

**Impact**: All 9 tests are replaced. New tests should cover `SessionSupervisor` creation, archive, restore, and subtree semantics.

### 2. `src/core/meta-session-state-store.test.ts` (459 lines)

| Line | Test | Spec mapping |
|------|------|-------------|
| 28–37 | `returns the v1 default meta session state when no file exists` | `~/.stoa/meta-session.json` deleted; no default state |
| 39–110 | `writes and re-reads persisted meta session state` | Entire persistence layer replaced; `sessions[]` + `proposals[]` + `action_logs[]` gone |
| 112–179 | `normalizes legacy meta sessions by defaulting archived=false` | Legacy normalization logic gone |
| 181–198 | `resets unrecoverable meta session state files to the default state` | Error recovery for meta-session.json gone |
| 200–205 | `resolves meta session state next to the overridden global state path` | File path resolution gone |
| 207–458 | `keeps legacy meta sessions...preserves their related proposal data` | Proposal data gone |

**Impact**: Entire file is a rewrite. The spec says `~/.stoa/meta-session.json` is no longer a product authority input — implementation can ignore/delete it. No `DEFAULT_META_SESSION_STATE`, `readMetaSessionState`, `writeMetaSessionState`, `resolveMetaSessionStateFilePath` are needed. Tests for these should be deleted.

### 3. `src/core/meta-session-control-server.test.ts` (1078 lines)

| Lines | Test | Spec mapping |
|-------|------|-------------|
| 158–258 | `serves /ctl/work-sessions/:id/context...` | Routes refactored; new `/ctl/session/*` paths |
| 260–419 | `serves whoami, capabilities, work-session collections, and meta session collections` | `whoami` output changes (`callerType`, `visibility`, `permissions`); `capabilities` changes; `/ctl/meta-sessions` routes deleted |
| 421–555 | `creates activates archives and restores meta sessions through control routes` | `activeMetaSessionId`, `/ctl/meta-sessions/*` routes deleted; replaced by `/ctl/session/*` |
| 557–681 | `creates and archives work sessions through control routes` | `workSessionLifecycle` refactored to unified `SessionSupervisor` |
| 683–782 | `rejects invalid work-session lifecycle requests` | New error codes: `unknown_session`, `forbidden_visibility_scope`, `forbidden_authority_scope`, etc. |
| 784–969 | `serves attention queue and supports proposal creation plus preset dispatch routes` | `proposal` routes gone; `dispatchPreset` route gone; replaced by direct `prompt`/`send-keys` |
| 971–1023 | `accepts ctlSecret as alternative to session-id auth` | Auth changes: `x-stoa-session-token` + `x-stoa-session-id` for session callers; `x-stoa-secret` for local-user callers |
| 1024–1047 | `rejects wrong ctlSecret` | Same auth changes |
| 1049–1077 | `serves /ctl/bootstrap-prompt as plain text with the canonical meta session prompt` | Bootstrap prompt replaced by `SessionBootstrapPromptService` with tree-local visibility description |

**Impact**: All 9 tests are full rewrites. New tests cover unified `SessionControlServer` routes, caller auth (session vs local-user), `whoami` with `callerType`, and `capabilities` with authority scope.

### 4. `src/core/meta-session-command-dispatcher.test.ts` (386 lines)

| Lines | Test | Spec mapping |
|-------|------|-------------|
| 12–69 | `creates a proposal instead of directly injecting a freeform prompt when approval is required` | `proposal` flow deleted; replaced by direct `prompt` (no approval gate) |
| 71–123 | `treats all freeform prompt injection as approval-gated even when the text is low risk` | Approval gate gone |
| 125–184 | `rejects proposal dispatch when the proposal has become stale` | Stale proposal rejection gone |
| 186–248 | `marks a proposal stale when the target session state has changed` | Proposal staleness gone |
| 250–305 | `dispatches run-tests-only preset directly without approval` | Preset dispatch gone; replaced by direct `prompt` |
| 307–359 | `dispatches low-level send-keys input directly without approval` | `sendKeysToWorkSession` survives but without `metaSessionId` parameter; replaced by `session prompt` path |
| 361–385 | `rejects send-keys for unknown sessions` | Now returns `unknown_session` error code |

**Impact**: All 7 tests are full rewrites. The `MetaSessionCommandDispatcher` class itself is deleted per spec. Tests should be replaced by `SessionCommandDispatcher` or equivalent that tests direct `prompt` flow without proposals.

### 5. `src/core/meta-session-command-env.test.ts` (23 lines)

| Lines | Test | Spec mapping |
|-------|------|-------------|
| 5–23 | `injects meta-session control variables and prepends the stoa-ctl bin dir to PATH` | `STOA_META_SESSION` and `STOA_META_SESSION_ID` deleted; replaced by `SessionCommandEnv` with `STOA_SESSION_ID`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL` |

**Impact**: The entire `buildMetaSessionCommandEnv` function is replaced by `buildSessionCommandEnv`. Test at `src/core/meta-session-command-env.test.ts:5` must be rewritten for the new function and new env var set.

### 6. `src/core/meta-session-context-assembler.test.ts` (162 lines)

| Lines | Test | Spec mapping |
|-------|------|-------------|
| 107–162 | `returns full context as large human-readable text with terminal replay merged in` | `MetaSessionContextAssembler` renamed/replaced by `SessionContextAssembler`; snapshot source no longer includes `activeMetaSessionId` |

**Impact**: The class is replaced. Test should be rewritten for the new `SessionContextAssembler` with new snapshot source contract.

### 7. `src/core/meta-session-proposal-store.test.ts` (50 lines)

| Lines | Test | Spec mapping |
|-------|------|-------------|
| 4–50 | Entire file: `creates prompt proposals and allows them to transition to approved and stale` | `MetaSessionProposalStore` deleted entirely per spec's "不保留旧 proposal/dispatch 作为统一控制主路径" |

**Impact**: Complete file deletion. No replacement needed if proposal flow is removed.

### 8. `src/core/meta-session-provider-patch.test.ts` (84 lines)

| Lines | Test | Spec mapping |
|-------|------|-------------|
| 37–84 | All 5 tests about `deriveMetaSessionProviderSessionPatch` | `MetaSessionProviderPatch` type and `deriveMetaSessionProviderSessionPatch` function deleted; meta-session state patch derivation no longer needed |

**Impact**: Complete file deletion. The `MetaSessionSummary`-typed sessions are gone.

---

## Category 2: Targeted Updates — Tests That Need Fixture Changes

These files are otherwise correct but use fixtures that must be extended with `parentSessionId`/`createdBySessionId`.

### 9. `src/shared/project-session.test.ts` (162 lines)

| Line | Change needed |
|------|---------------|
| 22–50 | `SessionSummary` fixture at line 22 needs `parentSessionId: null` and `createdBySessionId: null` added |
| 65–90 | `PersistedSession` fixture needs `parent_session_id: null` and `created_by_session_id: null` added |
| 96–125 | `PersistedProjectSessions` fixture needs same fields on its session entries |
| 52–94 | `PersistedAppStateV2` fixture — session entries need same fields |

**Evidence**: `src/shared/project-session.test.ts:22` — `SessionSummary` fixture missing `parentSessionId` and `createdBySessionId` fields per spec lines 145–149. The `toPersistedSession` at `src/core/project-session-manager.ts:62–87` will need to serialize these new fields, and the `PersistedSession` schema version will need bumping (v6 → v7 likely).

### 10. `src/core/project-session-manager.test.ts` (1453 lines)

| Lines | Change needed |
|-------|---------------|
| 615–650 | `createSession` fixture factory needs `parentSessionId` / `createdBySessionId` support added to `CreateSessionRequest` interface |
| 802–823 | `createSession initializes runtime created...` test — fixture needs new fields |
| 1016–1042 | `persists project session schema v6...` test — schema version bump comment needs updating (v6 → v7) |
| 444–486 | `hydrate active project from active session` test — fixtures need new fields |
| 508–542 | `clears active session references...` test — fixtures need new fields |
| 1016 | `persists project session schema v6` — update to v7 |

**Evidence**: `src/core/project-session-manager.ts:62–87` — `toPersistedSession` must add `parent_session_id` and `created_by_session_id` to serialization. `toSessionSummary` at line 89 must deserialize them. `CreateSessionRequest` type at `src/shared/project-session.ts` must add optional `parentSessionId`.

### 11. `src/core/session-runtime.test.ts` (769 lines)

| Lines | Change needed |
|-------|---------------|
| 659–719 | `merges commandEnv into the provider command` test at line 659 — the `commandEnv` injected at line 698 includes `STOA_META_SESSION: '1'`. This must be replaced with `STOA_SESSION_ID` (the session's own ID), `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL`. The env injection is changing from "meta-session only" to "all sessions". |

**Evidence**: `src/core/session-runtime.test.ts:698` — `STOA_META_SESSION: '1'` and `STOA_CTL_BASE_URL`. Per spec line 629–633, all sessions get `STOA_SESSION_ID`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL`. The test asserts `STOA_META_SESSION: '1'` which will no longer exist.

### 12. `src/core/session-runtime-callbacks.test.ts` (728 lines)

| Lines | Change needed |
|-------|---------------|
| 42–58 | `createBaseSession` fixture at line 42 — `StartSessionRuntimeOptions['session']` type may need `parentSessionId` field added, though it lives on `SessionSummary` not the runtime-start options. Likely unaffected, but monitor if `StartSessionRuntimeOptions` is extended. |

**Assessment**: Minimal impact. The `createBaseSession` fixture type is `StartSessionRuntimeOptions['session']`, which is the runtime start config, not `SessionSummary`. The new `parentSessionId`/`createdBySessionId` fields live on `SessionSummary` (persistence model). The runtime-start options may not need changes unless `SessionSupervisor` passes tree context at startup.

### 13. `src/core/memory/session-evidence-store.test.ts` (214 lines)

| Lines | Change needed |
|-------|---------------|
| 9–38 | `createEvent` fixture uses `session_id: 'session-77'`. Unaffected by tree design — evidence store operates at event level, not session tree level. |

**Assessment**: No changes needed. Evidence store is event-level and not directly affected by session hierarchy.

### 14. `src/core/stoa-ctl-shim.test.ts` (104 lines)

| Lines | Change needed |
|-------|---------------|
| 28–104 | Tests shim file resolution and writing. Unaffected by session tree design. The `stoa-ctl` CLI changes are in the CLI itself, not the shim installer. |

**Assessment**: No changes needed. Shim installer tests test path resolution and file writing, not CLI behavior.

---

## Category 3: New Unit Coverage Required

Per the spec's "测试策略" section (lines 858–883), these new test files must be authored. They have no existing counterparts.

### New file: `src/core/session-visibility-service.test.ts`

Tests for `SessionVisibilityService`:
- `rootSessionId` derivation from `parentSessionId=null` (line 149 of spec)
- `depth` derivation (line 149, root=0)
- `childSessionIds` projection
- `descendantCount` derivation
- visible set `V(S)` computation per spec lines 253–269
- same-depth peers visible
- descendants visible
- ancestors invisible
- sibling descendants invisible
- other trees invisible
- archived sessions excluded by default, included with `--include-archived`
- `graphVersion` monotonicity

**Insertion point**: New module `SessionVisibilityService` in `src/core/`.

### New file: `src/core/session-supervisor.test.ts`

Tests for `SessionSupervisor`:
- `createSession` with `parentSessionId=null` (root session) vs `parentSessionId=<parent>` (child session)
- child session inherits `projectId` from parent — cross-project forbidden
- in-session create (session caller context) only creates direct child
- `createChildSession` forbidden for same-depth peers
- `destroySession` — self allowed, descendants allowed, same-depth peers forbidden
- recursive subtree destroy: all descendants archived, `parentSessionId` preserved for restore
- subtree restore: recursive restore of all archived descendants
- `promptSession` — same-depth peers allowed, ancestors forbidden
- `inspectSession` — same visibility as `prompt`
- `session:event` broadcast on create/update/archive/restore/destroy

**Insertion point**: New module `SessionSupervisor` in `src/core/`.

### New file: `src/core/session-control-server-unified.test.ts`

Tests for unified `SessionControlServer` replacing `meta-session-control-server`:
- `/ctl/whoami` returns `callerType: "session"` with `visibility` + `permissions` fields for session callers
- `/ctl/whoami` returns `callerType: "local-user"` for local-user callers
- `/ctl/capabilities` returns supported commands + authority scope
- `/ctl/session list` — global view for local-user, visible set for session caller
- `/ctl/session create` — `--parent` forbidden in session caller context
- `/ctl/session create --parent <id>` — cross-project forbidden
- `/ctl/session prompt <id>` — `forbidden_authority_scope` for ancestor
- `/ctl/session destroy <id>` — `forbidden_authority_scope` for same-depth peer
- `/ctl/session inspect --view tree` — caller-filtered subtree
- auth: `x-stoa-session-id` + `x-stoa-session-token` accepted for live session
- auth: `x-stoa-session-token` rejected for archived/stopped session
- new error codes: `unknown_session`, `forbidden_visibility_scope`, `forbidden_authority_scope`, `invalid_parent_session`, `cross_project_parent_forbidden`

**Insertion point**: Replace/rewrite `src/core/meta-session-control-server.test.ts`.

### New file: `src/core/session-command-env.test.ts`

Tests for `SessionCommandEnv` (replacing `buildMetaSessionCommandEnv`):
- all sessions get `STOA_SESSION_ID`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL`
- `STOA_SESSION_ID` is the session's own ID, not a meta-session ID
- `STOA_META_SESSION` and `STOA_META_SESSION_ID` absent
- PATH prepend with `stoaCtlBinDir`
- shell sessions get command env but no agent bootstrap prompt
- session caller vs local-user caller env differentiation

**Insertion point**: Replace `src/core/meta-session-command-env.test.ts`.

### New file: `src/core/session-bootstrap-prompt-service.test.ts`

Tests for `SessionBootstrapPromptService` (replacing meta-session bootstrap prompt):
- bootstrap prompt describes session identity (id, tree position)
- bootstrap prompt describes tree-local visibility rules
- bootstrap prompt describes `stoa-ctl` capabilities available to this session
- bootstrap prompt describes what this session cannot control
- prompt does not mention "meta session" or "global agent"

**Insertion point**: New module `SessionBootstrapPromptService` in `src/core/`.

### New file: `src/core/session-caller-auth-registry.test.ts`

Tests for `SessionCallerAuthRegistry`:
- mint random control token on session runtime start
- inject `STOA_CTL_SESSION_TOKEN` env var
- validate token on request — session exists
- validate token on request — session runtime live
- token invalid → 401
- token missing → 401
- session stopped → token invalidated
- child session does not inherit parent token
- token not written to persistent state

**Insertion point**: New module `SessionCallerAuthRegistry` in `src/core/`.

### New file: `src/core/session-graph-event.test.ts`

Tests for `SessionGraphEvent` envelope:
- envelope `kind`: `created | updated | archived | restored | destroyed`
- `graphVersion` monotonic increment
- renderer deduplication via `graphVersion`
- `origin`: `renderer | local-cli | session | system`
- `initiatorSessionId` propagation
- `node`: `SessionNodeSnapshot` shape validation
- `kind = "created"` triggers parent auto-expand

**Insertion point**: New or existing event handling module in `src/core/`.

---

## Category 4: Unaffected Tests

The following test files have no dependency on session tree, meta-session, or session hierarchy concepts. No changes needed.

| File | Why unaffected |
|------|---------------|
| `src/core/pty-host.test.ts` | PTY lifecycle, write, resize, dispose — no session model dependency |
| `src/core/state-store.test.ts` | Generic JSON persistence, read/write contracts |
| `src/core/app-logger.test.ts` | Log file writing — no session model |
| `src/core/observation-store.test.ts` | Observation/event store — session ID as opaque string |
| `src/core/shell-command.test.ts` | Shell command building — no session tree |
| `src/main/preload-path.test.ts` | Preload path resolution |
| `src/core/provider-path-resolver.test.ts` | Provider binary resolution |
| `src/core/settings-detector.test.ts` | Settings detection |
| `src/extensions/panels/index.test.ts` | Panel registry — no session topology |
| `src/core/context/types.test.ts` | Type definitions |
| `src/core/context/ansi-stripper.test.ts` | ANSI stripping |
| `src/core/context/parsers/claude-code-parser.test.ts` | Parser logic |
| `src/core/context/parsers/codex-parser.test.ts` | Parser logic |
| `src/core/context/parsers/opencode-parser.test.ts` | Parser logic |
| `src/core/context/session-context-exporter.test.ts` | Context export |
| `src/core/context/full-text-formatter.test.ts` | Text formatting |
| `src/core/context/slim-text-formatter.test.ts` | Text formatting |
| `src/core/webhook-server.test.ts` | HTTP endpoint acceptance |
| `src/core/webhook-server-validation.test.ts` | Event validation rejection branches |
| `src/core/memory/delivery-paths.test.ts` | Memory delivery paths |
| `src/core/memory/execution-router.test.ts` | Execution routing |
| `src/core/memory/runtime-capabilities.test.ts` | Runtime capabilities |
| `src/core/memory/runtime-state-store.test.ts` | Runtime state store |
| `src/core/memory/inference-router.test.ts` | Inference routing |
| `src/core/memory/upstream-boundary-guard.test.ts` | Upstream boundary |
| `src/core/memory/runtime-host.test.ts` | Runtime host |
| `src/core/memory/turn-maintenance-runner.test.ts` | Turn maintenance |
| `src/core/memory/evolver-engine-adapter.test.ts` | Evolver adapter |
| `src/core/memory/transcript-snapshot.test.ts` | Transcript snapshot |
| `src/core/memory/bundled-evolver.test.ts` | Bundled evolver |
| `src/core/shell-integration-env.test.ts` | Shell env injection |
| `src/renderer/terminal/shell-integration-addon.test.ts` | Shell integration |
| `src/shared/terminal-settings.test.ts` | Terminal settings |
| `src/extensions/providers/shared-hook-dispatch.test.ts` | Hook dispatch |
| `src/main/hook-dispatch-failure-journal.test.ts` | Hook failure journal |
| `src/main/hook-lease-manager.test.ts` | Hook lease |
| `src/main/hook-lease-registry.test.ts` | Hook registry |
| `src/main/stoa-runtime-root.test.ts` | Stoa runtime root |
| `src/renderer/components/GlobalActivityBar.test.ts` | UI component |
| `src/renderer/components/inbox/InboxQueueSurface.test.ts` | UI surface |
| `src/renderer/components/tree/ContextTreeSurface.test.ts` | UI surface |
| `src/renderer/components/command/ProviderFloatingCard.test.ts` | UI component |
| `src/renderer/components/command/ProviderRadialMenu.test.ts` | UI component |
| `src/renderer/components/primitives/GlassFormField.test.ts` | UI primitive |
| `src/renderer/styles.typography.test.ts` | Typography |
| `src/renderer/assets/brand/brand-assets.test.ts` | Brand assets |
| `src/renderer/components/TitleBar.styles.test.ts` | UI styles |
| `src/renderer/components/update/UpdatePrompt.test.ts` | UI component |
| `src/renderer/components/command/SessionContextMenu.test.ts` | UI component |
| `src/renderer/components/command/TerminalSessionDeck.test.ts` | UI component |
| `src/renderer/components/command/WorkspaceQuickActions.test.ts` | UI component |
| `src/renderer/components/archive/ArchiveSurface.test.ts` | UI surface |
| `src/renderer/components/PanelExtensions.test.ts` | Panel extensions |
| `src/renderer/components/WorkspaceList.test.ts` | UI component |
| `src/renderer/stores/observability-view-models.test.ts` | Store projection |
| `src/shared/observability-projection.test.ts` | Shared projection |
| `src/shared/session-state-reducer.test.ts` | State reducer |
| `src/main/update-service.test.ts` | Update service |
| `src/main/session-runtime-controller.test.ts` | Runtime controller |
| `src/main/session-event-bridge.test.ts` | Event bridge |
| `src/main/session-input-router.test.ts` | Input router |
| `src/main/session-dimensions.test.ts` | Session dimensions |
| `src/main/launch-tracked-session-runtime.test.ts` | Launch tracking |
| `src/main/managed-sidecar-maintenance.test.ts` | Sidecar maintenance |
| `src/extensions/providers/codex-provider.test.ts` | Provider |
| `src/extensions/providers/claude-code-provider.test.ts` | Provider |
| `src/extensions/providers/opencode-provider.test.ts` | Provider |
| `src/extensions/providers/codex-project-config.test.ts` | Config |
| `src/extensions/providers/managed-sidecar-installer.test.ts` | Installer |
| `src/core/promo/history-store.test.ts` | Promo |
| `src/core/promo/webbridge-client.test.ts` | Promo |
| `src/core/promo/final-asset-capture.test.ts` | Promo |
| `src/core/promo/final-asset-capture-runner.test.ts` | Promo |
| `src/core/promo/session-capture-identification.test.ts` | Promo |
| `src/core/promo/weak-capture-tuning.test.ts` | Promo |
| `src/core/promo/asset-factory.test.ts` | Promo |
| `src/core/promo/promo-paths.test.ts` | Promo |
| `src/core/promo/fact-pack.test.ts` | Promo |
| `src/core/promo/claude-cli.test.ts` | Promo |
| `src/core/promo/promo-time.test.ts` | Promo |
| `src/core/hook-event-adapter.test.ts` | Hook adapter |
| `src/core/observability-service.test.ts` | Observability |
| `src/core/workspace-launcher.test.ts` | Workspace launcher |
| `src/core/stoa-ctl-port-file.test.ts` | Port file |
| `src/core/context/full-text-formatter.test.ts` | Formatter |
| `src/core/context/slim-text-formatter.test.ts` | Formatter |

---

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Meta-session manager creates separate persistence | `meta-session-manager.test.ts:23` | Line 23 |
| Meta-session state store has DEFAULT_META_SESSION_STATE | `meta-session-state-store.test.ts:28` | Line 28 |
| Control server serves /ctl/meta-sessions routes | `meta-session-control-server.test.ts:357` | Line 357 |
| Control server serves /ctl/proposals routes | `meta-session-control-server.test.ts:916` | Line 916 |
| Dispatcher creates proposals for all prompts | `meta-session-command-dispatcher.test.ts:13` | Line 13 |
| Env injection sets STOA_META_SESSION=1 | `meta-session-command-env.test.ts:14` | Line 14 |
| Context assembler uses activeMetaSessionId | `meta-session-context-assembler.test.ts:109` | Line 109 |
| Proposal store creates prompt proposals | `meta-session-proposal-store.test.ts:7` | Line 7 |
| Provider patch derives from MetaSessionSummary | `meta-session-provider-patch.test.ts:7` | Line 7 |
| Session runtime injects STOA_META_SESSION env | `session-runtime.test.ts:698` | Line 698 |
| SessionSummary fixture missing parentSessionId | `project-session.test.ts:22` | Line 22 |
| toPersistedSession serialization | `project-session-manager.ts:62` | Line 62 |
| Spec mandates parentSessionId/createdBySessionId | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:145` | Line 145 |
| Spec mandates SessionTreeMeta/SessionNodeSnapshot | Same spec | Line 168 |
| Spec mandates SessionGraphEvent envelope | Same spec | Line 709 |
| Spec mandates meta-session.json ignored | Same spec | Line 658 |
| Spec mandates SessionVisibilityService | Same spec | Line 612 |
| Spec mandates SessionSupervisor | Same spec | Line 541 |
| Spec mandates SessionControlServer replaces meta-session-control-server | Same spec | Line 555 |
| Spec mandates SessionCommandEnv replaces meta-session-command-env | Same spec | Line 623 |
| Spec mandates SessionBootstrapPromptService | Same spec | Line 635 |
| Spec mandates SessionCallerAuthRegistry | Same spec | Line 566 |
| Spec test strategy lists required coverage | Same spec | Lines 858–883 |

---

## Risks / Unknowns

- **[!]** The `createBaseSession` fixture in `session-runtime-callbacks.test.ts` uses `StartSessionRuntimeOptions['session']` — if `SessionSupervisor` adds `parentSessionId` to the startup options (to pass tree context to the runtime), this fixture may also need updating. Current analysis assumes the runtime-start options type is unaffected.
- **[?]** The renderer-side `upsertSession` and `projectHierarchy` tree projection tests are listed in the spec's test strategy but live in `src/renderer/stores/` or component tests, not `src/core/`. This report covers `src/**/*.test.ts` per the task scope, but renderer store tests for session tree projection are equally critical and should be tracked separately.
- **[!]** `src/core/stoa-ctl-port-file.test.ts` — the port file mechanism may need changes for the new `SessionCallerAuthRegistry` (minting tokens per live session). Current analysis shows the test file exists but is marked unaffected — verify whether token injection requires port-file schema changes.
- **[!]** Schema version bump: `PersistedProjectSessions` is at version 6 (`src/shared/project-session.test.ts:97`). Adding `parent_session_id` and `created_by_session_id` to the persisted session shape requires a version bump to 7. The test at `src/core/project-session-manager.test.ts:1016` asserts v6 explicitly.
- **[?]** `src/core/memory/session-evidence-store.test.ts` is marked unaffected, but if `SessionEvidenceStore` uses `SessionSummary` types internally, the fixture `createEvent` at line 9 may need updating when `SessionSummary` gets the new fields.

---

## Context Handoff

Start here: `research/2026-05-29-impl-test-surface-src-tests.md`

Context only. Use this report as the source of truth for test surface planning.
