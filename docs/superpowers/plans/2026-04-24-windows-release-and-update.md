# Windows Release And Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-only GitHub Release + in-app update flow for `stoa`, with NSIS packaging, user-confirmed update installs, and storage hardening that protects user state during upgrades.

**Architecture:** The implementation is split into six slices: persistence hardening, shared update contracts, main-process update runtime, renderer update UX, packaging/release verification, and GitHub Actions/runbook automation. The update client lives in the Electron main process via `electron-updater`, renderer code talks to it only through typed preload APIs, and persistence safety is hardened first so the app is safe to upgrade before release automation is enabled.

**Tech Stack:** Electron 37, electron-builder, electron-updater, Vue 3, Pinia, Vitest, Playwright, pnpm/Corepack, GitHub Actions

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `package.json` | Add `electron-updater` and release verification scripts |
| Modify | `electron-builder.yml` | Switch formal Windows packaging to NSIS and GitHub publishing |
| Create | `.github/workflows/ci.yml` | Main-branch cloud verification with pinned pnpm |
| Create | `.github/workflows/release.yml` | Tag-triggered formal Windows release workflow |
| Create | `docs/operations/release-and-update-runbook.md` | Operator guide for releases, logs, and recovery |
| Create | `src/shared/update-state.ts` | Shared updater state/command types |
| Modify | `src/shared/project-session.ts` | Extend `RendererApi`; version per-project sessions |
| Modify | `src/core/ipc-channels.ts` | Add update IPC channel constants |
| Modify | `src/preload/index.ts` | Expose typed update API and push subscription |
| Create | `src/main/update-service.ts` | Main-process update coordinator over `electron-updater` |
| Create | `src/main/update-service.test.ts` | Unit tests for updater state machine and guards |
| Modify | `src/main/index.ts` | Wire update service, IPC handlers, push events, session warnings |
| Modify | `src/core/state-store.ts` | Atomic writes, corruption backup, version rejection, multi-file rules |
| Modify | `src/core/state-store.test.ts` | Unit tests for atomic writes and schema rejection |
| Modify | `src/core/project-session-manager.ts` | Write project sessions before global commit marker |
| Modify | `src/core/project-session-manager.test.ts` | Multi-file consistency / salvage tests |
| Modify | `tests/e2e/error-edge-cases.test.ts` | Cross-file consistency and unsupported schema coverage |
| Modify | `tests/e2e/main-config-guard.test.ts` | IPC and preload contract guards for update channels |
| Create | `tests/e2e/update-bridge.test.ts` | Main/preload/renderer fake updater integration |
| Create | `src/renderer/stores/update.ts` | Renderer-side update state store |
| Create | `src/renderer/stores/update.test.ts` | Update store tests |
| Modify | `src/renderer/app/App.vue` | Subscribe to update events and host prompt surface |
| Modify | `src/renderer/app/App.test.ts` | App bootstrap/update prompt integration tests |
| Modify | `src/renderer/components/settings/AboutSettings.vue` | About panel update status and actions |
| Modify | `src/renderer/components/settings/AboutSettings.test.ts` | About panel update UI tests |
| Create | `src/renderer/components/update/UpdatePrompt.vue` | Lightweight update/install confirmation modal |
| Create | `src/renderer/components/update/UpdatePrompt.test.ts` | Prompt interaction tests |
| Modify | `scripts/verify-packaging-baseline.mjs` | Assert NSIS + updater metadata artifacts |
| Create | `scripts/smoke-packaged-release.mjs` | Launch packaged app and verify packaged PTY path |

---

### Task 1: Harden Persisted State And Version Boundaries

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/state-store.ts`
- Modify: `src/core/state-store.test.ts`

- [ ] **Step 1: Write failing state-store tests for versioned per-project sessions, corruption backup, and unsupported schema rejection**

Append these tests to `src/core/state-store.test.ts`:

```ts
test('returns empty version-4 project sessions when no file exists', async () => {
  const projectDir = await createTempProjectDir()

  await expect(readProjectSessions(projectDir)).resolves.toEqual({
    version: 4,
    project_id: '',
    sessions: []
  })
})

