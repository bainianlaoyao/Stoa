# Session Quick-Create: Floating Card & Radial Menu

Date: 2026-04-22
Status: Draft — Pending user approval

## Confirmed Decisions

1. **Radial layout**: 0°/180° (top/bottom) — confirmed
2. **Trigger modes**: All three (click, long-press, right-click) — confirmed
3. **Auto-naming**: `shell-{N}` for shell, `opencode-{projectName}` for opencode — confirmed

## Problem

The current "add session" flow uses `NewSessionModal.vue`, a global modal dialog (via `BaseModal` + Teleport). The modal requires:
1. Moving the mouse from the sidebar `+` button to the center of the screen
2. Filling in a session title field
3. Selecting a provider from a `<select>` dropdown
4. Clicking "Create"

This is too many steps and too much mouse travel for a frequent action. The modal is overqualified for what it does — selecting between 2 providers.

## Decision

Replace the global modal with two mouse-proximate interaction modes:

- **Mode A (click)**: Floating icon card anchored to the `+` button
- **Mode B (long-press)**: Full-ring radial menu centered on the `+` button
- **Mode C (right-click)**: Floating icon card at mouse position on project row

Both modes eliminate the title input (auto-named) and the dropdown (replaced by icon grid/ring). Session creation becomes a single-click or press-sweep-release gesture.

## What is Removed

- `NewSessionModal.vue` — replaced entirely
- Title input field — sessions are auto-named `{typeLabel}-{N}`
- Provider `<select>` dropdown — replaced by icon cells
- The modal overlay (`rgba(0,0,0,0.45)` dimming)

## What is Added

| Component | Purpose |
|---|---|
| `ProviderFloatingCard.vue` | Floating icon card (Mode A + C) |
| `ProviderRadialMenu.vue` | Full-ring radial menu (Mode B) |
| `provider-icons.ts` | Provider icon definitions (SVG + metadata) |
| CSS additions in `styles.css` | Floating card, radial menu, improved `+` button |

## Mode A — Floating Icon Card

### Trigger

Click the `+` button on any project row.

### Behavior

1. `+` button clicked → calculate position via `getBoundingClientRect()`
2. Teleport `ProviderFloatingCard` to `<body>` with `position: fixed`
3. Card appears to the right of the `+` button, vertically centered
4. Card shows provider icons in a horizontal row
5. Click an icon → emit `create` with `{ type, projectId }` → card closes
6. Click outside card / press Escape → card closes

### Layout

```
┌─────────────────────────────────┐
│ ▸ my-project               ⊕─────── ┌────────────────────┐
│   /Users/dev/my-project          │   │  ┌────┐  ┌────┐   │
│   ● shell-1                      │   │  │ ▣  │  │ >_ │   │
│                                  │   │  └────┘  └────┘   │
└─────────────────────────────────┘   │   OC      Shell    │
                                      └────────────────────┘
```

- Icon cell: 52×52px each
- Gap: 4px
- Card padding: 6px
- Total card: ~120×64px
- Anchor: `left = rect.right + 4`, `top = rect.top - 4`

### Styling

```css
.provider-floating-card {
  position: fixed;
  z-index: 100;
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);      /* 12px */
  box-shadow: var(--shadow-soft);
  padding: 6px;
  display: flex;
  gap: 4px;
}
```

## Mode B — Full-Ring Radial Menu

### Trigger

Long-press the `+` button for 200ms.

### Behavior

1. `mousedown` on `+` → start 200ms timer
2. At 150ms → `+` button `scale(1.05)` pulse feedback
3. At 200ms → long-press confirmed, show radial menu
4. Teleport `ProviderRadialMenu` to `<body>` with `position: fixed`
5. Ring is centered on the `+` button's `getBoundingClientRect()` center
6. Drag to a provider icon → that icon enters active state
7. `mouseup` on active icon → emit `create` → menu closes
8. `mouseup` on blank area → menu cancels, fade out 100ms
9. If `mouseup` occurs before 200ms → treat as click → Mode A instead

### Layout

```
              ┌────┐
              │ ▣  │  ← OpenCode (0°, top)
              │ OC │
              └────┘
                 │
            · · ○ · ·   ← ring track (var(--line), 1.5px)
                 │
  sidebar    ⊕ (anchor)
                 │
            · · ○ · ·
                 │
              ┌────┐
              │ >_ │  ← Shell (180°, bottom)
              │Shl │
              └────┘
```

