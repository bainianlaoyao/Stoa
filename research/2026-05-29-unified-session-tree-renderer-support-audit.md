---
date: 2026-05-29
topic: unified-session-tree renderer-support audit
status: completed
mode: context-gathering
sources: 23
---

## Context Report: Unified Session Tree Renderer Support Audit

### Why This Was Gathered
Bounded audit of renderer-facing support layers (store/composable/preload/shared types) needed to implement the unified session tree per `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` in the `feature/unified-session-tree` worktree.

### Summary
The shared types and workspaces store are mostly aligned with the spec. `SessionSummary` carries `parentSessionId`/`createdBySessionId`, `SessionGraphEvent`/`SessionNodeSnapshot`/`SessionTreeMeta` exist, and the store has `upsertSession` + `applySessionGraphEvent`. However, the preload has a critical bug (wrong IPC channel for `onSessionGraphEvent`), the `projectHierarchy` tree projection is still flat, the hierarchy panel renders flat sessions with no tree indentation, and several IPC channels for session control (prompt/destroy/inspect) are absent.

---

## Implemented Items (Spec Alignment)

### 1. Session Model — Shared Types
| Spec requirement | Implementation | Location |
|---|---|---|
| `SessionSummary` with `parentSessionId` | `parentSessionId: string \| null` in interface | `src/shared/project-session.ts:125` |
| `SessionSummary` with `createdBySessionId` | `createdBySessionId: string \| null` in interface | `src/shared/project-session.ts:126` |
| `SessionTreeMeta` interface | `rootSessionId`, `depth`, `childCount`, `descendantCount` | `src/shared/project-session.ts:303-308` |
| `SessionNodeSnapshot` interface | `session: SessionSummary + tree: SessionTreeMeta` | `src/shared/project-session.ts:310-313` |
| `SessionGraphEvent` interface | `kind: 'created'\|'updated'\|'archived'\|'restored'\|'destroyed'`, `graphVersion`, `origin`, `initiatorSessionId`, `node: SessionNodeSnapshot` | `src/shared/project-session.ts:315-321` |
| `CreateSessionRequest` accepts `parentSessionId` | `parentSessionId?: string \| null` | `src/shared/project-session.ts:287` |
| `PersistedSession` has `parent_session_id` | snake_case field present | `src/shared/project-session.ts:168` |

### 2. Store — workspaces.ts
| Spec requirement | Implementation | Location |
|---|---|---|
| `upsertSession` semantics | Inserts unknown session or updates existing; calls `syncSessionPresenceFromSummary` | `src/renderer/stores/workspaces.ts:408-426` |
| `applySessionGraphEvent` with all 5 kinds | Switch over `created/updated/archived/restored/destroyed` | `src/renderer/stores/workspaces.ts:484-519` |
| renderer origin → setActiveSession | `if (origin === 'renderer') setActiveSession(incoming.id)` | `src/renderer/stores/workspaces.ts:490-493` |
| non-renderer origin → no active steal | `created` path does not call `setActiveSession` for non-renderer | `src/renderer/stores/workspaces.ts:489-494` |
| `reprojectSessions` as tree projection | `projectSessionsIntoTree(nextSessions, sessionTreeHints)` | `src/renderer/stores/workspaces.ts:405-406` |
| `sessionTreeHints` Map for host-supplied tree metadata | `sessionTreeHints = new Map<string, SessionTreeMeta>()` | `src/renderer/stores/workspaces.ts:181` |
| `fallbackTreeProjection` | Derives depth/root/childCount/descendantCount from parent chain | `src/renderer/stores/workspaces.ts:53-59` |
| live vs archived separation | `projectHierarchy` computes `sessions` (non-archived) vs `archivedSessions` | `src/renderer/stores/workspaces.ts:204-223` |
| archived subtree entries | `archivedSessions` includes `archived = true` sessions | `src/renderer/stores/workspaces.ts:211-216` |

