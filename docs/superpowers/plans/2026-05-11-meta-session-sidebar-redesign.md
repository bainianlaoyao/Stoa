# Meta Session Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix meta session sidebar with three changes: add archive persistence, redesign entry style to match TerminalMetaBar visual language, and stabilize sort order.

**Architecture:** Add `archived` field to shared types, thread it through the IPC bridge to the manager and renderer store, then update the sidebar component to filter archived sessions, display compact two-line rows with tone chips + timestamps, and sort by `createdAt` instead of `updatedAt`.

**Tech Stack:** Vue 3 Composition API, Pinia, TypeScript, Vitest

---

### Task 1: Add `archived` field to shared types

**Files:**
- Modify: `src/shared/meta-session.ts:13-27` (MetaSessionSummary)
- Modify: `src/shared/meta-session.ts:29-43` (PersistedMetaSession)

- [ ] **Step 1: Add `archived` to `MetaSessionSummary`**

In `src/shared/meta-session.ts`, add `archived: boolean` to the `MetaSessionSummary` interface after `lastActivatedAt`:

```typescript
export interface MetaSessionSummary {
  id: string
  title: string
  status: MetaSessionStatus
  backendSessionType: MetaSessionBackendSessionType
  capabilityLevel: MetaSessionCapabilityLevel
  pendingProposalCount: number
  activeTargetCount: number
  lastSummary: string
  lastRisk: string | null
  backendSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
  archived: boolean
}
```

- [ ] **Step 2: Add `archived` to `PersistedMetaSession`**

In the same file, add `archived: boolean` to the `PersistedMetaSession` interface:

```typescript
export interface PersistedMetaSession {
  session_id: string
  title: string
  status: MetaSessionStatus
  backend_session_type: MetaSessionBackendSessionType
  capability_level: MetaSessionCapabilityLevel
  pending_proposal_count: number
  active_target_count: number
  last_summary: string
  last_risk: string | null
  backend_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  archived: boolean
}
```

- [ ] **Step 3: Run typecheck to see what breaks**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: Type errors in manager, state store, store, preload — all because of the new required field. This tells us exactly what to fix next.

- [ ] **Step 4: Commit**

```bash
git add src/shared/meta-session.ts
git commit -m "feat(meta-session): add archived field to shared types"
```

---

### Task 2: Update meta-session-manager to support archived field

**Files:**
- Modify: `src/core/meta-session-manager.ts` (toSummary, toPersisted, createSession, setActiveSession, add archiveSession/restoreSession)
- Modify: `src/core/meta-session-manager.test.ts` (add tests for archive/restore, update existing tests)
- Modify: `src/core/meta-session-state-store.ts` (add default for archived in read migration)

- [ ] **Step 1: Update `toSummary` mapper to include `archived`**

In `src/core/meta-session-manager.ts`, add `archived: session.archived` to the `toSummary` function:

```typescript
function toSummary(session: PersistedMetaSession): MetaSessionSummary {
  return {
    id: session.session_id,
    title: session.title,
    status: session.status,
    backendSessionType: session.backend_session_type,
    capabilityLevel: session.capability_level,
    pendingProposalCount: session.pending_proposal_count,
    activeTargetCount: session.active_target_count,
    lastSummary: session.last_summary,
    lastRisk: session.last_risk,
    backendSessionId: session.backend_session_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastActivatedAt: session.last_activated_at,
    archived: session.archived
  }
}
```

- [ ] **Step 2: Update `toPersisted` mapper to include `archived`**

In the same file, add `archived: session.archived` to `toPersisted`:

```typescript
function toPersisted(session: MetaSessionSummary): PersistedMetaSession {
  return {
    session_id: session.id,
    title: session.title,
    status: session.status,
    backend_session_type: session.backendSessionType,
    capability_level: session.capabilityLevel,
    pending_proposal_count: session.pendingProposalCount,
    active_target_count: session.activeTargetCount,
    last_summary: session.lastSummary,
    last_risk: session.lastRisk,
    backend_session_id: session.backendSessionId,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_activated_at: session.lastActivatedAt,
    archived: session.archived
  }
}
```

