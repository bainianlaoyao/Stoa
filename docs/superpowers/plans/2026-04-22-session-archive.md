# Session Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add archive/restore functionality to sessions so users can hide completed sessions from the main view and access them on a dedicated archive page.

**Architecture:** Add `archived: boolean` field to session data structures. Backend Manager handles archive/restore with PTY process termination. New IPC channels bridge to frontend. Pinia store filters archived sessions from `projectHierarchy`. New `ArchiveView` component accessible via GlobalActivityBar.

**Tech Stack:** TypeScript, Electron IPC, Vue 3 + Pinia, Vitest

---

### Task 1: Data model — add `archived` field to session types

**Files:**
- Modify: `src/shared/project-session.ts`

- [ ] **Step 1: Add `archived` to `SessionSummary`**

In `src/shared/project-session.ts`, add `archived: boolean` to `SessionSummary` (after `lastActivatedAt`):

```typescript
export interface SessionSummary {
  id: string
  projectId: string
  type: SessionType
  status: SessionStatus
  title: string
  summary: string
  recoveryMode: SessionRecoveryMode
  externalSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
  archived: boolean
}
```

- [ ] **Step 2: Add `archived` to `PersistedSession`**

In the same file, add `archived: boolean` to `PersistedSession` (after `recovery_mode`):

```typescript
export interface PersistedSession {
  session_id: string
  project_id: string
  type: SessionType
  title: string
  last_known_status: SessionStatus
  last_summary: string
  external_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  recovery_mode: SessionRecoveryMode
  archived: boolean
}
```

- [ ] **Step 3: Add new `RendererApi` methods**

In the same file, add three new methods to `RendererApi` (after `detectProvider`):

```typescript
export interface RendererApi {
  // ... existing methods ...
  detectProvider: (providerId: string) => Promise<string | null>
  archiveSession: (sessionId: string) => Promise<void>
  restoreSession: (sessionId: string) => Promise<void>
  listArchivedSessions: () => Promise<SessionSummary[]>
}
```

- [ ] **Step 4: Run type check to verify no existing code breaks**

