---
date: 2026-05-29
topic: unified-session-tree research-coverage audit — same-tree same-depth-plus-descendants visibility, sub-session same rule, and frontend sync for stoa-ctl-created sessions
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Unified Session Tree — Research Coverage Audit Against Three Requirements

### Why This Was Gathered

Audit whether existing research reports and shared contract docs support or reveal gaps relative to three concrete requirements of the unified session tree feature:
1. **Same-tree same-depth-plus-descendants visibility**: a viewer session sees itself, all peers at the same tree depth, and all descendants (deeper nodes linked by ancestry).
2. **Sub-session same rule**: sub-sessions (depth > 0) follow the same visibility contract as root sessions.
3. **Frontend sync for `stoa-ctl`-created sessions**: background child sessions created via CLI (`stoa-ctl session create`) appear in the renderer session tree without manual user action.

The reference spec `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md` does not exist. The implementation plan `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` is used as the authoritative spec source.

---

### Summary

Requirements 1 and 2 are **fully covered** — the `SessionVisibilityService` exists, is tested, and implements the exact "same-depth-plus-descendants" rule for both root and sub-sessions. Requirement 3 has a **spec gap**: no document specifies the event emission path from `SessionControlServer.createChildSession` to the renderer's IPC subscription. The research reports correctly identify this as a code gap (missing `IPC_CHANNELS.sessionGraphEvent` channel, no `onSessionGraphEvent` in preload, no `applySessionGraphEvent` in the store), but the spec does not include the event emission requirement at all. A spec amendment is needed.

---

## Requirement 1: Same-Tree Same-Depth-Plus-Descendants Visibility

### Specification (from implementation plan, Task 3)

> "visibility and authority calculation service" — same-depth-plus-descendants visible set, invisible targets collapse to `unknown_session`

The plan spec for `SessionVisibilityService` at Task 3 Step 3 (line 224 of the plan doc):
> "Implement: visibility and authority calculation service"

The plan test at Task 3 Step 1 (line 210-213):
```ts
test('returns same-depth peers and descendants for visibility scope', () => {
  const service = new SessionVisibilityService(sessionNodes)
  expect(service.visibleSessionIds('session-A')).toEqual(['session-A', 'session-B', 'session-A1'])
})
```

### Coverage Assessment: FULLY COVERED

**Code exists and matches spec exactly:**

`src/core/session-visibility-service.ts:19-41` — `visibleSessionIds(sessionId)`:
```ts
for (const candidate of this.nodes) {
  if (candidate.tree.rootSessionId !== rootSessionId) {
    continue
  }
  if (candidate.tree.depth === targetDepth || candidate.tree.depth > targetDepth) {
    if (candidate.tree.depth === targetDepth || this.isDescendantOf(candidate, sessionId)) {
      visible.push(candidate.session.id)
    }
  }
}
```

The algorithm:
1. Restricts to same `rootSessionId` tree (no cross-tree leakage)
2. Includes sessions at `targetDepth` (same-depth peers including self)
3. Includes sessions at `depth > targetDepth` only if they are a descendant of the viewer

**Test coverage (`src/core/session-visibility-service.test.ts`):**

| Test | Location | What it verifies |
|------|----------|-----------------|
| returns self for a single root session | line 53 | root at depth 0 sees only self |
| returns same-depth peers and descendants for a mid-tree session | line 59 | A at depth 1 sees A, B, A1, A2 |
| root sees all sessions at depth 0 plus their descendants | line 73 | root sees root + children + grandchildren |
| leaf session sees its same-depth siblings but not parent | line 83 | A1 at depth 2 sees A1, A2, not A or root |
| does not expose same-depth peers from another session tree | line 98 | root-1's A cannot see root-2's B |
| allows inspect on visible target | line 135 | inspect requires visibility |
| allows prompt on descendant | line 146 | prompt requires visibility |
| allows destroy on self | line 174 | self-destroy always allowed |
| allows destroy on descendant | line 180 | parent can destroy its descendants |
| rejects destroy on same-depth peer | line 190 | A cannot destroy B (same depth, not descendant) |
| rejects create on same-depth peer | line 202 | A cannot create B (same depth) |
| allows inspect on same-depth peer | line 214 | inspect allowed even on non-descendant peers |
| allows prompt on same-depth peer | line 224 | prompt allowed even on non-descendant peers |
| rejects ancestor targets as unknown_session | line 234 | A1 cannot see A (ancestor, outside visibility scope) |
| visibility failure for unknown targets | line 248 | unknown targets return `unknown_session` |