- [ ] **Step 3: Set `archived: false` in `createSession`**

In `createSession`, add `archived: false` to the created session object (after `lastActivatedAt`):

```typescript
const created: MetaSessionSummary = {
  id: `meta_session_${randomUUID()}`,
  title: request.title,
  status: 'created',
  backendSessionType: request.backendSessionType,
  capabilityLevel: request.capabilityLevel,
  pendingProposalCount: 0,
  activeTargetCount: 0,
  lastSummary: 'Waiting for meta session backend to start',
  lastRisk: null,
  backendSessionId: getProviderDescriptorBySessionType(request.backendSessionType).seedsExternalSessionId
    ? randomUUID()
    : null,
  createdAt: nowIso,
  updatedAt: nowIso,
  lastActivatedAt: this.state.sessions.length === 0 ? nowIso : null,
  archived: false
}
```

- [ ] **Step 4: Stop mutating `updatedAt` in `setActiveSession`**

In `setActiveSession`, remove the `updatedAt: nowIso` mutation. Only set `lastActivatedAt`:

```typescript
async setActiveSession(sessionId: string): Promise<void> {
  const nowIso = new Date().toISOString()
  this.state = {
    activeMetaSessionId: sessionId,
    sessions: this.state.sessions.map((session) => session.id === sessionId
      ? {
          ...session,
          lastActivatedAt: nowIso
        }
      : session),
    inspectorTarget: this.state.inspectorTarget
  }
  await this.persist()
}
```

- [ ] **Step 5: Add `archiveSession` method**

Add after `closeSession`:

```typescript
async archiveSession(sessionId: string): Promise<void> {
  this.state = {
    activeMetaSessionId: this.state.activeMetaSessionId === sessionId
      ? this.state.sessions.find((s) => s.id !== sessionId && !s.archived)?.id ?? null
      : this.state.activeMetaSessionId,
    sessions: this.state.sessions.map((session) => session.id === sessionId
      ? { ...session, archived: true }
      : session),
    inspectorTarget: this.state.inspectorTarget
  }
  await this.persist()
}
```

- [ ] **Step 6: Add `restoreSession` method**

Add after `archiveSession`:

```typescript
async restoreSession(sessionId: string): Promise<void> {
  this.state = {
    activeMetaSessionId: this.state.activeMetaSessionId,
    sessions: this.state.sessions.map((session) => session.id === sessionId
      ? { ...session, archived: false }
      : session),
    inspectorTarget: this.state.inspectorTarget
  }
  await this.persist()
}
```

- [ ] **Step 7: Add default `archived: false` in state store migration**

Read `src/core/meta-session-state-store.ts`. In the read function that deserializes `PersistedMetaSession`, add a fallback: if a session has no `archived` field (legacy data), default it to `false`. Look for where sessions are mapped after reading JSON and add:

```typescript
archived: session.archived ?? false
```

- [ ] **Step 8: Write tests for archive/restore**

Add to `src/core/meta-session-manager.test.ts`:

```typescript
test('archives a meta session and excludes it from active sessions', async () => {
  const manager = await MetaSessionManager.create({
    statePath: await createTempMetaSessionStatePath()
  })
  const first = await manager.createSession({ title: 'triage-a', backendSessionType: 'claude-code', capabilityLevel: 1 })
  const second = await manager.createSession({ title: 'triage-b', backendSessionType: 'codex', capabilityLevel: 3 })

  await manager.archiveSession(first.id)

  const snapshot = manager.snapshot()
  expect(snapshot.sessions.find((s) => s.id === first.id)?.archived).toBe(true)
  expect(snapshot.sessions.find((s) => s.id === second.id)?.archived).toBe(false)
  expect(snapshot.activeMetaSessionId).toBe(second.id)
})

test('restore a meta session marks it as not archived', async () => {
  const manager = await MetaSessionManager.create({
    statePath: await createTempMetaSessionStatePath()
  })
  const session = await manager.createSession({ title: 'triage-a', backendSessionType: 'claude-code', capabilityLevel: 1 })

  await manager.archiveSession(session.id)
  await manager.restoreSession(session.id)

  const snapshot = manager.snapshot()
  expect(snapshot.sessions.find((s) => s.id === session.id)?.archived).toBe(false)
})

test('setActiveSession does not mutate updatedAt', async () => {
  const manager = await MetaSessionManager.create({
    statePath: await createTempMetaSessionStatePath()
  })
  const session = await manager.createSession({ title: 'triage-a', backendSessionType: 'claude-code', capabilityLevel: 1 })
  const originalUpdatedAt = session.updatedAt

  await manager.setActiveSession(session.id)

  const snapshot = manager.snapshot()
  const updated = snapshot.sessions.find((s) => s.id === session.id)!
  expect(updated.updatedAt).toBe(originalUpdatedAt)
  expect(updated.lastActivatedAt).not.toBeNull()
})

test('archiving the active session falls back to another non-archived session', async () => {
  const manager = await MetaSessionManager.create({
    statePath: await createTempMetaSessionStatePath()
  })
  const first = await manager.createSession({ title: 'triage-a', backendSessionType: 'claude-code', capabilityLevel: 1 })
  const second = await manager.createSession({ title: 'triage-b', backendSessionType: 'codex', capabilityLevel: 3 })

  await manager.setActiveSession(first.id)
  await manager.archiveSession(first.id)

  const snapshot = manager.snapshot()
  expect(snapshot.activeMetaSessionId).toBe(second.id)
})
```

- [ ] **Step 9: Update existing test that checks session order**

The test `'tracks active meta session independently from work-session state'` at line 61 currently checks `snapshot.sessions.map((session) => session.id)).toEqual([first.id, second.id])`. Since we changed `setActiveSession` to not mutate `updatedAt`, the order should remain stable. Verify this test still passes — no change should be needed.

- [ ] **Step 10: Run manager tests**

Run: `npx vitest run src/core/meta-session-manager.test.ts`
Expected: All tests pass (old + new).

- [ ] **Step 11: Commit**

```bash
git add src/core/meta-session-manager.ts src/core/meta-session-manager.test.ts src/core/meta-session-state-store.ts
git commit -m "feat(meta-session): add archive/restore methods, stop mutating updatedAt on select"
```

---

### Task 3: Thread archive/restore through IPC bridge

**Files:**
- Modify: `src/core/ipc-channels.ts` (add archive/restore channel constants)
- Modify: `src/main/index.ts:1299-1307` (add archive/restore handlers)
- Modify: `src/preload/index.ts:89-94` (add archive/restore bridge methods)
- Modify: `src/shared/project-session.ts:328-339` (add archive/restore to RendererApi)

- [ ] **Step 1: Add IPC channel constants**

In `src/core/ipc-channels.ts`, add after `metaSessionClose`:

```typescript
metaSessionArchive: 'meta-session:archive',
metaSessionRestore: 'meta-session:restore',
```

- [ ] **Step 2: Add main process IPC handlers**

In `src/main/index.ts`, add after the `metaSessionClose` handler block (after line 1307):

```typescript
ipcMain.handle(IPC_CHANNELS.metaSessionArchive, async (_event, sessionId: string) => {
  ptyHost?.kill(sessionId)
  await hookLeaseManager?.releaseLease(sessionId)
  await metaSessionManager?.archiveSession(sessionId)
  const session = metaSessionManager?.getSession(sessionId)
  if (session) {
    pushMetaSessionEvent(session)
  }
})

ipcMain.handle(IPC_CHANNELS.metaSessionRestore, async (_event, sessionId: string) => {
  await metaSessionManager?.restoreSession(sessionId)
  const session = metaSessionManager?.getSession(sessionId)
  if (session) {
    pushMetaSessionEvent(session)
  }
})
```