test('backs up invalid global state before returning the default', async () => {
  const globalStatePath = await createTempGlobalStatePath()
  await import('node:fs/promises').then(({ mkdir, writeFile }) =>
    mkdir(dirname(globalStatePath), { recursive: true }).then(() =>
      writeFile(globalStatePath, '{not-json', 'utf-8')
    )
  )

  const read = await readGlobalState(globalStatePath)

  expect(read).toEqual(DEFAULT_GLOBAL_STATE)
  const backupDir = join(globalStatePath, '..', 'backups')
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(backupDir))
  expect(entries.some((entry) => entry.includes('global.corrupt'))).toBe(true)
})

test('backs up unsupported unversioned project sessions before returning default', async () => {
  const projectDir = await createTempProjectDir()
  await import('node:fs/promises').then(({ mkdir, writeFile }) =>
    mkdir(join(projectDir, '.stoa'), { recursive: true }).then(() =>
      writeFile(join(projectDir, '.stoa', 'sessions.json'), JSON.stringify({
        project_id: 'project_alpha',
        sessions: []
      }), 'utf-8')
    )
  )

  const read = await readProjectSessions(projectDir)

  expect(read).toEqual({
    version: 4,
    project_id: '',
    sessions: []
  })
  const backupDir = join(projectDir, '.stoa', 'backups')
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(backupDir))
  expect(entries.some((entry) => entry.includes('sessions.unsupported'))).toBe(true)
})
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pnpm vitest run src/core/state-store.test.ts`

Expected: FAIL because `PersistedProjectSessions` has no `version`, there is no backup directory logic, and unsupported unversioned files are still accepted.

- [ ] **Step 3: Implement minimal persisted versioning and backup-aware reads/writes**

Apply these changes:

In `src/shared/project-session.ts`, change the project session contract:

```ts
export interface PersistedProjectSessions {
  version: 4
  project_id: string
  sessions: PersistedSession[]
}
```

In `src/core/state-store.ts`, add a backup helper plus versioned defaults:

```ts
const DEFAULT_PROJECT_SESSIONS: PersistedProjectSessions = {
  version: 4,
  project_id: '',
  sessions: []
}

async function backupFile(filePath: string, reason: 'corrupt' | 'unsupported'): Promise<void> {
  const backupDir = join(dirname(filePath), 'backups')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = filePath.endsWith('global.json') ? 'global' : 'sessions'
  const target = join(backupDir, `${base}.${reason}.${stamp}.json`)
  await mkdir(backupDir, { recursive: true })
  await rename(filePath, target)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readProjectSessions(projectPath: string): Promise<PersistedProjectSessions> {
  const filePath = getProjectSessionsFilePath(projectPath)
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersistedProjectSessions>
    if (parsed.version !== 4 || !Array.isArray(parsed.sessions)) {
      await backupFile(filePath, 'unsupported')
      return structuredClone(DEFAULT_PROJECT_SESSIONS)
    }
    return parsed as PersistedProjectSessions
  } catch (error) {
    if (await fileExists(filePath)) {
      await backupFile(filePath, 'corrupt')
    }
    return structuredClone(DEFAULT_PROJECT_SESSIONS)
  }
}
```

Also convert global-state invalid/unsupported reads to the same backup-first pattern.

- [ ] **Step 4: Replace direct overwrite writes with atomic replace**

In `src/core/state-store.ts`, change global/project writes to use same-directory temp files:

```ts
async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8')
  await rename(tempPath, filePath)
}

export async function writeGlobalState(
  state: PersistedGlobalStateV3,
  filePath = getGlobalStateFilePath()
): Promise<void> {
  await writeJsonAtomically(filePath, state)
}