Run: `npx vitest run`
Expected: All existing tests pass (new `archived` field will cause failures in places that construct `SessionSummary`/`PersistedSession` — that's expected, we fix in next tasks)

Note: At this stage tests WILL fail because existing code doesn't provide the `archived` field. We fix those in subsequent tasks. If you prefer green-at-every-step, skip the test run here and verify after Task 2.

---

### Task 2: Backend Manager — add archive/restore methods and update mappers

**Files:**
- Modify: `src/core/project-session-manager.ts`

- [ ] **Step 1: Update `toBootstrapState` mapper to include `archived`**

In `toBootstrapState`, add `archived` to the session mapping:

```typescript
sessions: state.sessions.map((session) => ({
  id: session.session_id,
  projectId: session.project_id,
  type: session.type,
  status: session.last_known_status,
  title: session.title,
  summary: session.last_summary,
  recoveryMode: session.recovery_mode,
  externalSessionId: session.external_session_id,
  createdAt: session.created_at,
  updatedAt: session.updated_at,
  lastActivatedAt: session.last_activated_at,
  archived: session.archived ?? false
}))
```

Note: `?? false` handles existing persisted state that doesn't have the `archived` field yet. This is NOT a migration — it's a fallback for the current session's first load after upgrade.

- [ ] **Step 2: Update `toPersistedState` mapper to include `archived`**

In `toPersistedState`, add `archived` to the session mapping:

```typescript
sessions: state.sessions.map((session) => ({
  session_id: session.id,
  project_id: session.projectId,
  type: session.type,
  title: session.title,
  last_known_status: session.status,
  last_summary: session.summary,
  external_session_id: session.externalSessionId,
  created_at: session.createdAt,
  updated_at: session.updatedAt,
  last_activated_at: session.lastActivatedAt,
  recovery_mode: session.recoveryMode,
  archived: session.archived
}))
```

- [ ] **Step 3: Add `archived: false` to `createSession`**

In `createSession`, add `archived: false` to the new session object:

```typescript
const session: SessionSummary = {
  id: `session_${randomUUID()}`,
  projectId: request.projectId,
  type: request.type,
  status: 'bootstrapping',
  title: request.title,
  summary: '等待会话启动',
  recoveryMode: createSessionRecoveryMode(request.type),
  externalSessionId: request.externalSessionId ?? null,
  createdAt: now,
  updatedAt: now,
  lastActivatedAt: now,
  archived: false
}
```

- [ ] **Step 4: Add `archiveSession` method**

After `applySessionEvent`, add:

```typescript
async archiveSession(sessionId: string): Promise<void> {
  const session = this.state.sessions.find(s => s.id === sessionId)
  if (!session) return
  session.archived = true
  session.updatedAt = new Date().toISOString()
  if (this.state.activeSessionId === sessionId) {
    this.state.activeSessionId = null
  }
  await this.persist()
}
```

- [ ] **Step 5: Add `restoreSession` method**

After `archiveSession`, add:

```typescript
async restoreSession(sessionId: string): Promise<void> {
  const session = this.state.sessions.find(s => s.id === sessionId)
  if (!session) return
  session.archived = false
  session.updatedAt = new Date().toISOString()
  await this.persist()
}
```

- [ ] **Step 6: Add `getArchivedSessions` method**

After `restoreSession`, add:

```typescript
getArchivedSessions(): SessionSummary[] {
  return this.state.sessions.filter(s => s.archived)
}
```

- [ ] **Step 7: Update `buildBootstrapRecoveryPlan` to skip archived sessions**

Change the first line of `buildBootstrapRecoveryPlan` from:

```typescript
return this.state.sessions.map((session) => {
```

to:

```typescript
return this.state.sessions.filter(s => !s.archived).map((session) => {
```

---

### Task 3: Backend tests — archive/restore in ProjectSessionManager

**Files:**
- Modify: `src/core/project-session-manager.test.ts`

- [ ] **Step 1: Add archive/restore lifecycle test**

Add a new `describe` block inside the main `describe('ProjectSessionManager')`:

```typescript
describe('archive and restore', () => {
  test('archiveSession sets archived=true and clears activeSessionId', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
    const project = await manager.createProject({ path: projectDir, name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    await manager.archiveSession(session.id)

    const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
    expect(updated.archived).toBe(true)
    expect(manager.snapshot().activeSessionId).toBeNull()
  })

  test('restoreSession sets archived=false', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()
    const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
    const project = await manager.createProject({ path: projectDir, name: 'test' })
    const session = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })

    await manager.archiveSession(session.id)
    await manager.restoreSession(session.id)

    const updated = manager.snapshot().sessions.find(s => s.id === session.id)!
    expect(updated.archived).toBe(false)
  })

  test('getArchivedSessions returns only archived sessions', async () => {
    const manager = ProjectSessionManager.createForTest()
    const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
    const s1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })
    await manager.createSession({ projectId: project.id, type: 'shell', title: 'S2' })

    await manager.archiveSession(s1.id)

    const archived = manager.getArchivedSessions()
    expect(archived).toHaveLength(1)
    expect(archived[0]!.id).toBe(s1.id)
  })

  test('archiveSession is no-op for unknown session ID', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
    await expect(manager.archiveSession('nonexistent')).resolves.toBeUndefined()
  })

  test('restoreSession is no-op for unknown session ID', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
    await expect(manager.restoreSession('nonexistent')).resolves.toBeUndefined()
  })

  test('buildBootstrapRecoveryPlan skips archived sessions', async () => {
    const manager = ProjectSessionManager.createForTest()
    const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })
    const s1 = await manager.createSession({ projectId: project.id, type: 'shell', title: 'S1' })
    await manager.createSession({ projectId: project.id, type: 'shell', title: 'S2' })

    await manager.archiveSession(s1.id)

    const plan = manager.buildBootstrapRecoveryPlan()
    expect(plan).toHaveLength(1)
    expect(plan[0]!.sessionId).not.toBe(s1.id)
  })

  test('archived state persists across manager restart', async () => {
    const globalStatePath = await createTempGlobalStatePath()
    const projectDir = await createTempProjectDir()

    const manager1 = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
    const project = await manager1.createProject({ path: projectDir, name: 'test' })
    const session = await manager1.createSession({ projectId: project.id, type: 'shell', title: 'S1' })
    await manager1.archiveSession(session.id)

    const manager2 = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
    const restored = manager2.snapshot().sessions.find(s => s.id === session.id)!
    expect(restored.archived).toBe(true)
  })
})
```

- [ ] **Step 2: Run manager tests**

Run: `npx vitest run src/core/project-session-manager.test.ts`
Expected: All tests PASS

---

### Task 4: PtyHost — add `kill(runtimeId)` method

**Files:**
- Modify: `src/core/pty-host.ts`
- Modify: `src/core/pty-host.test.ts`

- [ ] **Step 1: Add `kill` method to PtyHost**

In `src/core/pty-host.ts`, add after the `resize` method:

```typescript
kill(runtimeId: string): void {
  const terminal = this.sessions.get(runtimeId)
  if (terminal) {
    terminal.kill()
    this.sessions.delete(runtimeId)
  }
}
```

- [ ] **Step 2: Add test for `kill` method**

In `src/core/pty-host.test.ts`, add a new `describe` block after the `dispose()` describe:

```typescript
describe('kill()', () => {
  test('kills a specific terminal by runtimeId', () => {
    host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
    host.start('rt-2', defaultCommand, vi.fn(), vi.fn())
    const term1 = mockTerminals[mockTerminals.length - 2]
    const term2 = mockTerminals[mockTerminals.length - 1]

    host.kill('rt-1')

    expect(term1.kill).toHaveBeenCalled()
    expect(term2.kill).not.toHaveBeenCalled()
  })

  test('removes killed session from map', () => {
    host.start('rt-1', defaultCommand, vi.fn(), vi.fn())
    const mockTerm = lastTerminal()

    host.kill('rt-1')

    host.write('rt-1', 'data')
    expect(mockTerm.write).not.toHaveBeenCalled()
  })

  test('does nothing for unknown runtimeId', () => {
    host.start('rt-1', defaultCommand, vi.fn(), vi.fn())

    expect(() => host.kill('unknown')).not.toThrow()
    expect(lastTerminal().kill).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run pty-host tests**

Run: `npx vitest run src/core/pty-host.test.ts`
Expected: All tests PASS

---

### Task 5: IPC channels — add archive/restore channels

**Files:**
- Modify: `src/core/ipc-channels.ts`

- [ ] **Step 1: Add new channels**

In `src/core/ipc-channels.ts`, add after the existing `sessionResize` entry:

```typescript
export const IPC_CHANNELS = {
  projectBootstrap: 'project:bootstrap',
  projectCreate: 'project:create',
  projectSetActive: 'project:set-active',
  sessionCreate: 'session:create',
  sessionSetActive: 'session:set-active',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionArchive: 'session:archive',
  sessionRestore: 'session:restore',
  sessionListArchived: 'session:list-archived',
  sessionEvent: 'session:event',
  terminalData: 'terminal:data',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  dialogPickFolder: 'dialog:pick-folder',
  dialogPickFile: 'dialog:pick-file',
  settingsDetectShell: 'settings:detect-shell',
  settingsDetectProvider: 'settings:detect-provider',
} as const
```

---

### Task 6: Main process — add IPC handlers for archive/restore

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add `session:archive` IPC handler**

After the `sessionResize` handler, add:

```typescript
ipcMain.handle(IPC_CHANNELS.sessionArchive, async (_event, sessionId: string) => {
  if (!projectSessionManager || !ptyHost) return
  ptyHost.kill(sessionId)
  await projectSessionManager.archiveSession(sessionId)
})
```

- [ ] **Step 2: Add `session:restore` IPC handler**

After the archive handler, add:

```typescript
ipcMain.handle(IPC_CHANNELS.sessionRestore, async (_event, sessionId: string) => {
  await projectSessionManager?.restoreSession(sessionId)
})
```

- [ ] **Step 3: Add `session:list-archived` IPC handler**

After the restore handler, add:

```typescript
ipcMain.handle(IPC_CHANNELS.sessionListArchived, async () => {
  return projectSessionManager?.getArchivedSessions() ?? []
})
```

- [ ] **Step 4: Skip archived sessions in bootstrap recovery loop**

In the bootstrap recovery loop (the `for (const plan of ...)` block), add a guard after `if (!session || !project) continue`:

```typescript
if (session.archived) continue
```

So the full block becomes:

```typescript
for (const plan of projectSessionManager.buildBootstrapRecoveryPlan()) {
  const snapshot = projectSessionManager.snapshot()
  const session = snapshot.sessions.find(s => s.id === plan.sessionId)
  const project = session ? snapshot.projects.find(p => p.id === session.projectId) : undefined
  if (!session || !project) continue
  if (session.archived) continue
  // ... rest unchanged
}
```

Note: `buildBootstrapRecoveryPlan` already filters archived sessions (Task 2 Step 7), so this `if (session.archived)` check is a defense-in-depth guard.

---

### Task 7: Preload — wire new IPC channels

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add new methods to preload API**

In `src/preload/index.ts`, add after `sendSessionResize`:

```typescript
async archiveSession(sessionId) {
  return ipcRenderer.invoke('session:archive', sessionId)
},
async restoreSession(sessionId) {
  return ipcRenderer.invoke('session:restore', sessionId)
},
async listArchivedSessions() {
  return ipcRenderer.invoke('session:list-archived')
},
```

---

### Task 8: Pinia store — filter archived sessions, add archive actions

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`

- [ ] **Step 1: Filter archived sessions from `projectHierarchy`**

In the `projectHierarchy` computed, add `.filter(session => !session.archived)` to the session mapping:

```typescript
const projectHierarchy = computed<ProjectHierarchyNode[]>(() => {
  return projects.value.map((project) => ({
    ...project,
    active: project.id === activeProjectId.value,
    sessions: sessions.value
      .filter((session) => session.projectId === project.id && !session.archived)
      .map((session) => ({
        ...session,
        active: session.id === activeSessionId.value
      }))
  }))
})
```

- [ ] **Step 2: Add `archivedSessions` ref**

After the existing refs, add:

```typescript
const archivedSessions = ref<SessionSummary[]>([])
```

- [ ] **Step 3: Add `archiveSession` action**

After `finishSessionCreate`, add:

```typescript
function archiveSession(sessionId: string): void {
  const session = sessions.value.find(s => s.id === sessionId)
  if (!session) return
  session.archived = true
  if (activeSessionId.value === sessionId) {
    activeSessionId.value = null
  }
}
```

- [ ] **Step 4: Add `restoreSession` action**

After `archiveSession`, add:

```typescript
function restoreSession(sessionId: string): void {
  const session = sessions.value.find(s => s.id === sessionId)
  if (!session) return
  session.archived = false
}
```

- [ ] **Step 5: Add `setArchivedSessions` action**

After `restoreSession`, add:

```typescript
function setArchivedSessions(sessions: SessionSummary[]): void {
  archivedSessions.value = sessions
}
```

- [ ] **Step 6: Export new state and actions**

Add to the return object:

```typescript
return {
  // ... existing exports ...
  archivedSessions,
  archiveSession,
  restoreSession,
  setArchivedSessions
}
```

---

### Task 9: Store tests — archive filtering and actions

**Files:**
- Modify: `src/renderer/stores/workspaces.test.ts`

- [ ] **Step 1: Update existing hydrate test to include `archived: false`**

In the first test (`hydrates explicit projects and sessions`), add `archived: false` to the session objects in the `hydrate` call. Every `SessionSummary` literal needs the field.

- [ ] **Step 2: Update all other test sessions with `archived: false`**

Go through ALL existing tests in this file and add `archived: false` to every session object literal. The tests that construct sessions are:

- `hydrates explicit projects and sessions without name+path grouping` — 1 session
- `selecting a session also activates its parent project` — 2 sessions
- `derives project hierarchy from canonical project/session state` — 2 sessions

- [ ] **Step 3: Add archive/restore tests**

Add a new `describe` block:

```typescript
describe('archive and restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('projectHierarchy excludes archived sessions', () => {
    const store = useWorkspaceStore()
    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_shell_1',
      terminalWebhookPort: 43127,
      projects: [
        {
          id: 'project_alpha',
          name: 'alpha',
          path: 'D:/alpha',
          createdAt: 'a',
          updatedAt: 'a'
        }
      ],
      sessions: [
        {
          id: 'session_shell_1',
          projectId: 'project_alpha',
          type: 'shell',
          status: 'running',
          summary: 'running',
          title: 'Shell 1',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false
        },
        {
          id: 'session_archived',
          projectId: 'project_alpha',
          type: 'shell',
          status: 'exited',
          summary: 'done',
          title: 'Old Shell',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: true
        }
      ]
    })

    expect(store.projectHierarchy).toHaveLength(1)
    expect(store.projectHierarchy[0]!.sessions).toHaveLength(1)
    expect(store.projectHierarchy[0]!.sessions[0]!.id).toBe('session_shell_1')
  })

  test('archiveSession marks session and clears activeSessionId', () => {
    const store = useWorkspaceStore()
    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_shell_1',
      terminalWebhookPort: 43127,
      projects: [
        { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
      ],
      sessions: [
        {
          id: 'session_shell_1',
          projectId: 'project_alpha',
          type: 'shell',
          status: 'running',
          summary: 'running',
          title: 'Shell 1',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: false
        }
      ]
    })

    store.archiveSession('session_shell_1')

    expect(store.sessions[0]!.archived).toBe(true)
    expect(store.activeSessionId).toBeNull()
  })

  test('restoreSession unarchives session', () => {
    const store = useWorkspaceStore()
    store.hydrate({
      activeProjectId: null,
      activeSessionId: null,
      terminalWebhookPort: 43127,
      projects: [
        { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
      ],
      sessions: [
        {
          id: 'session_archived',
          projectId: 'project_alpha',
          type: 'shell',
          status: 'exited',
          summary: 'done',
          title: 'Old Shell',
          recoveryMode: 'fresh-shell',
          externalSessionId: null,
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a',
          archived: true
        }
      ]
    })

    store.restoreSession('session_archived')

    expect(store.sessions[0]!.archived).toBe(false)
  })
})
```

- [ ] **Step 4: Run store tests**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts`
Expected: All tests PASS

---

### Task 10: GlobalActivityBar — add archive surface

**Files:**
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Modify: `src/renderer/components/GlobalActivityBar.test.ts`

- [ ] **Step 1: Add `archive` to `AppSurface` type**

In `src/renderer/components/GlobalActivityBar.vue`, change:

```typescript
export type AppSurface = 'command' | 'settings'
```

to:

```typescript
export type AppSurface = 'command' | 'archive' | 'settings'
```

- [ ] **Step 2: Add archive item to `bottomItems`**

In `GlobalActivityBar.vue`, add archive to `bottomItems` (before settings):

```typescript
const bottomItems: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'archive', label: '⊞', title: 'Archive' },
  { id: 'settings', label: '⚙', title: 'Settings' }
]
```

- [ ] **Step 3: Update GlobalActivityBar tests**

In `GlobalActivityBar.test.ts`, update the test that checks for 2 activity items to expect 3:

```typescript
it('renders 3 activity items with correct data-activity-item values', () => {
  const wrapper = mountBar()
  const items = wrapper.findAll('[data-activity-item]')
  expect(items).toHaveLength(3)
  const ids = items.map((el) => el.attributes('data-activity-item'))
  expect(ids).toEqual(['command', 'archive', 'settings'])
})
```

Also update the test `'renders command in top cluster and settings in bottom cluster'` to verify archive is in bottom cluster:

```typescript
it('renders command in top cluster and archive+settings in bottom cluster', () => {
  const wrapper = mountBar()
  const topCluster = wrapper.find('.activity-bar__cluster--top')
  const bottomCluster = wrapper.find('.activity-bar__cluster--bottom')
  expect(topCluster.find('[data-activity-item="command"]').exists()).toBe(true)
  expect(bottomCluster.find('[data-activity-item="archive"]').exists()).toBe(true)
  expect(bottomCluster.find('[data-activity-item="settings"]').exists()).toBe(true)
})
```

- [ ] **Step 4: Run GlobalActivityBar tests**

Run: `npx vitest run src/renderer/components/GlobalActivityBar.test.ts`
Expected: All tests PASS

---

### Task 11: AppShell — add archive surface routing

**Files:**
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/components/AppShell.test.ts`

