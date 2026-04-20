# Project / Session Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace-centric model with a breaking-change canonical `Project -> Session` model across shared contracts, persistence, main-process runtime orchestration, providers, preload IPC, renderer state, and UI.

**Architecture:** Introduce canonical `ProjectSummary` and `SessionSummary` shared types, persist `projects[]` and `sessions[]`, and move runtime orchestration to a session-centric service in the main process. Recovery stays subtype-driven: shell sessions relaunch with a fresh runtime attached to the same session record, while opencode sessions resume through persisted `external_session_id` without storing heavy local context.

**Tech Stack:** Electron, Vue 3, Pinia, TypeScript, Vitest, node-pty, electron-vite

---

### Task 1: Replace shared workspace contracts with project/session contracts

**Files:**
- Create: `src/shared/project-session.ts`
- Modify: `src/shared/index.d.ts`
- Modify: `src/preload/index.ts`
- Test: `src/shared/project-session.test.ts`

- [ ] **Step 1: Write the failing shared contract test**

```ts
// src/shared/project-session.test.ts
import { describe, expect, it } from 'vitest'
import type {
  PersistedAppStateV2,
  ProjectSummary,
  SessionSummary,
  SessionType
} from './project-session'

describe('project/session shared contracts', () => {
  it('models canonical project -> session hierarchy', () => {
    const project: ProjectSummary = {
      id: 'project_alpha',
      name: 'alpha',
      path: 'D:/alpha',
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z'
    }

    const session: SessionSummary = {
      id: 'session_shell_1',
      projectId: 'project_alpha',
      type: 'shell' satisfies SessionType,
      status: 'running',
      title: 'Shell 1',
      summary: 'attached',
      recoveryMode: 'fresh-shell',
      externalSessionId: null,
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      lastActivatedAt: '2026-04-19T00:00:00.000Z'
    }

    const state: PersistedAppStateV2 = {
      version: 2,
      active_project_id: 'project_alpha',
      active_session_id: 'session_shell_1',
      projects: [
        {
          project_id: project.id,
          name: project.name,
          path: project.path,
          created_at: project.createdAt,
          updated_at: project.updatedAt
        }
      ],
      sessions: [
        {
          session_id: session.id,
          project_id: session.projectId,
          type: session.type,
          title: session.title,
          last_known_status: session.status,
          last_summary: session.summary,
          external_session_id: null,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          last_activated_at: session.lastActivatedAt,
          recovery_mode: session.recoveryMode
        }
      ]
    }

    expect(state.projects[0]?.path).toBe('D:/alpha')
    expect(state.sessions[0]?.project_id).toBe('project_alpha')
  })
})
```

- [ ] **Step 2: Run the shared contract test and verify failure**

Run: `pnpm test src/shared/project-session.test.ts`

Expected: FAIL because `src/shared/project-session.ts` does not exist yet.

- [ ] **Step 3: Create canonical shared types**

```ts
// src/shared/project-session.ts
export type SessionType = 'shell' | 'opencode'
export type SessionRecoveryMode = 'fresh-shell' | 'resume-external'
export type SessionStatus =
  | 'bootstrapping'
  | 'starting'
  | 'running'
  | 'awaiting_input'
  | 'degraded'
  | 'error'
  | 'exited'
  | 'needs_confirmation'

export interface ProjectSummary {
  id: string
  name: string
  path: string
  defaultSessionType?: SessionType
  createdAt: string
  updatedAt: string
}

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
}

export interface PersistedProject {
  project_id: string
  name: string
  path: string
  default_session_type?: SessionType
  created_at: string
  updated_at: string
}

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
}

export interface PersistedAppStateV2 {
  version: 2
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  sessions: PersistedSession[]
}
```

- [ ] **Step 4: Update preload typing surface to use project/session contracts**

```ts
// src/preload/index.ts (shape change only)
import type {
  ProjectSummary,
  SessionSummary,
  PersistedAppStateV2
} from '@shared/project-session'

export interface RendererApi {
  getBootstrapState: () => Promise<BootstrapState>
  createProject: (request: CreateProjectRequest) => Promise<ProjectSummary>
  createSession: (request: CreateSessionRequest) => Promise<SessionSummary>
  setActiveProject: (projectId: string) => Promise<void>
  setActiveSession: (sessionId: string) => Promise<void>
}
```

- [ ] **Step 5: Run the shared contract test and typecheck**

Run: `pnpm test src/shared/project-session.test.ts && pnpm typecheck`

Expected: PASS for the new shared test; typecheck may still fail in untouched callers that still import workspace types.

- [ ] **Step 6: Commit**

```bash
git add src/shared/project-session.ts src/shared/project-session.test.ts src/preload/index.ts src/shared/index.d.ts
git commit -m "refactor: add canonical project session contracts"
```

