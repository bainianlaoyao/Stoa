---
date: 2026-05-29
topic: session-backend-topology
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Backend Session / Runtime / State / IPC Topology

### Why This Was Gathered
Supports a planned upgrade where sub sessions must be created, destroyed, inspected, prompted, and shown in the frontend. This report maps the current backend work-session topology only where the code provides direct evidence.

### Summary
Today the work-session backend model is `BootstrapState -> projects[] + sessions[]`; each `SessionSummary` belongs to one project through `projectId`, and there is no standalone persisted `workspace` entity in the inspected paths. Persistence is split between `~/.stoa/global.json` for projects/active IDs/settings and `<project>/.stoa/sessions.json` for that project's sessions; `ProjectSessionManager.create()` hydrates both into memory and `snapshot()` is exposed to the renderer through `project:bootstrap`. A newly created work session becomes visible to the frontend because `session:create` returns the created `SessionSummary`, and `App.vue` inserts it into the Pinia store with `workspaceStore.addSession(created)`; later runtime/provider changes arrive by `session:event`.

### Key Findings

#### 1. Session entities and hierarchy

- `SessionType` is limited to `'shell' | 'opencode' | 'codex' | 'claude-code'`. `SessionSummary` includes `projectId`, runtime/turn state, title/summary, recovery metadata, timestamps, and `archived`. `BootstrapState` contains `activeProjectId`, `activeSessionId`, `projects`, `sessions`, and `terminalWebhookPort`. `CreateSessionRequest` requires `projectId`, `type`, and `title`. Source: `src/shared/project-session.ts:39-46`, `src/shared/project-session.ts:113-145`, `src/shared/project-session.ts:265-286`.
- The current persisted/runtime hierarchy for work sessions is project-to-sessions, not workspace-to-projects-to-sessions: `SessionSummary.projectId` links sessions to projects, and `BootstrapState` only stores flat `projects[]` and `sessions[]`. Source: `src/shared/project-session.ts:122-145`, `src/shared/project-session.ts:265-286`.
- In the renderer, `ProjectHierarchyNode` is derived by grouping `sessions` under each project and splitting non-archived versus archived sessions. Source: `src/renderer/stores/workspaces.ts:11-15`, `src/renderer/stores/workspaces.ts:64-87`.
- Unknown explicitly: no standalone persisted or runtime `Workspace` entity was found in the inspected backend topology files; `workspace` appears in names like `workspaceOpen` and the Pinia store name, but not as a first-class hierarchy object in `BootstrapState`. Evidence inspected: `src/shared/project-session.ts:265-286`, `src/core/ipc-channels.ts:32`, `src/renderer/stores/workspaces.ts:30-35`.

#### 2. Persistence store

- Global state lives at `~/.stoa/global.json`, resolved by `getGlobalStateFilePath()`. Per-project session state lives at `<project>/.stoa/sessions.json`, resolved by `getProjectSessionsFilePath(projectPath)`. Source: `src/core/state-store.ts:46-52`.
- `PersistedGlobalStateV4` contains `active_project_id`, `active_session_id`, `projects`, and optional `settings`, but no `sessions`. `PersistedProjectSessions` contains `project_id` and `sessions`. Source: `src/shared/project-session.ts:251-263`.
- `readGlobalState()` reads `global.json` and returns `DEFAULT_GLOBAL_STATE` on `ENOENT`. `readProjectSessions()` reads a project's `sessions.json` and returns `DEFAULT_PROJECT_SESSIONS` on `ENOENT`. `readAllProjectSessions(projects)` iterates persisted projects and concatenates all per-project sessions. Source: `src/core/state-store.ts:341-367`, `src/core/state-store.ts:369-430`.
- Writes are atomic through `writeJsonAtomically()`, which writes a temp file and replaces the target file. `writeGlobalState()` writes the global JSON and `writeProjectSessions()` writes the per-project session JSON. Source: `src/core/state-store.ts:243-315`, `src/core/state-store.ts:440-457`.

#### 3. ProjectSessionManager topology

