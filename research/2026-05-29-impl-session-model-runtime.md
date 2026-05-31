---
date: 2026-05-29
topic: impl-session-model-runtime
status: completed
mode: context-gathering
sources: 25
---

## Context Report: Session State/Persistence/Runtime Changes For Session Tree Support

### Why This Was Gathered
Implementation-focused bounded research for session tree support across session types, persistence, manager flows, and runtime/controller seams.

### Summary
Current backend state is flat: `BootstrapState.sessions` is a project-scoped array of `SessionSummary`, persisted per project in `.stoa/sessions.json`, with archive/restore/start semantics implemented only for single sessions rather than subtrees. The minimal disruption path is to extend `SessionSummary`, `PersistedSession`, and `CreateSessionRequest` with parent/audit linkage, add a host-side derived tree read model, insert recursive subtree logic in `ProjectSessionManager` archive/restore and recovery ordering, and keep any runtime-only tree token registry inside `SessionRuntimeController`, which already owns per-session ephemeral maps and is the bridge for runtime events. [src/shared/project-session.ts:122-145](src/shared/project-session.ts:122), [src/shared/project-session.ts:163-186](src/shared/project-session.ts:163), [src/shared/project-session.ts:259-270](src/shared/project-session.ts:259), [src/core/project-session-manager.ts:458-529](src/core/project-session-manager.ts:458), [src/main/session-runtime-controller.ts:27-166](src/main/session-runtime-controller.ts:27)

### Key Findings

#### 1. Exact types and methods to extend

- `SessionSummary` is the authoritative in-memory/read-side work-session shape and currently ends at `archived: boolean`; it has no lineage fields yet. This is the first required extension point for `parentSessionId` and `createdBySessionId`. [src/shared/project-session.ts:122-145](src/shared/project-session.ts:122)
- `PersistedSession` is the disk schema mirrored into `<project>/.stoa/sessions.json`; it also has no lineage fields yet. This is the persistence extension point for `parent_session_id` and `created_by_session_id`. [src/shared/project-session.ts:163-186](src/shared/project-session.ts:163)
- `PersistedProjectSessions.version` is still hardcoded as `6` in both the type and writer/defaults, so any schema extension is coupled to a version bump and validator update. [src/shared/project-session.ts:259-263](src/shared/project-session.ts:259), [src/core/state-store.ts:36-40](src/core/state-store.ts:36), [src/core/state-store.ts:130-187](src/core/state-store.ts:130), [src/core/state-store.ts:447-457](src/core/state-store.ts:447)
- `CreateSessionRequest` currently only carries `projectId`, `type`, `title`, optional `externalSessionId`, and initial dimensions. If child creation is backend-authoritative, this request shape must grow to include `parentSessionId` for UI/rooted creation, while session-internal creation may derive it implicitly from caller identity. [src/shared/project-session.ts:279-286](src/shared/project-session.ts:279), [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:203-212](docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:203)
- `toPersistedSession` and `toSessionSummary` are the exact mapping seams where any new lineage fields must be copied between runtime camelCase and persisted snake_case. [src/core/project-session-manager.ts:62-114](src/core/project-session-manager.ts:62)
- `createSession()` is the only current constructor for a new `SessionSummary`; this object literal is where `parentSessionId`, `createdBySessionId`, and any initial derived read-model invalidation hooks would be seeded. [src/core/project-session-manager.ts:483-529](src/core/project-session-manager.ts:483)
- `isValidPersistedSession()` and `isValidProjectSessions()` are the schema gates that would reject new disk payloads until updated to accept lineage fields and a bumped version. [src/core/state-store.ts:130-187](src/core/state-store.ts:130)
- The design spec explicitly constrains persistence vs read model: `parentSessionId` is authoritative hierarchy, `createdBySessionId` is audit-only, while `rootSessionId`, `depth`, and `childSessionIds` are host-derived and must not be persisted. The spec also defines the intended read model as `SessionNodeSnapshot { session, tree }` with `SessionTreeMeta { rootSessionId, depth, childCount, descendantCount }`. [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:145-179](docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:145)
- `BootstrapState` is still `projects[] + sessions[]`; if tree metadata is exposed without replacing the whole bootstrap shape, the least disruptive path is usually to keep `sessions: SessionSummary[]` stable and add separate projection APIs or augment event payloads carefully. Existing tests assert `sessions` is an array. [src/shared/project-session.ts:265-270](src/shared/project-session.ts:265), [tests/e2e/ipc-bridge.test.ts:439-449](tests/e2e/ipc-bridge.test.ts:439)

