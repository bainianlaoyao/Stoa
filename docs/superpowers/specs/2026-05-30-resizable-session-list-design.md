# Resizable Session List Panel — Design Spec

**Date:** 2026-05-30
**Status:** Approved

## Problem

The session list panel (left sidebar inside CommandSurface and MetaSessionSurface) has a hardcoded width of 240px. Users cannot adjust it to see more or less session information. The right sidebar already supports drag-to-resize via `useSidebarResize` composable and `sidebar.ts` store.

## Scope

Add drag-to-resize to the left session list panel only. The right sidebar's existing resize functionality is unchanged.

## Design

### 1. Data Layer — Extend sidebar store

Add to `src/renderer/stores/sidebar.ts`:

```typescript
const DEFAULT_SESSION_LIST_WIDTH = 240
const SESSION_LIST_MIN_WIDTH = 160
const SESSION_LIST_MAX_WIDTH = 480
```

New state field:

- `sessionListWidth: number` — default 240, clamped to [160, 480]

New actions:

- `setSessionListWidth(w: number)` — live update during drag (clamped)
- `commitSessionListWidth()` — persist to disk after drag ends

`SidebarState` in `src/shared/sidebar-types.ts` gains `sessionListWidth: number`.

IPC channels (`getSidebarState` / `setSidebarState`) require no changes — they serialize the full `SidebarState` object.

### 2. Composable — Generalize useSidebarResize → usePanelResize

Refactor `src/renderer/composables/useSidebarResize.ts` into a parameterized `usePanelResize`:

```typescript
interface ResizeOptions {
  containerRef: Ref<HTMLElement | null>
  currentWidth: Ref<number>
  minWidth: number
  maxWidth: number
  dynamicMaxWidth?: boolean  // if true, compute max from window.innerWidth
  onWidthChange: (w: number) => void
  onWidthCommit: () => void
}

export function usePanelResize(options: ResizeOptions): {
  onResizeStart: (e: MouseEvent) => void
}
```

- Overlay + mousemove/mouseup logic unchanged
- Right sidebar call site migrates to `usePanelResize` with `dynamicMaxWidth: true` — behavior identical
- Left session list call site uses `minWidth: 160, maxWidth: 480`

### 3. UI — Drag Handle and Dynamic Grid

**CommandSurface.vue** and **MetaSessionSurface.vue**:

Grid template changes from static to dynamic:

```vue
<!-- Before -->
<div class="grid grid-cols-[240px_minmax(0,1fr)]">

<!-- After -->
<div class="grid" :style="{ gridTemplateColumns: sessionListWidth + 'px minmax(0,1fr)' }">
```

Drag handle positioned on the session list panel's **right edge** (1px vertical bar), mirroring the right sidebar's left-edge handle:

```vue
<div class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10
            hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20
            transition-colors"
     @mousedown="onResizeStart" />
```

### 4. File Change List

| File | Change |
|------|--------|
| `src/shared/sidebar-types.ts` | Add `sessionListWidth` to `SidebarState` |
| `src/renderer/stores/sidebar.ts` | Add state field, constants, actions |
| `src/renderer/composables/useSidebarResize.ts` | Rename/refactor to `usePanelResize` |
| `src/renderer/components/command/CommandSurface.vue` | Dynamic grid width + drag handle |
| `src/renderer/components/meta-session/MetaSessionSurface.vue` | Dynamic grid width + drag handle |
| `src/renderer/components/right-sidebar/RightSidebar.vue` | Update import to `usePanelResize` |
| Test files | Update to match new store shape and composable signature |

### Constraints

- All colors use CSS variables per `docs/engineering/design-language.md`
- Transitions default to `all 0.2s ease`
- No `as any`, `@ts-ignore`, or `@ts-expect-error`
- Width persists across sessions via existing IPC persistence
