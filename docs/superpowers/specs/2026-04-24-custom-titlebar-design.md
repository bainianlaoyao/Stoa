# Custom Frameless Title Bar Design

## Overview

Replace the Windows system title bar + Electron menu bar (File/Edit/View/Window/Help) with a modern, integrated custom title bar that blends seamlessly with the app's glass-morphism design.

Brand name: **stoa**

## Design

### Window Configuration

- **Frameless window**: Set `frame: false` on `BrowserWindow` in `src/main/index.ts`
- Remove `Menu.setApplicationMenu()` or set to `null` to hide the menu bar
- Set `backgroundColor` to `#f4f5f8` (canvas color) to match app theme

### Title Bar Component: `TitleBar.vue`

**Location**: `src/renderer/components/TitleBar.vue`

**Layout**: 36px height, horizontal flex row spanning full width

```
[ stoa-logo | "stoa" |            (drag area)            | — □ ✕ ]
```

- **Left section**: stoa brand logo (purple rounded square with "S") + "stoa" text
- **Center/blank**: `webkit-app-region: drag` for window dragging
- **Right section**: Windows-style window controls (minimize, maximize, close)
  - Gray icons by default (`#999`)
  - Hover: light gray background (`rgba(0,0,0,0.05)`)
  - Close hover: red background (`#e81123`) with white icon

**Styling**:
- Background: `linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.65))` with `backdrop-filter: blur(20px)`
- Bottom border: `1px solid rgba(0,0,0,0.04)`
- Window controls are `webkit-app-region: no-drag`

### IPC for Window Controls

Expose minimize/maximize/close via preload API or use existing IPC channels. The title bar component calls these on button click.

### Layout Integration

In `AppShell.vue`, place `TitleBar` above the existing main grid:

```
<div class="flex flex-col h-full">
  <TitleBar />
  <main class="grid grid-cols-[56px_1fr] flex-1 min-h-0 ...">
    ...
  </main>
</div>
```

## Files to Modify

1. `src/main/index.ts` — frameless window config, remove menu bar
2. `src/renderer/components/TitleBar.vue` — new component
3. `src/renderer/components/AppShell.vue` — integrate TitleBar into layout
4. `src/preload/index.ts` — expose window control APIs (minimize/maximize/close) if not already available
