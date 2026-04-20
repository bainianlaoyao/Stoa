---
date: 2026-04-19
topic: project-session-unification
status: draft-reviewed
---

# Project / Session Unified Data Model Design

## 1. Summary

This design replaces the current mismatched `workspace`-centric model with a unified canonical domain model built around **Project** and **Session**.

- `Project` becomes the top-level persisted entity.
- `Session` becomes the persisted child entity under a project.
- `Workspace` is removed from the shared product/domain vocabulary because it no longer carries a distinct lifecycle or user-facing meaning.

This aligns the backend, frontend hierarchy, IPC naming, persistence shape, and recovery model with the product language the user actually sees: **New Project** creates a project, and **New Session** creates a session under a project.

## 2. Context

The current architecture has a semantic split:

- the backend canonical object is `WorkspaceSummary` created via `workspace:create`
- the renderer presents a project-like hierarchy by grouping workspaces using `name + path`
- the UI already hints at a `new session` affordance
- `session` does not currently exist as a first-class backend entity

That creates drift across creation flows, hierarchy rendering, persistence, and restart recovery.

The product semantics confirmed during design are:

1. `Workspace` should be removed because it does not meaningfully differ from `Project`.
2. A `Project` can contain **multiple concurrent Sessions**.
3. `Session` is a persisted backend entity.
4. `Session` has multiple subtypes; currently:
   - `shell`
   - `opencode`
5. `shell` sessions are persisted but do **not** restore terminal history across restart.
6. `opencode` sessions are persisted and restored by resuming an external opencode session id.
7. The app should not persist large or complex conversation/runtime context locally.

## 3. Goals

### Functional goals

1. Unify frontend and backend around one shared hierarchy: `Project -> Session`.
2. Make `Session` a real persisted entity with subtype-specific recovery semantics.
3. Support multiple parallel sessions under a single project.
4. Replace `workspace:*` product semantics with `project:*` and `session:*` semantics.
5. Keep local persistence lightweight and recovery-oriented.

### Non-goals

1. Persisting full shell scrollback or full terminal history.
2. Persisting large opencode conversation context locally.
3. Introducing a separate `Workspace` entity unless a future product requirement creates a truly distinct lifecycle.
4. Designing provider-specific deep internals beyond the contract needed for session creation and recovery.

## 4. Considered Options

### Option A — Keep Workspace as the core entity

Use `Workspace` as the only persisted backend entity and continue deriving project/session semantics in the renderer.

**Rejected** because it directly conflicts with the confirmed product semantics:

- session must be persisted
- one project can have multiple sessions
- workspace no longer has distinct meaning

### Option B — Project + Session model, remove Workspace

Use `Project` as the top-level persisted entity and `Session` as the persisted child entity. Remove `Workspace` from the shared domain model.

**Chosen** because it matches the confirmed product semantics exactly while minimizing conceptual duplication.

### Option C — Project + Workspace + Session model

Keep all three as first-class backend entities.

**Rejected for now** because `Workspace` does not currently carry a distinct lifecycle or user mental model. Keeping it would add migration and modeling cost without clear product value.

## 5. Canonical Domain Model

## 5.1 Project

`Project` is the top-level persisted entity representing a local project.

Canonical identity rules:

- canonical identity is `Project.id`
- canonical uniqueness is based on normalized `path`
- two active projects must not point to the same normalized path
- `name` is display metadata, not identity
- `path` is the canonical project locator and must be treated as the stable uniqueness boundary

Suggested fields:

- `id`
- `name`
- `path`
- `defaultSessionType?`
- `createdAt`
- `updatedAt`

`Project` owns no terminal runtime directly. Its main responsibilities are:

- identity
- grouping of sessions
- stable path metadata
- project-level defaults and display information

Path mutation policy:

- changing a project's path is treated as updating the same project record only if the user explicitly edits the project
- automatic path-based inference must not create duplicate projects for the same normalized path
- if a path becomes invalid on disk, the project record may remain persisted, but runtime/session recovery behavior must surface the failure explicitly rather than silently deleting the project

## 5.2 Session

`Session` is a persisted child entity under a project.

Suggested fields:

- `id`
- `projectId`
- `type: 'shell' | 'opencode'`
- `status`
- `title`
- `summary`
- `createdAt`
- `updatedAt`
- `lastActivatedAt`
- `recoveryMode`
- `externalSessionId?`