- `ProjectSessionManager` owns a single in-memory `BootstrapState` plus settings and persistence bookkeeping. Source: `src/core/project-session-manager.ts:260-274`.
- `ProjectSessionManager.create()` reads persisted global state, maps persisted projects, loads all project sessions with `readAllProjectSessions`, resolves active IDs, builds the initial `BootstrapState`, then persists normalized state back out. Source: `src/core/project-session-manager.ts:276-299`.
- `snapshot()` returns a cloned `BootstrapState`. Source: `src/core/project-session-manager.ts:324-326`.
- `createProject()` inserts the project into state and, when persistence is enabled, attempts to import existing `<project>/.stoa/sessions.json` sessions into memory before persisting. Source: `src/core/project-session-manager.ts:342-379`.
- `createSession()` requires that the target project already exists, creates a `SessionSummary` with initial `runtimeState: 'created'`, `turnState: 'idle'`, `lastTurnOutcome: 'none'`, `summary: 'Waiting for session to start'`, pushes it into `state.sessions`, sets both active IDs to the new session/project, persists, and returns the new summary. Source: `src/core/project-session-manager.ts:483-529`.
- `archiveSession()`, `restoreSession()`, `setActiveSession()`, and `deleteProject()` mutate the same flat state and persist afterward. Source: `src/core/project-session-manager.ts:427-477`.
- `persist()` serializes writes through `persistChain`; `doPersist()` writes every project's filtered session list to `<project>/.stoa/sessions.json` and writes the project list plus active IDs/settings to `global.json`. Source: `src/core/project-session-manager.ts:668-726`.

#### 4. Runtime manager and runtime controller

- `startSessionRuntime()` is the runtime launcher. It installs provider sidecars, decides resume-versus-start, marks runtime starting, starts the PTY, forwards terminal data through `manager.appendTerminalData`, and marks runtime alive or failed/exited. Source: `src/core/session-runtime.ts:66-185`.
- `SessionRuntimeController` is the main-process adapter implementing the runtime manager interface over `ProjectSessionManager`. After each runtime/provider state mutation it calls `finishSessionStateChange(sessionId)`, which pushes `session:event`, pushes observability snapshots, and calls an optional callback. Source: `src/main/session-runtime-controller.ts:27-73`, `src/main/session-runtime-controller.ts:118-166`.
- Terminal output is batched and pushed over `terminal:data`. Source: `src/main/session-runtime-controller.ts:75-112`.

#### 5. IPC channels and exposed renderer API

- The IPC registry includes `project:bootstrap`, `session:create`, `session:set-active`, `session:archive`, `session:restore`, `session:restart`, `session:terminal-replay`, `session:event`, `terminal:data`, and observability channels. Source: `src/core/ipc-channels.ts:1-40`.
- Preload exposes `getBootstrapState()`, `createSession()`, `setActiveSession()`, `archiveSession()`, `restoreSession()`, `restartSession()`, `getTerminalReplay()`, and `onSessionEvent()` on `window.stoa`. Source: `src/preload/index.ts:58-107`, `src/preload/index.ts:168-221`.
- In `main/index.ts`, `project:bootstrap` returns `projectSessionManager.snapshot()` (or an empty bootstrap object if the manager is unavailable). Source: `src/main/index.ts:1251-1259`.
- In `main/index.ts`, `session:create` calls `createWorkSessionWithRuntime(payload)` and returns the resulting `SessionSummary`. Source: `src/main/index.ts:1295-1302`.
- `createWorkSessionWithRuntime()` delegates to `projectSessionManager.createSession(payload)`, then runs `syncObservabilityAndPushForSession(session.id)`, `syncUpdateStateToWindow()`, and starts runtime asynchronously with `launchSessionRuntimeWithGuard(session.id, 'session-create', { awaitDimensions: true })`. Source: `src/main/index.ts:1060-1069`.

#### 6. How a newly created session becomes visible to the frontend today

- On mount, the renderer subscribes to `window.stoa.onSessionEvent(...)`, then fetches bootstrap state with `window.stoa.getBootstrapState()`, and hydrates the Pinia workspace store. Source: `src/renderer/app/App.vue:211-235`.
- The `handleSessionCreate()` action calls `window.stoa.createSession(...)`, checks the returned value, then immediately runs `workspaceStore.addSession(created)` and `workspaceStore.setActiveSession(created.id)`. Source: `src/renderer/app/App.vue:69-85`.
- `workspaceStore.addSession()` simply pushes the returned `SessionSummary` into `sessions` and derives local presence from the summary. Source: `src/renderer/stores/workspaces.ts:265-268`, `src/renderer/stores/workspaces.ts:277-302`.
- Later runtime/provider changes are delivered by `session:event`; the renderer listener applies them with `workspaceStore.updateSession(event.session.id, event.session)`. Source: `src/renderer/app/App.vue:224-226`, `src/renderer/stores/workspaces.ts:270-275`, `src/main/session-runtime-controller.ts:124-136`.
- Therefore the current visibility path for a newly created work session is:
  1. backend create and persist through `ProjectSessionManager.createSession()`;
  2. `session:create` returns the created `SessionSummary`;
  3. renderer inserts it into the store with `addSession`;
  4. subsequent state changes are synchronized by `session:event`.
  Source: `src/core/project-session-manager.ts:483-529`, `src/main/index.ts:1295-1302`, `src/renderer/app/App.vue:69-85`, `src/main/session-runtime-controller.ts:124-136`.