- [ ] **Step 1: Add archive emit and props to AppShell**

In `src/renderer/components/AppShell.vue`, add `archiveSession` emit:

```typescript
const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  archiveSession: [sessionId: string]
  restoreSession: [sessionId: string]
}>()
```

- [ ] **Step 2: Add ArchiveView rendering in template**

In `AppShell.vue`, add an `ArchiveSurface` section after `SettingsSurface`:

```vue
<template>
  <main class="app-shell">
    <GlobalActivityBar :active-surface="activeSurface" @select="activeSurface = $event" />

    <section class="app-shell__viewport" aria-label="Application viewport">
      <CommandSurface
        v-if="activeSurface === 'command'"
        aria-label="Command surface"
        :hierarchy="hierarchy"
        :active-project="activeProject"
        :active-session="activeSession"
        :active-project-id="activeProjectId"
        :active-session-id="activeSessionId"
        @select-project="emit('selectProject', $event)"
        @select-session="emit('selectSession', $event)"
        @create-project="emit('createProject', $event)"
        @create-session="emit('createSession', $event)"
        @archive-session="emit('archiveSession', $event)"
      />
      <ArchiveSurface
        v-else-if="activeSurface === 'archive'"
        aria-label="Archive surface"
        :archived-sessions="archivedSessions"
        @restore-session="emit('restoreSession', $event)"
      />
      <SettingsSurface v-else />
    </section>
  </main>
</template>
```