- Ring radius: 52px (center to icon center)
- Icon cell: 36×36px
- Ring track: `width: 104px; height: 104px`
- Total diameter: ~140px
- 2 providers placed at 0° and 180° (top/bottom)
- With N providers, they distribute evenly around the full 360°

### Positioning

The ring is centered on the `+` button. Since the `+` button is near the right edge of the 240px sidebar, the ring will extend ~70px into the terminal viewport area. This is acceptable because the ring is a floating layer (`position: fixed`, `z-index: 200`) and does not affect layout.

### Styling

```css
.radial-menu {
  position: fixed;
  z-index: 200;
  pointer-events: none;
}

.radial-menu__track {
  position: absolute;
  border: 1.5px solid var(--line);
  border-radius: 50%;
  width: 104px;
  height: 104px;
}

.radial-menu__item {
  position: absolute;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface);
  backdrop-filter: blur(40px) saturate(120%);
  -webkit-backdrop-filter: blur(40px) saturate(120%);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s ease;
}

.radial-menu__item--active {
  background: var(--surface-solid);
  border-color: rgba(0, 0, 0, 0.04);
  box-shadow: var(--shadow-card);
}
```

### Animation

All animations are restrained per design-language requirements:

- **Track in**: `opacity 0→1, scale(0.85→1)`, 150ms ease-out
- **Items in**: translate from center to final position, 120ms ease-out, staggered 30ms
- **Confirm**: `opacity → 0`, 150ms ease (no scale)
- **Cancel**: `opacity → 0`, 100ms ease

No spring, no bounce, no exaggerated scaling.

## Mode C — Right-Click on Project Row

### Trigger

Right-click anywhere on a project row in the sidebar.

### Behavior

Same as Mode A, but the floating card is positioned at the mouse cursor coordinates (`event.clientX`, `event.clientY`) instead of anchored to the `+` button.

## `+` Button Improvements

### Current

```css
.route-add-session {
  width: 18px;
  height: 18px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
}
```

### New

```css
.route-add-session {
  width: 24px;                  /* larger hit target */
  height: 24px;
  border: 0;
  border-radius: 999px;        /* circular */
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  font-weight: 300;
  transition: all 0.2s ease;
}

.route-add-session:hover {
  background: var(--black-soft);    /* rgba(0,0,0,0.04) */
  color: var(--text-strong);
}
```

Tooltip on hover: `"Add session (long-press for radial)"`

## Provider Icons

```typescript
// src/renderer/composables/provider-icons.ts

interface ProviderIcon {
  type: SessionType
  label: string
  svg: string               // complete inline SVG string
  viewBox: string            // SVG viewBox
}

const PROVIDER_ICONS: ProviderIcon[] = [
  {
    type: 'opencode',
    label: 'OC',
    viewBox: '0 0 512 512',
    // Official OpenCode favicon-v3.svg "C" bracket mark
    // Source: https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/ui/src/assets/favicon/favicon-v3.svg
    // Uses fill (solid shape)
    svg: '<rect width="512" height="512" fill="#131010"/>'
       + '<path d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="white"/>'
       + '<path d="M320 224V352H192V224H320Z" fill="#5A5858"/>'
  },
  {
    type: 'shell',
    label: 'Shell',
    viewBox: '0 0 24 24',
    // Classic terminal icon: rectangle + prompt chevron + underscore
    // Uses stroke (line drawing), NOT fill
    svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
       + '<path d="M7 8l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
       + '<line x1="13" y1="14" x2="17" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  }
]
```

**Important rendering difference**:
- OpenCode icon uses `fill` (solid colored shapes on dark background)
- Shell icon uses `stroke` with `currentColor` (line drawing that inherits text color)

Icon labels use:
- Font: `var(--font-ui)` (UI labels)
- Size: 9px
- Weight: 600
- Color: `var(--muted)`

## Auto-Naming

Sessions are auto-named on creation. The naming strategy differs by provider type:

```
Shell:     shell-{N}           where N = count of existing shell sessions in project + 1
OpenCode:  opencode-{name}     where name = project name (from hierarchy node)

Examples (project "infra-control"):
  First shell session    → "shell-1"
  Second shell session   → "shell-2"
  First opencode session → "opencode-infra-control"
  Second opencode session → "opencode-infra-control"  (same — duplicates acceptable, distinguished by session ID)
```

If duplicate `opencode-{name}` titles are undesirable in the future, append a counter: `opencode-infra-control-2`. For the initial implementation, the simple format is sufficient.

