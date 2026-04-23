---
date: 2026-04-23
topic: height-scrollbar-issue
status: completed
mode: context-gathering
sources: 3
---

## Context Report: Electron Window Height / Scrollbar Issue

### Why This Was Gathered
The app shows a right-side scrollbar when the Electron window is resized shorter. The user wants the layout to fully adapt to window height without overflow.

### Summary
Multiple nested `min-height: 100vh` declarations on `body`, `#app`, and `AppShell <main>` cause the content to overflow the Electron window height. When the window is short (but above 720px minHeight), the cumulative box model + `min-height: 100vh` creates content taller than the viewport, triggering a scrollbar on `<body>`.

### Key Findings

1. **`body` has `min-height: 100vh`** — sets a floor but no ceiling, content can exceed viewport
2. **`#app` has `min-height: 100vh`** — same issue, compounds with body
3. **AppShell `<main>` has `min-h-screen`** (= `min-height: 100vh`) — third layer of the same pattern
4. **No `overflow: hidden` on body** — allows scrollbar to appear
5. **Electron window**: default height 900px, minHeight 720px

### Root Cause

The layout chain is:

```
body (min-height: 100vh)        ← no overflow control
  └─ #app (min-height: 100vh)   ← redundant
      └─ <main min-h-screen>    ← min-height: 100vh again
          └─ <section m-3>      ← 12px margin adds to height
```

When the `<main>` grid + its children render at or above `100vh`, plus the `<section>` has `m-3` (margin), the total exceeds the viewport. Body has no `overflow: hidden`, so a scrollbar appears.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `body { min-height: 100vh }` | tailwind.css | `src/renderer/styles/tailwind.css:91` |
| `#app { min-height: 100vh }` | tailwind.css | `src/renderer/styles/tailwind.css:102` |
| `<main class="... min-h-screen ...">` | AppShell.vue | `src/renderer/components/AppShell.vue:42` |
| `<section class="... m-3 ...">` | AppShell.vue | `src/renderer/components/AppShell.vue:45` |
| Window height: 900, minHeight: 720 | index.ts | `src/main/index.ts:78-80` |

### Recommended Fix

Change the height strategy from "minimum 100vh" to "exactly fill viewport, no overflow":

1. **`body`**: `height: 100vh; overflow: hidden;` (replace `min-height: 100vh`)
2. **`#app`**: `height: 100%; overflow: hidden;` (replace `min-height: 100vh`)
3. **AppShell `<main>`**: `h-full` instead of `min-h-screen` (fill parent, not viewport)
4. `<section>` margin will then be contained inside the fixed-height parent

This makes the layout a fixed viewport box with internal scroll only where needed (e.g. terminal).

### Risks / Unknowns
- [!] Changing `min-height` to `height` may affect components that relied on content expanding the page
- [?] Some child components may have their own height assumptions that need review after the fix
