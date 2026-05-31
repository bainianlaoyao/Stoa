---
date: 2026-05-29
topic: Task 5 command UI cutover — WorkspaceHierarchyPanel, CommandSurface, TerminalSessionDeck
status: completed
mode: context-gathering
sources: 9
---

## Context Report: Task 5 Command UI Cutover

### Why This Was Gathered

Task 5 step 1 requires writing RED-first tests for the three command components (`WorkspaceHierarchyPanel`, `CommandSurface`, `TerminalSessionDeck`), then cutting over the renderer to support recursive tree hierarchy, parent auto-expand, and background-child-no-steal semantics. This report maps exactly where flat-session assumptions live and what must change per component.

### Summary

All three command components iterate `project.sessions` as a flat array. None handle `parentSessionId`, `children`, or tree nesting. `TerminalSessionDeck` builds a flat `sessionLookup` from `project.sessions` that would miss child sessions in a tree model. `CommandSurface` derives `sessionRowViewModels` from the same flat iteration. `WorkspaceHierarchyPanel` renders one `route-session-row` per session at a single indent level. No meta-session references exist in the command components themselves (they live in `App.vue`, `AppShell.vue`, `GlobalActivityBar.vue`).

---

### Finding 1: WorkspaceHierarchyPanel — flat session rendering

The panel iterates `project.sessions` as a flat list inside `v-for="session in project.sessions"`.

**Current rendering structure** (`WorkspaceHierarchyPanel.vue:403–463`):

```
<template v-if="!isProjectCollapsed(project.id)">
  <div v-for="session in project.sessions" class="route-session-row">
    <!-- single-level child button -->
  </div>
</template>
```

Every session row uses CSS class `route-item child` with a fixed left-padding (`padding: 2px 8px 2px 20px`, line 578). There is no nested `v-for` for children, no `session.children`, no recursive rendering.

**Where recursive tree must land**: Inside the `<template v-if="!isProjectCollapsed(project.id)">` block, each session that has children (i.e. `parentSessionId === null` and has children) needs a nested iteration. The current single `v-for` at line 404 must become aware of `parentSessionId` grouping.

**Archived sessions**: Line 443–460 of the test verifies archived sessions are hidden. The panel has `archivedSessions` on `ProjectHierarchyNode` but does not render them (the test asserts `data-archived-group` is absent). The archived tree section must be added alongside the active tree rendering.

| Claim | Source | Location |
|-------|--------|----------|
| Flat `v-for="session in project.sessions"` | `WorkspaceHierarchyPanel.vue` | line 405 |
| Single indent via fixed CSS padding | `WorkspaceHierarchyPanel.vue` | line 578 |
| No `children` property consumed | `WorkspaceHierarchyPanel.vue` | lines 33–38 (props), 403–463 (template) |
| Archived sessions not rendered | `WorkspaceHierarchyPanel.test.ts` | lines 443–460 |

---

### Finding 2: WorkspaceHierarchyPanel — meta-session assumptions

The panel itself has **no meta-session imports or references**. It is clean of meta-session concerns. The meta-session store/components are in separate files:
- `src/renderer/stores/meta-session.ts`
- `src/renderer/components/meta-session/*`

However, `CommandSurface.vue` passes through `hierarchy` as `ProjectHierarchyNode[]` from the store. If `App.vue` or `AppShell.vue` conditionally shows the command surface based on meta-session state, that wiring is **upstream of these components**, not inside them.

| Claim | Source | Location |
|-------|--------|----------|
| No meta-session imports in WorkspaceHierarchyPanel | `WorkspaceHierarchyPanel.vue` | lines 1–11 |
| No meta-session imports in CommandSurface | `CommandSurface.vue` | lines 1–10 |
| No meta-session imports in TerminalSessionDeck | `TerminalSessionDeck.vue` | lines 1–10 |
| Meta-session references exist in App.vue, AppShell, GlobalActivityBar | Grep results | 15 files |

---

### Finding 3: TerminalSessionDeck — flat `sessionLookup` misses tree children

`TerminalSessionDeck.vue` builds a flat lookup from `project.sessions` (lines 41–54):

