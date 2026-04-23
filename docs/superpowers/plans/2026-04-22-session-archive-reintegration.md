# Session Archive Reintegration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move archive and restore interactions back into the session hierarchy so archived sessions live inside project rows instead of a dedicated archive surface.

**Architecture:** Keep `sessions` as the renderer's canonical source of truth and derive active versus archived rows per project inside the workspace store. Remove archive as a top-level surface, render archived rows inside `WorkspaceHierarchyPanel.vue`, and keep archive/restore as optimistic store + IPC actions handled through the existing `App.vue` flow.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vitest, happy-dom

---

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/stores/workspaces.ts` | Canonical project/session derivation for active + archived rows |
| `src/renderer/stores/workspaces.test.ts` | Store-level TDD for hierarchy derivation and archive/restore transitions |
| `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | Project/session hierarchy UI, including row-local archive/restore actions |
| `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts` | Component-level TDD for archived subsection and row actions |
| `src/renderer/components/command/CommandSurface.vue` | Event pass-through between hierarchy and app shell |
| `src/renderer/components/command/CommandSurface.test.ts` | Event forwarding tests |
| `src/renderer/components/GlobalActivityBar.vue` | Top-level activity destinations |
| `src/renderer/components/GlobalActivityBar.test.ts` | Activity item expectations |
| `src/renderer/components/AppShell.vue` | Surface switching between command/settings only |
| `src/renderer/components/AppShell.test.ts` | App shell routing tests after archive surface removal |
| `src/renderer/app/App.vue` | Archive/restore optimistic state and IPC integration |
| `src/renderer/app/App.test.ts` | Root integration tests for archive/restore without archive surface assumptions |
| `src/renderer/components/archive/ArchiveSurface.vue` | Delete |
| `src/renderer/components/archive/ArchiveSurface.test.ts` | Delete |

## Task 1: Make the store derive archived rows per project

**Files:**
- Modify: `src/renderer/stores/workspaces.test.ts`
- Modify: `src/renderer/stores/workspaces.ts`

- [ ] **Step 1: Write the failing tests for per-project archived derivation**

Add tests that prove each project node can expose both active and archived session groups from the same `sessions` source.

```ts
test('projectHierarchy derives archived sessions per project from canonical sessions', () => {
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

  expect(store.projectHierarchy[0]!.sessions.map((session) => session.id)).toEqual(['session_shell_1'])
  expect(store.projectHierarchy[0]!.archivedSessions.map((session) => session.id)).toEqual(['session_archived'])
})

test('archiveSession moves a session from active rows to archived rows for its project', () => {
  const store = useWorkspaceStore()
  // hydrate with one active session
  store.archiveSession('session_shell_1')

  expect(store.projectHierarchy[0]!.sessions).toHaveLength(0)
  expect(store.projectHierarchy[0]!.archivedSessions[0]!.id).toBe('session_shell_1')
})

test('restoreSession moves a session from archived rows back to active rows for its project', () => {
  const store = useWorkspaceStore()
  // hydrate with one archived session
  store.restoreSession('session_archived')

  expect(store.projectHierarchy[0]!.archivedSessions).toHaveLength(0)
  expect(store.projectHierarchy[0]!.sessions[0]!.id).toBe('session_archived')
})
```

- [ ] **Step 2: Run the store test file to verify the new tests fail for the expected reason**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts`
Expected: FAIL because `ProjectHierarchyNode` does not yet expose `archivedSessions` and the current derivation only returns active sessions.

- [ ] **Step 3: Implement the minimal store shape changes**

Update the hierarchy type and computed derivation so each project contains active and archived rows from the same backing `sessions` array.

```ts
export interface ProjectHierarchyNode extends ProjectSummary {
  active: boolean
  sessions: Array<SessionSummary & { active: boolean }>
  archivedSessions: Array<SessionSummary & { active: boolean }>
}

const projectHierarchy = computed<ProjectHierarchyNode[]>(() => {
  return projects.value.map((project) => {
    const projectSessions = sessions.value
      .filter((session) => session.projectId === project.id)
      .map((session) => ({
        ...session,
        active: session.id === activeSessionId.value
      }))

    return {
      ...project,
      active: project.id === activeProjectId.value,
      sessions: projectSessions.filter((session) => !session.archived),
      archivedSessions: projectSessions.filter((session) => session.archived)
    }
  })
})
```

Remove the renderer-only duplicate archive list state if it is no longer needed:

```ts
// delete
const archivedSessions = ref<SessionSummary[]>([])