### Task 2: Replace persistence and main-process state ownership with project/session state

**Files:**
- Modify: `src/core/state-store.ts`
- Create: `src/core/project-session-manager.ts`
- Modify: `src/main/index.ts`
- Test: `src/core/state-store.test.ts`
- Test: `src/core/project-session-manager.test.ts`

- [ ] **Step 1: Write the failing persistence test for version 2 state**

```ts
// src/core/state-store.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE } from './state-store'

describe('state-store v2', () => {
  it('defaults to an empty project/session state', () => {
    expect(DEFAULT_STATE).toEqual({
      version: 2,
      active_project_id: null,
      active_session_id: null,
      projects: [],
      sessions: []
    })
  })
})
```

- [ ] **Step 2: Write the failing manager integrity test**

```ts
// src/core/project-session-manager.test.ts
import { describe, expect, it } from 'vitest'
import { ProjectSessionManager } from './project-session-manager'

describe('ProjectSessionManager', () => {
  it('rejects orphan sessions and enforces unique project paths', async () => {
    const manager = ProjectSessionManager.createForTest()

    const project = await manager.createProject({
      name: 'alpha',
      path: 'D:/alpha'
    })

    await manager.createSession({
      projectId: project.id,
      type: 'shell',
      title: 'Shell 1'
    })

    await expect(manager.createProject({ name: 'alpha-copy', path: 'D:/alpha' })).rejects.toThrow(
      'Project path already exists'
    )
  })
})
```

- [ ] **Step 3: Run the tests and verify failure**

Run: `pnpm test src/core/state-store.test.ts src/core/project-session-manager.test.ts`

Expected: FAIL because the manager file and v2 defaults do not exist yet.

- [ ] **Step 4: Implement v2 persistence and canonical manager**

```ts
// src/core/state-store.ts
export const DEFAULT_STATE: PersistedAppStateV2 = {
  version: 2,
  active_project_id: null,
  active_session_id: null,
  projects: [],
  sessions: []
}
```

```ts
// src/core/project-session-manager.ts
export class ProjectSessionManager {
  static createForTest() {
    return new ProjectSessionManager({
      activeProjectId: null,
      activeSessionId: null,
      projects: [],
      sessions: []
    })
  }

  async createProject(input: { name: string; path: string }) {
    const normalizedPath = normalizePath(input.path)
    const duplicate = this.state.projects.find((project) => normalizePath(project.path) === normalizedPath)

    if (duplicate) {
      throw new Error('Project path already exists')
    }

    // create and persist ProjectSummary
  }

  async createSession(input: { projectId: string; type: SessionType; title: string }) {
    const project = this.state.projects.find((candidate) => candidate.id === input.projectId)
    if (!project) {
      throw new Error('Session must belong to an existing project')
    }

    // create and persist SessionSummary
  }
}
```

- [ ] **Step 5: Rewire main bootstrap to use the new manager**

```ts
// src/main/index.ts (high-level replacement)
let projectSessionManager: ProjectSessionManager | null = null

ipcMain.handle(IPC_CHANNELS.projectBootstrap, async () => {
  return projectSessionManager?.snapshot()
})

ipcMain.handle(IPC_CHANNELS.projectCreate, async (_event, payload) => {
  return projectSessionManager?.createProject(payload)
})

ipcMain.handle(IPC_CHANNELS.sessionCreate, async (_event, payload) => {
  return createAndStartSession(payload)
})
```

- [ ] **Step 6: Run tests and targeted typecheck**

Run: `pnpm test src/core/state-store.test.ts src/core/project-session-manager.test.ts && pnpm typecheck`

Expected: PASS for the new core tests; typecheck may still fail in renderer/runtime files not yet updated.

- [ ] **Step 7: Commit**

```bash
git add src/core/state-store.ts src/core/state-store.test.ts src/core/project-session-manager.ts src/core/project-session-manager.test.ts src/main/index.ts
git commit -m "refactor: introduce project session state manager"
```

### Task 3: Convert provider and runtime orchestration from workspace-based to session-based

**Files:**
- Modify: `src/extensions/providers/index.ts`
- Modify: `src/extensions/providers/local-shell-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/core/workspace-runtime.ts`
- Modify: `src/core/pty-host.ts`
- Test: `src/extensions/providers/opencode-provider.test.ts`

- [ ] **Step 1: Write the failing opencode provider resume test**

```ts
// src/extensions/providers/opencode-provider.test.ts
import { describe, expect, it } from 'vitest'
import { createOpenCodeProvider } from './opencode-provider'

describe('opencode provider', () => {
  it('builds a resume command from canonical external session id', async () => {
    const provider = createOpenCodeProvider()
    const command = await provider.buildResumeCommand(
      {
        session_id: 'session_op_1',
        project_id: 'project_alpha',
        path: 'D:/alpha',
        title: 'Deploy',
        type: 'opencode'
      },
      'external-123',
      { webhookPort: 4100, sessionSecret: 'secret', providerPort: 4101 }
    )

    expect(command.args).toContain('--session')
    expect(command.args).toContain('external-123')
  })
})
```