#### 2. Current create/archive/restore/start flows and subtree insertion points

- Create flow today is single-session and flat:
  - `ipcMain.handle(IPC_CHANNELS.sessionCreate, ...)` delegates to `createWorkSessionWithRuntime(payload)` and returns one `SessionSummary`. [src/main/index.ts:1296-1302](src/main/index.ts:1296)
  - `ProjectSessionManager.createSession()` validates `projectId`, resolves a title, constructs a single `SessionSummary`, pushes it into `this.state.sessions`, sets it active, and persists. No parent linkage or subtree bookkeeping exists. [src/core/project-session-manager.ts:483-529](src/core/project-session-manager.ts:483)
  - The frontend visibility path currently depends on this invoke response plus `workspaceStore.addSession(created)`, not on a creation broadcast, so background-created child sessions would be invisible without store/upsert changes or a new event. [research/2026-05-29-session-backend-topology.md:59-69](research/2026-05-29-session-backend-topology.md:59), [tests/e2e/frontend-store-projection.test.ts:590-635](tests/e2e/frontend-store-projection.test.ts:590)
- Archive flow today is leaf-only:
  - `archiveSession(sessionId)` finds one session, sets `archived = true`, updates `updatedAt`, clears active selection only if that exact session was active, then persists. No descendant traversal exists. [src/core/project-session-manager.ts:458-467](src/core/project-session-manager.ts:458)
  - `getArchivedSessions()` is just `filter(s => s.archived)`, so subtree semantics must also change archived enumeration rather than only toggling flags. [src/core/project-session-manager.ts:479-481](src/core/project-session-manager.ts:479)
  - The design spec requires recursive subtree destroy with leaf-first stop/archive, no orphan retention, and preserved `parentSessionId` for later restore. [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:214-235](docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:214)
- Restore flow today is also leaf-only:
  - `restoreSession(sessionId)` flips one session back to `archived = false`, sets active project/session to that node, updates timestamp, and persists. No descendant traversal exists. [src/core/project-session-manager.ts:469-477](src/core/project-session-manager.ts:469)
  - The design spec requires recursive subtree restore for all archived descendants rather than selective mid-branch restore. [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:236-245](docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:236)
- Bootstrap/startup recovery is currently flat:
  - `buildBootstrapRecoveryPlan()` filters only `!archived` sessions and maps each remaining session independently to `'fresh-shell'` or `'resume-external'`. Parent-before-child ordering does not exist yet. [src/core/project-session-manager.ts:328-340](src/core/project-session-manager.ts:328)
  - Tree support must insert topological ordering here so parents launch before descendants if child start semantics depend on parent runtime scope or visibility contracts.
- Persistence flow is project-grouped but tree-agnostic:
  - `doPersist()` converts all sessions, groups them by `project_id`, and writes one `PersistedProjectSessions` blob per project. This grouping already matches the design constraint that child sessions must stay in the same project as their parent. [src/core/project-session-manager.ts:691-709](src/core/project-session-manager.ts:691), [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:190-194](docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:190)
  - `createProject()` imports existing sessions from disk using `readProjectSessions(...).sessions.map(toSessionSummary)`, so lineage restoration from disk will ride through the same mapper once schema is extended. [src/core/project-session-manager.ts:363-371](src/core/project-session-manager.ts:363)
