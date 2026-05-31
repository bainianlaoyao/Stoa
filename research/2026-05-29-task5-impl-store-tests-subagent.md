---
date: 2026-05-29
topic: Task 5 renderer/store RED-first test plan and fixture gaps
status: completed
mode: context-gathering
sources: 3
---

## Context Report: Task 5 Renderer/Store RED-First Test Plan

### Why This Was Gathered

Task 5 implementation requires adding `applySessionGraphEvent`, `upsertSession`, recursive tree projection, and non-renderer-origin no-focus-steal to the workspace store. Before writing implementation, the exact test infrastructure gaps and minimal RED test cases must be identified to drive TDD.

### Summary

The test file (`workspaces.test.ts`) has zero references to `parentSessionId`, `createdBySessionId`, `SessionTreeMeta`, `SessionNodeSnapshot`, or `SessionGraphEvent`. The `sessionSummaryFixture` omits both lineage fields, creating a compile error against the current `SessionSummary` type. 12 existing tests cover flat hydration, selection cascading, archive/restore, and observability — but nothing exercises graph events, tree projection, or origin-based focus behavior.

### Key Findings

#### Finding 1 — `sessionSummaryFixture` is a compile error

The fixture (lines 232–258) returns `SessionSummary` but omits `parentSessionId: string | null` and `createdBySessionId: string | null` — both required fields in the interface (`src/shared/project-session.ts:125–126`). Every inline session object in `hydrate()` calls throughout the test file has the same gap.

| Claim | Source | Location |
|-------|--------|----------|
| `SessionSummary` requires `parentSessionId` and `createdBySessionId` | `src/shared/project-session.ts` | lines 125–126 |
| Fixture omits both fields | `src/renderer/stores/workspaces.test.ts` | lines 232–258 |
| Zero references to `parentSessionId` in entire test file | `src/renderer/stores/workspaces.test.ts` | grep: 0 matches |

**Implication**: Before any new tests can be written, the fixture and all inline hydration objects must be fixed to include `{ parentSessionId: null, createdBySessionId: null }`. This is the first RED fix.

#### Finding 2 — Types already defined, not yet consumed

The shared types file already carries the full graph event vocabulary:

| Type | Location | Status |
|------|----------|--------|
| `SessionTreeMeta { rootSessionId, depth, childCount, descendantCount }` | `src/shared/project-session.ts:303–308` | Defined, unused in store |
| `SessionNodeSnapshot { session, tree }` | `src/shared/project-session.ts:310–313` | Defined, unused in store |
| `SessionGraphEvent { kind, graphVersion, origin, initiatorSessionId, node }` | `src/shared/project-session.ts:315–321` | Defined, unused in store |
| `SessionSummary.parentSessionId` | `src/shared/project-session.ts:125` | Defined, unused in hierarchy |
| `SessionSummary.createdBySessionId` | `src/shared/project-session.ts:126` | Defined, unused in hierarchy |

#### Finding 3 — Type changes still needed

| Gap | What's Missing | Where to Add |
|-----|----------------|-------------|
| `RendererApi.onSessionGraphEvent` | No IPC channel for `SessionGraphEvent` delivery | `src/shared/project-session.ts:356–451` (`RendererApi`) |
| `ProjectHierarchyNode` children field | `sessions` is flat `Array<SessionSummary & { active: boolean }>`, no recursive nesting | `src/renderer/stores/workspaces.ts:11–15` |
| `SessionTreeNode` or equivalent | No type for a tree node with `children: SessionTreeNode[]` | New type or augment `ProjectHierarchyNode` |

#### Finding 4 — Current store API (relevant subset)

