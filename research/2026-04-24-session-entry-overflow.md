---
date: 2026-04-24
topic: session entry overflow when path is long
status: completed
mode: context-gathering
sources: 4
---

## Context Report: Session Entry Overflow on Long Path

### Why This Was Gathered
Session entries in the workspace hierarchy panel overflow their container when the project path or other text content is too long. Need to understand the root cause before fixing.

### Summary
The `WorkspaceHierarchyPanel.vue` renders project rows and session rows. The `.route-name` element has proper CSS text truncation (`overflow: hidden; white-space: nowrap; text-overflow: ellipsis`), but its sibling elements `.route-path` (project directory path) and `.route-time` (session type) **lack all truncation properties**. When a project path is long (e.g. `D:\Data\DEV\ultra-simple-panel`), the text pushes the grid cell wider than the 240px sidebar allows, causing visible overflow.

### Key Findings

1. **Sidebar is fixed at 240px** — `CommandSurface.vue:27` uses `grid-cols-[240px_minmax(0,1fr)]`, so the hierarchy panel has a fixed 240px width.

2. **`.route-name` truncates correctly** — has `overflow: hidden; white-space: nowrap; text-overflow: ellipsis` at `WorkspaceHierarchyPanel.vue:381-386`.

3. **`.route-path` and `.route-time` have NO truncation** — styled only with color and font at `WorkspaceHierarchyPanel.vue:389-393`:
   ```css
   .route-path,
   .route-time {
     color: var(--color-muted);
     font: var(--text-caption) var(--font-mono);
   }
   ```
   Missing: `overflow: hidden`, `white-space: nowrap`, `text-overflow: ellipsis`.

4. **Grid `min-width: 0` chain is correct** — `.route-session-row`, `.route-session-row .route-item`, and `.route-copy` all have `min-width: 0`, which should allow grid items to shrink. But the text content itself never truncates, so the minimum content width of `.route-path` / `.route-time` still forces the cell to expand.

5. **Project row parent grid is also constrained** — The project row wrapper at line 171 uses `grid-cols-[minmax(0,1fr)_auto]` with `min-width: 0` on `.route-item`, but again `.route-path` inside `.route-copy` lacks truncation.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Sidebar fixed at 240px | `CommandSurface.vue` | `:27` |
| `.route-name` has truncation | `WorkspaceHierarchyPanel.vue` | `:381-386` |
| `.route-path` / `.route-time` lack truncation | `WorkspaceHierarchyPanel.vue` | `:389-393` |
| `.route-copy` has `min-width: 0` | `WorkspaceHierarchyPanel.vue` | `:376-378` |
| `.route-session-row` has `min-width: 0` | `WorkspaceHierarchyPanel.vue` | `:285-291` |
| Session types are short strings | `project-session.ts` | `:1` |

### Risks / Unknowns

- [!] `.route-path` is the primary overflow vector since project paths can be arbitrarily long filesystem paths (e.g. `C:\Users\username\very\nested\directory\project`).
- [?] `.route-time` shows `session.type` which is always a short enum value (`shell | opencode | codex | claude-code`), so it's unlikely to overflow in practice but should still be protected.
- [?] The old `WorkspaceList.vue` component (still in codebase) has a similar issue with `<code>{{ project.path }}</code>` — unclear if this component is still rendered anywhere or is dead code.