- [ ] **Step 3: Add `archivedSessions` prop to AppShell**

Update the props:

```typescript
const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
  archivedSessions: SessionSummary[]
}>()
```

- [ ] **Step 4: Add ArchiveSurface import**

Add the import (the component will be created in Task 12):

```typescript
import ArchiveSurface from './archive/ArchiveSurface.vue'
```

- [ ] **Step 5: Update AppShell tests**

In `AppShell.test.ts`:

1. Add `archiveSession` and `restoreSession` to the mock `RendererApi`:
```typescript
archiveSession: vi.fn().mockResolvedValue(undefined),
restoreSession: vi.fn().mockResolvedValue(undefined),
listArchivedSessions: vi.fn().mockResolvedValue([]),
```

2. Add `archivedSessions: []` to all mount props.

3. Update the activity items count test to expect 3 items and `['command', 'archive', 'settings']`.

4. Add a test for switching to archive surface:
```typescript
it('switches to archive surface when archive activity is selected', async () => {
  const wrapper = mount(AppShell, {
    global: { plugins: [createPinia()] },
    props: {
      hierarchy: [],
      activeProjectId: null,
      activeSessionId: null,
      activeProject: null,
      activeSession: null,
      archivedSessions: []
    }
  })

  await wrapper.get('button[aria-label="Archive"]').trigger('click')

  expect(wrapper.get('[data-surface="archive"][aria-label="Archive surface"]')).toBeTruthy()
  expect(wrapper.find('[data-surface="command"]').exists()).toBe(false)
})
```