- Runtime start flow is a three-layer pipeline with no tree awareness today:
  - `launchTrackedSessionRuntime()` snapshots the manager, resolves the session and project, provisions hook lease/session secret, and passes a flat `session` object into `startSessionRuntime()`. [src/main/launch-tracked-session-runtime.ts:37-99](src/main/launch-tracked-session-runtime.ts:37)
  - `startSessionRuntime()` installs the provider sidecar, decides resume vs fresh start from `runtimeState`, provider capabilities, and `externalSessionId`, marks runtime starting, starts the PTY, streams output through `appendTerminalData`, and marks runtime alive or exited. [src/core/session-runtime.ts:66-185](src/core/session-runtime.ts:66)
  - Tree-aware runtime linkage would therefore have to be threaded through `StartSessionRuntimeOptions.session`, `toProviderTarget()`, and/or `ProviderCommandContext`, plus any pre-launch parent validation in `launchTrackedSessionRuntime()`. [src/core/session-runtime.ts:24-64](src/core/session-runtime.ts:24), [src/shared/project-session.ts:440-455](src/shared/project-session.ts:440)

#### 3. Plausible home for a runtime-only token registry

- `SessionRuntimeController` is the least disruptive location:
  - it already owns runtime-only per-session maps (`terminalBacklogs`, `pendingTerminalBatches`) and no persisted state, [src/main/session-runtime-controller.ts:27-30](src/main/session-runtime-controller.ts:27)
  - it sits on every lifecycle transition (`markRuntimeStarting`, `markRuntimeAlive`, `markRuntimeExited`, `markRuntimeFailedToStart`) and already centralizes fan-out to renderer and observability, [src/main/session-runtime-controller.ts:39-67](src/main/session-runtime-controller.ts:39), [src/main/session-runtime-controller.ts:118-166](src/main/session-runtime-controller.ts:118)
  - it is already injected as the `SessionRuntimeManager` into `launchTrackedSessionRuntime()`, so adding a sibling ephemeral registry there avoids widening PTY responsibilities. [src/main/launch-tracked-session-runtime.ts:16-23](src/main/launch-tracked-session-runtime.ts:16), [src/main/launch-tracked-session-runtime.ts:71-99](src/main/launch-tracked-session-runtime.ts:71)
- `PtyHost` is a secondary option but a weaker fit:
  - the runtime layer already uses `launchToken` and `isLaunchTokenCurrent` for stale-exit protection, [src/core/session-runtime.ts:50-52](src/core/session-runtime.ts:50), [src/core/session-runtime.ts:151-158](src/core/session-runtime.ts:151)
  - and the existing research notes `PtyHost.runtimeTokens` as generation tracking rather than lineage/session-tree identity, so mixing a tree token registry into PTY management would blur concerns. [research/2026-05-29-impl-session-runtime-subagent.md](research/2026-05-29-impl-session-runtime-subagent.md)