- [ ] **Step 2: Run the provider test and verify failure**

Run: `pnpm test src/extensions/providers/opencode-provider.test.ts`

Expected: FAIL because provider contracts still expect workspace-shaped inputs.

- [ ] **Step 3: Replace runtime input contracts with session-shaped inputs**

```ts
// src/core/workspace-runtime.ts -> keep file or rename later, but switch semantics
export interface StartSessionRuntimeOptions {
  project: ProjectSummary
  session: SessionSummary
  provider: ProviderDefinition
  ptyHost: SessionRuntimePtyHost
  manager: SessionRuntimeManager
}

const canResume =
  session.type === 'opencode' &&
  session.recoveryMode === 'resume-external' &&
  !!session.externalSessionId
```

```ts
// src/extensions/providers/local-shell-provider.ts
supportsResume() {
  return false
}
```

```ts
// src/extensions/providers/opencode-provider.ts
async buildResumeCommand(session, externalSessionId, context) {
  return createCommand(session, context, ['--port', String(context.providerPort), '--session', externalSessionId])
}
```

- [ ] **Step 4: Normalize shell vs opencode recovery outcomes in the main-process runtime service**

```ts
if (session.type === 'shell') {
  await startFreshShellRuntime(session)
} else {
  await resumeOrDegradeOpencodeSession(session)
}
```

- [ ] **Step 5: Run provider tests and related typecheck**

Run: `pnpm test src/extensions/providers/opencode-provider.test.ts && pnpm typecheck`

Expected: PASS for provider tests; remaining type errors should now be concentrated in renderer/store consumers.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/providers/index.ts src/extensions/providers/local-shell-provider.ts src/extensions/providers/opencode-provider.ts src/extensions/providers/opencode-provider.test.ts src/core/workspace-runtime.ts src/core/pty-host.ts
git commit -m "refactor: make runtime orchestration session based"
```

### Task 4: Replace renderer workspace store and hierarchy UI with canonical project/session state

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/HierarchyNode.vue`
- Modify: `src/renderer/components/command/TerminalMetaBar.vue`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Test: `src/renderer/stores/workspaces.test.ts`
- Test: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Write the failing store test for canonical project/session hierarchy**

```ts
// src/renderer/stores/workspaces.test.ts
import { describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorkspaceStore } from './workspaces'

describe('project/session renderer store', () => {
  it('hydrates explicit projects and sessions without name+path grouping', () => {
    setActivePinia(createPinia())
    const store = useWorkspaceStore()

    store.hydrate({
      activeProjectId: 'project_alpha',
      activeSessionId: 'session_op_1',
      projects: [
        { id: 'project_alpha', name: 'alpha', path: 'D:/alpha', createdAt: 'a', updatedAt: 'a' }
      ],
      sessions: [
        {
          id: 'session_op_1',
          projectId: 'project_alpha',
          type: 'opencode',
          status: 'running',
          title: 'Deploy',
          summary: 'running',
          recoveryMode: 'resume-external',
          externalSessionId: 'ext-1',
          createdAt: 'a',
          updatedAt: 'a',
          lastActivatedAt: 'a'
        }
      ]
    })

    expect(store.projectHierarchy).toHaveLength(1)
    expect(store.projectHierarchy[0]?.sessions).toHaveLength(1)
    expect(store.projectHierarchy[0]?.sessions[0]?.active).toBe(true)
  })
})
```

- [ ] **Step 2: Run the store test and verify failure**

Run: `pnpm test src/renderer/stores/workspaces.test.ts`

Expected: FAIL because the current store still exposes workspace-specific state.

- [ ] **Step 3: Replace renderer store shape and creation handlers**

```ts
// src/renderer/stores/workspaces.ts
const projects = ref<ProjectSummary[]>([])
const sessions = ref<SessionSummary[]>([])
const activeProjectId = ref<string | null>(null)
const activeSessionId = ref<string | null>(null)

const projectHierarchy = computed(() => {
  return projects.value.map((project) => ({
    ...project,
    sessions: sessions.value
      .filter((session) => session.projectId === project.id)
      .map((session) => ({ ...session, active: session.id === activeSessionId.value }))
  }))
})
```

```vue
<!-- src/renderer/app/App.vue -->
<AppShell
  :projects="projects"
  :sessions="sessions"
  :hierarchy="projectHierarchy"
  :active-project-id="activeProjectId"
  :active-session-id="activeSessionId"
  @create-project="handleProjectCreate"
  @create-session="handleSessionCreate"
/>
```

- [ ] **Step 4: Update hierarchy UI to render Project -> Session directly**

