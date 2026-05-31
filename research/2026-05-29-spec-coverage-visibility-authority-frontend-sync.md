---
date: 2026-05-29
topic: unified-session-tree spec coverage audit for visibility, authority, and frontend sync
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Unified Session Tree Spec Coverage Audit

### Why This Was Gathered

Audit whether the unified session tree implementation plan (the closest spec document, at `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md`) and its partially-implemented codebase fully cover three requirements:

1. A session using `stoa-ctl` can only see same-tree same-depth peers plus all descendants.
2. Sub-sessions obey the same tree-local peer/descendant visibility.
3. Sessions created by `stoa-ctl` must sync to the frontend so users can inspect/manage subsessions.

### Summary

Requirements 1 and 2 are fully covered in both the plan and the committed implementation. Requirement 3 has a gap: the plan mentions `SessionGraphEvent` as a shared type and store `upsertSession` in Task 5 prose, but does not specify the IPC channel, the `RendererApi` contract extension, or the control-server-to-renderer wiring needed to push graph events when `stoa-ctl session create` fires. Without these three elements, CLI-created sessions will persist to disk but never appear in the renderer.

### Key Findings

- **Req 1 (same-tree same-depth + descendants):** Fully covered. `SessionVisibilityService.visibleSessionIds` implements the algorithm; tests confirm same-depth peers, descendants, cross-tree isolation, and ancestor exclusion.
- **Req 2 (subsessions use same rules):** Fully covered. The visibility service is depth-agnostic — it uses the node's own `depth` and `rootSessionId`. The `session-command-env` propagation gives child sessions their own identity. Authority checks (`create` = self only, `destroy` = self + descendants) apply uniformly at any depth.
- **Req 3 (frontend sync for stoa-ctl sessions):** Partial gap. The plan's Task 5 mentions "store upsertSession and recursive tree projection" and Task 6 mentions "background child session visibility in renderer", but three critical sub-specifications are missing from the plan.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Visibility algorithm: same-root + same-depth-or-descendant | Implementation | `src/core/session-visibility-service.ts:19-41` |
| Test: same-depth peers and descendants visible | Test | `src/core/session-visibility-service.test.ts:59-71` |
| Test: leaf sees siblings only, not parent | Test | `src/core/session-visibility-service.test.ts:83-96` |
| Test: cross-tree isolation | Test | `src/core/session-visibility-service.test.ts:98-111` |
| Authority: create=self, destroy=self+descendants, inspect/prompt=visible | Implementation | `src/core/session-visibility-service.ts:48-85` |
| Test: destroy same-depth peer rejected | Test | `src/core/session-visibility-service.test.ts:190-200` |
| Test: destroy descendant allowed | Test | `src/core/session-visibility-service.test.ts:180-188` |
| Supervisor filters list via visibility for session callers | Implementation | `src/core/session-supervisor.ts:40-47` |
| Control server routes through supervisor | Implementation | `src/core/session-control-server.ts:108-112` |
| CLI resolves session identity from env vars | Implementation | `tools/stoa-ctl/index.ts:76-98` |
| Child sessions get own STOA_SESSION_ID + token via env | Implementation | `src/core/session-command-env.ts:12-24` |
| **GAP: No `sessionGraphEvent` IPC channel** | IPC channels | `src/core/ipc-channels.ts` — no `sessionGraphEvent` entry |
| **GAP: RendererApi has no graph event listener** | Shared types | `src/shared/project-session.ts:356-395` — no `onSessionGraphEvent` |
| **GAP: Store has no upsertSession or tree projection** | Store | `src/renderer/stores/workspaces.ts:64-87` — flat `projectHierarchy`, no tree nesting |
| **GAP: Control server createChildSession has no renderer push** | Control server | `src/core/session-control-server.ts:189-291` — no graph event emission after create |
| **GAP: main/index.ts does not wire SessionControlServer** | Main process | `src/main/index.ts` — imports `createMetaSessionControlServer` only |
| Plan mentions SessionGraphEvent shared type | Plan | `docs/superpowers/plans/.../2026-05-29-...md:83-84,118` |
| Plan mentions store upsertSession and tree projection | Plan | `docs/superpowers/plans/.../2026-05-29-...md:349` |
| Plan mentions background child visibility in renderer | Plan | `docs/superpowers/plans/.../2026-05-29-...md:387` |
| SessionGraphEvent type defined in shared types | Shared types | `src/shared/project-session.ts:315-321` |
| Existing session creation does sync via syncUpdateStateToWindow | Main process | `src/main/index.ts:1060-1069` |

### Detailed Gap Analysis for Requirement 3

The plan's Task 4 Step 3 (`docs/superpowers/plans/.../2026-05-29-...md:283-289`) says:

> "Implement: session supervisor, unified control server, CLI rewrite to session commands, prompt/env services, main/index.ts wiring away from meta-session stack"

This line should also specify that `main/index.ts` wiring must:

1. **Add an IPC channel** for `SessionGraphEvent` in `src/core/ipc-channels.ts` (e.g., `sessionGraphEvent: 'session:graph-event'`).
2. **Extend `RendererApi`** in `src/shared/project-session.ts:356` to include `onSessionGraphEvent: (callback: (event: SessionGraphEvent) => void) => () => void`.
3. **Wire the control server's `createChildSession` dep** to emit a `SessionGraphEvent(kind='created', origin='session', node)` via `mainWindow.webContents.send()` after the manager creates the session — analogous to how `createWorkSessionWithRuntime` calls `syncUpdateStateToWindow()` at `src/main/index.ts:1067`.
4. **Add `upsertSession` and `applySessionGraphEvent`** to the Pinia store (`src/renderer/stores/workspaces.ts`) with recursive tree projection that nests children under parents.
5. **Add a preload bridge listener** in `src/preload/index.ts` for the new graph-event channel.

The plan's Task 5 Step 1 (`docs/superpowers/plans/.../2026-05-29-...md:331-337`) tests "upserts unknown child session from graph event", which implies these pieces exist, but the plan's file list and step descriptions never explicitly list the IPC channel, RendererApi extension, or main-wiring emission. This leaves an implementer without a concrete specification for the sync path.

### Recommended Amendments

1. **`docs/superpowers/plans/.../2026-05-29-...md` Task 4 Step 3** — Add: "Add `sessionGraphEvent` IPC channel to `ipc-channels.ts`. Extend `RendererApi` with `onSessionGraphEvent`. Wire `SessionControlServer.createChildSession` to emit `SessionGraphEvent(kind='created')` via `mainWindow.webContents.send()`."
2. **`docs/superpowers/plans/.../2026-05-29-...md` Task 5 File List** — Add: `src/core/ipc-channels.ts` and `src/shared/project-session.ts` (RendererApi extension).
3. **`docs/superpowers/plans/.../2026-05-29-...md` Task 5 Step 3** — Add explicit item: "Add preload bridge `onSessionGraphEvent` forwarding to the new IPC channel."

### Risks / Unknowns

- [!] Without the graph-event emission wiring, all sessions created via `stoa-ctl session create` will be invisible to the renderer until the next app restart (which re-reads persisted state).
- [?] The existing `SessionSummaryEvent` (at `src/shared/project-session.ts:299-301`) carries a `SessionSummary` only, not a `SessionNodeSnapshot`. Reusing this channel would lose tree metadata. A new dedicated channel is safer.
- [?] The `projectHierarchy` computed in `workspaces.ts:64-87` is a flat project-to-sessions projection with no parent-child nesting. Task 5 must also specify the recursive tree projection data structure that the renderer components will consume.