- A new standalone registry class under `src/main/` would be cleaner architecturally, but it adds another dependency path through runtime launch and controller wiring. For "least disruption" the controller-local map is the best fit.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| `SessionSummary` current shape has no tree fields | `src/shared/project-session.ts` | `122-145` |
| `PersistedSession` current shape has no tree fields | `src/shared/project-session.ts` | `163-186` |
| `PersistedProjectSessions.version` is `6` | `src/shared/project-session.ts` | `259-263` |
| `CreateSessionRequest` current shape | `src/shared/project-session.ts` | `279-286` |
| `ProviderCommandContext` current runtime context seam | `src/shared/project-session.ts` | `440-455` |
| Mapper seams `toPersistedSession` / `toSessionSummary` | `src/core/project-session-manager.ts` | `62-114` |
| Flat recovery plan | `src/core/project-session-manager.ts` | `328-340` |
| Single-session archive/restore semantics | `src/core/project-session-manager.ts` | `458-481` |
| Single-session create flow | `src/core/project-session-manager.ts` | `483-529` |
| Persist groups per project and writes version `6` session files | `src/core/project-session-manager.ts` | `691-709` |
| Project import hydrates sessions via `toSessionSummary` | `src/core/project-session-manager.ts` | `363-371` |
| State store default session-file version | `src/core/state-store.ts` | `36-40` |
| State store validator requires version `6` | `src/core/state-store.ts` | `130-143` |
| State store persisted-session validator fields | `src/core/state-store.ts` | `145-187` |
| State store writer hardcodes version `6` | `src/core/state-store.ts` | `447-457` |
| Runtime manager interface and start options | `src/core/session-runtime.ts` | `6-53` |
| Provider target mapping and start lifecycle | `src/core/session-runtime.ts` | `55-185` |
| Runtime controller ephemeral maps and fan-out | `src/main/session-runtime-controller.ts` | `27-166` |
| Launch orchestrator wiring | `src/main/launch-tracked-session-runtime.ts` | `16-102` |
| IPC session create returns one created session | `src/main/index.ts` | `1296-1302` |
| Existing backend topology notes flat create visibility path | `research/2026-05-29-session-backend-topology.md` | `59-69` |
| Existing persistence safety report documents silent-drop risk | `research/2026-04-24-state-persistence-safety.md` | `113-119` |
| Existing persistence safety report proposes atomic writes | `research/2026-04-24-state-persistence-safety.md` | `262-278` |
| Design spec: parent/audit fields and derived-only tree metadata | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `145-179` |
| Design spec: same-project child constraint | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `190-194` |
| Design spec: direct-child creation rule | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `203-212` |
| Design spec: recursive subtree destroy/restore | `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` | `214-245` |
| IPC bridge tests assert flat bootstrap/session shape | `tests/e2e/ipc-bridge.test.ts` | `439-449`, `477-494`, `514-536` |
| Store tests assert flat `addSession` and grouped project hierarchy | `tests/e2e/frontend-store-projection.test.ts` | `590-635` |

### Risks / Unknowns
- [!] Schema change is breaking in three places at once: `PersistedSession`, `PersistedProjectSessions.version`, and `state-store` validation/writing. Without updating all three together, persisted session trees will fail to load or silently flatten. [src/shared/project-session.ts:163-186](src/shared/project-session.ts:163), [src/shared/project-session.ts:259-263](src/shared/project-session.ts:259), [src/core/state-store.ts:130-187](src/core/state-store.ts:130)
- [!] Current archive/restore logic is node-local; implementing subtree semantics only at the UI layer would be incorrect because persisted state, recovery plans, and archived-session listings all currently operate on flat flags. [src/core/project-session-manager.ts:328-340](src/core/project-session-manager.ts:328), [src/core/project-session-manager.ts:458-481](src/core/project-session-manager.ts:458)
- [!] Renderer and tests still assume flat insertion via `createSession()` invoke result plus `addSession(created)`. Session-internal child creation will need an upsert/broadcast path or those sessions will not appear live. [research/2026-05-29-session-backend-topology.md:63-69](research/2026-05-29-session-backend-topology.md:63), [tests/e2e/frontend-store-projection.test.ts:590-635](tests/e2e/frontend-store-projection.test.ts:590)
- [!] Persistence safety remains a background risk: `readAllProjectSessions` can silently drop unreadable project session files before the next write, which is especially dangerous once whole subtrees live in those files. [research/2026-04-24-state-persistence-safety.md:113-119](research/2026-04-24-state-persistence-safety.md:113)
- [?] Whether tree metadata should be injected into `BootstrapState.sessions` directly, emitted on `session:event`, or exposed through a parallel inspect/read API is still an implementation choice. The design spec defines the target read model but current transport contracts are flat. [src/shared/project-session.ts:265-270](src/shared/project-session.ts:265), [docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:165-179](docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md:165)
- [?] Runtime child-start dependency is not encoded today. If child sessions require a live parent lease/token/context before launch, `buildBootstrapRecoveryPlan()` and `launchTrackedSessionRuntime()` need explicit ordering rules beyond the current flat start sequence. [src/core/project-session-manager.ts:328-340](src/core/project-session-manager.ts:328), [src/main/launch-tracked-session-runtime.ts:37-99](src/main/launch-tracked-session-runtime.ts:37)

## Context Handoff: Session State/Persistence/Runtime Tree Support

Start here: `research/2026-05-29-impl-session-model-runtime.md`

Context only. Use the saved report as the source of truth.