function setArchivedSessions(_sessions: SessionSummary[]): void {
  // delete this function entirely
}
```

- [ ] **Step 4: Run the store test file to verify it passes**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts`
Expected: PASS

## Task 2: Move archive and restore into the hierarchy rows

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

- [ ] **Step 1: Write failing hierarchy panel tests**

Add tests that lock in the new structure.

```ts
it('renders archived sessions inside a project archived subsection', () => {
  const wrapper = mountPanel({
    hierarchy: [{
      ...createHierarchy()[0],
      sessions: [createHierarchy()[0]!.sessions[0]!],
      archivedSessions: [{
        ...createHierarchy()[0]!.sessions[1]!,
        id: 'session_archived',
        title: 'old shell',
        archived: true,
        active: false
      }]
    }]
  })

  expect(wrapper.find('[data-archived-group="project_alpha"]').exists()).toBe(true)
  expect(wrapper.find('[data-archived-session="session_archived"]').exists()).toBe(true)
})

it('clicking archive action emits archiveSession without selecting the row', async () => {
  const wrapper = mountPanel()

  await wrapper.find('[data-row-archive="session_1"]').trigger('click')

  expect(wrapper.emitted('archiveSession')).toEqual([['session_1']])
  expect(wrapper.emitted('selectSession')).toBeUndefined()
})

it('clicking restore action emits restoreSession without selecting the row', async () => {
  const wrapper = mountPanel({
    hierarchy: [{
      ...createHierarchy()[0],
      sessions: [],
      archivedSessions: [{
        ...createHierarchy()[0]!.sessions[0]!,
        id: 'session_archived',
        title: 'old shell',
        archived: true,
        active: false
      }]
    }]
  })

  await wrapper.find('[data-row-restore="session_archived"]').trigger('click')

  expect(wrapper.emitted('restoreSession')).toEqual([['session_archived']])
  expect(wrapper.emitted('selectSession')).toBeUndefined()
})
```

- [ ] **Step 2: Run the hierarchy panel test file and verify it fails**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: FAIL because `restoreSession` is not emitted, archived rows are not rendered in-panel, and the row action selectors do not exist.

- [ ] **Step 3: Implement the minimal hierarchy panel changes**

Refactor the component to accept `archivedSessions` per project node and render row-local action areas.

```ts
const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: SessionType; title: string }]
  archiveSession: [sessionId: string]
  restoreSession: [sessionId: string]
}>()

const archivedOpen = ref<Record<string, boolean>>({})

function isArchivedOpen(projectId: string): boolean {
  return archivedOpen.value[projectId] ?? false
}

function toggleArchived(projectId: string): void {
  archivedOpen.value = {
    ...archivedOpen.value,
    [projectId]: !isArchivedOpen(projectId)
  }
}
```

Use a shared row structure for both active and archived rows:

```vue
<div v-for="session in project.sessions" :key="session.id" class="route-session-row">
  <button class="route-item child" type="button" @click="emit('selectSession', session.id)">
    <div class="route-dot" :class="session.status" />
    <div class="route-copy">
      <div class="route-name">{{ session.title }}</div>
      <div class="route-time">{{ session.type }}</div>
    </div>
    <span class="route-row-actions">
      <button
        class="route-row-action"
        type="button"
        :data-row-archive="session.id"
        @click.stop="emit('archiveSession', session.id)"
      >
        Archive
      </button>
    </span>
  </button>
</div>

<div
  v-if="project.archivedSessions.length > 0"
  class="route-archived-group"
  :data-archived-group="project.id"
>
  <button
    class="route-archived-toggle"
    type="button"
    @click="toggleArchived(project.id)"
  >
    已归档 {{ project.archivedSessions.length }}
  </button>

  <div v-if="isArchivedOpen(project.id)" class="route-archived-list">
    <div v-for="session in project.archivedSessions" :key="session.id" class="route-session-row route-session-row--archived">
      <div class="route-item child route-item--archived" :data-archived-session="session.id">
        <div class="route-dot" :class="session.status" />
        <div class="route-copy">
          <div class="route-name">{{ session.title }}</div>
          <div class="route-time">{{ session.type }}</div>
        </div>
        <span class="route-row-actions">
          <button
            class="route-row-action"
            type="button"
            :data-row-restore="session.id"
            @click.stop="emit('restoreSession', session.id)"
          >
            Restore
          </button>
        </span>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Apply token-only styling for row-local actions and archived rows**

Add or update scoped styles only with shared tokens.

```css
.route-row-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.route-row-action {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-solid);
  color: var(--muted);
  padding: 4px 8px;
  font: inherit;
  transition: all 0.2s ease;
}

