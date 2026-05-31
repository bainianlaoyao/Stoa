---
title: Right Sidebar Improvement Plan
date: 2026-05-31
status: in-progress
---

# Right Sidebar Improvement Plan

## Source
Gap analysis comparing Stoa right sidebar vs Orca upstream (`research/upstreams/orca/`).
7 agents examined architecture, panels, interaction UX, state persistence, and styling.

## Critical (4 items)

| # | Gap | Change |
|---|-----|--------|
| 1 | Sidebar unmounts on close | `v-if` → CSS hide (`width:0; overflow:hidden`) |
| 2 | No keyboard shortcuts | New composable: `Ctrl+B` toggle, `Ctrl+Shift+E/F/G` panel switch |
| 3 | File explorer no dblclick/keyboard | Add `@dblclick`, arrow keys, Enter, F2, Delete |
| 4 | Hardcoded panels | New `useSidebarPanels` registry composable |

## Important (9 items)

| # | Gap | Change |
|---|-----|--------|
| 5 | Git status stale on close | New `useGitStatusPolling` app-level composable (30s interval) |
| 6 | No reveal-in-explorer | Store action + FileExplorer watcher + flash animation |
| 7 | No panel visibility filtering | `gitOnly` flag, auto-hide for non-git projects |
| 8 | Context menu lacks copy/reveal | Add Copy Path, Relative Path, Reveal, Find in Folder, Duplicate |
| 9 | No per-project tab memory | `activeTabByProject: Record<string, string>` |
| 10 | No drag-drop file move | HTML5 drag/drop on file rows |
| 11 | Search requires Enter | 300ms debounced auto-search + stale cancellation |
| 12 | No atomic writes | tmp+rename pattern + backup slot + recovery |
| 13 | Resize not rAF throttled | rAF + direct DOM during drag, store on mouseup |

## Minor (7 items)

| # | Gap | Change |
|---|-----|--------|
| 14 | No close button | X button in sidebar header |
| 15 | No window blur on resize | blur → stopResize cleanup |
| 16 | No file type icons | Extension-based icon mapping |
| 17 | No shortcut tooltips | title attrs on TabBar buttons |
| 18 | No auto-hide on navigation | Close sidebar on settings/full-page surfaces |
| 19 | No file duplication | Duplicate option in context menu |
| 20 | Search results not clickable | Click-to-open file at line |

## Implementation Phases

```
Phase 1 — Foundation (4 agents, parallel)
  ├─ useSidebarPanels.ts (panel registry)
  ├─ useSidebarShortcuts.ts (keyboard shortcuts)
  ├─ useGitStatusPolling.ts (git polling)
  └─ useSidebarResize.ts (rAF + blur)

Phase 2 — Store (1 agent)
  └─ sidebar.ts + sidebar-types.ts (per-project tab, reveal, visibility)

Phase 3 — Components (5 agents, parallel)
  ├─ RightSidebar.vue (CSS-hide + registry + close button)
  ├─ TabBar.vue (registry + tooltips)
  ├─ FileExplorer.vue (dblclick + keyboard + context menu + drag-drop + icons)
  ├─ SearchPanel.vue (debounce + click-to-open)
  └─ SourceControlPanel.vue (global git state)

Phase 4 — Integration (2 agents, parallel)
  ├─ sidebar-fs-handlers.ts (atomic writes)
  └─ App.vue / AppShell.vue (wire composables + auto-hide)

Phase 5 — Tests (2 agents, parallel)
  ├─ Unit/component test updates
  └─ E2E test updates
```

## Stoa Advantages (preserve these)
- Dedicated sidebar IPC channels with typed `IPC_CHANNELS`
- Full state persistence (open, activeTab, width, sessionListWidth)
- Pinia store focused solely on sidebar concerns
- Clean main-process handler separation (fs-handlers, git-handlers)
- Vue template-based resize overlay (cleaner than Orca's imperative approach)