`Session` is the canonical entity for:

- terminal/runtime identity
- lifecycle state
- restore/restart behavior
- session-specific provider integration

Integrity rules:

- every session must belong to exactly one project
- `Session.projectId` must reference an existing project
- orphan sessions are invalid and must not be loaded as canonical state
- `activeSessionId`, if present, must belong to `activeProjectId`; otherwise both active pointers must be repaired during load

## 5.3 Session subtypes

`Session` is a unified entity with subtype-driven behavior.

### Shell session

- persisted across app restarts
- retains identity and metadata
- does **not** restore historical terminal content
- restart behavior is **fresh shell launch**, not full resume
- runtime continuity is **not** preserved across app restart
- session identity continuity **is** preserved across app restart

Recommended semantics:

- `type = 'shell'`
- `recoveryMode = 'fresh-shell'`

Lifecycle contract:

- a shell session is a persistent logical record, not a durable shell process
- on app restart, the same session record receives a new shell runtime attachment
- this must be treated as **session continuity with runtime replacement**, not true resume
- if fresh shell launch fails during startup recovery, the session should enter `error` or `needs_confirmation`, never disappear

### Opencode session

- persisted across app restarts
- retains identity and metadata
- stores only lightweight recovery information required for resumption
- uses an external opencode session id to resume

Recommended semantics:

- `type = 'opencode'`
- `recoveryMode = 'resume-external'`
- `externalSessionId` is the lightweight persisted recovery handle

Recovery failure classification:

| Condition | Resulting state | Notes |
|---|---|---|
| `externalSessionId` missing | `error` | Invalid persisted opencode session; cannot resume |
| external backend temporarily unavailable | `degraded` or `needs_confirmation` | Retryable failure; session record remains |
| external session not found / expired permanently | `needs_confirmation` | User-facing recovery decision required |
| resume succeeds but returned metadata conflicts with local expectations | `degraded` | Keep local session identity, require reconciliation |

Recovery ownership rule:

- adapters may detect subtype-specific outcomes
- canonical session states remain normalized in the shared session model
- adapters must not invent their own persisted lifecycle vocabulary

## 5.4 Workspace

`Workspace` is removed from the shared domain model.

Any fields currently attached to workspace must be reassigned either to:

- `Project` if they describe the project itself
- `Session` if they describe a running or recoverable session
- runtime-only in-memory state if they only apply to the current app process

## 6. Ownership Boundaries

### Main process owns

- canonical `Project` records
- canonical `Session` records
- persistence
- recovery orchestration
- runtime registry keyed by session id

### Renderer owns

- presentation state
- expansion/collapse state
- selection state not required for backend recovery
- view composition over canonical project/session data

### Rule

If a concept must survive restart or participate in recovery logic, it belongs in canonical main-process state.

By this rule:

- `Project` is canonical
- `Session` is canonical
- runtime ports, secrets, PTY handles, live buffers are **not** canonical persisted state

Selection integrity rule:

- `active_project_id` and `active_session_id` are part of the architecture, not just UI convenience
- `active_session_id` must always reference a session that belongs to `active_project_id`
- invalid active references must be nulled or repaired during bootstrap loading

## 7. Runtime vs Persisted State

This design explicitly separates persisted identity from runtime attachment.

### Persisted state

- projects
- sessions
- session subtype
- lightweight recovery metadata
- last-known status/summary

### Runtime-only state

- PTY process handles
- webhook ports
- provider ports
- session secrets
- terminal buffers
- active transport connections

This prevents the canonical model from becoming polluted with per-process runtime fields.

## 8. Recovery Model

Recovery is driven by persisted `Session.type` and `Session.recoveryMode`.

### App startup flow

1. Load persisted `Project` and `Session` records.
2. Rebuild canonical hierarchy.
3. For each session, dispatch recovery by subtype.
4. Attach runtime state in memory.
5. Broadcast session events to renderer.

### Shell recovery

For `shell` sessions:

- retain the persisted session record
- do not restore prior terminal content
- launch a fresh shell runtime for the same session identity

This is a relaunch, not a replay.

### Opencode recovery

For `opencode` sessions:

- retain the persisted session record
- read `externalSessionId`
- call the adapter-specific resume flow
- restore status based on resume result

If resume fails, the session should transition into a recoverable failure state such as `needs_confirmation` or `error`, rather than silently disappearing.

## 9. Session State Model