### 3. IPC Channels — ipc-channels.ts
| Implementation | Location |
|---|---|
| `sessionGraphEvent: 'session:graph-event'` channel constant | `src/core/ipc-channels.ts:32` |
| `sessionCreate: 'session:create'` channel | `src/core/ipc-channels.ts:6` |
| `sessionArchive: 'session:archive'` channel | `src/core/ipc-channels.ts:12` |
| `sessionRestore: 'session:restore'` channel | `src/core/ipc-channels.ts:14` |

### 4. Preload — API surface
| Implementation | Location |
|---|---|
| `onSessionGraphEvent` declared in `RendererApi` (optional) | `src/shared/project-session.ts:375` |
| `onSessionEvent` declared in `RendererApi` | `src/shared/project-session.ts:374` |
| `createSession` accepts `CreateSessionRequest` with `parentSessionId` | `src/preload/index.ts:70-71` |
| `restoreSession` in preload API | `src/preload/index.ts:100-102` |
| `archiveSession` in preload API | `src/preload/index.ts:94-96` |

### 5. App.vue — Graph Event Integration
| Implementation | Location |
|---|---|
| Subscribes to `onSessionGraphEvent` when available | `src/renderer/app/App.vue:225-228` |
| Falls back to `onSessionEvent` for backwards compatibility | `src/renderer/app/App.vue:229-238` |
| Graph event handler calls `workspaceStore.applySessionGraphEvent` | `src/renderer/app/App.vue:227` |

### 6. Tests
| Coverage | Location |
|---|---|
| `upsertSession` inserts unknown child session | `src/renderer/stores/workspaces.test.ts:1374-1435` |
| Recursive hierarchy projection includes child session | `src/renderer/stores/workspaces.test.ts:1437-1517` |
| Archived tree section includes archived sessions | `src/renderer/stores/workspaces.test.ts:1519-1562` |
| Non-renderer origin does not steal active session | `src/renderer/stores/workspaces.test.ts:1564-1626` |
| `sessionSummaryFixture` includes `parentSessionId: null` | `src/renderer/stores/workspaces.test.ts:236-237` |

---

## Missing / Deviating Items

### [CRITICAL] BUG — Preload subscribes to wrong IPC channel for `SessionGraphEvent`

**Spec says:** `session:graph-event` push must arrive via `IPC_CHANNELS.sessionGraphEvent` ('session:graph-event')

**Implementation:** `onSessionGraphEvent` in preload binds to `IPC_CHANNELS.sessionEvent` ('session:event')

| Location | Evidence |
|---|---|
| `src/preload/index.ts:189-193` | `ipcRenderer.on(IPC_CHANNELS.sessionEvent, handler)` — wrong channel |

**Impact:** Renderer never receives `SessionGraphEvent` push events from main process because preload listens on the wrong IPC channel. The `SessionGraphEvent` broadcast from main lands on `session:event`, but `onSessionGraphEvent` is subscribed to `session:event` too — but the event shapes differ. This creates a silent failure where graph events are broadcast but not received.

**Fix:** Change line 191 in `src/preload/index.ts` from `IPC_CHANNELS.sessionEvent` to `IPC_CHANNELS.sessionGraphEvent`.

---

### [MAJOR] App.vue — Old `session:event` fallback still present

**Spec says:** "旧平面 `session:event` / `SessionSummaryEvent` push contract 删除，不保留并行双轨事件源" (old `session:event` push contract deleted, no parallel dual event source)

**Implementation:** `src/renderer/app/App.vue:229-238` still falls back to `onSessionEvent` when `onSessionGraphEvent` is absent.

**Impact:** The fallback path updates flat `SessionSummary` instead of `SessionNodeSnapshot`, bypassing tree metadata. In a mixed state (some main handlers send `session:event`, others send `session:graph-event`), the renderer will have inconsistent state.

---

### [MAJOR] Store — `projectHierarchy` does not use parent chain for tree projection

**Spec says:** "新投影必须改成：`Project → Root Sessions → Child Sessions` 递归树" (new projection must be Project → Root Sessions → Child Sessions recursive tree)