.route-item--archived {
  color: var(--text);
}

.route-item--archived .route-time,
.route-item--archived .route-path {
  color: var(--subtle);
}
```

- [ ] **Step 5: Run the hierarchy panel test file to verify it passes**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: PASS

## Task 3: Wire restore events through CommandSurface and App

**Files:**
- Modify: `src/renderer/components/command/CommandSurface.test.ts`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/app/App.test.ts`
- Modify: `src/renderer/app/App.vue`

- [ ] **Step 1: Write the failing event-forwarding test for CommandSurface**

```ts
it('forwards restoreSession from WorkspaceHierarchyPanel', async () => {
  const wrapper = mount(CommandSurface, {
    global: { plugins: [createPinia()] },
    props: {
      hierarchy,
      activeProject,
      activeSession,
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_1'
    }
  })

  await wrapper.findComponent(WorkspaceHierarchyPanel).vm.$emit('restoreSession', 'session_1')

  expect(wrapper.emitted('restoreSession')).toEqual([['session_1']])
})
```

- [ ] **Step 2: Run the CommandSurface test file and verify it fails**

Run: `npx vitest run src/renderer/components/command/CommandSurface.test.ts`
Expected: FAIL because `restoreSession` is not part of the current emit contract.

- [ ] **Step 3: Implement restore forwarding in CommandSurface**

```ts
const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  archiveSession: [sessionId: string]
  restoreSession: [sessionId: string]
}>()
```

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
  @restore-session="emit('restoreSession', $event)"
/>
```

- [ ] **Step 4: Update root App tests for canonical-session-only bootstrapping**

Replace archive-surface-specific expectations with tests that use `sessions` as the source of truth.

```ts
it('does not fetch a separate archived session list on mount', async () => {
  wrapper = await mountApp(pinia)
  await flush()

  expect(window.stoa.listArchivedSessions).not.toHaveBeenCalled()
})

it('restoreSession event updates store and calls window.stoa.restoreSession', async () => {
  // hydrate one archived session in bootstrapState.sessions
  // emit restoreSession from AppShell
  // expect archived flag to become false and IPC to be called
})
```

- [ ] **Step 5: Run the App test file and verify it fails for the expected reasons**

Run: `npx vitest run src/renderer/app/App.test.ts`
Expected: FAIL because mount still calls `listArchivedSessions()` and the updated assertions are not yet satisfied.

- [ ] **Step 6: Implement the minimal App.vue changes**

Remove separate archive-list loading and keep archive/restore as optimistic state + IPC only.

```ts
const {
  projectHierarchy,
  activeProjectId,
  activeSessionId,
  activeProject,
  activeSession
} = storeToRefs(workspaceStore)

onMounted(async () => {
  const bootstrapState = await window.stoa.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)
  await settingsStore.loadSettings()

  unsubscribeSessionEvent = window.stoa?.onSessionEvent?.((event: SessionStatusEvent) => {
    workspaceStore.updateSession(event.sessionId, {
      status: event.status,
      summary: event.summary
    })
  })
})
```

Update `AppShell` props passed from `App.vue` so `archivedSessions` is no longer sent.

- [ ] **Step 7: Run the CommandSurface and App tests to verify they pass**

Run: `npx vitest run src/renderer/components/command/CommandSurface.test.ts src/renderer/app/App.test.ts`
Expected: PASS

## Task 4: Remove archive as a top-level surface

**Files:**
- Modify: `src/renderer/components/GlobalActivityBar.test.ts`
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Modify: `src/renderer/components/AppShell.test.ts`
- Modify: `src/renderer/components/AppShell.vue`
- Delete: `src/renderer/components/archive/ArchiveSurface.vue`
- Delete: `src/renderer/components/archive/ArchiveSurface.test.ts`

- [ ] **Step 1: Write failing activity bar and app shell tests**

Update tests to lock the new top-level navigation.

```ts
it('renders 2 activity items with correct data-activity-item values', () => {
  const wrapper = mountBar()
  const ids = wrapper.findAll('[data-activity-item]').map((el) => el.attributes('data-activity-item'))
  expect(ids).toEqual(['command', 'settings'])
})