The `title` field in the `createSession` payload is set by the caller (`WorkspaceHierarchyPanel`), not by user input. The `projectId` prop provides access to the project name via the hierarchy data.

## Teleport & Positioning Strategy

Both floating card and radial menu MUST use `<Teleport to="body">` with `position: fixed`. The sidebar `.workspace-hierarchy-panel` has `overflow: hidden`, which would clip any `position: absolute` child.

### Position Calculation

```typescript
function getButtonPosition(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  }
}
```

- **Floating card**: `left = rect.right + 4`, `top = rect.top - 4`
- **Radial menu**: center = `{ x: rect.left + rect.width/2, y: rect.top + rect.height/2 }`
- **Right-click card**: `left = event.clientX`, `top = event.clientY`

## Click-Outside Handling

Floating card only (radial uses press-sweep, no outside click needed):

```typescript
// On Teleported card, listen for mousedown on document
// If target is outside the card element, close the card
// Also close on Escape keydown
```

## Z-Index Stack

| Layer | Z-Index | Content |
|---|---|---|
| Sidebar | auto | `.workspace-hierarchy-panel` |
| Modal overlay | 50 | Current modal (being removed) |
| Floating card | 100 | `ProviderFloatingCard` |
| Radial menu | 200 | `ProviderRadialMenu` |

## Data Flow

### Current

```
+ button click → openSessionModal(projectId)
  → showNewSession = true
  → NewSessionModal opens (global overlay)
  → User fills title + selects type
  → submit() → emit('create', { title, type })
  → WorkspaceHierarchyPanel → emit('createSession', { ...payload, projectId })
  → App.vue → workspaceStore → IPC → backend
```

### New

Both `ProviderFloatingCard` and `ProviderRadialMenu` receive `projectId` as a prop. When the user selects a provider, the component emits `create` with `{ type: SessionType }`. The parent (`WorkspaceHierarchyPanel`) handles auto-title generation and forwards the full payload.

```
+ button click → showFloatingCard(projectId, buttonRect)
  → <ProviderFloatingCard :project-id="projectId" :position="rect" />
  → User clicks provider icon
  → emit('create', { type: SessionType })
  → WorkspaceHierarchyPanel receives { type }
  → auto-generate title: "{typeLabel}-{N}"
  → emit('createSession', { projectId, type, title })
  → App.vue → workspaceStore → IPC → backend (unchanged)

+ button long-press → showRadialMenu(projectId, buttonRect)
  → <ProviderRadialMenu :project-id="projectId" :position="rect" />
  → User sweep-releases on provider icon
  → emit('create', { type: SessionType })
  → same flow as above

project row right-click → showFloatingCard(projectId, mouseCoords)
  → same as click flow, positioned at mouse
```

The backend (IPC handler, `project-session-manager`, providers) is **not modified**. Only the renderer-side trigger and UI components change.

### Props Interface

```typescript
// ProviderFloatingCard.vue
defineProps<{
  projectId: string
  position: { x: number; y: number; width: number; height: number }
}>()

defineEmits<{
  create: [payload: { type: SessionType }]
  close: []
}>()

// ProviderRadialMenu.vue — same interface
```

## Components Removed

- `src/renderer/components/command/NewSessionModal.vue` — deleted
- `src/renderer/components/command/NewSessionModal.test.ts` — deleted

## Components Added

- `src/renderer/components/command/ProviderFloatingCard.vue`
- `src/renderer/components/command/ProviderFloatingCard.test.ts`
- `src/renderer/components/command/ProviderRadialMenu.vue`
- `src/renderer/components/command/ProviderRadialMenu.test.ts`
- `src/renderer/composables/provider-icons.ts`

## Components Modified

- `src/renderer/components/command/WorkspaceHierarchyPanel.vue` — remove modal refs, add floating card + radial menu, add right-click handler
- `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts` — update tests that reference NewSessionModal
- `src/renderer/styles.css` — add floating card, radial menu, improved `+` button styles

## Frontend Semantic Requirements

### Floating Card — `ProviderFloatingCard.vue`

The floating card is a popup menu. Per `docs/engineering/frontend-semantic-requirements.md`:

```html
<div role="group" aria-label="Session providers">
  <button
    role="menuitem"
    aria-label="Create OpenCode session"
    @click="select('opencode')"
  >
    <!-- OpenCode icon SVG -->
    <span>OC</span>
  </button>
  <button
    role="menuitem"
    aria-label="Create Shell session"
    @click="select('shell')"
  >
    <!-- Shell icon SVG -->
    <span>Shell</span>
  </button>
</div>
```

