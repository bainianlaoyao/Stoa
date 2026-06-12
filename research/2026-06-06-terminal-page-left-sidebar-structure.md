---
date: 2026-06-06
topic: terminal-page-left-sidebar-structure
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Terminal Page Left Sidebar Structure

### Why This Was Gathered
To understand the terminal page's left sidebar implementation for debugging scrolling and layout issues.

### Summary
The terminal page's left sidebar is implemented by the `WorkspaceHierarchyPanel` Vue component with a specific scrolling configuration. The sidebar uses flex layout with `overflow-y-auto` on the content body and relies on `min-h-0` throughout the component hierarchy to enable proper scrolling behavior.

### Key Findings

**1. Main Sidebar Component**
- **File**: `D:\Data\DEV\ultra_simple_panel\src\renderer\components\command\WorkspaceHierarchyPanel.vue`
- **Lines**: 414-592 (template), 637-1144 (scoped styles)
- **Root element**: `<aside class="min-h-0 flex flex-col rounded-none border-r border-line bg-mica">`
- **Scrolling container**: Line 451 - `<div class="flex-1 overflow-y-auto px-2.5 py-3 grid gap-3 align-content-start route-body-scroll">`

**2. Scrollable CSS Configuration**
- **Location**: `WorkspaceHierarchyPanel.vue:451` (template), `lines 1119-1143` (styles)
- **Key CSS class**: `.route-body-scroll`
- **Scroll properties**:
  ```css
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  ```
- **Hover behavior**: `scrollbar-color: var(--color-black-soft) transparent`
- **Custom scrollbar styling**: 4px width with transparent track/thumb that shows on hover

**3. Layout Hierarchy (Root to Sidebar)**
```
App.vue:288 - .app-root (h-full flex flex-col overflow-hidden)
  └─ AppShell.vue:44 - <main class="grid grid-cols-[56px_1fr_auto] grid-rows-1 flex-1 min-h-0">
      └─ AppShell.vue:47 - <section class="min-w-0 min-h-0 overflow-hidden"> (app-viewport)
          └─ CommandSurface.vue:92 - <section class="h-full min-h-0"> (command-panel)
              └─ CommandSurface.vue:94 - <div class="h-full grid gap-0 min-h-0 grid-template-columns: [sessionListWidth]px minmax(0,1fr)">
                  └─ CommandSurface.vue:95 - <div ref="sessionListRef" class="relative min-h-0">
                      └─ WorkspaceHierarchyPanel.vue:414 - <aside class="min-h-0 flex flex-col">
```

**4. Sidebar Internal Structure**
- **Header**: Lines 417-448 - Fixed toolbar with actions (`.border-b`, `bg-surface-soft`)
- **Scrollable body**: Line 451 - Contains project/session tree (`.flex-1 .overflow-y-auto`)
- **CSS Flex pattern**: `min-h-0 flex flex-col` on parent + `flex-1 overflow-y-auto` on child

**5. Critical CSS Patterns**

**Sidebar Root (line 414)**:
```css
.min-h-0.flex.flex-col.rounded-none.border-r.border-line.bg-mica
```

**Scrollable Content (line 451)**:
```css
.flex-1.overflow-y-auto.px-2.5.py-3.grid.gap-3.align-content-start.route-body-scroll
```

**Scrollbar Styling (lines 1119-1143)**:
```css
.route-body-scroll {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.route-body-scroll:hover {
  scrollbar-color: var(--color-black-soft) transparent;
}
.route-body-scroll::-webkit-scrollbar {
  width: 4px;
}
.route-body-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.route-body-scroll::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}
.route-body-scroll:hover::-webkit-scrollbar-thumb {
  background: var(--color-black-soft);
}
```

**6. Overflow-Related Styles in Component Tree**

**WorkspaceHierarchyPanel.vue**:
- Line 451: `.overflow-y-auto` (scrollable content area)
- Line 875: `.overflow-hidden` (route-name text truncation)
- Line 884: `.overflow-hidden` (route-session-name truncation)
- Line 906: `.text-overflow: ellipsis` (route-session-label truncation)
- Line 996: `.overflow-hidden` (detail-popover__name truncation)

