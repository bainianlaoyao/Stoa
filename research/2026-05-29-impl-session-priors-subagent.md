---
date: 2026-05-29
topic: impl-session-priors-subagent
status: completed
mode: context-gathering
sources: 20
---

## Context Report: Implementation Priors for Session Tree Support

### Why This Was Gathered
Bounded read-only research to inform implementation planning for sub-session / session tree support. Maps existing research, risky test assumptions, and carry-forward risks.

---

## Summary

The codebase already contains extensive research on session topology, state persistence, and runtime behavior. Key findings:

1. **Existing reports document a flat `projectId → sessions[]` model** with no `parentSessionId` field in `SessionSummary` (`src/shared/project-session.ts:122-145`). The design spec (`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`) calls for adding this field as a breaking change.

2. **Persistence is split** between `~/.stoa/global.json` (projects/active IDs) and `<project>/.stoa/sessions.json` (per-project sessions). No session-level isolation exists today (`src/core/state-store.ts:46-52`).

3. **Three tests encode flat-hierarchy assumptions** that would break under subtree semantics: `ipc-bridge.test.ts:439-536` asserts `getBootstrapState()` returns a flat sessions array; `frontend-store-projection.test.ts` projects `ProjectHierarchyNode[]` as `Project → Sessions` only; `backend-lifecycle.test.ts` creates sessions with no parent context.

4. **Stale `externalSessionId`** is an existing known risk — if a user runs `/new` inside a provider CLI, the stored ID becomes stale and `--resume <old-id>` resumes the wrong conversation (`research/2026-04-24-provider-external-session-id-lifecycle.md:190`, `research/2026-04-25-session-id-refresh-and-switching.md:83`).

5. **No periodic session list refresh loop** — session list is bootstrapped once via `getBootstrapState()` then updated via `session:event` push (`research/2026-05-29-session-frontend-topology.md:39`).

6. **Current renderer only does upsert via `session:create` invoke result**; a background-created child session would not appear via current push channels (`research/2026-05-29-session-backend-topology.md:69`, `research/2026-05-29-session-frontend-topology.md:60`).

---

## 1. Existing Research Reports — Relevance to Session Tree

### Backend Topology

- **`research/2026-05-29-session-backend-topology.md`** — Documents that `SessionSummary` has no `parentSessionId` field, that persistence is split between `global.json` and per-project `sessions.json`, and that `createSession()` requires `projectId` and always creates at project scope (`:19-21`, `:39`). Identifies the visibility path gap: no separate push channel for work-session creation, renderer relies on `session:create` invoke result (`:58-69`). Explicitly flags: "no inspected code shows an existing backend concept named 'sub session'" (`:101`).

- **`research/2026-05-29-stoa-ctl-current-architecture.md`** — Documents that `stoa-ctl` control server auth currently only accepts known meta session IDs; that auth is the hardest boundary for exposing `stoa-ctl` to all sessions (`:189`). Documents the `activeMetaSessionId` fallback pattern that the design spec says must be removed (`:390-415`). Maps all routes that would need generalization.

### State Persistence

- **`research/2026-04-24-state-persistence-safety.md`** — Documents six interconnected safety defects in state persistence. **Critical for session tree**: if a child session creates its own `sessions.json` isolation (not planned per spec), the read-failure cascade could lose entire subtrees. The atomic write fix (`atomicWriteFile`) at `:262-278` would benefit any recursive archive/destroy path. Key finding: `readAllProjectSessions` silently drops failed projects, causing data loss on next persist (:113-119). This is directly relevant if subtree operations fail mid-execution.

- **`research/2026-04-24-session-presence-and-ui.md`** — Documents that current renderer only shows flat session status; no `parentSessionId` visualization exists. Documents the session row rendering at `WorkspaceHierarchyPanel.vue:264-267` — only shows title/type, not parent relationship. Documents that `turn_complete`, `degraded`, `needs_confirmation` all share warning styling (:28), which will need differentiation when subtree depth is added.

### Session ID / Runtime Behavior

- **`research/2026-04-24-provider-external-session-id-lifecycle.md`** — Documents three distinct ID acquisition strategies: claude-code seeds UUID, opencode discovers via webhook, codex discovers via file polling. Documents that **none of the three providers detect internal conversation switches** — stored `externalSessionId` becomes stale on `.resume`, `/new`, `/clear` (:48-50, :190). This is a known silent data corruption risk if child sessions resume wrong conversations.

- **`research/2026-04-25-session-id-refresh-and-switching.md`** — Documents that session IDs are write-once, never refreshed. `applySessionEvent()` overwrites `externalSessionId` only at initial discovery, with no diff check (:71). Confidence model treats `externalSessionId` presence as `authoritative` but doesn't verify correctness (:53-62). Documents that Stoa session switching works (store + IPC) but provider-internal switches don't (:47-51).

