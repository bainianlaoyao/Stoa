# Session Archive UI Reintegration Design

**Date**: 2026-04-22
**Status**: Approved by user
**Scope**: Move archive interactions back into the session hierarchy so archiving becomes an in-item state transition instead of a separate surface

## Problem

The current archive implementation is structurally split across two unrelated UI surfaces:

1. In `WorkspaceHierarchyPanel.vue`, each session row renders a standalone archive button as a sibling beside the session item.
2. Archived sessions are then moved to a separate `ArchiveSurface.vue`, reachable from a dedicated activity bar entry.

That creates three issues:

- The archive action is visually detached from the session item it modifies.
- The archive experience breaks hierarchy continuity by pushing the user into a separate page.
- The resulting structure conflicts with the repository design language, which prefers calm layering, unified surfaces, and local state transitions over fragmented control clusters.

The intended model is simpler: archive is part of the session item itself, and archived sessions still belong to the same hierarchy panel.

## Approved Design Direction

Archive and restore are integrated into the existing session hierarchy. A session row remains the primary unit of interaction, and archive state is expressed as:

- a row-internal trailing action area
- a change in grouping within the same hierarchy panel
- a subdued archived visual state using existing design tokens

The dedicated archive surface is removed. The dedicated archive activity bar entry is removed. Archived sessions remain visible inside the hierarchy under a collapsible archived section.

## Goals

1. Make archive / restore feel native to the session row instead of bolted on.
2. Preserve hierarchy continuity by keeping archived sessions in the same panel.
3. Reuse the same row component structure for active and archived sessions.
4. Keep the visual language aligned with the project's Modern Minimalist Glassmorphism + Clean UI rules.
5. Reduce navigation friction by removing page-switching for archive management.

## Non-Goals

This redesign does not introduce:

- a new modal confirmation flow
- multi-select archive management
- a separate archive management page
- compatibility shims for the previous archive surface architecture

Prototype-stage breaking change is acceptable and preferred.

## Information Architecture

### Before

```text
GlobalActivityBar
├── workspace surface
│   └── hierarchy panel
│       └── session row + external archive button
└── archive surface
    └── archived session cards
```

### After

```text
WorkspaceHierarchyPanel
├── Active sessions
│   └── session rows
└── Archived sessions (collapsible section)
    └── archived session rows
```

Archive becomes a state change within the hierarchy, not a navigation destination.

## Component Architecture

### Session Row Structure

Each session row should be a single cohesive surface with two internal regions:

```text
session-row
├── session-row__main
│   ├── title
│   └── metadata/status
└── session-row__actions
    └── archive or restore action
```

The action control is part of the row layout, not a separate sibling element outside the row.

### Hierarchy Structure

Within each project block in `WorkspaceHierarchyPanel.vue`:

```text
project group
├── active session rows
└── archived subsection
    ├── archived subsection header
    └── archived session rows
```

The archived subsection should be collapsible. Collapsed by default is acceptable if it reduces noise, but the section must remain visible enough that archived sessions still feel local to the project context.

## Visual Design Rules

All styling must follow `docs/engineering/design-language.md`.

### Shared Row Language

Both active and archived rows must reuse the same structural styling foundation:

- surface driven by `var(--surface-solid)` or the existing row token pattern
- border limited to `1px solid var(--line)` where needed
- text hierarchy from `var(--text-strong)`, `var(--text)`, `var(--muted)`, `var(--subtle)`
- restrained transitions using `transition: all 0.2s ease`

### Active Session Row

Active rows retain normal contrast and current hierarchy emphasis.

### Archived Session Row

Archived rows should communicate lower priority without looking disabled or broken:

- lower text contrast for metadata
- subtler background response on hover
- no heavy badge treatment
- restore action presented as the primary row-local recovery control

The archived state should feel "present but secondary," not hidden or visually punished.

### Action Area

The trailing action area should feel like part of the row composition:

- always structurally present inside the row
- visually quiet by default
- slightly more visible on row hover or focus
- no floating detached icon button style

### Archived Section Header

The archived subsection header should be lightweight and token-based:

- small UI typography
- muted color
- optional count label
- compact disclosure affordance

It should read as local list structure, not as a separate panel.

## Interaction Design

### Archive Flow

When the user archives an active session:

1. The archive action is triggered from inside that session row.
2. The session is removed from the active session group.
3. The session appears in the archived subsection for the same project.
4. No surface switch occurs.
5. Focus and context stay inside the hierarchy panel.