**TerminalViewport.vue**:
- Line 443: `.overflow-hidden` (terminal-viewport__shell)
- Line 451: `.overflow-hidden` (terminal-viewport__xterm-mount)
- Line 464: `.overflow-y: auto` (xterm-viewport scrolling)

**CommandSurface.vue**:
- Uses grid layout: `grid-template-columns: sessionListWidth + 'px minmax(0,1fr)'`
- Both columns have `min-h-0` for proper flex/grid behavior

**7. Height/Max-Height Constraints**
- No explicit `height` or `max-height` on sidebar
- Uses `flex-1` to take available space
- `min-h-0` throughout hierarchy to prevent flex items from expanding beyond container
- Relies on parent `h-full` (height: 100%) chain from App.vue root

**8. Flex Layout Analysis**

**Critical Chain**:
1. App.vue: `.app-root.h-full` (100vh height)
2. AppShell.vue: `<main>.flex-1.min-h-0` (takes remaining height)
3. CommandSurface.vue: `<section>.h-full.min-h-0` (100% of parent)
4. WorkspaceHierarchyPanel.vue: `<aside>.min-h-0.flex.flex-col` (column direction)

**Scroll Enablement**:
- Parent: `.flex.flex-col.min-h-0` (enables shrinking)
- Child: `.flex-1.overflow-y-auto` (takes available space + scrolls)

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Main sidebar component | WorkspaceHierarchyPanel.vue | 414-592 |
| Scrollable container definition | WorkspaceHierarchyPanel.vue | 451 |
| Scrollbar CSS styling | WorkspaceHierarchyPanel.vue | 1119-1143 |
| Root app overflow hidden | App.vue | 288 |
| Viewport overflow hidden | AppShell.vue | 47 |
| Command panel grid layout | CommandSurface.vue | 94 |
| Sidebar flex layout | WorkspaceHierarchyPanel.vue | 414 |
| min-h-0 usage pattern | Multiple files | Various |
| Session list width store | sidebar.ts | 18 |

### Risks / Unknowns

**[!]** Potential Layout Issues:
- If parent chain loses `h-full` or `min-h-0`, scrolling breaks
- `min-h-0` is critical - without it, flex items won't shrink properly
- Grid layout in CommandSurface.vue: `minmax(0,1fr)` is essential for sidebar resizing

**[?]** Unknown:
- Dynamic content height calculations for scroll position restoration
- Performance implications of complex scrollbar styling
- Whether `align-content-start` affects scroll behavior with sparse content

**[!] Scrollbar Styling**:
- Custom 4px scrollbar might be hard to use on touch/high-DPI displays
- Transparent-to-visible transition on hover could confuse users

### Component Communication Flow

```
App.vue (root)
  ↓ props
AppShell.vue (layout shell)
  ↓ props
CommandSurface.vue (terminal page layout)
  ↓ props
WorkspaceHierarchyPanel.vue (LEFT SIDEBAR)
  ↓ emits
CommandSurface.vue
  ↑ bubbles
AppShell.vue
  ↑ bubbles
App.vue
```

### Related Files

**Layout Structure**:
- `src/renderer/app/App.vue` - Root application layout
- `src/renderer/components/AppShell.vue` - Main shell layout
- `src/renderer/components/command/CommandSurface.vue` - Terminal page layout
- `src/renderer/components/command/WorkspaceHierarchyPanel.vue` - **LEFT SIDEBAR**
- `src/renderer/components/command/TerminalSessionDeck.vue` - Terminal viewport area

**State Management**:
- `src/renderer/stores/sidebar.ts` - Sidebar width/state persistence
- `src/renderer/stores/workspaces.ts` - Workspace/project hierarchy

**Styling**:
- `src/renderer/styles/tailwind.css` - Global CSS variables and base styles

### CSS Variable Dependencies

The sidebar scrolling behavior depends on these CSS variables:
- `--color-black-soft` - Scrollbar thumb color on hover
- `--color-line` - Border colors
- `--radius-sm` - Scrollbar border-radius

### Accessibility Attributes

- `aria-label="Workspace hierarchy"` on sidebar root
- `aria-current` for active items
- `data-testid` attributes for testing:
  - `workspace-hierarchy-panel`
  - `route-body`
  - `project-row`
  - `session-row`