- [ ] **Step 6: Run AppShell tests**

Run: `npx vitest run src/renderer/components/AppShell.test.ts`
Expected: All tests PASS (but will need ArchiveSurface component first — if failing, continue to Task 12 then re-run)

---

### Task 12: Create ArchiveSurface component

**Files:**
- Create: `src/renderer/components/archive/ArchiveSurface.vue`
- Create: `src/renderer/components/archive/ArchiveSurface.test.ts`

- [ ] **Step 1: Create `ArchiveSurface.vue`**

```vue
<script setup lang="ts">
import type { SessionSummary } from '@shared/project-session'

defineProps<{
  archivedSessions: SessionSummary[]
}>()

const emit = defineEmits<{
  restoreSession: [sessionId: string]
}>()
</script>

<template>
  <section class="archive-surface" data-surface="archive" aria-label="Archive surface">
    <div class="archive-body">
      <h2 class="archive-title">已归档会话</h2>

      <p v-if="archivedSessions.length === 0" class="archive-empty">没有已归档的会话</p>

      <div class="archive-list">
        <div
          v-for="session in archivedSessions"
          :key="session.id"
          class="archive-card"
          :data-archive-session="session.id"
        >
          <div class="archive-card__content">
            <strong class="archive-card__title">{{ session.title }}</strong>
            <span class="archive-card__type">{{ session.type }}</span>
            <span class="archive-card__status">{{ session.status }}</span>
          </div>
          <button
            class="archive-card__restore"
            type="button"
            :data-archive-restore="session.id"
            @click="emit('restoreSession', session.id)"
          >
            恢复
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Create `ArchiveSurface.test.ts`**

```typescript
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ArchiveSurface from './ArchiveSurface.vue'
import type { SessionSummary } from '@shared/project-session'