```vue
<!-- src/renderer/components/command/WorkspaceHierarchyPanel.vue -->
<button class="route-action" type="button" @click="emit('createProject')">New Project</button>

<section v-for="project in hierarchy" :key="project.id" :data-parent-group="project.id">
  <button type="button" @click="emit('createSession', project.id)">
    <span class="route-add-session">+</span>
  </button>

  <HierarchyNode
    v-for="session in project.sessions"
    :key="session.id"
    :session="session"
    @select="emit('selectSession', $event)"
  />
</section>
```

- [ ] **Step 5: Run renderer store/component tests and typecheck**

Run: `pnpm test src/renderer/stores/workspaces.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts && pnpm typecheck`

Expected: PASS for updated renderer tests.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/stores/workspaces.ts src/renderer/stores/workspaces.test.ts src/renderer/app/App.vue src/renderer/components/AppShell.vue src/renderer/components/command/CommandSurface.vue src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/HierarchyNode.vue src/renderer/components/command/TerminalMetaBar.vue src/renderer/components/TerminalViewport.vue src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
git commit -m "refactor: switch renderer to project session hierarchy"
```

### Task 5: Add recovery verification and finish the breaking-change cleanup

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Delete: `src/core/session-manager.ts`
- Test: `src/core/project-session-manager.test.ts`
- Test: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write the failing recovery test for shell/opencode divergence**

```ts
it('relaunches shell sessions and resumes opencode sessions during bootstrap', async () => {
  const manager = ProjectSessionManager.createForTest()
  const project = await manager.createProject({ name: 'alpha', path: 'D:/alpha' })

  const shell = await manager.createSession({ projectId: project.id, type: 'shell', title: 'Shell 1' })
  const opencode = await manager.createSession({
    projectId: project.id,
    type: 'opencode',
    title: 'Deploy',
    externalSessionId: 'ext-123'
  })

  const outcomes = await manager.buildBootstrapRecoveryPlan()

  expect(outcomes).toEqual([
    { sessionId: shell.id, action: 'fresh-shell' },
    { sessionId: opencode.id, action: 'resume-external', externalSessionId: 'ext-123' }
  ])
})
```

- [ ] **Step 2: Run the recovery test and verify failure**

Run: `pnpm test src/core/project-session-manager.test.ts`

Expected: FAIL because the manager does not yet expose bootstrap recovery planning.

- [ ] **Step 3: Implement bootstrap recovery planning and remove old workspace IPC**

```ts
// src/core/ipc-channels.ts
export const IPC_CHANNELS = {
  projectBootstrap: 'project:bootstrap',
  projectCreate: 'project:create',
  projectSetActive: 'project:set-active',
  sessionCreate: 'session:create',
  sessionSetActive: 'session:set-active',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
  sessionEvent: 'session:event',
  terminalData: 'terminal:data'
} as const
```

```ts
// src/core/project-session-manager.ts
buildBootstrapRecoveryPlan() {
  return this.state.sessions.map((session) =>
    session.type === 'shell'
      ? { sessionId: session.id, action: 'fresh-shell' as const }
      : { sessionId: session.id, action: 'resume-external' as const, externalSessionId: session.externalSessionId }
  )
}
```

- [ ] **Step 4: Delete the old workspace manager after callers are switched**

```bash
git rm src/core/session-manager.ts
```

- [ ] **Step 5: Run full verification**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: PASS. No remaining imports of `@shared/workspace`, no remaining `workspace:*` IPC channels, and the app builds with the canonical `Project -> Session` model only.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/core/project-session-manager.ts src/core/ipc-channels.ts src/preload/index.ts src/renderer/components/TerminalViewport.test.ts
git commit -m "refactor: complete project session breaking change"
```

## Spec Coverage Check

- Canonical `Project -> Session` model: covered by Tasks 1, 2, and 4.
- Session subtype recovery (`shell` fresh-shell, `opencode` resume-external): covered by Tasks 3 and 5.
- Remove `Workspace` semantics: covered by Tasks 1, 2, 4, and 5.
- Lightweight persistence only: covered by Tasks 2 and 5.
- Breaking change / no migration: covered by Task 5 with deletion of the old manager and IPC surface.

## Placeholder Scan

- No `TODO`, `TBD`, or “implement later” placeholders remain in the task steps.
- Every code-writing step includes concrete code or shape to implement.
- Every verification step has an explicit command and expected outcome.

## Type Consistency Check

- Canonical top-level entities are consistently named `ProjectSummary` and `SessionSummary`.
- Persisted recovery handle is consistently named `externalSessionId` in memory and `external_session_id` in persistence.
- Recovery modes are consistently `fresh-shell` and `resume-external`.

Plan complete and saved to `docs/superpowers/plans/2026-04-19-project-session-unification-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