| Method | Behavior | Lines |
|--------|----------|-------|
| `hydrate(BootstrapState)` | Sets projects, sessions, active IDs | 89–99 |
| `addSession(SessionSummary)` | Pushes to `sessions.value`, syncs presence | 265–268 |
| `updateSession(id, patch)` | Finds session, `Object.assign`, syncs presence | 270–275 |
| `archiveSession(id)` | Sets `archived=true`, clears active if matched | 308–315 |
| `restoreSession(id)` | Sets `archived=false` | 317–320 |
| `setActiveSession(id)` | Sets `activeSessionId` + cascades `activeProjectId` | 238–246 |
| `projectHierarchy` computed | Flat filter by projectId, split archived/non-archived | 64–87 |

None of these use `parentSessionId` for tree derivation.

#### Finding 5 — `projectHierarchy` shape (current)

```typescript
ProjectHierarchyNode extends ProjectSummary {
  active: boolean
  sessions: Array<SessionSummary & { active: boolean }>       // non-archived, flat
  archivedSessions: Array<SessionSummary & { active: boolean }> // archived, flat
}
```

No `children` field. No nesting. No depth awareness.

#### Finding 6 — `meta-session.ts` provides the upsert pattern

`src/renderer/stores/meta-session.ts:104–116` shows the canonical `upsertSession` pattern:
- `findIndex` to check existence
- If not found: `[...sessions.value, cloneSession(session)]`
- If found: `sessions.value.slice(); next[index] = cloneSession(session)`
- Then side-effect (sync proposal counts)

This is the exact pattern to replicate for workspace store's `upsertSession`, with `syncSessionPresenceFromSummary` as the side-effect.

#### Finding 7 — Existing test structure

12 tests organized in:
- Root describe `project/session renderer store` (3 tests: hydration, selection cascading, hierarchy derivation)
- Nested `archive and restore` (3 tests: derivation, archive, restore)
- Nested `observability` (9 tests: hydration, subscriptions, authority, stale rejection, backfill)

Total: ~15 test blocks. Zero coverage for graph events, tree projection, or origin-based focus.

#### Finding 8 — `createStoaMock` has no graph event mock

The `createStoaMock` function (lines 21–134) mocks all current `RendererApi` methods but has no `onSessionGraphEvent`. This must be extended when `RendererApi` gains the new method.

### Risks / Unknowns

- **[!] Compile error**: The test file likely does not compile currently due to the missing `parentSessionId`/`createdBySessionId` in `sessionSummaryFixture` and all inline hydration objects. Fixing this is prerequisite to any new tests.
- **[?]** Whether `ProjectHierarchyNode.sessions` should become `SessionTreeNode[]` (recursive) or keep the flat array and add a parallel `sessionTree` computed is an open design choice. The prior research (`task5-renderer-sync-store-panel-subagent.md`) flagged this as unspecified.
- **[?]** Whether `applySessionGraphEvent` should be called from within `hydrateObservability` (extending existing subscription wiring) or as a standalone subscription initialized separately.

### Minimal RED-First Test Cases

These tests should be written FIRST (RED phase) before any store implementation changes:

#### Prerequisite — Fix `sessionSummaryFixture`

Add `parentSessionId: null, createdBySessionId: null` to the fixture and all inline hydration session objects.

#### Test Case 1: `applySessionGraphEvent` with `kind: 'created'` inserts new session

```
Given: hydrated store with one project, no sessions
When:  applySessionGraphEvent({ kind: 'created', node: { session: {...}, tree: {...} } })
Then:  store.sessions includes the new session
       projectHierarchy[0].sessions includes the new session node
```

#### Test Case 2: `applySessionGraphEvent` with `kind: 'updated'` patches existing

```
Given: hydrated store with session 's1' (runtimeState: 'alive', turnState: 'running')
When:  applySessionGraphEvent({ kind: 'updated', node: { session: { id: 's1', runtimeState: 'alive', turnState: 'idle', ... } } })
Then:  store.sessions[0].turnState === 'idle'
```

#### Test Case 3: `applySessionGraphEvent` with `kind: 'archived'` archives and clears active