- [ ] **Step 3: Add preload bridge methods**

In `src/preload/index.ts`, add after the `closeMetaSession` method (after line 94):

```typescript
async archiveMetaSession(sessionId: string) {
  return ipcRenderer.invoke(IPC_CHANNELS.metaSessionArchive, sessionId)
},
async restoreMetaSession(sessionId: string) {
  return ipcRenderer.invoke(IPC_CHANNELS.metaSessionRestore, sessionId)
},
```

- [ ] **Step 4: Add to RendererApi type**

In `src/shared/project-session.ts`, add after `closeMetaSession?` (after line 331):

```typescript
archiveMetaSession?: (sessionId: string) => Promise<void>
restoreMetaSession?: (sessionId: string) => Promise<void>
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to these changes.

- [ ] **Step 6: Commit**

```bash
git add src/core/ipc-channels.ts src/main/index.ts src/preload/index.ts src/shared/project-session.ts
git commit -m "feat(meta-session): add archive/restore IPC channels"
```

---

### Task 4: Update renderer store with archive/restore actions

**Files:**
- Modify: `src/renderer/stores/meta-session.ts` (add archive/restore methods, filter archived from main list, fix sort)

- [ ] **Step 1: Add `archiveSession` method to the store**

In `src/renderer/stores/meta-session.ts`, add after `closeSession`:

```typescript
async function archiveSession(sessionId: string): Promise<void> {
  await window.stoa.archiveMetaSession?.(sessionId)
  sessions.value = sessions.value.map((session) =>
    session.id === sessionId ? { ...session, archived: true } : session
  )
  if (activeMetaSessionId.value === sessionId) {
    activeMetaSessionId.value = sessions.value.find((s) => !s.archived)?.id ?? null
  }
}
```

- [ ] **Step 2: Add `restoreSession` method to the store**

Add after `archiveSession`:

```typescript
async function restoreSession(sessionId: string): Promise<void> {
  await window.stoa.restoreMetaSession?.(sessionId)
  sessions.value = sessions.value.map((session) =>
    session.id === sessionId ? { ...session, archived: false } : session
  )
}
```

- [ ] **Step 3: Export the new methods**

In the return object, add after `closeSession`:

```typescript
archiveSession,
restoreSession,
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/meta-session.ts
git commit -m "feat(meta-session): add archive/restore to renderer store"
```

---

### Task 5: Redesign sidebar component — layout, chips, timestamps, stable sort

**Files:**
- Modify: `src/renderer/components/meta-session/MetaSessionSessionList.vue` (full rewrite of template + style)

- [ ] **Step 1: Add computed helpers for time formatting and archived filtering**

Replace the `orderedSessions` computed and add new helpers in the `<script setup>` block:

```typescript
const activeSessions = computed(() => {
  return sessions.value.filter((s) => !s.archived)
})

const archivedSessions = computed(() => {
  return sessions.value.filter((s) => s.archived)
})