export async function writeProjectSessions(projectPath: string, data: PersistedProjectSessions): Promise<void> {
  await writeJsonAtomically(getProjectSessionsFilePath(projectPath), data)
}
```

- [ ] **Step 5: Re-run the targeted tests and commit**

Run: `pnpm vitest run src/core/state-store.test.ts`

Expected: PASS

```bash
git add src/shared/project-session.ts src/core/state-store.ts src/core/state-store.test.ts
git commit -m "feat: harden persisted state boundaries"
```

---

### Task 2: Enforce Multi-File Consistency In Project Session Persistence

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `tests/e2e/error-edge-cases.test.ts`

- [ ] **Step 1: Write failing tests for commit ordering and dangling active-session salvage**

Add a unit test in `src/core/project-session-manager.test.ts`:

```ts
test('persists project sessions before writing global commit marker', async () => {
  const calls: string[] = []
  vi.spyOn(stateStore, 'writeProjectSessions').mockImplementation(async () => {
    calls.push('project')
  })
  vi.spyOn(stateStore, 'writeGlobalState').mockImplementation(async () => {
    calls.push('global')
  })

  const manager = ProjectSessionManager.createForTest()
  await manager.createProject({ name: 'Alpha', path: 'D:/alpha', defaultSessionType: 'shell' })

  expect(calls[calls.length - 1]).toBe('global')
  expect(calls).toContain('project')
})
```

Add an E2E case in `tests/e2e/error-edge-cases.test.ts`:

```ts
test('clears dangling active session references on bootstrap', async () => {
  await writeGlobalState({
    version: 3,
    active_project_id: 'project_alpha',
    active_session_id: 'missing_session',
    projects: [{
      project_id: 'project_alpha',
      name: 'alpha',
      path: projectDir,
      created_at: now,
      updated_at: now
    }]
  }, globalStatePath)

  await writeProjectSessions(projectDir, {
    version: 4,
    project_id: 'project_alpha',
    sessions: []
  })

  const manager = await ProjectSessionManager.create({ webhookPort: null, globalStatePath })
  expect(manager.snapshot().activeSessionId).toBeNull()
})
```

- [ ] **Step 2: Run the affected tests to verify they fail**

Run: `pnpm vitest run src/core/project-session-manager.test.ts tests/e2e/error-edge-cases.test.ts`

Expected: FAIL because `persist()` writes global state first and bootstrap does not clear dangling references.

- [ ] **Step 3: Reorder persistence so `global.json` becomes the final commit marker**

In `src/core/project-session-manager.ts`, move `writeGlobalState()` after the per-project loop:

```ts
  private async persist(): Promise<void> {
    const persistedProjects = this.state.projects.map(toPersistedProject)
    const persistedSessions = this.state.sessions.map(toPersistedSession)
    const byProject = new Map<string, PersistedSession[]>()

    for (const session of persistedSessions) {
      const list = byProject.get(session.project_id) ?? []
      list.push(session)
      byProject.set(session.project_id, list)
    }

    for (const project of persistedProjects) {
      await writeProjectSessions(project.path, {
        version: 4,
        project_id: project.project_id,
        sessions: byProject.get(project.project_id) ?? []
      })
    }

    await writeGlobalState(globalState, this.globalStatePath)
  }
```

- [ ] **Step 4: Add bootstrap salvage for missing active references**

In `ProjectSessionManager.create()`, normalize the restored active IDs:

```ts
    const activeProjectExists = projects.some((project) => project.id === persistedGlobal.active_project_id)
    const activeSessionExists = sessions.some((session) => session.id === persistedGlobal.active_session_id)

    const initialState: BootstrapState = {
      activeProjectId: activeProjectExists ? persistedGlobal.active_project_id : null,
      activeSessionId: activeSessionExists ? persistedGlobal.active_session_id : null,
      terminalWebhookPort: options.webhookPort,
      projects,
      sessions
    }
```

- [ ] **Step 5: Re-run the tests and commit**

Run: `pnpm vitest run src/core/project-session-manager.test.ts tests/e2e/error-edge-cases.test.ts`

Expected: PASS

```bash
git add src/core/project-session-manager.ts src/core/project-session-manager.test.ts tests/e2e/error-edge-cases.test.ts
git commit -m "feat: enforce multi-file state consistency"
```

---

### Task 3: Add Shared Update Contracts And Preload Bridge

**Files:**
- Create: `src/shared/update-state.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Write failing guard tests for update IPC exposure**

Add these assertions to `tests/e2e/main-config-guard.test.ts`:

```ts
it('preload exposes update invoke methods', () => {
  expect(preloadSource).toMatch(/async\s+getUpdateState\s*\(/)
  expect(preloadSource).toMatch(/async\s+checkForUpdates\s*\(/)
  expect(preloadSource).toMatch(/async\s+downloadUpdate\s*\(/)
  expect(preloadSource).toMatch(/async\s+quitAndInstallUpdate\s*\(/)
  expect(preloadSource).toMatch(/async\s+dismissUpdate\s*\(/)
})

it('preload listens for update:state channel', () => {
  expect(preloadSource).toMatch(/ipcRenderer\.on\(\s*['"]update:state['"]/)
})
```

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `pnpm vitest run tests/e2e/main-config-guard.test.ts`

Expected: FAIL because there are no update channels or preload methods yet.

- [ ] **Step 3: Create shared update types and extend `RendererApi`**

Create `src/shared/update-state.ts`:

```ts
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'disabled'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  downloadProgressPercent: number | null
  lastCheckedAt: string | null
  message: string | null
  requiresSessionWarning: boolean
}
```

Modify `src/shared/project-session.ts`:

```ts
import type { UpdateState } from './update-state'

export interface RendererApi {
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateState>
  quitAndInstallUpdate: () => Promise<void>
  dismissUpdate: () => Promise<void>
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
  // existing members...
}
```

- [ ] **Step 4: Add IPC constants and preload bridge methods**

Modify `src/core/ipc-channels.ts`:

```ts
  updateGetState: 'update:get-state',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateQuitAndInstall: 'update:quit-and-install',
  updateDismiss: 'update:dismiss',
  updateState: 'update:state',
```

Modify `src/preload/index.ts`:

```ts
  async getUpdateState() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateGetState) as Promise<UpdateState>
  },
  async checkForUpdates() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateCheck) as Promise<UpdateState>
  },
  async downloadUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDownload) as Promise<UpdateState>
  },
  async quitAndInstallUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateQuitAndInstall)
  },
  async dismissUpdate() {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDismiss)
  },
  onUpdateState(callback) {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on(IPC_CHANNELS.updateState, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateState, handler)
  },
```

- [ ] **Step 5: Re-run the guard test and commit**

Run: `pnpm vitest run tests/e2e/main-config-guard.test.ts`

Expected: PASS

```bash
git add src/shared/update-state.ts src/shared/project-session.ts src/core/ipc-channels.ts src/preload/index.ts tests/e2e/main-config-guard.test.ts
git commit -m "feat: add typed update preload bridge"
```

---

### Task 4: Implement Main-Process Update Service And Session-Aware Install Guards

**Files:**
- Modify: `package.json`
- Create: `src/main/update-service.ts`
- Create: `src/main/update-service.test.ts`
- Modify: `src/main/index.ts`
- Create: `tests/e2e/update-bridge.test.ts`

- [ ] **Step 1: Install `electron-updater` and write failing main-process tests**

Run:

```bash
cd D:/Data/DEV/ultra_simple_panel
pnpm add electron-updater
```

Create `src/main/update-service.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { UpdateService } from './update-service'

test('disables update checks in unpackaged mode', async () => {
  const updater = { autoDownload: true, checkForUpdates: vi.fn() }
  const service = new UpdateService({
    appVersion: '0.1.0',
    isPackaged: false,
    updater: updater as any,
    hasBlockingSessions: () => false,
    onStateChange: () => {}
  })

  await service.checkForUpdates()

  expect(updater.checkForUpdates).not.toHaveBeenCalled()
  expect(service.getState().phase).toBe('disabled')
})

test('does not auto-download when update is discovered', async () => {
  const updater = { autoDownload: true, checkForUpdates: vi.fn(), downloadUpdate: vi.fn() }
  const service = new UpdateService({
    appVersion: '0.1.0',
    isPackaged: true,
    updater: updater as any,
    hasBlockingSessions: () => false,
    onStateChange: () => {}
  })

  service.markUpdateAvailable('0.2.0')
  expect(updater.autoDownload).toBe(false)
  expect(updater.downloadUpdate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pnpm vitest run src/main/update-service.test.ts`

Expected: FAIL because `electron-updater` is not installed and `UpdateService` does not exist.

- [ ] **Step 3: Implement a minimal `UpdateService` with explicit `autoDownload = false`**

Create `src/main/update-service.ts`:

```ts
import type { AppUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/update-state'

export class UpdateService {
  private state: UpdateState

  constructor(private readonly deps: {
    appVersion: string
    isPackaged: boolean
    updater: Pick<AppUpdater, 'autoDownload' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'>
    hasBlockingSessions: () => boolean
    onStateChange: (state: UpdateState) => void
  }) {
    this.deps.updater.autoDownload = false
    this.state = {
      phase: deps.isPackaged ? 'idle' : 'disabled',
      currentVersion: deps.appVersion,
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: deps.isPackaged ? null : 'Updates disabled in unpackaged mode',
      requiresSessionWarning: false
    }
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (!this.deps.isPackaged) return this.getState()
    this.setState({ phase: 'checking', lastCheckedAt: new Date().toISOString() })
    await this.deps.updater.checkForUpdates()
    return this.getState()
  }

  markUpdateAvailable(version: string): void {
    this.setState({ phase: 'available', availableVersion: version })
  }

  async downloadUpdate(): Promise<UpdateState> {
    await this.deps.updater.downloadUpdate()
    return this.getState()
  }

  async quitAndInstall(): Promise<void> {
    this.setState({ requiresSessionWarning: this.deps.hasBlockingSessions() })
    this.deps.updater.quitAndInstall()
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onStateChange(this.getState())
  }
}
```

- [ ] **Step 4: Wire the service into `src/main/index.ts` and add session-aware handlers**

In `src/main/index.ts`, create and publish the service:

```ts
import { autoUpdater } from 'electron-updater'
import { UpdateService } from './update-service'

let updateService: UpdateService | null = null

function hasBlockingSessions(): boolean {
  return projectSessionManager?.snapshot().sessions.some((session) => !session.archived && session.status !== 'exited') ?? false
}

updateService = new UpdateService({
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  updater: autoUpdater,
  hasBlockingSessions,
  onStateChange: (state) => mainWindow?.webContents.send(IPC_CHANNELS.updateState, state)
})

ipcMain.handle(IPC_CHANNELS.updateGetState, async () => updateService?.getState() ?? null)
ipcMain.handle(IPC_CHANNELS.updateCheck, async () => await updateService?.checkForUpdates() ?? null)
ipcMain.handle(IPC_CHANNELS.updateDownload, async () => await updateService?.downloadUpdate() ?? null)
ipcMain.handle(IPC_CHANNELS.updateDismiss, async () => {})
ipcMain.handle(IPC_CHANNELS.updateQuitAndInstall, async () => {
  if (hasBlockingSessions()) {
    await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Restart and install'],
      defaultId: 0,
      message: 'Installing this update will terminate active sessions.'
    })
  }
  await updateService?.quitAndInstall()
})
```

- [ ] **Step 5: Add a fake-updater integration test and commit**

Create `tests/e2e/update-bridge.test.ts`:

```ts
test('update bridge returns disabled state in unpackaged test mode', async () => {
  const app = await launchElectronApp()
  const state = await app.page.evaluate(() => window.stoa.getUpdateState())
  expect(state.phase).toBe('disabled')
  await app.close()
})
```

Run: `pnpm vitest run src/main/update-service.test.ts tests/e2e/update-bridge.test.ts`

Expected: PASS

```bash
git add package.json pnpm-lock.yaml src/main/update-service.ts src/main/update-service.test.ts src/main/index.ts tests/e2e/update-bridge.test.ts
git commit -m "feat: add main-process update service"
```

---

### Task 5: Add Renderer Update Store, About Panel Status, And Prompt UX

**Files:**
- Create: `src/renderer/stores/update.ts`
- Create: `src/renderer/stores/update.test.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/app/App.test.ts`
- Modify: `src/renderer/components/settings/AboutSettings.vue`
- Modify: `src/renderer/components/settings/AboutSettings.test.ts`
- Create: `src/renderer/components/update/UpdatePrompt.vue`
- Create: `src/renderer/components/update/UpdatePrompt.test.ts`

- [ ] **Step 1: Write failing component/store tests for update status rendering and prompt actions**

Create `src/renderer/stores/update.test.ts`:

```ts
import { setActivePinia, createPinia } from 'pinia'
import { describe, expect, test } from 'vitest'
import { useUpdateStore } from './update'

test('hydrates and applies pushed update state', () => {
  setActivePinia(createPinia())
  const store = useUpdateStore()
  store.applyState({
    phase: 'available',
    currentVersion: '0.1.0',
    availableVersion: '0.2.0',
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: '2026-04-24T00:00:00.000Z',
    message: null,
    requiresSessionWarning: false
  })

  expect(store.phase).toBe('available')
  expect(store.availableVersion).toBe('0.2.0')
})
```

Extend `src/renderer/components/settings/AboutSettings.test.ts`:

```ts
it('renders check-for-updates action and status text', () => {
  const wrapper = mount(AboutSettings, {
    global: {
      stubs: { UpdatePrompt: true }
    }
  })

  expect(wrapper.text()).toContain('Check for updates')
  expect(wrapper.text()).toContain('Current version')
})
```

Create `src/renderer/components/update/UpdatePrompt.test.ts`:

```ts
it('renders download action for available update', () => {
  const wrapper = mount(UpdatePrompt, {
    props: {
      state: {
        phase: 'available',
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
        downloadedVersion: null,
        downloadProgressPercent: null,
        lastCheckedAt: null,
        message: null,
        requiresSessionWarning: false
      }
    }
  })

  expect(wrapper.text()).toContain('Download and update')
})
```

- [ ] **Step 2: Run the targeted renderer tests to verify they fail**

Run: `pnpm vitest run src/renderer/stores/update.test.ts src/renderer/components/settings/AboutSettings.test.ts src/renderer/components/update/UpdatePrompt.test.ts src/renderer/app/App.test.ts`

Expected: FAIL because the update store/component/prompt do not exist and About/App do not render update UI.

- [ ] **Step 3: Add a renderer update store**

Create `src/renderer/stores/update.ts`:

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UpdateState } from '@shared/update-state'

const DEFAULT_STATE: UpdateState = {
  phase: 'idle',
  currentVersion: '0.0.0',
  availableVersion: null,
  downloadedVersion: null,
  downloadProgressPercent: null,
  lastCheckedAt: null,
  message: null,
  requiresSessionWarning: false
}

export const useUpdateStore = defineStore('update', () => {
  const state = ref<UpdateState>({ ...DEFAULT_STATE })
  const shouldShowPrompt = computed(() => state.value.phase === 'available' || state.value.phase === 'downloaded')

  function applyState(next: UpdateState): void {
    state.value = { ...next }
  }

  return {
    state,
    phase: computed(() => state.value.phase),
    availableVersion: computed(() => state.value.availableVersion),
    shouldShowPrompt,
    applyState
  }
})
```

- [ ] **Step 4: Wire `App.vue`, create `UpdatePrompt.vue`, and upgrade `AboutSettings.vue`**

In `src/renderer/app/App.vue`:

```vue
<script setup lang="ts">
import UpdatePrompt from '@renderer/components/update/UpdatePrompt.vue'
import { useUpdateStore } from '@renderer/stores/update'

const updateStore = useUpdateStore()
let unsubscribeUpdateState: (() => void) | null = null

onMounted(async () => {
  updateStore.applyState(await window.stoa.getUpdateState())
  unsubscribeUpdateState = window.stoa.onUpdateState((state) => updateStore.applyState(state))
})

onBeforeUnmount(() => {
  unsubscribeUpdateState?.()
})
</script>

<template>
  <AppShell ... />
  <UpdatePrompt
    v-if="updateStore.shouldShowPrompt"
    :state="updateStore.state"
    @download="window.stoa.downloadUpdate()"
    @install="window.stoa.quitAndInstallUpdate()"
    @dismiss="window.stoa.dismissUpdate()"
  />
</template>
```

In `src/renderer/components/settings/AboutSettings.vue`, replace the hardcoded version and add update actions:

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUpdateStore } from '@renderer/stores/update'

const updateStore = useUpdateStore()
const { state } = storeToRefs(updateStore)
</script>

<template>
  <span class="settings-about__version">v{{ state.currentVersion }}</span>
  <div class="settings-about__update-card">
    <span class="settings-about__update-label">Current version</span>
    <strong class="settings-about__update-value">v{{ state.currentVersion }}</strong>
    <span class="settings-about__update-status">{{ state.phase }}</span>
    <button class="settings-about__update-action" @click="window.stoa.checkForUpdates()">
      Check for updates
    </button>
  </div>
</template>
```