const archivedSession: SessionSummary = {
  id: 'session-archived-1',
  projectId: 'project-1',
  type: 'shell',
  status: 'exited',
  title: 'Old Shell',
  summary: 'done',
  recoveryMode: 'fresh-shell',
  externalSessionId: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
  lastActivatedAt: '2026-04-21T00:00:00.000Z',
  archived: true
}

describe('ArchiveSurface', () => {
  it('renders archive surface with correct data attributes', () => {
    const wrapper = mount(ArchiveSurface, { props: { archivedSessions: [] } })
    expect(wrapper.find('[data-surface="archive"]').exists()).toBe(true)
  })

  it('shows empty message when no archived sessions', () => {
    const wrapper = mount(ArchiveSurface, { props: { archivedSessions: [] } })
    expect(wrapper.find('.archive-empty').exists()).toBe(true)
  })

  it('renders archived session cards', () => {
    const wrapper = mount(ArchiveSurface, {
      props: { archivedSessions: [archivedSession] }
    })
    expect(wrapper.find('[data-archive-session="session-archived-1"]').exists()).toBe(true)
    expect(wrapper.find('.archive-card__title').text()).toBe('Old Shell')
  })

  it('restore button emits restoreSession event', async () => {
    const wrapper = mount(ArchiveSurface, {
      props: { archivedSessions: [archivedSession] }
    })
    await wrapper.find('[data-archive-restore="session-archived-1"]').trigger('click')
    expect(wrapper.emitted('restoreSession')).toHaveLength(1)
    expect(wrapper.emitted('restoreSession')![0]).toEqual(['session-archived-1'])
  })
})
```

- [ ] **Step 3: Run ArchiveSurface tests**

Run: `npx vitest run src/renderer/components/archive/ArchiveSurface.test.ts`
Expected: All tests PASS

---

### Task 13: CommandSurface — forward archive event

**Files:**
- Modify: `src/renderer/components/command/CommandSurface.vue`

- [ ] **Step 1: Add `archiveSession` emit**

In `CommandSurface.vue`, add to emits:

```typescript
const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  archiveSession: [sessionId: string]
}>()
```

- [ ] **Step 2: Forward archive event from WorkspaceHierarchyPanel**

In the template, add to the `WorkspaceHierarchyPanel`:

```vue
<WorkspaceHierarchyPanel
  :hierarchy="hierarchy"
  :active-project-id="activeProjectId"
  :active-session-id="activeSessionId"
  @select-project="emit('selectProject', $event)"
  @select-session="emit('selectSession', $event)"
  @create-project="emit('createProject', $event)"
  @create-session="emit('createSession', $event)"
  @archive-session="emit('archiveSession', $event)"
