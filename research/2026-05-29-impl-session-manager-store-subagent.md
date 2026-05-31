---
date: 2026-05-29
topic: impl-session-manager-store-subagent
status: completed
mode: context-gathering
sources: 28
---

## Context Report: Session Tree Support — Persistence & Lifecycle Semantics

### Why This Was Gathered
Bounding the concrete extension points for adding session subtree (parent/child) semantics to `ProjectSessionManager` and `StateStore` — specifically what mutates what, where subtree logic must be injected, and the exact API/payload shapes that change.

---

### Summary

The current system is a flat session list per project — `PersistedSession` has no parent reference, `archiveSession`/`restoreSession` operate on exactly one session, and `getArchivedSessions` returns a flat filter. Subtree support requires: (1) adding `parent_session_id` to session types, (2) cascading archive/restore through children, (3) updating `doPersist` grouping and `getArchivedSessions` display logic, and (4) bumping schema versions.

---

### 1. How Create/Archive/Restore Operations Mutate Persisted State

#### Project Creation — `project-session-manager.ts:342–379`
- Creates `ProjectSummary`, pushes to `this.state.projects` (line 358)
- If no `activeProjectId`, sets it to the new project (line 360)
- On import (existing project path), reads `projectPath/.stoa/sessions.json` via `readProjectSessions` (line 365), filters out already-tracked sessions, maps via `toSessionSummary`, and pushes into `this.state.sessions` (lines 366–371)
- Calls `this.persist()`

#### Session Creation — `project-session-manager.ts:483–530`
- Validates project exists (line 485)
- Creates `SessionSummary` with `archived: false` (line 521) and `id = session_<uuid>` (line 500)
- Pushes to `this.state.sessions` (line 524)
- Sets `activeProjectId = request.projectId` and `activeSessionId = session.id` (lines 525–526)
- Calls `this.persist()`

#### Session Archival — `project-session-manager.ts:458–467`
```typescript
async archiveSession(sessionId: string): Promise<void> {
  const session = this.state.sessions.find(s => s.id === sessionId)
  if (!session) return
  session.archived = true                              // line 461
  session.updatedAt = new Date().toISOString()      // line 462
  if (this.state.activeSessionId === sessionId) {   // line 463
    this.state.activeSessionId = null               // line 464
  }
  await this.persist()                              // line 466
}
```
**Key: No subtree handling.** Operates on exactly one session found by ID.

#### Session Restore — `project-session-manager.ts:469–477`
```typescript
async restoreSession(sessionId: string): Promise<void> {
  const session = this.state.sessions.find(s => s.id === sessionId)
  if (!session) return
  session.archived = false                          // line 472
  this.state.activeProjectId = session.projectId   // line 473
  this.state.activeSessionId = session.id          // line 474
  session.updatedAt = new Date().toISOString()    // line 475
  await this.persist()                             // line 476
}
```
**Key: No subtree handling.** Only restores the single session.

#### Persistence Write — `project-session-manager.ts:685–726`
`doPersist` groups all sessions by `project_id` (lines 694–699) and writes each project's sessions to `projectPath/.stoa/sessions.json` via `writeProjectSessions`, then writes `PersistedGlobalStateV4` to `global.json`. Sessions are written unconditionally — no filter by `archived`.

---

### 2. Where Subtree Semantics Must Be Inserted

#### Archive/Restore Cascade Logic
| Method | Location | Subtree Insertion Point |
|--------|----------|------------------------|
| `archiveSession` | `project-session-manager.ts:458` | After setting `session.archived = true`, find all `this.state.sessions` where `session.parentId === sessionId` and set `archived = true` on each |
| `restoreSession` | `project-session-manager.ts:469` | After setting `session.archived = false`, find all children and set `archived = false` on each |
| `getArchivedSessions` | `project-session-manager.ts:479–481` | Build a set of all archived session IDs, then include any session whose `parentId` is in that set |

#### Display / Enumeration Changes
| Method | Location | Subtree Insertion Point |
|--------|----------|------------------------|
| `getArchivedSessions` | `project-session-manager.ts:479` | Currently: `this.state.sessions.filter(s => s.archived)`. Must expand to include child sessions of archived parents. |

#### Bootstrap / Recovery
| Method | Location | Subtree Insertion Point |
|--------|----------|------------------------|
| `buildBootstrapRecoveryPlan` | `project-session-manager.ts:328–340` | Currently skips all archived sessions via filter. If a parent is alive and children are archived, children remain excluded — already correct for flat exclusion. If children should be restored with parent, this is a design decision. |

#### Project Deletion Cascade
| Method | Location | Subtree Insertion Point |
|--------|----------|------------------------|
| `deleteProject` | `project-session-manager.ts:439–456` | Currently filters sessions by `projectId !== projectId`. If parent sessions live in one project and children in another (cross-project trees), cascade delete logic must handle children explicitly. Currently children are already removed because they share `projectId`. |

---

### 3. Concrete Extension Points

#### Type Changes — `src/shared/project-session.ts`

**`PersistedSession`** (line 163–186): add `parent_session_id?: string | null`
```typescript
export interface PersistedSession {
  // ... existing fields ...
  archived: boolean
  parent_session_id?: string | null  // NEW
}
```