**All critical branches verified. No spec gaps.**

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionVisibilityService` exists | `src/core/session-visibility-service.ts` | entire file |
| `visibleSessionIds` algorithm matches spec | `src/core/session-visibility-service.ts` | :19-41 |
| `checkAuthority` enforces same rule | `src/core/session-visibility-service.ts` | :48-85 |
| All authority branches tested | `src/core/session-visibility-service.test.ts` | lines 134-245 |
| `SessionNodeSnapshot` has `tree: SessionTreeMeta` | `src/shared/project-session.ts` | :310-313 |
| `SessionTreeMeta` has `depth` and `rootSessionId` | `src/shared/project-session.ts` | :303-308 |
| Supervisor uses visibility service | `src/core/session-supervisor.ts` | :40-46, :49-62, :97-104 |
| Control server wires visibility service | `src/core/session-control-server.ts` | :7-13, :57 |

---

## Requirement 2: Sub-Session Same Rule

### Specification (from implementation plan)

The plan does not have a separate spec section for sub-sessions. The "same-depth-plus-descendants" rule applies uniformly regardless of depth. A sub-session (depth > 0) should see: itself, its same-depth siblings (other children of the same parent), and its own descendants.

### Coverage Assessment: FULLY COVERED

**Code implements the rule uniformly — no depth special cases:**

`session-visibility-service.ts:25-37` — same logic for all depths:
```ts
const targetDepth = node.tree.depth
// includes same-depth peers
// then includes deeper nodes only if descendant
```

**Test for leaf (depth=2) sub-session (`session-visibility-service.test.ts:83-96`):**
```ts
test('leaf session sees its same-depth siblings but not parent', () => {
  const nodes = [
    node('root', null, 0),
    node('A', 'root', 1, undefined, { rootSessionId: 'root' }),
    node('B', 'root', 1, undefined, { rootSessionId: 'root' }),
    node('A1', 'A', 2, undefined, { rootSessionId: 'root' }),
    node('A2', 'A', 2, undefined, { rootSessionId: 'root' }),
  ]
  const service = new SessionVisibilityService(nodes)
  const visible = service.visibleSessionIds('A1')
  expect(visible).toEqual(expect.arrayContaining(['A1', 'A2']))
  expect(visible).not.toContain('A')     // parent — NOT included
  expect(visible).not.toContain('root')   // grandparent — NOT included
})
```

This confirms:
- A1 (depth 2) sees A1 and A2 (same depth, siblings under parent A)
- A1 does NOT see A (parent, depth 1 < target depth)
- A1 does NOT see root (ancestor, depth 0 < target depth)

**Authority check also uniform for sub-sessions** — `checkAuthority` at line 76-84: only self and descendants allowed for `destroy`, same rule applies at all depths.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Leaf sub-session test exists and passes | `src/core/session-visibility-service.test.ts` | :83-96 |
| `visibleSessionIds` has no depth special cases | `src/core/session-visibility-service.ts` | :19-41 |
| `checkAuthority` same logic at all depths | `src/core/session-visibility-service.ts` | :48-85 |
| `destroy` allows descendant at any depth | `src/core/session-visibility-service.test.ts` | :180-188 |
| `reject ancestor targets` test at leaf depth | `src/core/session-visibility-service.test.ts` | :234-245 |

---

## Requirement 3: Frontend Sync for `stoa-ctl`-Created Sessions

### Specification (from implementation plan)

Task 4 plan (line 261-267 of plan doc) specifies `session create` CLI command → `POST /ctl/session/create` → `supervisor.createChildSession`. Task 5 plan (line 347-352) specifies the renderer must "upsert unknown child sessions from `SessionGraphEvent`" so they "appear in the frontend."

The plan defines `SessionGraphEvent` with `kind: 'created'` and `origin: 'local-cli'` (`src/shared/project-session.ts:315-321`).

**Critical gap in spec**: No document specifies that the backend must emit `SessionGraphEvent` via IPC to the renderer after a CLI-initiated creation. The spec defines the event type and the store's handling, but not the emission requirement.

### Coverage Assessment: PARTIALLY COVERED — Spec gap identified

**Code that exists (correctly):**

1. `SessionGraphEvent` type defined (`src/shared/project-session.ts:315-321`)
2. `SessionControlServer` handles `POST /ctl/session/create` (`src/core/session-control-server.ts:189-291`)
3. `SessionSupervisor.createChildSession` creates the session (`src/core/session-supervisor.ts:74-87`)
4. CLI sends correct headers and calls correct route (`tools/stoa-ctl/index.ts:130-145, 261-296`)

**Code gap (correctly identified by research reports):**

The backend creates the session but does not emit a `SessionGraphEvent` to the renderer. Research reports confirm this:

| Report | Finding | Location in report |
|--------|---------|--------------------|
| `2026-05-29-task5-renderer-sync-store-panel-subagent.md` | Finding 1: No `SessionGraphEvent` IPC channel or preload bridge method | line 22-30 |
| `2026-05-29-task5-renderer-sync-main-subagent.md` | Finding 3: No `SessionGraphEvent` IPC channel exists | line 56-70 |
| `2026-05-29-task4-control-plane-gaps-session-server.md` | G1: main/index.ts not wired to unified control server | line 29-39 |

The specific code gap: `session-control-server.ts:224` calls `supervisor.createChildSession`, which creates the session in the backend persistence layer, but no code path emits `IPC_CHANNELS.sessionGraphEvent` with `kind: 'created'` to the renderer window.

**Spec gap: the implementation plan does not document the event emission requirement.**

The plan's Task 5 (renderer sync) lists store and preload changes but does not include a step for "backend emits `SessionGraphEvent` on `createChildSession`." The control server implementation plan (Task 4) does not include "emit renderer event on session creation." This gap was found by research but is not in the spec itself.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `SessionGraphEvent` defined with `kind`, `node`, `origin` | `src/shared/project-session.ts` | :315-321 |
| `SessionNodeSnapshot` pairs session with tree meta | `src/shared/project-session.ts` | :310-313 |
| `SessionSummary` has `parentSessionId` and `createdBySessionId` | `src/shared/project-session.ts` | :125-126 |
| Control server handles create route | `src/core/session-control-server.ts` | :189-291 |
| Supervisor `createChildSession` delegates to deps | `src/core/session-supervisor.ts` | :74-87 |
| CLI sends correct create request | `tools/stoa-ctl/index.ts` | :261-296 |
| CLI sends token header | `tools/stoa-ctl/index.ts` | :130-145 |
| No `sessionGraphEvent` in `IPC_CHANNELS` | `src/core/ipc-channels.ts` | entire file |
| No `onSessionGraphEvent` in `RendererApi` | `src/shared/project-session.ts` | :356-451 |
| No `onSessionGraphEvent` in preload | `src/preload/index.ts` | entire file |
| Store `updateSession` drops unknown sessions | `src/renderer/stores/workspaces.ts` | :270-275 |
| Store has no `applySessionGraphEvent` | `src/renderer/stores/workspaces.ts` | entire store |
| Research correctly identifies the gap | `research/2026-05-29-task5-renderer-sync-*.md` | passim |
| Spec does NOT document emission requirement | `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md` | missing |

---

## Spec Amendment Required

The implementation plan's Task 4 section should be amended to include a **backend event emission step**. Specifically, after Step 3 ("Implement minimal unified backend control plane"), add:

> **Step 3b: Emit `SessionGraphEvent` on `createChildSession`**
>
> After `supervisor.createChildSession` succeeds, emit `IPC_CHANNELS.sessionGraphEvent` with `{ kind: 'created', origin: 'local-cli', initiatorSessionId: callerSessionId, node: snapshot }` to the renderer window. This requires:
> - Adding `sessionGraphEvent: 'session:graph-event'` to `IPC_CHANNELS`
> - Adding `onSessionGraphEvent` to `RendererApi` and the preload bridge
> - Wiring the emit into `main/index.ts` after `SessionControlServer` is wired
>
> Run: `rtk npx vitest run src/core/session-control-server.test.ts src/preload/index.test.ts`
> Expected: PASS (test should verify `sessionGraphEvent` emitted on create)

**Why this is a spec gap and not just a code gap**: The plan defines the event type (`SessionGraphEvent`) and the store's consumption of it (`applySessionGraphEvent`), but omits the critical bidirectional path: the backend must emit it. Without this spec step, a future implementer could complete all steps in the plan and still have broken frontend sync.

**Note**: The spec amendment also belongs in the Task 5 section, as the store's `applySessionGraphEvent` is meaningless without the event being delivered.

---

## Context Handoff: unified-session-tree research-coverage audit

Start here: `D:\Data\DEV\ultra_simple_panel\.worktrees\unified-session-tree\research\2026-05-29-research-coverage-unified-session-tree-requirements.md`

Context only. Use the saved report as the source of truth.

The report identifies:
- Requirements 1 and 2 are fully covered — no action needed
- Requirement 3 has a spec gap (missing event emission requirement in Task 4 plan) that the code gap research already correctly identified but the spec itself does not document
- The precise spec section to amend: Task 4 of `docs/superpowers/plans/2026-05-29-unified-session-tree-implementation.md`, after Step 3, add Step 3b for backend event emission