/>
```

---

### Task 14: WorkspaceHierarchyPanel — add archive button to session rows

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

- [ ] **Step 1: Add `archiveSession` emit**

Add to the emits:

```typescript
const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: SessionType; title: string }]
  archiveSession: [sessionId: string]
}>()
```

- [ ] **Step 2: Add archive button to session rows**

In the template, change the session button to include an archive button. Wrap the session row in a div:

```vue
<div
  v-for="session in project.sessions"
  :key="session.id"
  class="route-session-row"
>
  <button
    class="route-item child"
    :class="{ 'route-item--active': session.id === activeSessionId }"
    :aria-current="session.id === activeSessionId ? 'true' : undefined"
    type="button"
    @click="emit('selectSession', session.id)"
  >
    <div class="route-dot" :class="session.status" />
    <div class="route-copy">
      <div class="route-name">{{ session.title }}</div>
      <div class="route-time">{{ session.type }}</div>
    </div>
  </button>
  <button
    class="route-archive-session"
    type="button"
    :aria-label="`Archive ${session.title}`"
    :data-archive-session="session.id"
    @click.stop="emit('archiveSession', session.id)"
  >
    ×
  </button>
</div>
```

---

### Task 15: App.vue — wire archive/restore handlers

**Files:**
- Modify: `src/renderer/app/App.vue`

- [ ] **Step 1: Add `archiveSession` handler**

After `handleSessionCreate`, add:

```typescript
async function handleArchiveSession(sessionId: string): Promise<void> {
  workspaceStore.archiveSession(sessionId)
  try {
    await window.stoa.archiveSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
    workspaceStore.restoreSession(sessionId)
  }
}
```

- [ ] **Step 2: Add `restoreSession` handler**

After `handleArchiveSession`, add:

```typescript
async function handleRestoreSession(sessionId: string): Promise<void> {
  workspaceStore.restoreSession(sessionId)
  try {
    await window.stoa.restoreSession(sessionId)
  } catch (err) {
    workspaceStore.lastError = err instanceof Error ? err.message : String(err)
    workspaceStore.archiveSession(sessionId)
  }
}
```

- [ ] **Step 3: Add `loadArchivedSessions` in onMounted**

In the `onMounted` callback, after `hydrate`, add:

```typescript
const archived = await window.stoa.listArchivedSessions()
workspaceStore.setArchivedSessions(archived)
```

- [ ] **Step 4: Update template to pass archivedSessions and wire events**

```vue
<AppShell
  :hierarchy="projectHierarchy"
  :active-project-id="activeProjectId"
  :active-session-id="activeSessionId"
  :active-project="activeProject"
  :active-session="activeSession"
  :archived-sessions="archivedSessions"
  @select-project="handleProjectSelect"
  @select-session="handleSessionSelect"
  @create-project="handleProjectCreate"
  @create-session="handleSessionCreate"
  @archive-session="handleArchiveSession"
  @restore-session="handleRestoreSession"
