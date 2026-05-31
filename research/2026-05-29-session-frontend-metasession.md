---
date: 2026-05-29
topic: session-frontend-metasession
status: completed
mode: context-gathering
sources: 47
---

## Context Report: Frontend UI Logic for Session Parent/Child Relationships

### Why This Was Gathered
Identify where frontend-visible management UI would need to change to support session parent/child relationships and management actions controlled by stoa-ctl. Need to understand current session UI architecture, data models, and stoa-ctl integration points.

### Summary
The current codebase has a two-level hierarchy (Project → Sessions) with a separate MetaSession system that can target multiple work sessions via proposals. There is no explicit parent-child session relationship in the data model. The UI components for meta-sessions are in `src/renderer/components/meta-session/` and communicate with the backend via IPC channels defined in `src/core/ipc-channels.ts`. The `stoa-ctl` CLI tool has HTTP-based control endpoints but no direct UI integration.

### Key Findings

#### 1. Current Session Hierarchy is Flat (Project → Sessions)

The existing data model does not support parent-child session relationships beyond project containment.

**SessionSummary** (`src/shared/project-session.ts:122-145`):
- Only `projectId: string` field linking sessions to projects
- No `parentSessionId` or `childSessionIds` fields
- Sessions stored as flat array within projects

**PersistedSession** (`src/shared/project-session.ts:113-186`):
```typescript
export interface PersistedSession {
  session_id: string
  project_id: string  // ← Only parent reference
  type: SessionType
  title: string
  // ... no child session tracking
}
```

#### 2. MetaSession Proposal Targeting is NOT Parent-Child

The MetaSession system targets work sessions via proposals, but this is proposal-based targeting, not hierarchical parent-child relationships.

**MetaSessionProposal** (`src/shared/meta-session.ts:58-98`):
```typescript
export interface MetaSessionProposal {
  id: string
  metaSessionId: string  // ← Owning meta-session (not parent)
  targetSessionIds: string[]  // ← Target work sessions (not children)
  riskLevel: MetaSessionCapabilityLevel
  status: MetaSessionProposalStatus
  // ...
}
```

#### 3. Frontend Session UI Components

**MetaSessionSurface.vue** (`src/renderer/components/meta-session/MetaSessionSurface.vue:1-37`):
- Main meta-session layout component
- 3-column grid: 240px sidebar, flexible center, 320px inspector
- Child components: SessionList, TerminalDeck, InspectorPanel
- Emits `createWorkspaceSession` events

**MetaSessionSessionList.vue** (`src/renderer/components/meta-session/MetaSessionSessionList.vue:1-582`):
- Session list selector with active/archived filtering (lines 14-28)
- Provider button management (lines 30-48)
- `handleProviderCreate` creates meta-sessions via `metaSessionStore.createSession()` (lines 97-108)
- Session selection on click (line 162)
- Archive/restore functionality (lines 175-241)

**MetaSessionActionPanel.vue** (`src/renderer/components/meta-session/MetaSessionActionPanel.vue:1-118`):
- Approve button → `metaSessionStore.approveProposal()` (line 21-22)
- Reject button → `metaSessionStore.rejectProposal()` (lines 29-30)
- "Approve and Execute" → `metaSessionStore.approveAndDispatchProposal()` (lines 39-40)
- Archive session → `metaSessionStore.archiveSession()` (lines 46-49)

#### 4. MetaSession Pinia Store

**stores/meta-session.ts** (`src/renderer/stores/meta-session.ts:34-274`):
- State: `sessions`, `activeMetaSessionId`, `inspectorTarget`, `proposals`
- Actions: `createSession()`, `setActiveSession()`, `archiveSession()`, `restoreSession()`
- Proposal actions: `approveProposal()`, `rejectProposal()`, `approveAndDispatchProposal()`
- Hydration from `window.stoa.getMetaSessionBootstrapState()` (lines 136-153)
- Event subscription via `window.stoa.onMetaSessionEvent()` (lines 188-192)

#### 5. IPC Channels for Session Management

**ipc-channels.ts** (`src/core/ipc-channels.ts:17-28`):
```typescript
metaSessionBootstrap: 'meta-session:bootstrap'
metaSessionCreate: 'meta-session:create'
metaSessionSetActive: 'meta-session:set-active'
metaSessionArchive: 'meta-session:archive'
metaSessionRestore: 'meta-session:restore'
metaSessionEvent: 'meta-session:event'
metaSessionProposalList: 'meta-session:proposal-list'
metaSessionProposalGet: 'meta-session:proposal-get'
metaSessionProposalApprove: 'meta-session:proposal-approve'
metaSessionProposalReject: 'meta-session:proposal-reject'
metaSessionProposalDispatch: 'meta-session:proposal-dispatch'
metaSessionInspectorSetTarget: 'meta-session:inspector-set-target'
```

**preload/index.ts** (`src/preload/index.ts:108-140`): Exposes all meta-session IPC calls via `window.stoa` API

#### 6. stoa-ctl Integration Points

**stoa-ctl CLI** (`tools/stoa-ctl/index.ts:510-617`):
- `meta-sessions list/create/get/archive/restore/activate`
- `proposals list/create/get/wait`
- `dispatch proposal <id>` / `dispatch preset <name>`
- HTTP-based communication with control server

**MetaSessionControlServer** (`src/core/meta-session-control-server.ts:156-160`):
- HTTP control server for stoa-ctl communication
- Routes: `/ctl/whoami`, `/ctl/capabilities`, `/ctl/state/brief`, `/ctl/work-sessions/*`