- [ ] **Step 5: Re-run the renderer tests and commit**

Run: `pnpm vitest run src/renderer/stores/update.test.ts src/renderer/components/settings/AboutSettings.test.ts src/renderer/components/update/UpdatePrompt.test.ts src/renderer/app/App.test.ts`

Expected: PASS

```bash
git add src/renderer/stores/update.ts src/renderer/stores/update.test.ts src/renderer/app/App.vue src/renderer/app/App.test.ts src/renderer/components/settings/AboutSettings.vue src/renderer/components/settings/AboutSettings.test.ts src/renderer/components/update/UpdatePrompt.vue src/renderer/components/update/UpdatePrompt.test.ts
git commit -m "feat: add renderer update surfaces"
```

---

### Task 6: Switch Packaging To NSIS, Verify Release Artifacts, And Add Packaged Smoke Coverage

**Files:**
- Modify: `electron-builder.yml`
- Modify: `scripts/verify-packaging-baseline.mjs`
- Create: `scripts/smoke-packaged-release.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write a failing packaging verification test script contract**

Replace the verifier expectations in `scripts/verify-packaging-baseline.mjs` with:

```js
const requiredReleaseFiles = [
  join(root, 'release', 'latest.yml')
]

const releaseDir = join(root, 'release')
const releaseEntries = await readdir(releaseDir)
if (!releaseEntries.some((entry) => entry.endsWith('.exe'))) {
  throw new Error('Expected NSIS installer .exe in release/')
}
```

Also add a smoke script shell in `package.json`:

```json
{
  "scripts": {
    "package:release": "electron-builder --config electron-builder.yml --publish always",
    "verify:release-smoke": "node scripts/smoke-packaged-release.mjs"
  }
}
```

- [ ] **Step 2: Run the packaging verifier to confirm it fails with the current `portable` config**

Run:

```bash
pnpm run build
pnpm run package
pnpm run verify:packaging
```

Expected: FAIL because the current release output does not contain `latest.yml` or an NSIS installer.

- [ ] **Step 3: Switch `electron-builder.yml` to NSIS + GitHub publishing**

Update `electron-builder.yml`:

```yml
appId: dev.stoa.app
productName: Stoa
directories:
  output: release