- Gap identified: there is no separate “session created” push channel for work sessions in the inspected IPC registry. The renderer depends on the `session:create` invoke result for initial insertion, not on a creation event broadcast. Source: `src/core/ipc-channels.ts:1-40`, `src/renderer/app/App.vue:69-85`.

#### 7. Test evidence for the current flow

- IPC bridge tests verify `getBootstrapState()` round-trips bootstrap state and `createSession()` returns a real `SessionSummary`; they also verify that after creation, a later `getBootstrapState()` contains the new session. Source: `tests/e2e/ipc-bridge.test.ts:439-449`, `tests/e2e/ipc-bridge.test.ts:477-492`, `tests/e2e/ipc-bridge.test.ts:515-536`.
- Frontend store projection tests verify that adding a created session to the store is an explicit store operation (`store.addSession({ ...session })`) and that the grouped hierarchy is derived from the store state. Source: `tests/e2e/frontend-store-projection.test.ts:590-611`, `tests/e2e/frontend-store-projection.test.ts:613-635`.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Work-session entity definitions and bootstrap shape | `src/shared/project-session.ts` | `39-46`, `113-145`, `265-286` |
| Renderer hierarchy groups sessions under projects | `src/renderer/stores/workspaces.ts` | `11-15`, `64-87` |
| Global and project session file paths | `src/core/state-store.ts` | `46-52` |
| Global state excludes sessions; per-project sessions wrapper contains sessions | `src/shared/project-session.ts` | `251-263` |
| Global/project session reads and aggregate hydration | `src/core/state-store.ts` | `341-430` |
| Atomic persistence implementation | `src/core/state-store.ts` | `243-315`, `440-457` |
| ProjectSessionManager boot hydration | `src/core/project-session-manager.ts` | `276-299` |
| Project import reads existing per-project sessions | `src/core/project-session-manager.ts` | `342-379` |
| Session creation mutates in-memory state and persists | `src/core/project-session-manager.ts` | `483-529` |
| Persist writes all project session files and global state | `src/core/project-session-manager.ts` | `668-726` |
| Runtime launcher responsibilities | `src/core/session-runtime.ts` | `66-185` |
| Runtime controller pushes `session:event` and observability updates | `src/main/session-runtime-controller.ts` | `27-73`, `118-166` |
| Session-related IPC registry | `src/core/ipc-channels.ts` | `1-40` |
| Preload exposes session/bootstrap APIs and event listeners | `src/preload/index.ts` | `58-107`, `168-221` |
| Main process bootstrap and session-create handlers | `src/main/index.ts` | `1060-1069`, `1251-1259`, `1295-1302` |
| Renderer inserts created session from invoke result and later applies session events | `src/renderer/app/App.vue` | `69-85`, `211-235` |
| Store insertion and session update behavior | `src/renderer/stores/workspaces.ts` | `89-99`, `265-302` |
| IPC bridge test coverage for bootstrap/createSession | `tests/e2e/ipc-bridge.test.ts` | `439-449`, `477-492`, `515-536` |
| Store test coverage for explicit `addSession` path | `tests/e2e/frontend-store-projection.test.ts` | `590-611`, `613-635` |

### Risks / Unknowns
- Unknown: this report did not trace meta-session internals beyond noting that they exist on separate IPC channels. The user request asked for backend session/runtime/state/IPC topology for work sessions; meta-session topology would need a separate bounded pass if sub sessions are expected to build on that path. Evidence inspected: `src/core/ipc-channels.ts:17-28`, `src/preload/index.ts:108-140`.
- Unknown: no inspected code shows an existing backend concept named “sub session”. Any upgrade for sub sessions is a new topology, not an extension point already named in the current work-session model.

## Context Handoff: Session Backend Topology

Start here: `research/2026-05-29-session-backend-topology.md`

Context only. Use the saved report as the source of truth.