The session state machine remains unified, but subtype-specific recovery behavior is externalized to adapters.

Representative states can include:

- `bootstrapping`
- `starting`
- `running`
- `awaiting_input`
- `degraded`
- `error`
- `exited`
- `needs_confirmation`

Important rule:

- state semantics are shared
- recovery implementation differs by session subtype

Lifecycle ownership rule:

- the main-process session service owns canonical state transitions
- subtype adapters emit normalized outcomes and recovery signals, not arbitrary state names
- persisted session status is a last-known lifecycle snapshot, not proof of currently attached runtime truth

This avoids creating entirely different lifecycle models for `shell` and `opencode` while still allowing different restart behavior.

## 10. IPC / API Design

The product-facing boundary should move away from `workspace:*` naming.

### Project APIs

- `project:list`
- `project:create`
- `project:update`
- `project:set-active`

### Session APIs

- `session:create`
- `session:listByProject`
- `session:set-active`
- `session:write-input`
- `session:resize-terminal`
- `session:restart`
- `session:delete`
- `session:retry-recovery`

Recovery on app startup should normally be main-process managed and not require the renderer to orchestrate resume manually.

### Product action mapping

- **New Project** → `project:create`
- **New Session** → `session:create(projectId, type, ...)`

This makes the UI actions map directly to canonical domain operations.

## 11. Persistence Shape

Recommended persisted structure:

```ts
interface PersistedAppStateV2 {
  version: 2
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  sessions: PersistedSession[]
}
```

### PersistedProject

Suggested fields:

- `project_id`
- `name`
- `path`
- `default_session_type?`
- `created_at`
- `updated_at`

### PersistedSession

Suggested fields:

- `session_id`
- `project_id`
- `type`
- `title`
- `last_known_status`
- `last_summary`
- `external_session_id?`
- `created_at`
- `updated_at`
- `last_activated_at`
- `recovery_mode`

The local persistence file should remain lightweight and recovery-oriented. It should not store large shell history, transcript payloads, or complex opencode context trees.

Naming rule:

- camelCase names describe the in-memory/domain model
- snake_case names describe serialized persistence shape
- `external_session_id` is canonical persisted recovery data for opencode sessions, not a best-effort historical observation

## 12. Frontend Hierarchy

The frontend hierarchy should become a direct rendering of canonical backend truth:

- `Project`
  - `Session`
  - `Session`
  - `Session`

The renderer should stop constructing parent groups by `name + path` heuristics. That logic should be replaced with explicit backend-provided project/session records.

## 13. Migration Strategy

This redesign is a **breaking change**.

No compatibility migration is required.

Rules:

- old workspace-centric persisted state does not need in-place migration support
- the implementation may replace the old persistence shape with the new `Project` / `Session` schema directly
- temporary compatibility code should be avoided unless required for bootstrapping the implementation itself
- implementation should prefer a clean cutover over dual-model support

## 14. Risks and Mitigations

### Risk: old runtime-specific fields are accidentally persisted in the new model

**Mitigation:** keep a strict persisted-vs-runtime boundary and move ports/secrets/pty handles into an in-memory runtime registry.

### Risk: shell and opencode sessions diverge into two incompatible models

**Mitigation:** enforce a unified `Session` entity with subtype-specific adapters rather than separate root models.

### Risk: session recovery failures lead to silent data loss

**Mitigation:** failed resume should degrade into explicit session states such as `needs_confirmation` or `error`, never deletion.

## 15. Decision Summary

### Adopted design

- `Project` is the canonical top-level persisted entity.
- `Session` is the canonical persisted child entity.
- `Session` supports multiple subtypes, currently `shell` and `opencode`.
- `Workspace` is removed from the shared domain model.
- local persistence stores lightweight identity and recovery metadata only.

### Why this design

This design is the smallest model that fully matches the confirmed product semantics:

- project is real
- session is real
- session can be parallel
- session subtype controls recovery behavior
- workspace is unnecessary duplication

It unifies frontend and backend language, simplifies hierarchy rendering, and creates a stable basis for restart recovery without introducing heavy local state management.

## 16. Open Questions Deferred Beyond This Design

The following questions are intentionally left for implementation planning rather than this design document:

1. Exact event envelope naming for project/session events.
2. Exact adapter interface signatures for shell and opencode providers.
3. Whether session title is user-editable or system-generated.

These do not block the canonical model decision.
