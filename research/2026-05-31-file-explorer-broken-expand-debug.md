---
date: 2026-05-31
topic: file-explorer-broken-expand-debug
status: completed
mode: context-gathering
sources: 6
---

## Context Report: File Explorer Broken — Expand Does Not Show Children

### Why This Was Gathered
File explorer is fundamentally broken: expanding a folder shows no children inside. Needed to find root cause and reference mature implementations for a correct fix.

### Summary
Two compounding bugs found: (1) the double-click handler swallows directory expand actions — users naturally double-click folders, which cancels the pending expand timer and fires a no-op `openFile`; (2) `loadDir` silently catches IPC errors, making failures invisible. Fix applied: directories now expand immediately on single-click; `loadDir` now logs errors.

### Key Findings

1. **Double-click handler is the primary cause** — `handleRowClick` in FileExplorer.vue implements 300ms double-click detection. For directories, the first click starts a timer; if a second click arrives within 300ms, the timer is cancelled and `openFile(node)` is called instead. Since `openFile` returns early for directories (`if (node.isDirectory) return`), the expand never fires. Users who naturally double-click folders see nothing happen.

2. **Orca upstream uses the same pattern but in React** — `useFileExplorerTree.ts` uses `dirCache: Record<string, DirCache>` + `Set<string>` for expanded + recursive DFS for flattening. The data structure is identical to our `useFileTree`.

3. **Silent error swallowing masks failures** — `loadDir`'s catch block sets `children: []` without logging, making IPC failures impossible to diagnose.

### Fixes Applied

| File | Change |
|------|--------|
| `src/renderer/components/right-sidebar/explorer/FileExplorer.vue` | Directories now expand/collapse immediately on click. Double-click detection only applies to files. |
| `src/renderer/composables/useFileTree.ts` | Rewritten with Orca's proven DFS pattern. Added `console.error` in catch block. Cleaner `toRelative()` path helper. |
| Tests | 12/12 pass, 1723/1723 total pass |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Double-click swallows expand for dirs | FileExplorer.vue | `handleRowClick` lines 65-89 (old) |
| Orca uses same dirCache + Set pattern | Orca codebase | `useFileExplorerTree.ts` |
| Orca uses recursive DFS for flat rows | Orca codebase | `useFileExplorerTree.ts:flatRows` |
| Silent catch hides IPC errors | useFileTree.ts | `loadDir` catch block |

### Risks / Unknowns
- [!] The root-level load works (IPC functional) but we haven't verified subdirectory IPC at runtime with the actual Electron app
- [?] If there's still a subdirectory-specific IPC issue, the `console.error` will now surface it
