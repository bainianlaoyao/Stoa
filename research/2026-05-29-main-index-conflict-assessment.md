---
date: 2026-05-29
topic: main-conflict — uncommitted changes in index.ts vs session-tree spec
status: completed
mode: context-gathering
sources: 4
---

## Context Report: Uncommitted `src/main/index.ts` changes vs Unified Session Tree spec

### Why This Was Gathered

Determine whether the current uncommitted diff in `src/main/index.ts` will conflict with the planned implementation of `docs/superpowers/specs/2026-05-29-stoa-ctl-unified-session-tree-design.md`.

### Summary

The uncommitted changes are purely additive sidebar IPC handlers. They touch a completely separate integration seam from the session tree restructuring. **No conflict expected.** The sidebar additions can merge cleanly into any branch that reworks the meta-session stack.

### Key Findings

1. **Uncommitted diff is narrow and additive**: Only 2 new IPC handlers (`sidebarGetState`, `sidebarSetState`) and 1 new import (`readSidebarState`, `writeSidebarState` from `@core/sidebar-state-store`).
2. **The spec targets a different seam entirely**: The session tree spec calls for deleting the entire meta-session stack (~50 files, ~15 IPC channels) and adding new session tree infrastructure. None of this overlaps with the sidebar additions.
3. **The sidebar handlers are inserted at a neutral location**: Between `registerFilesystemHandlers` and `settingsDetectShell` (lines ~1452-1459 in new file), which is not in the meta-session handler zone (lines 1556-1655).
4. **No `parentSessionId` / `createdBySessionId` fields exist yet** in `SessionSummary` or any shared type — confirmed by grep of `src/shared/`. The spec's model extension has not started.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Uncommitted diff adds only sidebar import + 2 IPC handlers | `git diff src/main/index.ts` | Lines +27, +1452-1459 |
| Sidebar handlers use `sidebarGetState` / `sidebarSetState` channels | `src/core/ipc-channels.ts:67-68` | `sidebar:*` channel names |
| 50 files reference meta-session concepts slated for deletion | `grep -r 'meta-session\|metaSession\|MetaSession' src/` | Cross-cutting: core/, main/, renderer/, shared/ |
| Meta-session IPC handlers occupy lines 1556-1655 in index.ts | `src/main/index.ts` | `metaSessionBootstrap` through `metaSessionInspectorSetTarget` |
| Meta-session core infrastructure in index.ts: imports lines 13-22, manager init line 470-472, runtime launch lines 848-1059 | `src/main/index.ts` | `MetaSessionManager`, `MetaSessionControlServer`, etc. |
| `parentSessionId` / `createdBySessionId` do not exist in shared types | `grep 'parentSessionId\|createdBySessionId' src/shared/` | No matches |
| New file `src/core/sidebar-state-store.ts` is untracked, provides `readSidebarState` / `writeSidebarState` | `src/core/sidebar-state-store.ts` | 36 lines, standalone module |

### Risks / Unknowns

- [!] **Blast radius of spec is enormous**: The spec deletes the entire meta-session stack from `index.ts` (imports, manager init, runtime launch, control server wiring, ~15 IPC handlers, ~600 lines of meta-session runtime logic). Any future work touching meta-session code in this file will be on a collision course.
- [!] **Sidebar handler insertion point may drift**: If the spec deletes the meta-session handler block (lines 1556-1655), the surrounding line numbers shift. But since the sidebar handlers are at lines ~1452-1459 (well before the meta block), they should remain stable.
- [?] **Whether `sidebar-state-store.ts` needs adjustment** when `~/.stoa/sidebar.json` persistence path changes alongside the spec's session state rework — unknown, but unlikely since sidebar state is orthogonal to session modeling.

### Conflict Verdict

**Zero merge conflict.** The uncommitted sidebar additions are in a different integration seam, using different imports, different IPC channels, and different functionality from everything the session tree spec touches.