### Frontend Topology

- **`research/2026-05-29-session-frontend-topology.md`** — Documents that `useWorkspaceStore` keeps flat `projects` and `sessions` refs, derives `projectHierarchy` by grouping sessions under `project.id` only (:21, :53). Documents that renderer bootstraps once via `getBootstrapState()` and has no periodic polling loop (:39). Documents that `session:event` is the only push channel but renderer assumes `addSession()` from invoke result is the creation path (:60). Documents that metasession is a separate UI stack — `useMetaSessionStore()` is separate from `useWorkspaceStore` (:47-49, :58).

### Session Type Architecture

- **`research/2026-04-23-session-type-architecture.md`** — Documents the hardcoded `if/else` mapping from `SessionType` to provider at `src/main/index.ts:119` — a bottleneck for any new session type including sub sessions. Documents that adding a new session type requires changes across 10 layers including UI name maps.

### Design Spec

- **`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`** — The authoritative design spec. Key decisions: add `parentSessionId` + `createdBySessionId` to `SessionSummary`; derive `rootSessionId`/`depth` at runtime; `SessionSupervisor` owns all create/destroy/inspect/prompt; `SessionControlServer` replaces meta-session-control-server; recursive subtree destroy/restore; tree-local visibility contract; renderer must use `upsertSession` not just `addSession`; no migration logic.

---

## 2. Tests Encoding Risky Flat-Hierarchy Assumptions

### `tests/e2e/ipc-bridge.test.ts:439-536`

**Assumption**: `getBootstrapState()` returns a flat `sessions[]` array. Tests verify:
- `getBootstrapState()` round-trips bootstrap state containing flat sessions array
- `createSession()` returns a real `SessionSummary` and later `getBootstrapState()` contains it

**Risk for tree semantics**:
- No `parentSessionId` in assertions — if backend starts returning `SessionNodeSnapshot` instead of raw `SessionSummary`, assertions will fail
- If `getBootstrapState` adds `treeMeta` fields to each session, test assertions need updating
- `BootstrapState` shape is asserted as-is; any augmentation triggers test failure

**Lines to watch**: `:439-449` (bootstrap round-trip), `:477-492` (session create returns SessionSummary), `:515-536` (subsequent bootstrap contains new session)

### `tests/e2e/frontend-store-projection.test.ts:590-635`

**Assumption**: `store.addSession({ ...session })` is the canonical insertion path. Tests verify:
- Adding a created session to the store is an explicit `addSession()` call
- `projectHierarchy` is derived from flat `projects` + `sessions` with no parent relationship

**Risk for tree semantics**:
- `projectHierarchy` computed as `ProjectHierarchyNode[]` grouping by `projectId` only (:64-87 in workspaces.ts) — no recursion on `parentSessionId`
- `upsertSession` semantics (insert if unknown) are not tested; current tests only cover `addSession` (update if exists)
- If tree projection changes `projectHierarchy` shape, assertions need updating

**Lines to watch**: `:590-611` (addSession path), `:613-635` (hierarchy derivation)

### `tests/e2e/backend-lifecycle.test.ts:61-529`

**Assumption**: Session creation only requires `projectId`, no `parentSessionId`. Tests verify:
- `ProjectSessionManager.createSession()` with `CreateSessionRequest { projectId, type, title }`
- `startSessionRuntime()` with flat session object — no parent context
- Session events flow without parent relationship

**Risk for tree semantics**:
- `createSession()` path assumes single-level hierarchy
- `CreateSessionRequest` doesn't include `parentSessionId` — new field would be ignored or require interface update
- Subtree destroy/restore not tested

**Lines to watch**: `:61-96` (session creation with mock event), all `createSession()` calls

### `tests/e2e/session-runtime-lifecycle.test.ts:1-100`

**Assumption**: `startSessionRuntime` takes a flat session object with no parent context. Tests create echo/fail providers with no tree semantics.

**Risk for tree semantics**:
- `StartSessionRuntimeOptions.session` interface has no `parentSessionId` field
- No subtree lifecycle testing (create child → destroy parent → verify child archived)
- No visibility scope testing

**Lines to watch**: `:15-57` (echo provider), `:59-93` (fail provider), all `startSessionRuntime` calls

### `tests/e2e/app-bridge-guard.test.ts` and `tests/e2e/main-config-guard.test.ts`

**Assumption**: Config guard tests analyze source code text for structural correctness. These tests are at lower risk because they check patterns rather than session structure, but should be updated if new IPC channels are added for `session:create-child`, `session:prompt`, `session:destroy`.

---

## 3. Notable Risks / Unknowns for Implementation Plan

### [!] No `parentSessionId` field exists in `SessionSummary`

