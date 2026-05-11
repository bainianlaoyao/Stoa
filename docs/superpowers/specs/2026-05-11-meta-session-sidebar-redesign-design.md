# Meta Session Sidebar Redesign

Date: 2026-05-11

## Problem

Three issues with the meta session left sidebar:

1. **Visual style mismatch**: Sidebar entries show a plain 6px dot + text status, inconsistent with the TerminalMetaBar's tone-colored chips and timestamps.
2. **Archive not persisted**: Trashing a session removes it from the renderer array but the manager only sets `status: 'closed'`. On restart, closed sessions reappear because the bootstrap state includes them and there is no `archived` field on `MetaSessionSummary`.
3. **Selection jump**: `setActiveSession()` updates `updatedAt` to `now()`, and the sidebar sorts by `updatedAt` descending, causing the selected session to jump to the top.

## Design

### 1. Add `archived` field to data model

Add `archived: boolean` to both `MetaSessionSummary` and `PersistedMetaSession`:

```
MetaSessionSummary.archived: boolean          // default false
PersistedMetaSession.archived: boolean        // default false
```

- Manager: `createSession()` sets `archived: false`
- Manager: rename `closeSession()` to `archiveSession()` — sets `archived: true`, persists
- Manager: add `restoreSession(sessionId)` — sets `archived: false`, persists
- Manager mappers `toSummary()` and `toPersisted()` updated for the new field
- Renderer store: `archiveSession(sessionId)` calls bridge, filters local array
- Renderer store: `restoreSession(sessionId)` calls bridge, restores in local array
- Preload bridge: expose `archiveMetaSession` and `restoreMetaSession` IPC channels

Sidebar display:
- Main list shows only `archived === false` sessions
- Collapsible "Archived" section at the bottom shows archived sessions
- Archived rows show a restore icon on hover (replaces trash icon)

### 2. Compact sidebar entry style

Each row becomes a two-line layout in the same visual language as TerminalMetaBar:

```
[provider-icon] [title]
                [status-chip] [5m ago] [· N pending]
```

- **Line 1**: Provider icon (18px) + title in `--font-mono`, `--text-body-sm`, ellipsis-truncated
- **Line 2**: Status chip (inline-flex pill, `border-radius: var(--radius-lg)`, tone-colored text matching TerminalMetaBar pattern) + relative timestamp computed from `updatedAt` using the same `updatedAgoLabel` logic + pending count (only when `pendingProposalCount > 0`)
- Remove the 6px `route-dot` — the chip replaces it
- Grid: `grid-template-columns: 18px 1fr` for icon + content block
- Active indicator: keep the 2px left border accent (`--color-active-indicator`)
- Pending count format: `· N pending` in `--color-muted`, `--font-mono`

Status chip tone mapping (reuses existing mapping):
- `running/starting` → accent (blue)
- `waiting_approval` → warning (amber)
- `idle` → success (green)
- `failed` → danger (red)
- `created/closed` → neutral

Time formatting:
- Reuse the `updatedAgoLabel` logic: `updatedAt` relative to now, "< 1min" → "Just now", otherwise "Nm ago"

### 3. Stable sort by `createdAt`

- `orderedSessions` computed changes from sorting by `updatedAt` desc to sorting by `createdAt` desc
- Sessions stay where they were first created — no position changes on selection
- Manager's `setActiveSession()` stops mutating `updatedAt` — only sets `lastActivatedAt`
- `updatedAt` continues to be updated by `updateSession()` (status changes, proposal counts) for the timestamp display, but is no longer a sort key

## Files to modify

- `src/shared/meta-session.ts` — Add `archived` to types
- `src/core/meta-session-manager.ts` — Add archive/restore methods, stop mutating `updatedAt` in `setActiveSession`
- `src/core/meta-session-manager.test.ts` — Update tests for new methods
- `src/renderer/stores/meta-session.ts` — Add archive/restore actions, filter archived sessions
- `src/renderer/components/meta-session/MetaSessionSessionList.vue` — New two-line layout, archive section, stable sort
- Preload/IPC bridge — Expose `archiveMetaSession`, `restoreMetaSession` channels