**Bootstrap Prompt** (`src/core/meta-session-bootstrap-prompt.ts:3-28`):
- Instructs meta-session to use `stoa-ctl work-sessions context <id>` for session inspection
- Lists available stoa-ctl commands

**Command Environment** (`src/core/meta-session-command-env.ts:1-25`):
- Sets `STOA_META_SESSION=1`, `STOA_META_SESSION_ID`, `STOA_SESSION_ID`
- Sets `STOA_CTL_BASE_URL`, `STOA_CTL_COMMAND`
- Adds stoa-ctl bin dir to PATH

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Flat session hierarchy (Project → Sessions) | `src/shared/project-session.ts` | lines 122-145 |
| No parent-child session fields | `src/shared/project-session.ts` | lines 113-186 |
| MetaSession targets via proposals, not hierarchy | `src/shared/meta-session.ts` | lines 58-98 |
| MetaSessionSurface layout component | `src/renderer/components/meta-session/MetaSessionSurface.vue` | lines 1-37 |
| SessionList selector component | `src/renderer/components/meta-session/MetaSessionSessionList.vue` | lines 1-582 |
| ActionPanel for proposals | `src/renderer/components/meta-session/MetaSessionActionPanel.vue` | lines 1-118 |
| Pinia store with session actions | `src/renderer/stores/meta-session.ts` | lines 34-274 |
| IPC channel definitions | `src/core/ipc-channels.ts` | lines 17-28 |
| Preload API exposure | `src/preload/index.ts` | lines 108-140 |
| stoa-ctl CLI commands | `tools/stoa-ctl/index.ts` | lines 510-617 |
| HTTP control server | `src/core/meta-session-control-server.ts` | lines 156-160 |
| Bootstrap prompt instructions | `src/core/meta-session-bootstrap-prompt.ts` | lines 3-28 |
| stoa-ctl command environment | `src/core/meta-session-command-env.ts` | lines 1-25 |

### Required Changes for Parent/Child Session Support

#### A. Data Model Changes (Backend)

1. **Add parent-child fields to SessionSummary** (`src/shared/project-session.ts`)
   - Add `parentSessionId: string | null` field
   - Add `childSessionIds: string[]` field (or derive computed)
   - Update persistence schema version

2. **Add IPC channels for parent-child operations** (`src/core/ipc-channels.ts`)
   - `sessionLinkChild: 'session:link-child'` - Link child session
   - `sessionUnlinkChild: 'session:unlink-child'` - Unlink child session
   - `sessionGetChildren: 'session:get-children'` - Get child sessions
   - `sessionSetParent: 'session:set-parent'` - Set parent session

3. **Update ProjectSessionManager** (`src/core/project-session-manager.ts`)
   - Implement `linkChildSession()` method
   - Implement `unlinkChildSession()` method
   - Implement `getChildSessions()` method
   - Handle parent-child cleanup on session deletion

#### B. Frontend UI Changes

1. **Update MetaSessionSessionList.vue** (`src/renderer/components/meta-session/MetaSessionSessionList.vue`)
   - Add tree/list UI for parent-child display
   - Add expand/collapse for child sessions
   - Add context menu or action buttons for linking/unlinking

2. **Update meta-session Pinia store** (`src/renderer/stores/meta-session.ts`)
   - Add `linkChild()` action
   - Add `unlinkChild()` action
   - Add `childSessions` computed property
   - Add IPC calls for parent-child operations

3. **Update preload API** (`src/preload/index.ts`)
   - Expose `linkChildSession()`, `unlinkChildSession()`, `getChildSessions()`

4. **Update MetaSessionInspectorPanel.vue** (`src/renderer/components/meta-session/MetaSessionInspectorPanel.vue`)
   - Display child sessions in inspector when session is selected
   - Show parent-child relationship visualization

#### C. stoa-ctl Integration

1. **Add parent-child commands** (`tools/stoa-ctl/index.ts`)
   - `work-sessions link <parent-id> <child-id>`
   - `work-sessions unlink <parent-id> <child-id>`
   - `work-sessions children <session-id>`
   - `work-sessions parent <session-id>`

2. **Add HTTP control endpoints** (`src/core/meta-session-control-server.ts`)
   - `/ctl/work-sessions/link`
   - `/ctl/work-sessions/unlink`
   - `/ctl/work-sessions/children`
   - `/ctl/work-sessions/parent`

### Risks / Unknowns

- **[!]** The current design treats MetaSession as the "parent" of work sessions via proposals, but this is proposal-based targeting, not a true parent-child hierarchy. Adding parent-child relationships may conflict with or need to integrate with the existing proposal system.
- **[?]** Unknown whether `stoa-ctl` should have full parent-child CRUD or just read/notify capabilities - requires clarification on UX design.
- **[?]** Unknown how parent-child relationships should affect session lifecycle (e.g., if parent is archived, what happens to children?).
- **[?]** Unknown whether parent-child sessions should be visible in TerminalDeck or only in the session list.
- **[?]** The MetaSessionProposalSnapshotSession structure suggests snapshot-based targeting - need to clarify if child sessions are live references or snapshots.

---

## Context Handoff: Session Frontend Metasession

Start here: `D:\Data\DEV\ultra_simple_panel\research\2026-05-29-session-frontend-metasession.md`

Context only. Use the saved report as the source of truth.