### Restore Flow

When the user restores an archived session:

1. The restore action is triggered from that archived row.
2. The session leaves the archived subsection.
3. The session returns to the active session group for the same project.
4. No route or surface change occurs.

### Open Behavior

The archived row may remain visible and readable in the list, but the key requirement is that restore is local and obvious. If the implementation keeps archived rows non-navigating, that is acceptable as long as the restore path is immediate and clear.

## State Model

The existing `archived: boolean` session field remains valid. The redesign is architectural and presentational, not a new data-model direction.

Required implications:

- active session collections filter `archived !== true`
- archived session collections derive from the same underlying project session data
- no separate archive-only surface state should remain in the renderer shell

## Required Frontend Changes

### `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

This component becomes the primary archive UI owner.

Required changes:

- remove the external sibling archive button structure
- move archive / restore controls into the session row layout
- render archived sessions in a dedicated collapsible subsection inside each project group or a shared archived section if that matches the current hierarchy shape better
- keep event propagation correct so row actions do not accidentally trigger row selection

### `src/renderer/components/command/CommandSurface.vue`

Update event wiring if the hierarchy component emits archive / restore from the new internal row structure, but keep the surface architecture focused on the main command workspace only.

### `src/renderer/components/AppShell.vue`

Remove archive-surface switching logic.

Required changes:

- remove archive from shell-level active surface handling
- stop conditionally rendering `ArchiveSurface.vue`
- keep workspace and settings surfaces only, unless other surfaces already exist for unrelated reasons

### `src/renderer/components/chrome/GlobalActivityBar.vue`

Remove the archive entry from the activity bar because archive is no longer a top-level destination.

### `src/renderer/components/archive/ArchiveSurface.vue`

Delete this component entirely unless some small reusable internal fragment is worth moving into the hierarchy row system. Do not preserve it for compatibility.

### `src/renderer/app/App.vue`

Keep archive / restore handlers only as state operations; remove any surface-navigation behavior tied to archive management.

### `src/renderer/stores/workspaces.ts`

Adjust derived state so the hierarchy can render both active and archived session groups from one coherent source of truth.

The store should support:

- active sessions for the main project hierarchy
- archived sessions grouped in-list for rendering
- row-local archive / restore actions without page loading assumptions

## Required Backend / IPC Position

No conceptual backend redesign is required if archive / restore IPC already exists and persists the `archived` flag correctly.

However, any renderer-facing API added only to support the old dedicated archive page should be reevaluated and removed if no longer necessary. The UI should not depend on a separate archive listing route or surface-specific fetch path unless the shared store still benefits from one canonical archived-session query.

## Testing Requirements

Following `AGENTS.md`, the redesign is not complete until `npx vitest run` passes with zero unexpected failures.

### Component Tests

Add or update tests covering:

- session row renders archive action inside the row structure
- archived rows render inside the hierarchy, not in a separate archive surface
- archived subsection disclosure behavior
- restore action placement and emission from archived rows
- activity bar no longer renders archive entry

### Store Tests

Add or update tests covering:

- active hierarchy excludes archived rows from the active section
- archived rows are still derivable for in-panel rendering
- archive / restore actions move sessions between derived groups without losing project association

### Integration / E2E Tests

Add or update tests covering:

- archiving a session updates the visible hierarchy without switching surfaces
- restoring a session returns it to the active list
- archived sessions remain persisted across restart
- no archive surface route or activity-bar path remains

## File Impact Summary

| File | Change |
|---|---|
| `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | Reintegration of archive UI into session rows and archived subsection rendering |
| `src/renderer/components/command/CommandSurface.vue` | Event wiring updates |
| `src/renderer/components/AppShell.vue` | Remove archive surface switching |
| `src/renderer/components/chrome/GlobalActivityBar.vue` | Remove archive destination entry |
| `src/renderer/components/archive/ArchiveSurface.vue` | Delete |
| `src/renderer/app/App.vue` | Simplify archive/restore handling around in-panel behavior |
| `src/renderer/stores/workspaces.ts` | Unify active/archived hierarchy derivation |
| Related renderer tests | Update for hierarchy-based archive UX |

## Rationale

This design matches the user's approved direction: the archive interface belongs inside the session item and the surrounding hierarchy, not in a detached page. It also better matches the repository's design language by favoring local transitions, unified surfaces, restrained emphasis, and token-driven hierarchy.

## Approval

Approved by the user in chat on 2026-04-22.