it('renders command in top cluster and settings in bottom cluster', () => {
  const wrapper = mountBar()
  const topCluster = wrapper.find('.activity-bar__cluster--top')
  const bottomCluster = wrapper.find('.activity-bar__cluster--bottom')
  expect(topCluster.find('[data-activity-item="command"]').exists()).toBe(true)
  expect(bottomCluster.find('[data-activity-item="settings"]').exists()).toBe(true)
  expect(bottomCluster.find('[data-activity-item="archive"]').exists()).toBe(false)
})
```

```ts
it('does not render archive surface when switching activities', async () => {
  const wrapper = mount(AppShell, {
    global: { plugins: [createPinia()] },
    props: {
      hierarchy: [],
      activeProjectId: null,
      activeSessionId: null,
      activeProject: null,
      activeSession: null
    }
  })

  expect(wrapper.find('[data-surface="archive"]').exists()).toBe(false)

  await wrapper.get('button[aria-label="Settings"]').trigger('click')

  expect(wrapper.find('[data-surface="archive"]').exists()).toBe(false)
})
```

- [ ] **Step 2: Run the activity bar and app shell test files to verify they fail**

Run: `npx vitest run src/renderer/components/GlobalActivityBar.test.ts src/renderer/components/AppShell.test.ts`
Expected: FAIL because archive still exists as a surface and activity item.

- [ ] **Step 3: Implement the minimal top-level UI removals**

Update `GlobalActivityBar.vue`:

```ts
export type AppSurface = 'command' | 'settings'

const bottomItems: Array<{ id: AppSurface; label: string; title: string }> = [
  { id: 'settings', label: '⚙', title: 'Settings' }
]
```

Update `AppShell.vue`:

```ts
import GlobalActivityBar from './GlobalActivityBar.vue'
import CommandSurface from './command/CommandSurface.vue'
import SettingsSurface from './settings/SettingsSurface.vue'

const props = defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
  activeProject: ProjectSummary | null
  activeSession: SessionSummary | null
}>()

const emit = defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: string; title: string }]
  archiveSession: [sessionId: string]
  restoreSession: [sessionId: string]
}>()
```

Remove the archive branch from the template and pass `restore-session` through `CommandSurface` instead of an archive page.

- [ ] **Step 4: Delete the archive surface files**

Delete:
- `src/renderer/components/archive/ArchiveSurface.vue`
- `src/renderer/components/archive/ArchiveSurface.test.ts`

- [ ] **Step 5: Run the activity bar and app shell tests to verify they pass**

Run: `npx vitest run src/renderer/components/GlobalActivityBar.test.ts src/renderer/components/AppShell.test.ts`
Expected: PASS

## Task 5: Final renderer verification and full suite

**Files:**
- Modify: any affected e2e/static tests after local renderer changes reveal breakage

- [ ] **Step 1: Run diagnostics on all changed renderer/store files**

Run diagnostics on:
- `src/renderer/stores/workspaces.ts`
- `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- `src/renderer/components/command/CommandSurface.vue`
- `src/renderer/components/GlobalActivityBar.vue`
- `src/renderer/components/AppShell.vue`
- `src/renderer/app/App.vue`

Expected: zero errors

- [ ] **Step 2: Run the targeted renderer test set**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/command/CommandSurface.test.ts src/renderer/components/GlobalActivityBar.test.ts src/renderer/components/AppShell.test.ts src/renderer/app/App.test.ts`
Expected: PASS

- [ ] **Step 3: Run related e2e tests and fix regressions caused by the archive surface removal**

Run: `npx vitest run tests/e2e/frontend-store-projection.test.ts tests/e2e/app-bridge-guard.test.ts tests/e2e/backend-lifecycle.test.ts tests/e2e/store-lifecycle-sync.test.ts`
Expected: PASS or clearly identified failures caused by outdated archive-surface assumptions.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS with zero unexpected failures

- [ ] **Step 5: Review diff against spec before completion**

Confirm the final diff satisfies all approved design points:
- no top-level archive surface
- no archive activity item
- row-local archive and restore actions
- archived subsection inside hierarchy
- token-only styling and restrained motion