```
Given: hydrated store with activeSessionId === 's1'
When:  applySessionGraphEvent({ kind: 'archived', node: { session: { id: 's1', archived: true, ... } } })
Then:  session 's1'.archived === true
       projectHierarchy[0].sessions excludes 's1'
       projectHierarchy[0].archivedSessions includes 's1'
       activeSessionId === null
```

#### Test Case 4: `applySessionGraphEvent` with `kind: 'restored'` un-archives

```
Given: hydrated store with archived session 's1'
When:  applySessionGraphEvent({ kind: 'restored', node: { session: { id: 's1', archived: false, ... } } })
Then:  session 's1'.archived === false
       projectHierarchy[0].sessions includes 's1'
```

#### Test Case 5: `applySessionGraphEvent` with `kind: 'destroyed'` removes session

```
Given: hydrated store with session 's1'
When:  applySessionGraphEvent({ kind: 'destroyed', node: { session: { id: 's1', ... } } })
Then:  store.sessions does not include 's1'
```

#### Test Case 6: Non-renderer origin does not steal active session (no-focus-steal)

```
Given: hydrated store with activeSessionId === 's1' (alive, running)
When:  applySessionGraphEvent({ kind: 'created', origin: 'session', node: { session: { id: 's2', parentSessionId: 's1', ... } } })
Then:  activeSessionId remains 's1' (not 's2')
```

#### Test Case 7: Renderer origin updates active session

```
Given: hydrated store with activeSessionId === 's1'
When:  applySessionGraphEvent({ kind: 'created', origin: 'renderer', node: { session: { id: 's2', ... } } })
Then:  activeSessionId === 's2'
```

#### Test Case 8: Recursive tree projection via `parentSessionId`

```
Given: hydrated store with:
         project 'p1',
         session 's1' (parentSessionId: null),
         session 's2' (parentSessionId: 's1')
When:  reading projectHierarchy
Then:  projectHierarchy[0].sessions contains a tree node for 's1'
       tree node for 's1' has children containing 's2'
       's2' does NOT appear at the top level
```

This test requires `ProjectHierarchyNode.sessions` to become a tree structure (e.g., `SessionTreeNode[]` with `children`).

#### Test Case 9: Archived sessions render in separate archived tree section

```
Given: hydrated store with:
         session 's1' (parentSessionId: null, archived: true),
         session 's2' (parentSessionId: 's1', archived: true)
When:  reading projectHierarchy
Then:  projectHierarchy[0].archivedSessions contains tree node for 's1'
       tree node for 's1' has children containing 's2'
```

### Recommended Test Order

1. Fix `sessionSummaryFixture` (compile error blocker)
2. Test cases 1–5 (core `applySessionGraphEvent` CRUD)
3. Test cases 6–7 (origin-based focus behavior)
4. Test cases 8–9 (recursive tree projection — requires `ProjectHierarchyNode` type change)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `sessionSummaryFixture` missing lineage fields | `workspaces.test.ts` | lines 232–258 |
| Zero `parentSessionId` references in test | `workspaces.test.ts` | grep: 0 matches |
| `SessionGraphEvent` type defined | `project-session.ts` | lines 315–321 |
| `RendererApi` has no `onSessionGraphEvent` | `project-session.ts` | lines 356–451 |
| `ProjectHierarchyNode` has no `children` | `workspaces.ts` | lines 11–15 |
| `projectHierarchy` flat filter | `workspaces.ts` | lines 64–87 |
| `upsertSession` pattern in meta-session store | `meta-session.ts` | lines 104–116 |
| `createStoaMock` has no graph event mock | `workspaces.test.ts` | lines 21–134 |

## Context Handoff: Task 5 Renderer/Store RED-First Test Plan

Start here: `D:\Data\DEV\ultra_simple_panel\.worktrees\unified-session-tree\research\2026-05-29-task5-impl-store-tests-subagent.md`

Context only. Use the saved report as the source of truth.