/>
```

- [ ] **Step 5: Destructure `archivedSessions` from store**

Update the `storeToRefs` destructuring:

```typescript
const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession,
  archivedSessions
} = storeToRefs(workspaceStore)
```

---

### Task 16: E2E tests — IPC bridge and config guard

**Files:**
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Add archive/restore IPC round-trip tests in `ipc-bridge.test.ts`**

Read the existing `ipc-bridge.test.ts` to understand the FakeIpcBus pattern, then add tests that:

1. Create a project and session via IPC
2. Archive the session via `session:archive` channel
3. Verify the session has `archived: true` in the snapshot
4. Restore the session via `session:restore` channel
5. Verify the session has `archived: false`
6. Verify `session:list-archived` returns only archived sessions

- [ ] **Step 2: Update `main-config-guard.test.ts`**

Add verification that the new IPC channels (`session:archive`, `session:restore`, `session:list-archived`) are:
1. Registered in `IPC_CHANNELS` constant
2. Used in `ipcMain.handle` calls (not hardcoded strings)
3. Exposed in preload with matching channel names

- [ ] **Step 3: Run all E2E tests**

Run: `npx vitest run tests/e2e/`
Expected: All tests PASS except `main-config-guard.test.ts` sandbox:false known failure

---

### Task 17: Fix remaining component tests

**Files:**
- Any component test that constructs `SessionSummary` or `ProjectHierarchyNode` objects

- [ ] **Step 1: Search for all `SessionSummary` literals in test files**

Run: `grep -r "SessionSummary\|SessionSummary\[" src/renderer/ tests/`

Add `archived: false` to any test file that constructs session objects but is missing the field.

- [ ] **Step 2: Update `WorkspaceList.test.ts` if needed**

Read `src/renderer/components/WorkspaceList.test.ts` and add `archived: false` to all session fixtures.

- [ ] **Step 3: Update any `App.test.ts` mocks**

Read `src/renderer/app/App.test.ts` and add `archiveSession`, `restoreSession`, `listArchivedSessions` to the mock `RendererApi`.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS except `main-config-guard.test.ts` sandbox:false known failure

---

### Task 18: Visual styling for archive components

**Files:**
- Modify: `src/renderer/styles.css` or component-scoped styles

- [ ] **Step 1: Add archive-specific styles**

Follow the existing design language from `docs/engineering/design-language.md`. Add minimal styles for:
- `.archive-surface` — full-height scrollable area
- `.archive-card` — session card with restore button
- `.route-archive-session` — small × button on session rows in hierarchy

Use the project's existing CSS patterns (no Tailwind, no CSS modules — plain CSS with BEM-like conventions as seen in existing components).

- [ ] **Step 2: Run full test suite one final time**

Run: `npx vitest run`
Expected: All tests PASS except `main-config-guard.test.ts` sandbox:false known failure