files:
  - out/**
  - package.json
asarUnpack:
  - node_modules/node-pty/**
publish:
  provider: github
  owner: "${env.GH_OWNER}"
  repo: "${env.GH_REPO}"
  releaseType: release
win:
  target:
    - nsis
npmRebuild: false
electronVersion: 37.4.0
```

- [ ] **Step 4: Add a packaged smoke script that launches the built app**

Create `scripts/smoke-packaged-release.mjs`:

```js
import { mkdtemp, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright'

const releaseDir = join(process.cwd(), 'release', 'win-unpacked')
const entries = await readdir(releaseDir)
const exe = entries.find((entry) => entry.endsWith('.exe'))
if (!exe) throw new Error('No packaged executable found in release/win-unpacked')

const stateDir = await mkdtemp(join(tmpdir(), 'stoa-packaged-state-'))
const projectDir = join(stateDir, 'project')
await mkdir(projectDir, { recursive: true })

const electronApp = await electron.launch({
  executablePath: join(releaseDir, exe),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    VIBECODING_E2E: '1',
    VIBECODING_STATE_DIR: stateDir
  }
})

const page = await electronApp.firstWindow()
await page.getByRole('button', { name: /new project/i }).click()
await electronApp.evaluate(async (_electron, targetPath) => {
  const api = globalThis.__VIBECODING_MAIN_E2E__
  api?.queueDialogPickFolder(targetPath)
}, projectDir)
await page.getByLabel(/project name/i).fill('Packaged Smoke')
await page.getByRole('button', { name: /create project/i }).click()
await page.getByRole('button', { name: /new session/i }).click()
await page.getByRole('button', { name: /create session/i }).click()
await page.getByText(/会话运行中|running|awaiting_input/i).waitFor({ timeout: 15000 })
await electronApp.close()
```

Then add package scripts:

```json
{
  "scripts": {
    "package:release": "electron-builder --config electron-builder.yml --publish always",
    "verify:packaging": "node scripts/verify-packaging-baseline.mjs",
    "verify:release-smoke": "node scripts/smoke-packaged-release.mjs"
  }
}
```

- [ ] **Step 5: Re-run package verification and commit**

Run:

```bash
pnpm run build
pnpm run package
pnpm run verify:packaging
pnpm run verify:release-smoke
```

Expected: PASS

```bash
git add electron-builder.yml scripts/verify-packaging-baseline.mjs scripts/smoke-packaged-release.mjs package.json
git commit -m "feat: switch Windows release channel to nsis"
```

---

### Task 7: Add GitHub Actions Workflows, Release Runbook, And Full Quality Gate

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `docs/operations/release-and-update-runbook.md`

- [ ] **Step 1: Write the CI and release workflows**

Create `.github/workflows/ci.yml`:

```yml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test:generate
      - run: pnpm run typecheck
      - run: pnpm vitest run
      - run: pnpm run test:e2e
      - run: pnpm run test:behavior-coverage
      - run: pnpm run build
      - run: pnpm run package
      - run: pnpm run verify:packaging
```

Create `.github/workflows/release.yml`:

```yml
name: release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  publish:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: echo "GH_OWNER=${{ github.repository_owner }}" >> $env:GITHUB_ENV
      - run: echo "GH_REPO=${{ github.event.repository.name }}" >> $env:GITHUB_ENV
      - run: node -e "const v=require('./package.json').version; const t=process.env.GITHUB_REF_NAME; if (`v${v}`!==t) process.exit(1)"
      - run: pnpm run test:generate
      - run: pnpm run typecheck
      - run: pnpm vitest run
      - run: pnpm run test:e2e
      - run: pnpm run test:behavior-coverage
      - run: pnpm run build
      - run: pnpm run package:release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Write the operator runbook**

Create `docs/operations/release-and-update-runbook.md`:

```md
# Release And Update Runbook

## Cut A Release

1. Bump `package.json.version`.
2. Run `pnpm run test:all`.
3. Commit the version bump.
4. Create tag `vX.Y.Z`.
5. Push commit and tag.

## Verify Assets

- Check GitHub Release is published, not draft.
- Check release contains `latest.yml`, installer `.exe`, and updater metadata.
- Install the app and verify About shows the release version.

## Update Diagnostics

- Update log path: `~/.stoa/logs/update.log`
- Global state path: `~/.stoa/global.json`
- Project state path: `<project>/.stoa/sessions.json`

## Recovery

- If state is corrupt or unsupported, inspect `.stoa/backups/`.
- Do not attempt schema migration during prototype stage.
```

- [ ] **Step 3: Run the full repository quality gate locally**

Run:

```bash
pnpm run test:generate
pnpm run typecheck
pnpm vitest run
pnpm run test:e2e
pnpm run test:behavior-coverage
pnpm run build
pnpm run package
pnpm run verify:packaging
pnpm run verify:release-smoke
```

Expected: PASS

- [ ] **Step 4: Commit the workflow and runbook changes**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml docs/operations/release-and-update-runbook.md package.json
git commit -m "ci: automate Windows releases and update verification"
```

---

## Spec Coverage Check

- Windows-only NSIS release path: Task 6
- GitHub tag-driven formal release flow: Task 7
- User-confirmed download/install with `autoDownload = false`: Task 4 and Task 5
- Dev/E2E updater disable path: Task 4
- Session interruption warning before install: Task 4 and Task 5
- `sessions.json` schema versioning and unsupported backup behavior: Task 1
- Multi-file consistency and bootstrap salvage: Task 2
- Artifact verification plus packaged PTY smoke: Task 6
- Release runbook and cloud verification: Task 7

## Type Consistency Check

- Per-project session persistence is version `4` throughout this plan.
- Renderer update surface uses `UpdateState`, `getUpdateState`, `checkForUpdates`, `downloadUpdate`, `quitAndInstallUpdate`, `dismissUpdate`, and `onUpdateState` consistently across shared types, preload, main, store, and UI.
- Release workflows consistently use Corepack + `pnpm install --frozen-lockfile`.