const orderedActiveSessions = computed(() => {
  return [...activeSessions.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
})

const orderedArchivedSessions = computed(() => {
  return [...archivedSessions.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
})

const archivedSectionOpen = ref(false)

function relativeTime(updatedAt: string): string {
  const elapsedMs = Date.now() - Date.parse(updatedAt)
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return 'Just now'
  return `${Math.floor(elapsedMs / 60_000)}m ago`
}

function statusChipLabel(status: MetaSessionStatus): string {
  return status.replace(/_/g, ' ')
}
```

- [ ] **Step 2: Update the template — replace route-dot with two-line layout**

Replace the `meta-session-sidebar__items` div content. Each row becomes:

```html
<div class="meta-session-sidebar__items">
  <div
    v-for="session in orderedActiveSessions"
    :key="session.id"
    class="route-session-row"
  >
    <button
      class="route-item child"
      :class="{ 'route-item--active': session.id === activeMetaSessionId }"
      data-testid="meta-session.session.item"
      :data-session-id="session.id"
      type="button"
      @click="void metaSessionStore.setActiveSession(session.id)"
    >
      <img class="route-provider-icon" :src="providerIcon(session.backendSessionType)" :alt="session.backendSessionType" />
      <div class="route-copy">
        <span class="route-session-title">{{ session.title }}</span>
        <div class="route-session-meta">
          <span class="route-chip" :data-tone="statusTone(session.status)">{{ statusChipLabel(session.status) }}</span>
          <span class="route-time">{{ relativeTime(session.updatedAt) }}</span>
          <span v-if="session.pendingProposalCount > 0" class="route-pending">· {{ session.pendingProposalCount }} pending</span>
        </div>
      </div>
    </button>
    <span class="route-row-actions">
      <button
        class="route-row-action route-icon-button"
        type="button"
        data-testid="meta-session.session.archive"
        :data-session-id="session.id"
        :aria-label="`Archive session ${session.title}`"
        title="Archive session"
        @click.stop="void metaSessionStore.archiveSession(session.id)"
      >
        <svg
          class="route-icon-button__icon"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M2 4H14V12C14 13.1046 13.1046 14 12 14H4C2.89543 14 2 13.1046 2 12V4Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
          <path d="M6 8H10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
          <path d="M1 4H15" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
          <path d="M6 1H10V4H6V1Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
        </svg>
      </button>
    </span>
  </div>
</div>
```

- [ ] **Step 3: Add archived section at the bottom of `meta-session-sidebar__body`**

After the `meta-session-sidebar__items` div, add:

```html
<div v-if="orderedArchivedSessions.length > 0" class="meta-session-sidebar__archived">
  <button
    class="route-archived-toggle"
    type="button"
    @click="archivedSectionOpen = !archivedSectionOpen"
  >
    <span class="route-archived-label">Archived ({{ orderedArchivedSessions.length }})</span>
    <span class="route-archived-chevron" :class="{ 'route-archived-chevron--open': archivedSectionOpen }">&#9662;</span>
  </button>
  <div v-if="archivedSectionOpen" class="meta-session-sidebar__archived-items">
    <div
      v-for="session in orderedArchivedSessions"
      :key="session.id"
      class="route-session-row route-session-row--archived"
    >
      <button
        class="route-item child"
        data-testid="meta-session.session.archived-item"
        :data-session-id="session.id"
        type="button"
        @click="void metaSessionStore.setActiveSession(session.id); void metaSessionStore.restoreSession(session.id)"
      >
        <img class="route-provider-icon" :src="providerIcon(session.backendSessionType)" :alt="session.backendSessionType" />
        <div class="route-copy">
          <span class="route-session-title">{{ session.title }}</span>
          <div class="route-session-meta">
            <span class="route-chip" data-tone="neutral">{{ statusChipLabel(session.status) }}</span>
            <span class="route-time">{{ relativeTime(session.updatedAt) }}</span>
          </div>
        </div>
      </button>
      <span class="route-row-actions">
        <button
          class="route-row-action route-icon-button"
          type="button"
          data-testid="meta-session.session.restore"
          :data-session-id="session.id"
          :aria-label="`Restore session ${session.title}`"
          title="Restore session"
          @click.stop="void metaSessionStore.restoreSession(session.id)"
        >
          <svg class="route-icon-button__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 8C2 4.68629 4.68629 2 8 2V2C11.3137 2 14 4.68629 14 8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
            <path d="M14 8L12 6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 8L12 10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </span>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Update the styles**

Replace the relevant CSS sections. Remove `.route-dot` styles entirely. Add new styles:

```css
.route-item.child {
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 8px 6px 12px;
}

.route-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.route-session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font: 500 var(--text-body-sm) / 1.2 var(--font-ui);
}

.route-session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.route-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-strong);
  font: 500 var(--text-caption) / 1.4 var(--font-mono);
  white-space: nowrap;
}

.route-chip[data-tone='neutral'] {
  color: var(--color-subtle);
}

.route-chip[data-tone='accent'] {
  color: var(--color-accent);
}

.route-chip[data-tone='success'] {
  color: var(--color-success);
}

.route-chip[data-tone='warning'] {
  color: var(--color-warning);
}

.route-chip[data-tone='danger'] {
  color: var(--color-error);
}

.route-time {
  color: var(--color-subtle);
  font: var(--text-caption) / 1.4 var(--font-mono);
  white-space: nowrap;
}

.route-pending {
  color: var(--color-muted);
  font: var(--text-caption) / 1.4 var(--font-mono);
  white-space: nowrap;
}

.meta-session-sidebar__archived {
  display: grid;
  gap: 2px;
  border-top: 1px solid var(--color-line);
  padding-top: 8px;
}

.route-archived-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-ui);
}

.route-archived-toggle:hover {
  background: var(--color-black-faint);
}

.route-archived-label {
  color: var(--color-muted);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.route-archived-chevron {
  color: var(--color-subtle);
  font-size: 10px;
  transition: transform 0.2s ease;
}

.route-archived-chevron--open {
  transform: rotate(180deg);
}

.route-session-row--archived .route-session-title {
  color: var(--color-muted);
}
```

- [ ] **Step 5: Remove the old `statusLabel` function**

Delete the `statusLabel` function (lines 72-78) since it's replaced by `statusChipLabel` and the pending count is now in the template.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/meta-session/MetaSessionSessionList.vue
git commit -m "feat(meta-session): redesign sidebar with two-line chips, timestamps, stable sort, archive section"
```

---

### Task 6: Update existing tests for new `archived` field

**Files:**
- Modify: `src/renderer/components/meta-session/MetaSessionSurface.test.ts` (add `archived` to mock session data)

- [ ] **Step 1: Add `archived: false` to all mock meta sessions**

In `MetaSessionSurface.test.ts`, find the mock session object in `createStoaMock` (around line 103-117) and add `archived: false`:

```typescript
sessions: [{
  id: 'meta_session_1',
  title: 'global-triage',
  status: 'running',
  backendSessionType: 'claude-code',
  capabilityLevel: 2,
  pendingProposalCount: 1,
  activeTargetCount: 3,
  lastSummary: 'Collecting blocked sessions.',
  lastRisk: 'Two sessions are editing the same module.',
  backendSessionId: 'backend-session-1',
  createdAt: '2026-05-07T08:00:00.000Z',
  updatedAt: '2026-05-07T08:05:00.000Z',
  lastActivatedAt: '2026-05-07T08:05:00.000Z',
  archived: false
}],
```

Also add `archived: false` to the mock `createMetaSession` response (around line 207-221):

```typescript
{
  id: 'meta_session_2',
  title: 'meta-session-2',
  status: 'created',
  backendSessionType: 'codex',
  capabilityLevel: 3,
  pendingProposalCount: 0,
  activeTargetCount: 0,
  lastSummary: 'Waiting for meta session backend to start',
  lastRisk: null,
  backendSessionId: null,
  createdAt: '2026-05-07T08:10:00.000Z',
  updatedAt: '2026-05-07T08:10:00.000Z',
  lastActivatedAt: null,
  archived: false
}
```

Also add the new bridge methods to the mock. After `closeMetaSession` (line 124), add:

```typescript
archiveMetaSession: vi.fn().mockResolvedValue(undefined),
restoreMetaSession: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: Run the surface test**

Run: `npx vitest run src/renderer/components/meta-session/MetaSessionSurface.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/meta-session/MetaSessionSurface.test.ts
git commit -m "test(meta-session): update mock data with archived field"
```

---

### Task 7: Run full test suite and verify

**Files:** None — verification only.

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run unit tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run e2e tests**

Run: `npm run test:e2e`
Expected: All tests pass.

- [ ] **Step 4: Run behavior coverage**

Run: `npm run test:behavior-coverage`
Expected: Coverage gates pass.
