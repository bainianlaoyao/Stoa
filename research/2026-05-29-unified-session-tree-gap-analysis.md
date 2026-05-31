---
date: 2026-05-29
topic: unified-session-tree-gap-analysis
status: completed
mode: context-gathering
sources: 42
---

## Context Report: Unified Session Tree / stoa-ctl Gap Analysis

### Why This Was Gathered

Preparing to implement the unified session tree design (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`). Need to confirm which specs/plans/research already exist, trace implementation seams between session/meta-session/frontend/IPC/control-plane, and identify design constraints that must be enforced during implementation.

### Summary

A complete spec exists at `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` (1035 lines). It replaces two older specs (`2026-05-07-meta-session-global-agent-design.md`, `2026-05-12-stoa-ctl-work-session-lifecycle-design.md`). Nine prior research reports cover backend topology, frontend topology, frontend store/IPC, meta-session removal points, CLI patterns, auth, and backend control-plane seams. The implementation gap is not in documentation — it is in the 6 structural seams where the current bifurcated (work-session vs meta-session) architecture must be collapsed into a single session tree model. No code implementing the unified design has been written yet.

### Key Findings

#### 1. Existing Spec / Plan / Research Inventory

**Authoritative spec (exists, complete):**
- `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` — 1035-line unified session tree design. Covers session model, tree constraints, visibility contract, authority contract, CLI design, backend architecture, persistence, renderer sync, IPC design, error semantics, test strategy, and implementation order. This is the single source of truth.

**Superseded specs (exist, to be replaced):**
- `docs/superpowers/specs/2026-05-07-meta-session-global-agent-design.md` — Hermes/meta-session global agent design. Replaced by unified tree spec.
- `docs/superpowers/specs/2026-05-12-stoa-ctl-work-session-lifecycle-design.md` — stoa-ctl work-session create/archive lifecycle. Replaced by unified tree spec.

**Implementation plans (not yet created):**
- No `.sisyphus/plans/` file exists for the unified session tree implementation. The spec itself contains a 9-step implementation order (lines 1010-1018) but no decomposed plan file.

**Prior research reports (exist, provide seam-level detail):**

| Report | Topic | Key Contribution |
|--------|-------|------------------|
| `research/2026-05-29-stoa-ctl-current-architecture.md` | Full stoa-ctl + meta-session architecture map | 18 evidence items tracing CLI, control server, dispatcher, proposal store, renderer, main wiring |
| `research/2026-05-29-session-backend-topology.md` | Backend session/runtime/state/IPC topology | 12 evidence items on ProjectSessionManager, state-store, IPC channels, session creation flow |
| `research/2026-05-29-session-frontend-topology.md` | Frontend session/project/session topology | 26 evidence items on workspace store, hierarchy projection, hydration, push channels |
| `research/2026-05-29-session-frontend-metasession.md` | Frontend meta-session UI logic | 47 evidence items on meta-session components, Pinia store, IPC channels, proposal system |
| `research/2026-05-29-session-frontend-store-ipc.md` | Frontend store IPC hydration/refresh | 28 evidence items on bootstrap, push channels, observability, stale guards |
| `research/2026-05-29-renderer-meta-session-removal-points.md` | Exact renderer removal points | 14 evidence items identifying every file/line for meta-session removal across 5 layers |
| `research/2026-05-29-unified-session-control-plane-seams.md` | 6 backend control-plane seams | 6 seams with exact file:line locations for each replacement |
| `research/2026-05-29-stoa-ctl-unified-session-tree-auth-research.md` | Auth and caller resolution gaps | 9 evidence items on auth replacement and activeMetaSessionId removal |
| `research/2026-05-29-impl-backend-control-plane.md` | Backend control plane implementation seams | 23 evidence items on CLI, HTTP server, env injection, bootstrap prompt, main lifecycle, IPC |
| `research/2026-05-29-impl-renderer-session-tree.md` | Renderer session tree implementation | Renderer-side implementation details |
| `research/2026-05-29-impl-session-model-runtime.md` | Session model runtime changes | Model and runtime implementation details |
| `research/2026-05-29-impl-session-types-subagent.md` | Session types changes | Type system changes |
| `research/2026-05-29-impl-session-manager-store-subagent.md` | Session manager/store changes | Manager and store implementation |
| `research/2026-05-29-impl-session-runtime-subagent.md` | Session runtime changes | Runtime implementation |
| `research/2026-05-29-impl-session-priors-subagent.md` | Session priors | Prior/context implementation |
| `research/2026-05-29-session-cli-best-practices.md` | CLI best practices | CLI design patterns |
| `research/2026-05-29-orca-cli-session-patterns.md` | Orca CLI session patterns | Reference patterns from upstream |

#### 2. Six Structural Seams Requiring Replacement

The current codebase is bifurcated: work sessions and meta sessions are separate product concepts with separate stores, IPC channels, CLI command groups, control-server routes, env injection, bootstrap prompts, and launch paths. The unified design collapses these into one model. The six seams are:

**Seam 1: CLI command structure** (`tools/stoa-ctl/index.ts`)
- Current: separate `meta-sessions`, `work-sessions`, `proposals`, `dispatch` command groups
- Target: single `session` command group with `list/create/inspect/prompt/destroy`
- Critical: `resolveHeaders()` at line 93-113 uses `STOA_META_SESSION_ID` + `activeMetaSessionId` fallback → must become unified caller auth

**Seam 2: HTTP control server** (`src/core/meta-session-control-server.ts`)
- Current: `/ctl/meta-sessions/*`, `/ctl/proposals/*`, `/ctl/dispatch/*` endpoints
- Target: unified `/ctl/session/*` endpoints
- Critical: `authorize()` at line 83-96 checks `metaSessionSource.getSession()` → must become `SessionCallerAuthRegistry`

**Seam 3: Command environment** (`src/core/meta-session-command-env.ts`)
- Current: `STOA_META_SESSION: '1'`, `STOA_META_SESSION_ID` (lines 17-18), meta-session-only injection
- Target: remove meta-session env vars, add `STOA_CTL_SESSION_TOKEN`, inject into ALL sessions

**Seam 4: Bootstrap prompt** (`src/core/meta-session-bootstrap-prompt.ts`)
- Current: "You are running inside a Stoa meta session" (line 2), references `stoa-ctl meta-sessions` (line 28)
- Target: unified session identity + tree-local visibility rules

**Seam 5: Main process lifecycle** (`src/main/index.ts`)
- Current: separate `MetaSessionManager`, `MetaSessionProposalStore`, `MetaSessionCommandDispatcher` (lines 13-18); bifurcated launch paths `launchSessionRuntimeWithGuard` vs `launchMetaSessionRuntimeWithGuard` (lines 787-1015)
- Target: unified `SessionSupervisor` with single launch path

**Seam 6: IPC channels** (`src/core/ipc-channels.ts`)
- Current: 10 `meta-session:*` channels (lines 17-28) + work-session channels (lines 6-16)
- Target: remove all `meta-session:*` channels, add `session:create-child`, `session:prompt`, `session:destroy`, `session:inspect`

#### 3. Implementation Gaps (what does NOT exist yet)

The following code does not exist anywhere in the repository — it must be written from scratch:

1. **`parentSessionId` / `createdBySessionId` on `SessionSummary`** — `src/shared/project-session.ts:122-145` has no parent-child fields. These must be added.

2. **`SessionSupervisor`** — no file exists. Must be created as the unified business entry point for create/destroy/inspect/prompt/graph-derivation.

3. **`SessionVisibilityService`** — no file exists. Must be created to compute rootSessionId, depth, visible set, and authority matrix.

4. **`SessionCallerAuthRegistry`** — no file exists. Must be created for per-session token minting, validation, and lifecycle binding.

5. **`SessionControlServer`** — does not exist. Must replace `meta-session-control-server.ts` with unified `/ctl/session/*` routes.

6. **`SessionCommandEnv`** — does not exist. Must replace `meta-session-command-env.ts` to inject stoa-ctl env into ALL sessions.

7. **`SessionBootstrapPromptService`** — does not exist. Must replace `meta-session-bootstrap-prompt.ts`.

8. **`SessionNodeSnapshot` / `SessionTreeMeta` read models** — do not exist in `src/shared/project-session.ts`. Must be added.

9. **`SessionGraphEvent`** envelope for `session:event` — does not exist. Current `session:event` only pushes `SessionSummary`.

10. **Renderer `upsertSession` semantics** — `src/renderer/stores/workspaces.ts:261-268` only has `updateSession` (updates existing). Must add insert-if-missing.

11. **Tree projection in `projectHierarchy`** — `src/renderer/stores/workspaces.ts:64-87` only groups sessions under projects (flat). Must add parent/child tree projection.

12. **Recursive session tree row in `WorkspaceHierarchyPanel.vue`** — current implementation only renders one level of session rows per project.

13. **Archived subtree projection** — archived sessions are currently flattened into a separate `ArchiveSurface`. Must remain in-tree with parent-child structure preserved.

14. **`stoa-ctl` unified `session` command group** — `tools/stoa-ctl/index.ts` currently has split command groups. Must be rewritten.

#### 4. Design Constraints That MUST Be Written Into Any Implementation Plan

These constraints are non-negotiable per the spec and the user's stated requirements:

| # | Constraint | Source |
|---|-----------|--------|
| C1 | **No separate meta-session product concept.** All session management goes through one unified model. | spec lines 37-48, user requirement |
| C2 | **All sessions expose stoa-ctl.** Not just meta sessions — every provider-managed session gets `STOA_SESSION_ID`, `STOA_CTL_SESSION_TOKEN`, `STOA_CTL_BASE_URL` and stoa-ctl on PATH. | spec lines 623-633 |
| C3 | **Frontend displays unified session tree.** `WorkspaceHierarchyPanel` must render recursive parent/child tree, not flat project→sessions. | spec lines 867-905 |
| C4 | **`parentSessionId` is the only authority relationship field.** No `childSessionIds`, no `rootSessionId`, no `depth` on the persisted model. All derived. | spec lines 131-159 |
| C5 | **Session-created sub sessions auto-appear in frontend.** `session:event` must carry `created` events with full `SessionNodeSnapshot`. Renderer must upsert unknown sessions. | spec lines 745-810 |
| C6 | **Background child creation does NOT steal focus.** Only explicit user creation from the renderer switches active session. | spec lines 850-864 |
| C7 | **Destroy is recursive subtree.** No orphans. No reparenting. Leaf-first stop, then archive all. | spec lines 215-234 |
| C8 | **Visibility contract: same-depth peers + descendants only.** No ancestor visibility, no peer-descendant visibility, no cross-tree visibility. | spec lines 249-318 |
| C9 | **Authority matrix is separate from visibility.** Visible does not mean fully empowered. Session callers cannot destroy same-depth peers. | spec lines 326-358 |
| C10 | **No backwards compatibility.** No migration. No `meta-session:*` IPC as compatibility layer. No old proposal/dispatch as main path. | spec lines 49-56, AGENTS.md |
| C11 | **`SessionSupervisor` is the single business entry point.** Both IPC and CLI routes share one implementation. No split semantics. | spec lines 587-610 |
| C12 | **Port file removes `activeMetaSessionId`.** No implicit caller resolution. Session callers must have explicit token. | spec lines 400-460, auth-research |
| C13 | **Archived sessions remain in-tree.** Each project has `liveRoots` + `archivedRoots` forests. Archived subtrees preserve parent-child structure. | spec lines 818-850 |
| C14 | **Quality gate: all test tiers must pass.** `npm run test:generate`, `npx vitest run`, `npm run test:e2e`, `npm run test:behavior-coverage`. | spec lines 996-1006, CLAUDE.md |

#### 5. Files That Must Be Deleted (meta-session product removal)

Per the spec and `research/2026-05-29-renderer-meta-session-removal-points.md`:

**Core (backend):**
- `src/core/meta-session-manager.ts` — replaced by SessionSupervisor
- `src/core/meta-session-state-store.ts` — meta-session persistence removed
- `src/core/meta-session-control-server.ts` — replaced by SessionControlServer
- `src/core/meta-session-command-dispatcher.ts` — replaced by SessionSupervisor prompt
- `src/core/meta-session-proposal-store.ts` — proposal system removed
- `src/core/meta-session-context-assembler.ts` — replaced by unified context
- `src/core/meta-session-provider-patch.ts` — meta-session status patching removed
- `src/core/meta-session-command-env.ts` — replaced by SessionCommandEnv
- `src/core/meta-session-bootstrap-prompt.ts` — replaced by SessionBootstrapPromptService

**Shared types:**
- `src/shared/meta-session.ts` — entire file (199 lines)

**Renderer store:**
- `src/renderer/stores/meta-session.ts` — entire Pinia store (274 lines)

**Renderer components (5 files):**
- `src/renderer/components/meta-session/MetaSessionSurface.vue`
- `src/renderer/components/meta-session/MetaSessionSessionList.vue`
- `src/renderer/components/meta-session/MetaSessionTerminalDeck.vue`
- `src/renderer/components/meta-session/MetaSessionInspectorPanel.vue`
- `src/renderer/components/meta-session/MetaSessionActionPanel.vue`

**Shared type re-exports:**
- `src/shared/project-session.ts:13-19` — 7 meta-session type re-exports
- `src/shared/project-session.ts:385-396` — 12 optional RendererApi methods
- `src/shared/provider-descriptors.ts:76-82` — meta-session provider filter

**IPC channels:**
- `src/core/ipc-channels.ts:17-28` — all 10 `meta-session:*` channels

**Activity bar:**
- `src/renderer/components/GlobalActivityBar.vue:6` — remove `'meta-session'` from AppSurface type
- `src/renderer/components/GlobalActivityBar.vue:46-55` — remove meta-session activity bar button

**App wiring:**
- `src/renderer/app/App.vue:14,23,156,240-246,268-272` — remove meta-session store bootstrap/cleanup
- `src/renderer/components/AppShell.vue:6,74-78` — remove MetaSessionSurface import and slot

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Authoritative unified session tree spec | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | 1035 lines |
| Superseded spec: meta-session global agent | `docs/superpowers/specs/2026-05-07-meta-session-global-agent-design.md` | full file |
| Superseded spec: work-session lifecycle | `docs/superpowers/specs/2026-05-12-stoa-ctl-work-session-lifecycle-design.md` | full file |
| No parent-child fields in SessionSummary | `src/shared/project-session.ts` | lines 122-145 |
| 10 meta-session IPC channels | `src/core/ipc-channels.ts` | lines 17-28 |
| Meta-session CLI command groups | `tools/stoa-ctl/index.ts` | lines 41-77 |
| Meta-session control server routes | `src/core/meta-session-control-server.ts` | lines 467-635 |
| Meta-session command env | `src/core/meta-session-command-env.ts` | lines 17-18 |
| Meta-session bootstrap prompt | `src/core/meta-session-bootstrap-prompt.ts` | lines 2, 28 |
| Bifurcated main-process launch paths | `src/main/index.ts` | lines 787-1015 |
| Meta-session manager + dispatcher in main | `src/main/index.ts` | lines 13-18, 466-567 |
| Flat projectHierarchy projection | `src/renderer/stores/workspaces.ts` | lines 64-87 |
| No upsertSession in workspace store | `src/renderer/stores/workspaces.ts` | lines 261-268 |
| Meta-session Pinia store | `src/renderer/stores/meta-session.ts` | 274 lines |
| 5 meta-session Vue components | `src/renderer/components/meta-session/*.vue` | 5 files |
| 12 optional RendererApi bridge methods | `src/shared/project-session.ts` | lines 385-396 |
| Auth only checks session existence | `src/core/meta-session-control-server.ts` | lines 83-96 |
| activeMetaSessionId in port file | `src/core/stoa-ctl-port-file.ts` | lines 6-12 |
| 9 research reports covering seams | `research/2026-05-29-*.md` | 9 files |
| No implementation plan file exists | `.sisyphus/plans/` | no session-tree plan |

### Risks / Unknowns

- [!] **`launchMetaSessionRuntimeWithGuard()` has 168 lines of meta-session-specific logic** (src/main/index.ts:848-1015) including runtime snapshot, runtime hooks, and stoaCtlShim setup. Generalizing this is the highest-risk seam.
- [!] **Renderer `hydrateObservability()` generates N+3 IPC invocations on every mount** — the tree-aware bootstrap must consider performance with larger session sets.
- [!] **Session event push does not include observability** — `pushSessionEvent` sends `SessionSummary` but not `SessionPresenceSnapshot`. The new `SessionGraphEvent` envelope must consider ordering relative to the parallel observability push channel.
- [!] **The proposal system is deeply integrated** — `MetaSessionProposalStore` has its own persistence, stale detection, and audit log. The unified design removes proposals entirely, but any agent prompts currently rely on the proposal workflow.
- [?] **Whether `stoa-ctl` CLI tests (`tools/stoa-ctl/index.test.ts`) cover enough command paths** to safely rewrite the CLI. This needs verification before the rewrite.
- [?] **Whether any third-party or external consumer depends on `/ctl/meta-sessions/*` or `meta-session:*` IPC channels** — if external tools consume these, the breaking change may need documentation.
- [?] **How the unified session tree interacts with existing session recovery** — `ProjectSessionManager.buildBootstrapRecoveryPlan()` and `MetaSessionManager.buildBootstrapRecoveryPlan()` both exist. The unified design needs a single recovery plan that handles tree-structured sessions.

## Context Handoff: Unified Session Tree Gap Analysis

Start here: `research/2026-05-29-unified-session-tree-gap-analysis.md`

Context only. Use the saved report as the source of truth.