**`SessionSummary`** (line 122–145): add `parentId: string | null`
```typescript
export interface SessionSummary {
  // ... existing fields ...
  archived: boolean
  parentId: string | null  // NEW
}
```

#### Transformers — `src/core/project-session-manager.ts`

**`toPersistedSession`** (lines 62–87): include `parent_session_id`
```typescript
return {
  // ... existing fields ...
  archived: session.archived,
  parent_session_id: session.parentId ?? null  // NEW
}
```

**`toSessionSummary`** (lines 89–114): read `parent_session_id`
```typescript
return {
  // ... existing fields ...
  archived: session.archived ?? false,
  parentId: session.parent_session_id ?? null  // NEW
}
```

#### State-Store Validators — `src/core/state-store.ts`

**`isValidPersistedSession`** (lines 145–187): validate `parent_session_id`
```typescript
&& hasNullableString(value, 'parent_session_id')  // NEW before final hasBoolean(value, 'archived')
```

**`PersistedProjectSessions` version bump**: version 6 → 7 (line 259)

#### Schema Version Bumps
- `PersistedProjectSessions`: `version: 6` → `version: 7` (state-store.ts:259, state-store.ts:37)
- `DEFAULT_PROJECT_SESSIONS.version`: 6 → 7 (state-store.ts:37)

#### CreateSession — Default Parent — `src/core/project-session-manager.ts:499–522`
```typescript
const session: SessionSummary = {
  // ... existing fields ...
  archived: false,
  parentId: request.parentId ?? null  // NEW
}
```

**`CreateSessionRequest`** (`src/shared/project-session.ts`): add `parentId?: string`
```typescript
export interface CreateSessionRequest {
  projectId: string
  type: SessionType
  title: string
  externalSessionId?: string | null
  initialCols?: number
  initialRows?: number
  parentId?: string  // NEW
}
```

#### Persistence Grouping — `src/core/project-session-manager.ts:694–709`
Current grouping is flat by `project_id`. Subtree semantics do not require changing this — children live in the same project and are grouped together. No structural change needed unless cross-project trees are supported.

---

### Evidence Chain

| Claim | Source | Location |
|-------|--------|----------|
| `archiveSession` sets `archived=true`, clears `activeSessionId`, calls `persist()` | `project-session-manager.ts` | lines 458–467 |
| `restoreSession` sets `archived=false`, sets active refs, calls `persist()` | `project-session-manager.ts` | lines 469–477 |
| `getArchivedSessions` is a flat filter by `archived` | `project-session-manager.ts` | lines 479–481 |
| `doPersist` groups sessions by `project_id` | `project-session-manager.ts` | lines 694–699 |
| `doPersist` writes per-project sessions then global state | `project-session-manager.ts` | lines 701–721 |
| `createSession` sets `archived: false` on init | `project-session-manager.ts` | line 521 |
| `buildBootstrapRecoveryPlan` skips archived sessions | `project-session-manager.ts` | line 329 |
| `PersistedSession` has `archived: boolean` | `project-session.ts` | line 185 |
| `SessionSummary` has `archived: boolean` | `project-session.ts` | line 144 |
| `PersistedSession` has no parent reference | `project-session.ts` | lines 163–186 |
| `SessionSummary` has no parent reference | `project-session.ts` | lines 122–145 |
| `CreateSessionRequest` has no parent reference | `project-session.ts` | lines 279–286 |
| `PersistedProjectSessions` is version 6 | `project-session.ts` | lines 259–263 |
| `state-store.ts` writes `sessions.json` with version 6 | `state-store.ts` | line 453 |
| `isValidPersistedSession` validates all session fields | `state-store.ts` | lines 145–187 |
| `isValidProjectSessions` checks `version === 6` | `state-store.ts` | lines 130–143 |
| `DEFAULT_PROJECT_SESSIONS` version 6 | `state-store.ts` | lines 36–40 |
| `toPersistedSession` maps `session.archived` | `project-session-manager.ts` | line 85 |
| `toSessionSummary` reads `session.archived ?? false` | `project-session-manager.ts` | line 112 |
| `createProject` merges existing sessions from disk | `project-session-manager.ts` | lines 365–371 |
| `deleteProject` cascades by `projectId` only | `project-session-manager.ts` | line 444 |

---

### Risks / Unknowns

- **[!] Cross-project subtree ownership**: If child sessions could live in a different project than their parent, `deleteProject` and `restoreSession` cascade logic must query by `parentId` rather than assuming all children share `projectId`. The current code assumes flat project membership.
- **[?] Archive/restore ordering**: When archiving parent + children, should children be archived first (so UI updates atomically) or parent first (so tree collapses top-down)? Not specified — design decision needed.
- **[?] Orphan handling on parent restore**: If a parent is restored but a child remains archived, should `getArchivedSessions` still surface the child? Likely yes — children should remain individually restorable.
- **[?] `buildBootstrapRecoveryPlan`**: Currently skips all archived sessions. If children are kept archived while parent is alive, this is already correct. No change needed unless the design changes.
- **[?] Schema migration path**: Existing sessions on disk have no `parent_session_id`. `toSessionSummary` should default to `null` when the field is absent (already handled by `session.archived ?? false` pattern, but `parent_session_id` needs explicit null-coalescing).