`src/shared/project-session.ts:122-145` — `SessionSummary` has no parent relationship field. Any session tree implementation starts here. The design spec calls for adding `parentSessionId: string | null` and `createdBySessionId: string | null`.

### [!] `createSession()` requires `projectId` only — no parent support

`src/core/project-session-manager.ts:483-529` — `createSession()` only accepts `{ projectId, type, title }`. No `parentSessionId` in the creation path. New overload or parameter required.

### [!] `projectHierarchy` is computed as flat `Project → Sessions[]`

`src/renderer/stores/workspaces.ts:64-87` — derived by grouping sessions under `project.id` only. No recursion on `parentSessionId`. Needs redesign for tree projection.

### [!] Renderer assumes `addSession()` only updates existing sessions

`src/renderer/app/App.vue:69-85` — explicit `addSession(created)` from `session:create` invoke result. Background-created child sessions (via `stoa-ctl` from another session) would not appear via current push channels. Design spec requires `upsertSession` semantics.

### [!] No visibility scope enforcement exists today

`research/2026-05-29-stoa-ctl-current-architecture.md:189` — current control server auth only accepts known meta session IDs. `SessionVisibilityService` doesn't exist — all route handlers share full scope. Need to add caller-scoped filtering.

### [!] State persistence has silent failure cascade

`research/2026-04-24-state-persistence-safety.md:113-119` — `readAllProjectSessions` silently drops failed projects, causing data loss on next persist. If subtree destroy fails mid-operation, partial state could persist. The atomic write fix (`:262-278`) would help but is not yet applied.

### [?] How subtree restore should handle archived descendants

Design spec says restore is symmetric with destroy (recursive restore), but no test or implementation exists. Must decide: restore target + all archived descendants, or selective restore.

### [?] `externalSessionId` staleness on child session

`research/2026-04-24-provider-external-session-id-lifecycle.md:190` — stale externalSessionId corrupts session identity on restart. If child sessions inherit external IDs or create new ones, the staleness problem applies to both parent and child scopes.

### [?] Whether `stoa-ctl session create` from a session caller should auto-inherit `parentSessionId`

Design spec says session-context create must create direct child of caller, but no implementation exists. Must decide: caller passes nothing, backend derives from calling session's identity; or caller passes explicit parent.

### [?] Meta session stack removal scope

`docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:340-348` says remove independent meta-session surface. `research/2026-05-29-session-frontend-topology.md:47-49` shows meta session is a separate store/surface stack. Must verify: how much code touches `useMetaSessionStore` and `MetaSessionSurface`?

### [?] IPC channel naming for tree actions

Current `session:*` channels assume flat session operations. New actions needed: `session:create-child`, `session:prompt`, `session:destroy`. Must decide: extend existing channels or add new ones; whether tree actions reuse or replace `session:archive`.

---

## Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionSummary` has no parent field | `src/shared/project-session.ts` | `:122-145` |
| Persistence split: global vs per-project | `src/core/state-store.ts` | `:46-52` |
| `createSession()` requires only `projectId` | `src/core/project-session-manager.ts` | `:483-529` |
| `projectHierarchy` is flat `Project → Sessions` | `src/renderer/stores/workspaces.ts` | `:64-87` |
| Bootstrap is one-shot, no polling | `research/2026-05-29-session-frontend-topology.md` | `:39` |
| `addSession` from invoke result is creation path | `src/renderer/app/App.vue` | `:69-85` |
| Control server auth is meta-session-only | `research/2026-05-29-stoa-ctl-current-architecture.md` | `:189` |
| Stale externalSessionId on provider switch | `research/2026-04-24-provider-external-session-id-lifecycle.md` | `:190` |
| Session ID is write-once, never refreshed | `research/2026-04-25-session-id-refresh-and-switching.md` | `:21-29` |
| State read failures drop projects silently | `research/2026-04-24-state-persistence-safety.md` | `:113-119` |
| Atomic write fix proposed but not applied | `research/2026-04-24-state-persistence-safety.md` | `:262-278` |
| IPC bridge tests assume flat sessions array | `tests/e2e/ipc-bridge.test.ts` | `:439-536` |
| Store tests assume `addSession` not `upsertSession` | `tests/e2e/frontend-store-projection.test.ts` | `:590-635` |
| Backend lifecycle tests assume single-level hierarchy | `tests/e2e/backend-lifecycle.test.ts` | `:61-529` |
| Session runtime interface has no parent context | `tests/e2e/session-runtime-lifecycle.test.ts` | `:1-100` |
| Meta session is separate UI stack | `research/2026-05-29-session-frontend-topology.md` | `:47-49` |
| Design spec tree constraints | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `:189-247` |

---

## Context Handoff: Session Tree Implementation Priors

Start here: `research/2026-05-29-impl-session-priors-subagent.md`

Context only. Use the saved report as the source of truth.