```ts
const sessionLookup = computed<Record<string, ResolvedTerminalSession>>(() => {
  const lookup: Record<string, ResolvedTerminalSession> = {}
  for (const project of props.hierarchy) {
    for (const session of project.sessions) {
      lookup[session.id] = { project, session }
    }
  }
  return lookup
})
```

When the store switches to a recursive tree model (e.g. `project.sessions` containing `children` arrays), this lookup will **miss child sessions** because it only iterates the top-level `project.sessions` array.

**Impact on persistent AI terminal caching**: The `activatedAiSessionIds` watcher (line 68–79) prunes IDs not found in `sessionLookup`. A child session activated as an AI terminal would be pruned because it doesn't appear in the flat lookup.

**Impact on ephemeral session resolution**: The `activeEphemeralEntry` computed (line 95–102) resolves the active shell session from `sessionLookup`. A shell child session would fail to resolve.

| Claim | Source | Location |
|-------|--------|----------|
| Flat `sessionLookup` iterates only `project.sessions` | `TerminalSessionDeck.vue` | lines 41–54 |
| Pruning watcher removes IDs not in lookup | `TerminalSessionDeck.vue` | lines 68–79 |
| Ephemeral entry resolution uses flat lookup | `TerminalSessionDeck.vue` | lines 95–102 |
| No `children` iteration anywhere | `TerminalSessionDeck.vue` | entire component |

---

### Finding 4: CommandSurface — flat `sessionRowViewModels` derivation

`CommandSurface.vue` derives `sessionRowViewModels` by iterating `project.sessions` flat (lines 38–54):

```ts
for (const project of props.hierarchy) {
  for (const session of project.sessions) {
    const presence = sessionPresenceMap.value[session.id]
    if (!presence) continue
    viewModels[session.id] = toSessionRowViewModel(session, presence, nowIso)
  }
}
```

This will not produce view models for child sessions in a tree model. The `WorkspaceHierarchyPanel` needs view models for child rows too, so this derivation must become tree-aware.

| Claim | Source | Location |
|-------|--------|----------|
| Flat `sessionRowViewModels` derivation | `CommandSurface.vue` | lines 38–54 |
| Flat `activeSessionViewModel` derivation | `CommandSurface.vue` | lines 56–71 |
| `WorkspaceHierarchyPanel` receives view models via prop | `CommandSurface.vue` | line 82 |

---

### Finding 5: Test fixture shape assumes flat hierarchy

All three test files create `ProjectHierarchyNode` fixtures with flat `sessions[]` arrays (no `children` field, no `parentSessionId` grouping). Key fixture patterns:

- `WorkspaceHierarchyPanel.test.ts`: `createHierarchy()` (line 46–109) creates sessions with `archived: false` and `active: boolean`, but no `parentSessionId` or `children`.
- `CommandSurface.test.ts`: `hierarchy` constant (lines 20–82) — same flat pattern.
- `TerminalSessionDeck.test.ts`: `hierarchyFixture()` (lines 94–109) — same.

The `ProjectHierarchyNode` interface (defined in `src/renderer/stores/workspaces.ts:11–15`) has no `children` field on session nodes. All tests build fixtures conforming to this flat interface.

| Claim | Source | Location |
|-------|--------|----------|
| Panel fixture has no `parentSessionId`/`children` | `WorkspaceHierarchyPanel.test.ts` | lines 46–109 |
| CommandSurface fixture same pattern | `CommandSurface.test.ts` | lines 20–82 |
| Deck fixture same pattern | `TerminalSessionDeck.test.ts` | lines 94–109 |
| `ProjectHierarchyNode` has no `children` field | `src/renderer/stores/workspaces.ts` | lines 11–15 |

---

### Finding 6: No `parentSessionId` usage in any command component

Despite `SessionSummary` already carrying `parentSessionId: string | null` and `createdBySessionId: string | null` (from `src/shared/project-session.ts:125–126`), none of the command components access or use these fields. They are present on every session object that flows through but completely ignored.

| Claim | Source | Location |
|-------|--------|----------|
| `SessionSummary` has `parentSessionId` | `src/shared/project-session.ts` | line 125 |
| `SessionSummary` has `createdBySessionId` | `src/shared/project-session.ts` | line 126 |
| No component reads `parentSessionId` | `WorkspaceHierarchyPanel.vue`, `CommandSurface.vue`, `TerminalSessionDeck.vue` | all files |