**Implementation:** `projectHierarchy` at `src/renderer/stores/workspaces.ts:202-225` computes two flat arrays per project:
- `sessions`: all non-archived sessions (no tree structure)
- `archivedSessions`: all archived sessions (no tree structure)

**Spec §4.2 requires:** Each project maintains two forests (`liveRoots`, `archivedRoots`) where archived roots are defined as archived sessions whose parent is absent, non-archived, or archived. Child sessions must appear as sub-nodes of their parent, not flattened.

**Current behavior:** All sessions at depth > 0 appear as siblings in the flat list with no indent, no parent-child visual hierarchy, no `treeDepth` used in the hierarchy output.

---

### [MAJOR] Store — Archived subtree rule not fully implemented

**Spec §4.2 says:** `archivedRoots` must include archived sessions where:
- `parentSessionId = null`, OR
- parent does not exist, OR
- parent exists but `parent.archived = false`

**Implementation:** `src/renderer/stores/workspaces.ts:211-216` only filters `archived === true` — does not check parent existence or parent archived status.

**Impact:** If a non-archived parent session has an archived child, the archived child appears in `archivedSessions` but its parent is still visible as a live session. The spec says this should produce a subtree entry at the archived root level.

---

### [MAJOR] WorkspaceHierarchyPanel — Renders flat sessions, no tree structure

**Spec says:** "每个 session row 至少显示：...是否 sub session 的层级缩进" (each session row shows whether it is a sub-session with tree indent)

**Implementation:** `src/renderer/components/command/WorkspaceHierarchyPanel.vue:403-463` uses `v-for="session in project.sessions"` — flat iteration. All sessions use the same `.route-item.child` class with hardcoded `padding-left: 20px`. No `treeDepth` used. No recursive rendering.

**Missing:**
- No `v-if="session.parentSessionId"` indent logic
- No `treeDepth` from `ProjectHierarchySessionNode` used for indentation multiplier
- No child count badge on parent session rows
- No expand/collapse toggle for parent sessions (only project collapse exists)
- Archived section not shown per spec §4.3

---

### [MAJOR] IPC — Missing session control channels

**Spec IPC design says:** Renderer needs:
- `session:prompt` — prompt a session
- `session:destroy` — destroy a session (subtree)
- `session:inspect` — inspect session metadata

**Implementation:** `src/core/ipc-channels.ts` has none of these.

**Current workaround:** `archiveSession` is used for session stop, but spec explicitly says "Destroy 是唯一主路径上的 stop/archive 动作" (Destroy is the only main-path stop/archive action). `archiveSession` is the old meta-session concept.

**Missing from preload `RendererApi`:**
- `promptSession(sessionId, text)` — line 375 is optional but never implemented
- `destroySession(sessionId)` — not in API
- `inspectSession(sessionId)` — not in API

---

### [MAJOR] WorkspaceHierarchyPanel — Session context menu lacks spec actions

**Spec says:** "用户在前端的 session row 上至少能执行：Create Child / Inspect / Prompt / Destroy / Restore"

**Implementation:** `src/renderer/components/command/WorkspaceHierarchyPanel.vue:116-143` context menu only has:
- Regenerate title
- Restart session

**Missing:** Create Child, Inspect, Prompt, Destroy (Restore already absent since archived section is not shown).

---

### [MINOR] IPC channels — Old meta-session channels still present

**Spec non-goal:** "不保留旧 `meta-session:*` IPC / store / surface 作为兼容层"

**Implementation:** `src/core/ipc-channels.ts:17-28` still exports `metaSession*` channels (bootstrap, create, set-active, archive, restore, event, proposal list/get/approve/reject/dispatch, inspector set target).

**Impact:** These channels are dead code. The spec says they should be removed as part of step 6.

---

### [MINOR] Preload — `onSessionGraphEvent` is optional in RendererApi

**Spec says:** `onSessionGraphEvent` is a required renderer capability, not optional.

**Implementation:** `onSessionGraphEvent?: (callback: ...) => void` in `src/shared/project-session.ts:375` — the `?` makes it optional.

