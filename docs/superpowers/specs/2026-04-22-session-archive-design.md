# Session Archive Feature Design

## Summary

Add archive/restore functionality to sessions. Currently sessions can only be created — they accumulate indefinitely in the sidebar. Archiving hides them from the active view and terminates any running process. Archived sessions are preserved and viewable on a dedicated archive page where they can be restored.

## Requirements

1. Any session (regardless of status) can be archived
2. Archiving a running session terminates its PTY process
3. Archived sessions are hidden from the main workspace list
4. Archived sessions are preserved in state and viewable on a dedicated archive page
5. Archived sessions can be restored back to the active list
6. Each session card has a direct archive button
7. The archive page is accessible via the GlobalActivityBar

## Approach: `archived` boolean field

Add an `archived: boolean` field to the existing session data structures. This is the simplest approach — no data migration, no separate storage, O(1) archive/restore operations. Session array growth is acceptable at prototype stage.

## Data Model Changes

### `src/shared/project-session.ts`

```
SessionSummary   += archived: boolean
PersistedSession += archived: boolean
```

`archived` is independent of `SessionStatus`. A session retains its status when archived.

New `RendererApi` methods:
- `archiveSession(sessionId: string): Promise<void>`
- `restoreSession(sessionId: string): Promise<void>`
- `listArchivedSessions(): Promise<SessionSummary[]>`

## Backend

### `src/core/project-session-manager.ts`

New methods:
- `archiveSession(sessionId)` — sets `archived=true`, persists
- `restoreSession(sessionId)` — sets `archived=false`, persists
- `getArchivedSessions()` — returns sessions where `archived=true`

`toBootstrapState` and `toPersistedState` map the `archived` field bidirectionally.

`sessions` array always contains all sessions (active + archived). Consumers filter as needed.

### `src/core/ipc-channels.ts`

New channels:
- `sessionArchive: 'session:archive'`
- `sessionRestore: 'session:restore'`
- `sessionListArchived: 'session:list-archived'`

### `src/main/index.ts`

New IPC handlers:
- `session:archive` — calls `ptyHost.dispose(sessionId)` to terminate process, then `manager.archiveSession(sessionId)`
- `session:restore` — calls `manager.restoreSession(sessionId)` (does NOT auto-start the session)
- `session:list-archived` — returns `manager.getArchivedSessions()`

`ptyHost.dispose()` is a no-op on non-running sessions — safe to call unconditionally.

Bootstrap recovery plan skips archived sessions (check `archived` flag).

### `src/preload/index.ts`

Wire new IPC channels to the `RendererApi` methods.

## Frontend

### Pinia Store (`src/renderer/stores/workspaces.ts`)

- `projectHierarchy` computed filters out `archived=true` sessions
- `addSession` sets `archived` default to `false`
- New: `archivedSessions` ref populated by `loadArchivedSessions()`
- New: `archiveSession(sessionId)` action — calls IPC, marks session in local array
- New: `restoreSession(sessionId)` action — calls IPC, unmarks session in local array
- New: `loadArchivedSessions()` action — calls `listArchivedSessions()` IPC

### UI Components

**WorkspaceList.vue** — Each session card gains an archive button (icon). Click emits `archiveSession` event.

**App.vue** — New `handleArchiveSession` handler: calls store action + IPC.

**New: ArchiveView.vue** — Dedicated page listing archived sessions grouped by project. Each session shows a "restore" button. Minimal: title, type, status, date, restore button.

**AppShell.vue** — Controls view switching between workspace and archive views via a `currentView` ref toggled by GlobalActivityBar.

**GlobalActivityBar.vue** — Add archive icon. Clicking switches AppShell to archive view.

## View Switching

No Vue Router needed. AppShell manages a `currentView: 'workspace' | 'archive'` ref. GlobalActivityBar emits view-change events. AppShell conditionally renders WorkspaceList or ArchiveView.

## Test Plan

### Unit Tests

- `project-session-manager.test.ts` — archive/restore lifecycle, archived sessions excluded from recovery plan, persisted state round-trip
- `workspaces.test.ts` — projectHierarchy filters archived sessions, archiveSession/restoreSession store actions, loadArchivedSessions

### E2E Tests

- `backend-lifecycle.test.ts` — archive → persist → restart → verify archived flag preserved → restore → verify active again
- `frontend-store-projection.test.ts` — archived sessions excluded from projectHierarchy, appear in archivedSessions
- `ipc-bridge.test.ts` — archive/restore IPC round-trip
- `main-config-guard.test.ts` — verify new IPC channels registered, preload exposes new methods

### Component Tests

- `WorkspaceList.test.ts` — archive button renders, emits correct event
- New `ArchiveView.test.ts` — renders archived sessions, restore button works
- `GlobalActivityBar.test.ts` — archive icon present, emits view switch

## Files Touched

| File | Change |
|------|--------|
| `src/shared/project-session.ts` | Add `archived` field, new RendererApi methods |
| `src/core/ipc-channels.ts` | Add 3 new channels |
| `src/core/project-session-manager.ts` | Add archive/restore/getArchived, update mappers, skip archived in recovery |
| `src/main/index.ts` | Add 3 IPC handlers, skip archived in bootstrap recovery |
| `src/preload/index.ts` | Wire new channels |
| `src/renderer/stores/workspaces.ts` | Filter, new actions |
| `src/renderer/components/WorkspaceList.vue` | Archive button |
| `src/renderer/components/AppShell.vue` | View switching logic |
| `src/renderer/components/GlobalActivityBar.vue` | Archive icon |
| `src/renderer/app/App.vue` | Archive handler |
| New: `src/renderer/components/ArchiveView.vue` | Archive page |