---

### Minimal RED-First Test Cases

#### WorkspaceHierarchyPanel.test.ts

1. **`renders child session rows nested under parent`** — Create a hierarchy with a root session (`parentSessionId: null`) that has a child session (`parentSessionId: root.id`). Assert that the child row renders with a distinct testid or data attribute indicating nesting (e.g., `data-depth="1"` or nested inside the parent row's container).

2. **`auto-expands parent when child session appears`** — Mount with collapsed project, emit a child-created graph event (or change the hierarchy prop to include a new child), assert the parent project row is no longer collapsed.

3. **`renders archived session subtree in archived section`** — Create hierarchy with an archived parent and its archived children. Assert `data-archived-group` exists and contains nested archived children.

4. **`does not render child as flat sibling`** — With parent+child hierarchy, assert child does NOT appear at the top-level `v-for` — only under its parent's nested container.

#### CommandSurface.test.ts

5. **`derives sessionRowViewModels for child sessions in tree`** — Mount with tree hierarchy, assert that child sessions appear in the `sessionRowViewModels` passed to `WorkspaceHierarchyPanel`.

6. **`resolves active child session terminal in deck`** — Set `activeSession` to a child session, assert the terminal deck mounts a viewport for it.

#### TerminalSessionDeck.test.ts

7. **`sessionLookup resolves child sessions from tree hierarchy`** — Pass a tree hierarchy with parent+child, assert that looking up the child session ID returns the correct `ResolvedTerminalSession`.

8. **`persists AI terminal for child session and caches across switches`** — Activate a child AI session, switch to parent, switch back. Assert the child terminal is still mounted (not pruned from `activatedAiSessionIds`).

9. **`prunes child terminal when child disappears from hierarchy`** — Activate child session, then remove it from hierarchy. Assert it is pruned from `activatedAiSessionIds`.

#### All three test files

10. **`background child create does not steal active session`** — Set `activeSessionId` to parent, add a child session to the hierarchy prop. Assert `activeSessionId` remains the parent's ID.

---

### Risks / Unknowns

- **[!] Tree-aware `sessionLookup` in TerminalSessionDeck**: The deck must flatten the tree for lookup purposes. Whether this happens at the store level (flat `sessions[]` with `parentSessionId`) or at the component level (recursive flatten) is an architectural choice that affects all three components.
- **[?] `ProjectHierarchyNode` type change scope**: The interface change (adding `children` to session nodes) affects the store, all three components, and all their tests. This is the single most impactful type change.
- **[?] `CommandSurface` `sessionRowViewModels` computed**: Must decide if tree-awareness goes into the computed (recursive) or if the store provides a flattened view model map that already includes children.
- **[?] Indent depth CSS**: The current `.route-item.child` uses fixed padding. A recursive tree needs variable indent depth. The existing `depth=2, max_depth=2` constraint limits this to one level of nesting.

---

### Evidence Chain

| # | Finding | Source | Location |
|---|---------|--------|----------|
| 1 | Flat `v-for` in panel | `WorkspaceHierarchyPanel.vue` | line 405 |
| 2 | Panel uses `route-item child` single indent | `WorkspaceHierarchyPanel.vue` | line 578, CSS |
| 3 | No meta-session in command components | Grep results | command/ directory |
| 4 | Flat `sessionLookup` in deck | `TerminalSessionDeck.vue` | lines 41–54 |
| 5 | Deck pruning watcher | `TerminalSessionDeck.vue` | lines 68–79 |
| 6 | Flat `sessionRowViewModels` in surface | `CommandSurface.vue` | lines 38–54 |
| 7 | `ProjectHierarchyNode` has no `children` | `workspaces.ts` | lines 11–15 |
| 8 | `SessionSummary` has `parentSessionId` | `project-session.ts` | line 125 |
| 9 | All test fixtures are flat | `.test.ts` files | all three |

---

## Context Handoff: Task 5 Command UI Cutover

Start here: `research/2026-05-29-task5-impl-command-ui-subagent.md`

Context only. Use the saved report as the source of truth.