**Impact:** Renderer code must check `if (window.stoa.onSessionGraphEvent)` before subscribing (which is done correctly in App.vue), but the type should reflect that this is a required capability for session tree rendering.

---

### [MINOR] Store — `projectSessionsIntoTree` does out-of-order resilience correctly but lacks explicit parent-link restoration

**Spec §4.1 says:** "parent 尚未到达时，允许先作为 pending node 存在。一旦 parent 到达，必须自动恢复 parent/child 链接。不允许把暂时缺 parent 的节点永久降级成平面孤立行"

**Implementation:** `src/renderer/stores/workspaces.ts:62-165` `projectSessionsIntoTree` uses `if (!session.parentSessionId || !sessionById.has(session.parentSessionId))` to detect root sessions. Sessions with unknown parents are treated as root, which satisfies the pending-node requirement.

**But:** No explicit "pending queue" for parent-arrival events. The current implementation merges into the root list when parent is unknown, then `reprojectSessions` is called again when `upsertSession` adds the parent. This works but is implicit rather than having a documented pending node pattern.

---

## Recommended Next Implementation Order (Renderer-Facing Focus)

### Phase 1 — Critical Bug Fixes (blocks all downstream)
1. **Fix preload `onSessionGraphEvent` wrong channel** (`src/preload/index.ts:191`) — change `IPC_CHANNELS.sessionEvent` to `IPC_CHANNELS.sessionGraphEvent`
2. **Remove App.vue old event fallback** (`src/renderer/app/App.vue:229-238`) — delete `onSessionEvent` fallback path

### Phase 2 — Store Tree Projection
3. **Update `projectHierarchy` to use parent chain** — compute `children[]` per session from `parentSessionId` map; derive tree depth; replace flat `sessions: SessionSummary[]` with nested `SessionTreeNode[]` (or add `children` array to each node)
4. **Implement archived subtree rules** — filter `archivedRoots` per spec §4.2 rules (parent null / parent missing / parent not archived)
5. **Expose `treeDepth` and `children` in `ProjectHierarchyNode`** — update type and derived computed

### Phase 3 — UI Component Updates
6. **Render recursive session tree in WorkspaceHierarchyPanel** — replace flat `v-for` with recursive tree rendering; indent by `treeDepth`; show child count badge on parent rows; add expand/collapse for sub-sessions
7. **Show archived section per spec §4.3** — collapsible archived section per project with tree structure
8. **Add missing session row actions** — Create Child, Inspect, Prompt, Destroy to context menu; Restore for archived rows

### Phase 4 — IPC Channel Completeness
9. **Add `session:prompt`, `session:destroy`, `session:inspect` IPC channels** — extend `ipc-channels.ts` and add handlers in main process
10. **Add `promptSession`, `destroySession`, `inspectSession` to preload `RendererApi`** — wire to new IPC channels

### Phase 5 — Cleanup
11. **Remove meta-session IPC channels** from `ipc-channels.ts` (step 6 per spec implementation order)
12. **Make `onSessionGraphEvent` non-optional in `RendererApi`** — remove `?` from type declaration

---

## Risks / Unknowns

| Item | Assessment |
|---|---|
| Backend hasn't been audited — main process may not send `SessionGraphEvent` via `session:graph-event` channel | [!] Backend code not reviewed in this pass. Even with preload fix, events may not be emitted. Needs separate audit. |
| `session:destroy` subtree semantics not verified | [!] Store has no `destroySession` action. Current `archiveSession` is not spec-equivalent. Backend must implement recursive subtree archive. |
| Bootstrap returns `SessionSummary[]` not `SessionNodeSnapshot[]` | [?] `getBootstrapState` returns `sessions: SessionSummary[]` per `src/shared/project-session.ts:273`. Spec §4 says bootstrap must return `SessionNodeSnapshot[]` with tree metadata. Current implementation relies on client-side `fallbackTreeProjection`. Needs backend audit. |
| Meta-session IPC channels still registered in main process | [?] Channels exist in `ipc-channels.ts` but not checked if handlers still registered in `src/main/index.ts`. Dead code vs active code needs verification. |