Key semantic contracts:
- Container: `role="group"` + `aria-label="Session providers"`
- Each icon cell: `<button>` with `aria-label` describing the action (e.g., `"Create Shell session"`)
- No `role="dialog"` needed — this is not a modal, it's a transient popup

### Radial Menu — `ProviderRadialMenu.vue`

Same semantic structure as floating card, but items are positioned on a ring:

```html
<div role="group" aria-label="Session providers (radial)">
  <!-- Ring track (decorative, aria-hidden) -->
  <div class="radial-menu__track" aria-hidden="true" />

  <button
    role="menuitem"
    aria-label="Create OpenCode session"
    :class="{ 'radial-menu__item--active': isActive('opencode') }"
  >
    <!-- icon -->
  </button>
  <button
    role="menuitem"
    aria-label="Create Shell session"
    :class="{ 'radial-menu__item--active': isActive('shell') }"
  >
    <!-- icon -->
  </button>
</div>
```

### `+` Button — Updated ARIA

The existing `+` button already has `aria-label="Add session to {project.name}"`. This remains unchanged. The tooltip content is updated to `"Add session · long-press for radial"`.

### Region Registration

Per the Region Contract, new components must register their `aria-label`:

| Component | aria-label | Role |
|---|---|---|
| ProviderFloatingCard | `"Session providers"` | `role="group"` |
| ProviderRadialMenu | `"Session providers (radial)"` | `role="group"` |

## Testing Plan

Per AGENTS.md test architecture:

### Tier 1: New Component Tests

**`ProviderFloatingCard.test.ts`** — alongside the component:

```
- renders a role="group" with aria-label="Session providers"
- renders one button per provider with correct aria-labels
- clicking a provider button emits create with { type: SessionType }
- pressing Escape emits close
- clicking outside the card emits close
- does not render when not visible
```

**`ProviderRadialMenu.test.ts`** — alongside the component:

```
- renders a role="group" with aria-label="Session providers (radial)"
- renders one button per provider with correct aria-labels
- clicking a provider button emits create with { type: SessionType }
- does not render when not visible
```

### Tier 1: Updated Component Tests

**`WorkspaceHierarchyPanel.test.ts`** — must update:

| Existing Test | Change |
|---|---|
| `'NewSessionModal component is rendered in the wrapper'` | Replace with: `'ProviderFloatingCard component is rendered'` and `'ProviderRadialMenu component is rendered'` |
| Import `NewSessionModal` from `./NewSessionModal.vue` | Remove import, add imports for new components |
| `'clicking "+" does NOT directly emit createSession'` | Keep but update: clicking "+" now shows floating card, not modal |
| `'clicking the named add-session button does NOT emit selectProject'` | Keep unchanged (click.stop still works) |

### Tests Deleted

- `src/renderer/components/command/NewSessionModal.test.ts` — deleted with the component

### Tests Unchanged

- All E2E tests (`tests/e2e/*.test.ts`) — the backend flow is unchanged
- `src/renderer/stores/workspaces.test.ts` — store interface unchanged
- `src/renderer/app/App.test.ts` — IPC flow unchanged

### Test Locator Strategy

All new tests MUST use semantic locators per AGENTS.md:

```typescript
// ✅ Correct — semantic
wrapper.getByRole('group', { name: 'Session providers' })
wrapper.getByRole('button', { name: 'Create Shell session' })

// ❌ Wrong — CSS selector
wrapper.find('.provider-icon-cell')
wrapper.find('.radial-menu__item')
```

## Design Language Compliance

All styles are verified against `docs/engineering/design-language.md`:

| Rule | Compliance |
|---|---|
| Design tokens only | All colors use `var(--*)`, no hardcoded values except accent ring (matches existing codebase pattern) |
| Z-axis hierarchy | Glass surface with `backdrop-filter: blur(40px)`, `var(--shadow-soft)` for inner controls |
| Restrained micro-interactions | `transition: all 0.2s ease`, hover = `var(--black-soft)`, no exaggerated scale |
| Typography discipline | Labels: `var(--font-ui)`, icon descriptions: `var(--muted)` at 9px |
| No decorative animation | No breathing pulse, no spring, no bounce. Only opacity/scale transitions for functional feedback |
| Breaking changes only | Per AGENTS.md: no compatibility code, no migration shims. Clean deletion of old modal. |
