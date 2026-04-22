# Settings Surface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the settings placeholder in AppShell with a full settings surface including General, Providers, and About tabs, plus native folder/file pickers.

**Architecture:** New Pinia settings store ↔ new IPC channels ↔ main process persistence in state.json. Settings UI uses horizontal tab navigation inside the existing glass viewport. Auto-detection for shell and provider binaries runs on main process.

**Tech Stack:** Vue 3 Composition API, Pinia, Electron IPC, Electron `dialog.showOpenDialog`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `src/core/settings-detector.ts` | Shell and provider binary auto-detection |
| `src/core/settings-detector.test.ts` | Unit tests for detector |
| `src/renderer/stores/settings.ts` | Pinia store for settings state |
| `src/renderer/stores/settings.test.ts` | Unit tests for settings store |
| `src/renderer/components/settings/SettingsSurface.vue` | Root settings container with tab switching |
| `src/renderer/components/settings/SettingsTabBar.vue` | Horizontal tab bar component |
| `src/renderer/components/settings/GeneralSettings.vue` | Shell path + font size form |
| `src/renderer/components/settings/ProvidersSettings.vue` | Provider binary path list |
| `src/renderer/components/settings/AboutSettings.vue` | Version + tech stack + links |
| `src/renderer/components/settings/SettingsSurface.test.ts` | Component test for settings surface |

### Modified Files

| File | Change |
|---|---|
| `src/core/ipc-channels.ts` | Add 6 new channels |
| `src/shared/project-session.ts` | Add `AppSettings` type, extend `RendererApi` |
| `src/shared/index.d.ts` | Update `Window.stoa` type |
| `src/core/state-store.ts` | Add `settings` to `DEFAULT_STATE` |
| `src/core/project-session-manager.ts` | Add `getSettings()` / `setSetting()` methods |
| `src/preload/index.ts` | Expose 6 new API methods |
| `src/main/index.ts` | Register 6 new IPC handlers |
| `src/renderer/components/AppShell.vue` | Replace placeholder with `SettingsSurface` |
| `src/renderer/app/App.vue` | Load settings on mount |
| `src/renderer/styles.css` | Add settings CSS classes |
| `src/renderer/components/command/NewProjectModal.vue` | Replace path input with Browse button |
| `tests/e2e/main-config-guard.test.ts` | Add new channel registration guards |
| `tests/e2e/ipc-bridge.test.ts` | Add new IPC round-trip tests |

---

### Task 1: Define AppSettings Type and Extend Shared Interfaces

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/ipc-channels.ts`

- [ ] **Step 1: Add AppSettings type to shared types**

In `src/shared/project-session.ts`, add after the `ProviderCommand` interface (after line 145):

```typescript
export interface AppSettings {
  shellPath: string
  terminalFontSize: number
  providers: Record<string, string>
}

export const DEFAULT_SETTINGS: AppSettings = {
  shellPath: '',
  terminalFontSize: 14,
  providers: {}
}
```

Then extend the `RendererApi` interface (line 99) to add the 6 new methods:

```typescript
export interface RendererApi {
  // ... existing methods (lines 100-108 unchanged) ...
  getSettings: () => Promise<AppSettings>
  setSetting: (key: string, value: unknown) => Promise<void>
  pickFolder: (options?: { title?: string }) => Promise<string | null>
  pickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
  detectShell: () => Promise<string | null>
  detectProvider: (providerId: string) => Promise<string | null>
}
```

- [ ] **Step 2: Add new IPC channel constants**

In `src/core/ipc-channels.ts`, add after the `terminalData` entry:

```typescript
export const IPC_CHANNELS = {
  projectBootstrap: 'project:bootstrap',
  projectCreate: 'project:create',
  projectSetActive: 'project:set-active',
  sessionCreate: 'session:create',
  sessionSetActive: 'session:set-active',
  sessionInput: 'session:input',
  sessionResize: 'session:resize',
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

- [ ] **Step 3: Run type check**

Run: `npx vue-tsc --noEmit`
Expected: No type errors on modified files

---

### Task 2: Create Settings Auto-Detection Module

**Files:**
- Create: `src/core/settings-detector.ts`
- Create: `src/core/settings-detector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/settings-detector.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectShell, detectProvider } from './settings-detector'

vi.mock('node:fs/promises', () => ({
  access: vi.fn()
}))

import { access } from 'node:fs/promises'

describe('detectShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SHELL
    delete process.env.COMSPEC
  })

  it('returns SHELL env on unix when file exists', async () => {
    process.platform = 'darwin'
    process.env.SHELL = '/bin/zsh'
    vi.mocked(access).mockResolvedValueOnce(undefined)
    const result = await detectShell()
    expect(result).toBe('/bin/zsh')
  })

  it('returns fallback /bin/bash on unix when SHELL not set', async () => {
    process.platform = 'darwin'
    vi.mocked(access).mockResolvedValueOnce(undefined)
    const result = await detectShell()
    expect(result).toBe('/bin/bash')
  })

  it('returns COMSPEC on windows when file exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.COMSPEC = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    vi.mocked(access).mockResolvedValueOnce(undefined)
    const result = await detectShell()
    expect(result).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('returns null when no shell found', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    vi.mocked(access).mockRejectedValue(new Error('not found'))
    const result = await detectShell()
    expect(result).toBeNull()
  })
})

describe('detectProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when provider not found', async () => {
    vi.mocked(access).mockRejectedValue(new Error('not found'))
    const result = await detectProvider('opencode')
    expect(result).toBeNull()
  })

  it('detects opencode in common path', async () => {
    vi.mocked(access).mockResolvedValueOnce(undefined)
    const result = await detectProvider('opencode')
    // Should return a non-null path
    expect(result).not.toBeNull()
    expect(typeof result).toBe('string')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/settings-detector.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement the detector**

Create `src/core/settings-detector.ts`:

```typescript
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

const COMMON_BIN_PATHS_UNIX = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
]

const COMMON_BIN_PATHS_WIN = [
  process.env.LOCALAPPDATA ?? '',
  process.env.PROGRAMFILES ?? '',
  process.env['PROGRAMFILES(X86)'] ?? '',
].filter(Boolean)

export async function detectShell(): Promise<string | null> {
  if (process.platform === 'win32') {
    const comspec = process.env.COMSPEC
    if (comspec) {
      try {
        await access(comspec, constants.X_OK)
        return comspec
      } catch { /* fall through */ }
    }
    // Fallback to powershell
    const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    try {
      await access(psPath, constants.X_OK)
      return psPath
    } catch { /* fall through */ }
    return null
  }

  // Unix
  const envShell = process.env.SHELL
  if (envShell) {
    try {
      await access(envShell, constants.X_OK)
      return envShell
    } catch { /* fall through */ }
  }

  const fallbacks = ['/bin/bash', '/bin/zsh', '/bin/sh']
  for (const candidate of fallbacks) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch { /* continue */ }
  }

  return null
}

export async function detectProvider(providerId: string): Promise<string | null> {
  const binaryName = process.platform === 'win32'
    ? `${providerId}.cmd`
    : providerId

  // Try common install paths
  const searchPaths = process.platform === 'win32' ? COMMON_BIN_PATHS_WIN : COMMON_BIN_PATHS_UNIX

  for (const dir of searchPaths) {
    const candidate = resolve(dir, binaryName)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch { /* continue */ }
  }

  // Try PATH lookup via which/where
  const { execFile } = await import('node:child_process')
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(cmd, [providerId], (err, stdout) => {
      if (err) {
        resolve(null)
        return
      }
      const firstLine = stdout.trim().split('\n')[0]?.trim()
      resolve(firstLine || null)
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/settings-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/settings-detector.ts src/core/settings-detector.test.ts src/shared/project-session.ts src/core/ipc-channels.ts
git commit -m "feat: add settings types, IPC channels, and auto-detection module"
```

---

### Task 3: Add Settings to Persistence Layer

**Files:**
- Modify: `src/core/state-store.ts`
- Modify: `src/core/project-session-manager.ts`

- [ ] **Step 1: Write failing test for settings persistence**

In `src/core/project-session-manager.test.ts` (existing), add a new test block:

Note: This file already exists. Append the following describe block:

```typescript
describe('settings', () => {
  it('returns default settings when none persisted', async () => {
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      stateFilePath: testStatePath
    })
    const settings = manager.getSettings()
    expect(settings.shellPath).toBe('')
    expect(settings.terminalFontSize).toBe(14)
    expect(settings.providers).toEqual({})
  })

  it('persists a single setting update', async () => {
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      stateFilePath: testStatePath
    })
    await manager.setSetting('shellPath', '/bin/fish')
    const settings = manager.getSettings()
    expect(settings.shellPath).toBe('/bin/fish')

    // Verify persistence across instances
    const manager2 = await ProjectSessionManager.create({
      webhookPort: null,
      stateFilePath: testStatePath
    })
    expect(manager2.getSettings().shellPath).toBe('/bin/fish')
  })

  it('persists provider settings', async () => {
    const manager = await ProjectSessionManager.create({
      webhookPort: null,
      stateFilePath: testStatePath
    })
    await manager.setSetting('providers', { opencode: '/usr/local/bin/opencode' })
    expect(manager.getSettings().providers.opencode).toBe('/usr/local/bin/opencode')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/project-session-manager.test.ts`
Expected: FAIL — `getSettings` is not a function

- [ ] **Step 3: Extend state-store DEFAULT_STATE**

In `src/core/state-store.ts`, add `settings` to `DEFAULT_STATE`:

```typescript
import type { PersistedAppStateV2, AppSettings } from '@shared/project-session'

export const DEFAULT_SETTINGS: AppSettings = {
  shellPath: '',
  terminalFontSize: 14,
  providers: {}
}

export const DEFAULT_STATE: PersistedAppStateV2 = {
  version: 2,
  active_project_id: null,
  active_session_id: null,
  projects: [],
  sessions: [],
  settings: DEFAULT_SETTINGS
}
```

Also update `PersistedAppStateV2` in `src/shared/project-session.ts` to add:

```typescript
export interface PersistedAppStateV2 {
  version: 2
  active_project_id: string | null
  active_session_id: string | null
  projects: PersistedProject[]
  sessions: PersistedSession[]
  settings?: AppSettings
}
```

Note: `settings` is optional for backward compatibility with existing state files.

- [ ] **Step 4: Add getSettings/setSetting to ProjectSessionManager**

In `src/core/project-session-manager.ts`, add after the `setActiveSession` method:

```typescript
import { DEFAULT_SETTINGS } from '@core/state-store'
import type { AppSettings } from '@shared/project-session'

// ... inside the class:

private settings: AppSettings

// In constructor, initialize settings:
private constructor(initialState: BootstrapState, stateFilePath?: string, persistedSettings?: AppSettings) {
  this.state = structuredCloneState(initialState)
  this.stateFilePath = stateFilePath
  this.settings = persistedSettings ?? { ...DEFAULT_SETTINGS }
}

// Update static create:
static async create(options: ProjectSessionManagerOptions): Promise<ProjectSessionManager> {
  const persisted = await readPersistedState(options.stateFilePath)
  const initialState = toBootstrapState(persisted, options.webhookPort)
  const manager = new ProjectSessionManager(
    initialState,
    options.stateFilePath,
    persisted.settings ?? { ...DEFAULT_SETTINGS }
  )
  await manager.persist()
  return manager
}

getSettings(): AppSettings {
  return { ...this.settings }
}

async setSetting(key: string, value: unknown): Promise<void> {
  if (key === 'shellPath' && typeof value === 'string') {
    this.settings.shellPath = value
  } else if (key === 'terminalFontSize' && typeof value === 'number') {
    this.settings.terminalFontSize = Math.max(12, Math.min(24, value))
  } else if (key === 'providers' && typeof value === 'object' && value !== null) {
    this.settings.providers = value as Record<string, string>
  }
  await this.persist()
}
```

Update `persist()` to include settings:

```typescript
private async persist(): Promise<void> {
  const nextState = this.state.projects.length === 0 && this.state.sessions.length === 0
    ? { ...DEFAULT_STATE, settings: this.settings }
    : { ...toPersistedState(this.state), settings: this.settings }

  await writePersistedState(nextState, this.stateFilePath)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/project-session-manager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/state-store.ts src/core/project-session-manager.ts src/shared/project-session.ts
git commit -m "feat: add settings persistence to state-store and project-session-manager"
```

---

### Task 4: Register Settings IPC Handlers and Preload API

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add IPC handlers in main process**

In `src/main/index.ts`, add imports and handlers. After the existing `sessionResize` handler (around line 183), add:

```typescript
import { dialog } from 'electron'
import { detectShell, detectProvider } from '@core/settings-detector'

// ... after existing handlers:

ipcMain.handle(IPC_CHANNELS.settingsGet, async () => {
  return projectSessionManager?.getSettings() ?? null
})

ipcMain.handle(IPC_CHANNELS.settingsSet, async (_event, key: string, value: unknown) => {
  await projectSessionManager?.setSetting(key, value)
})

ipcMain.handle(IPC_CHANNELS.dialogPickFolder, async (_event, options?: { title?: string }) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: options?.title ?? 'Select Folder'
  })
  return result.canceled ? null : result.filePaths[0] ?? null
})

ipcMain.handle(IPC_CHANNELS.dialogPickFile, async (_event, options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    title: options?.title ?? 'Select File',
    filters: options?.filters
  })
  return result.canceled ? null : result.filePaths[0] ?? null
})

ipcMain.handle(IPC_CHANNELS.settingsDetectShell, async () => {
  return detectShell()
})

ipcMain.handle(IPC_CHANNELS.settingsDetectProvider, async (_event, providerId: string) => {
  return detectProvider(providerId)
})
```

- [ ] **Step 2: Add preload API methods**

In `src/preload/index.ts`, add to the `api` object after `onSessionEvent`:

```typescript
import type {
  // ... existing imports ...
  AppSettings
} from '@shared/project-session'

const api: RendererApi = {
  // ... existing methods ...

  async getSettings() {
    return ipcRenderer.invoke('settings:get') as Promise<AppSettings>
  },
  async setSetting(key: string, value: unknown) {
    return ipcRenderer.invoke('settings:set', key, value)
  },
  async pickFolder(options?: { title?: string }) {
    return ipcRenderer.invoke('dialog:pick-folder', options) as Promise<string | null>
  },
  async pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) {
    return ipcRenderer.invoke('dialog:pick-file', options) as Promise<string | null>
  },
  async detectShell() {
    return ipcRenderer.invoke('settings:detect-shell') as Promise<string | null>
  },
  async detectProvider(providerId: string) {
    return ipcRenderer.invoke('settings:detect-provider', providerId) as Promise<string | null>
  }
}
```

- [ ] **Step 3: Run type check**

Run: `npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: register settings IPC handlers and preload API"
```

---

### Task 5: Create Settings Pinia Store

**Files:**
- Create: `src/renderer/stores/settings.ts`
- Create: `src/renderer/stores/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/stores/settings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from './settings'

vi.stubGlobal('stoa', {
  getSettings: vi.fn().mockResolvedValue({
    shellPath: '',
    terminalFontSize: 14,
    providers: {}
  }),
  setSetting: vi.fn().mockResolvedValue(undefined),
  detectShell: vi.fn().mockResolvedValue('/bin/zsh'),
  detectProvider: vi.fn().mockResolvedValue('/usr/local/bin/opencode')
})

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loads settings from backend', async () => {
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.shellPath).toBe('')
    expect(store.terminalFontSize).toBe(14)
  })

  it('updates shell path', async () => {
    const store = useSettingsStore()
    await store.loadSettings()
    await store.updateSetting('shellPath', '/bin/fish')
    expect(store.shellPath).toBe('/bin/fish')
    expect(window.stoa.setSetting).toHaveBeenCalledWith('shellPath', '/bin/fish')
  })

  it('clamps font size between 12 and 24', async () => {
    const store = useSettingsStore()
    await store.loadSettings()
    await store.updateSetting('terminalFontSize', 30)
    expect(store.terminalFontSize).toBe(24)
  })

  it('detects shell and fills empty path', async () => {
    const store = useSettingsStore()
    await store.loadSettings()
    expect(store.shellPath).toBe('')
    const detected = await store.detectAndSetShell()
    expect(detected).toBe('/bin/zsh')
    expect(store.shellPath).toBe('/bin/zsh')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/settings.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement the settings store**

Create `src/renderer/stores/settings.ts`:

```typescript
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettings } from '@shared/project-session'

export const useSettingsStore = defineStore('settings', () => {
  const shellPath = ref('')
  const terminalFontSize = ref(14)
  const providers = ref<Record<string, string>>({})
  const loaded = ref(false)

  async function loadSettings(): Promise<void> {
    const settings = await window.stoa.getSettings()
    if (settings) {
      shellPath.value = settings.shellPath
      terminalFontSize.value = settings.terminalFontSize
      providers.value = { ...settings.providers }
    }
    loaded.value = true
  }

  async function updateSetting(key: string, value: unknown): Promise<void> {
    await window.stoa.setSetting(key, value)

    if (key === 'shellPath' && typeof value === 'string') {
      shellPath.value = value
    } else if (key === 'terminalFontSize' && typeof value === 'number') {
      terminalFontSize.value = Math.max(12, Math.min(24, value))
    } else if (key === 'providers' && typeof value === 'object' && value !== null) {
      providers.value = { ...(value as Record<string, string>) }
    }
  }

  async function detectAndSetShell(): Promise<string | null> {
    const detected = await window.stoa.detectShell()
    if (detected && !shellPath.value) {
      await updateSetting('shellPath', detected)
    }
    return detected
  }

  async function detectAndSetProvider(providerId: string): Promise<string | null> {
    const detected = await window.stoa.detectProvider(providerId)
    if (detected && !providers.value[providerId]) {
      const updated = { ...providers.value, [providerId]: detected }
      await updateSetting('providers', updated)
    }
    return detected
  }

  async function pickFolder(title?: string): Promise<string | null> {
    return window.stoa.pickFolder(title ? { title } : undefined)
  }

  async function pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
    return window.stoa.pickFile(options)
  }

  return {
    shellPath,
    terminalFontSize,
    providers,
    loaded,
    loadSettings,
    updateSetting,
    detectAndSetShell,
    detectAndSetProvider,
    pickFolder,
    pickFile
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/stores/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/settings.ts src/renderer/stores/settings.test.ts
git commit -m "feat: add settings Pinia store with auto-detection and file pickers"
```

---

### Task 6: Create Settings UI Components

**Files:**
- Create: `src/renderer/components/settings/SettingsSurface.vue`
- Create: `src/renderer/components/settings/SettingsTabBar.vue`
- Create: `src/renderer/components/settings/GeneralSettings.vue`
- Create: `src/renderer/components/settings/ProvidersSettings.vue`
- Create: `src/renderer/components/settings/AboutSettings.vue`

- [ ] **Step 1: Create SettingsTabBar.vue**

Create `src/renderer/components/settings/SettingsTabBar.vue`:

```vue
<script setup lang="ts">
export type SettingsTab = 'general' | 'providers' | 'about'

defineProps<{
  activeTab: SettingsTab
}>()

const emit = defineEmits<{
  select: [tab: SettingsTab]
}>()

const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'providers', label: 'Providers', icon: '🔧' },
  { id: 'about', label: 'About', icon: 'ℹ' }
]
</script>

<template>
  <nav class="settings-tab-bar" role="tablist" aria-label="Settings navigation">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="settings-tab-bar__item"
      :class="{ 'settings-tab-bar__item--active': tab.id === activeTab }"
      :aria-selected="tab.id === activeTab"
      :aria-controls="`settings-panel-${tab.id}`"
      :data-settings-tab="tab.id"
      role="tab"
      type="button"
      @click="emit('select', tab.id)"
    >
      <span class="settings-tab-bar__icon">{{ tab.icon }}</span>
      <span class="settings-tab-bar__label">{{ tab.label }}</span>
    </button>
  </nav>
</template>
```

- [ ] **Step 2: Create GeneralSettings.vue**

Create `src/renderer/components/settings/GeneralSettings.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import GlassFormField from '../primitives/GlassFormField.vue'

const store = useSettingsStore()
const detectedShell = ref<string | null>(null)
const detecting = ref(false)

const fontSizeOptions = Array.from({ length: 13 }, (_, i) => ({
  value: String(i + 12),
  label: `${i + 12}px`
}))

onMounted(async () => {
  detecting.value = true
  detectedShell.value = await store.detectAndSetShell()
  detecting.value = false
})

async function browseShell() {
  const path = await store.pickFile({
    title: 'Select Shell Binary',
    filters: process.platform === 'win32'
      ? [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat'] }]
      : [{ name: 'All Files', extensions: ['*'] }]
  })
  if (path) {
    await store.updateSetting('shellPath', path)
    detectedShell.value = null
  }
}
</script>

<template>
  <div class="settings-section" role="tabpanel" id="settings-panel-general" aria-label="General settings">
    <div class="settings-item">
      <span class="eyebrow">Shell Path</span>
      <div class="settings-item__row">
        <input
          class="form-field__input settings-item__path-input"
          :value="store.shellPath"
          placeholder="Auto-detected"
          data-settings-field="shellPath"
          @change="store.updateSetting('shellPath', ($event.target as HTMLInputElement).value)"
        />
        <button class="button-ghost settings-item__browse" type="button" @click="browseShell">Browse</button>
      </div>
      <span v-if="detecting" class="settings-item__hint">Detecting...</span>
      <span v-else-if="detectedShell && !store.shellPath" class="settings-item__hint settings-item__hint--success">
        Auto-detected: {{ detectedShell }} ✓
      </span>
      <span v-else-if="store.shellPath && store.shellPath !== detectedShell" class="settings-item__hint">
        Custom path
      </span>
      <span v-else-if="detectedShell" class="settings-item__hint settings-item__hint--success">
        Auto-detected ✓
      </span>
    </div>

    <div class="settings-item">
      <GlassFormField
        label="Terminal Font Size"
        type="select"
        :model-value="String(store.terminalFontSize)"
        :options="fontSizeOptions"
        data-settings-field="terminalFontSize"
        @update:model-value="store.updateSetting('terminalFontSize', Number($event))"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create ProvidersSettings.vue**

Create `src/renderer/components/settings/ProvidersSettings.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'

const store = useSettingsStore()

const providerList = [
  { id: 'opencode', label: 'OpenCode' },
  { id: 'local-shell', label: 'Local Shell' }
]

const detectedPaths = reactive<Record<string, string | null>>({})
const detecting = ref(false)

onMounted(async () => {
  detecting.value = true
  for (const provider of providerList) {
    detectedPaths[provider.id] = await store.detectAndSetProvider(provider.id)
  }
  detecting.value = false
})

async function browseProvider(providerId: string) {
  const path = await store.pickFile({
    title: `Select ${providerId} Binary`,
    filters: process.platform === 'win32'
      ? [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat'] }]
      : [{ name: 'All Files', extensions: ['*'] }]
  })
  if (path) {
    const updated = { ...store.providers, [providerId]: path }
    await store.updateSetting('providers', updated)
    detectedPaths[providerId] = null
  }
}

function getStatus(providerId: string): 'detected' | 'custom' | 'missing' {
  const configured = store.providers[providerId]
  const detected = detectedPaths[providerId]
  if (configured && configured === detected) return 'detected'
  if (configured) return 'custom'
  if (detected) return 'detected'
  return 'missing'
}
</script>

<template>
  <div class="settings-section" role="tabpanel" id="settings-panel-providers" aria-label="Provider settings">
    <div
      v-for="(provider, index) in providerList"
      :key="provider.id"
      class="settings-item"
      :class="{ 'settings-item--bordered': index < providerList.length - 1 }"
    >
      <span class="eyebrow">{{ provider.label }}</span>
      <div class="settings-item__row">
        <input
          class="form-field__input settings-item__path-input"
          :value="store.providers[provider.id] ?? ''"
          :placeholder="getStatus(provider.id) === 'missing' ? 'not found' : 'Auto-detected'"
          :data-settings-field="`provider-${provider.id}`"
          @change="store.updateSetting('providers', { ...store.providers, [provider.id]: ($event.target as HTMLInputElement).value })"
        />
        <button class="button-ghost settings-item__browse" type="button" @click="browseProvider(provider.id)">Browse</button>
      </div>
      <span v-if="detecting" class="settings-item__hint">Detecting...</span>
      <span v-else-if="getStatus(provider.id) === 'detected'" class="settings-item__hint settings-item__hint--success">
        Auto-detected ✓
      </span>
      <span v-else-if="getStatus(provider.id) === 'custom'" class="settings-item__hint">
        Custom path
      </span>
      <span v-else class="settings-item__hint settings-item__hint--warning">
        Not found — click Browse to locate
      </span>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Create AboutSettings.vue**

Create `src/renderer/components/settings/AboutSettings.vue`:

```vue
<script setup lang="ts">
const appVersion = __APP_VERSION__
</script>

<template>
  <div class="settings-about" role="tabpanel" id="settings-panel-about" aria-label="About">
    <div class="settings-about__brand">
      <div class="settings-about__logo">V</div>
      <h2 class="settings-about__name">Vibecoding Panel</h2>
      <span class="settings-about__version">v{{ appVersion }}</span>
    </div>
    <div class="settings-about__divider"></div>
    <div class="settings-about__stack">
      <span class="settings-about__stack-text">Electron · Vue 3 · node-pty</span>
    </div>
    <div class="settings-about__links">
      <a class="settings-about__link" href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a class="settings-about__link" href="https://docs.example.com" target="_blank" rel="noopener noreferrer">Documentation</a>
      <a class="settings-about__link" href="https://github.com/issues" target="_blank" rel="noopener noreferrer">Report Issue</a>
    </div>
  </div>
</template>
```

Note: `__APP_VERSION__` is injected via Vite `define` config. Add to `vite.config.ts`:

```typescript
define: {
  __APP_VERSION__: JSON.stringify('0.1.0')
}
```

Or read from package.json dynamically. For the prototype, the define approach is simpler.

- [ ] **Step 5: Create SettingsSurface.vue**

Create `src/renderer/components/settings/SettingsSurface.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import SettingsTabBar, { type SettingsTab } from './SettingsTabBar.vue'
import GeneralSettings from './GeneralSettings.vue'
import ProvidersSettings from './ProvidersSettings.vue'
import AboutSettings from './AboutSettings.vue'

const activeTab = ref<SettingsTab>('general')

const tabComponents: Record<SettingsTab, any> = {
  general: GeneralSettings,
  providers: ProvidersSettings,
  about: AboutSettings
}
</script>

<template>
  <section class="settings-surface" data-surface="settings" aria-label="Settings">
    <SettingsTabBar :active-tab="activeTab" @select="activeTab = $event" />
    <div class="settings-surface__content">
      <component :is="tabComponents[activeTab]" />
    </div>
  </section>
</template>
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/settings/
git commit -m "feat: add settings surface with General, Providers, and About tabs"
```

---

### Task 7: Add Settings CSS Styles

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add settings CSS classes**

Append to the end of `src/renderer/styles.css`, before the media query:

```css
/* ── Settings Surface ─────────────────────────── */

.settings-surface {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
}

.settings-tab-bar {
  display: flex;
  gap: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
}

.settings-tab-bar__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  font-family: var(--font-ui);
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-tab-bar__item:hover {
  background: var(--black-soft);
  color: var(--text-strong);
}

.settings-tab-bar__item--active {
  color: var(--text-strong);
}

.settings-tab-bar__item--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.settings-tab-bar__icon {
  font-size: 13px;
}

.settings-tab-bar__label {
  font-size: 12px;
}

.settings-surface__content {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  justify-content: center;
}

.settings-section {
  width: 100%;
  max-width: 640px;
  padding: 0;
}

.settings-item {
  padding: 16px 20px;
  display: grid;
  gap: 8px;
}

.settings-item--bordered {
  border-bottom: 1px solid var(--line);
}

.settings-item__row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.settings-item__path-input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

.settings-item__browse {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 11px;
}

.settings-item__hint {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted);
}

.settings-item__hint--success {
  color: var(--success);
}

.settings-item__hint--warning {
  color: var(--warning);
}

/* ── About Tab ────────────────────────────────── */

.settings-about {
  max-width: 360px;
  margin: 0 auto;
  padding: 40px 20px;
  display: grid;
  gap: 16px;
  justify-items: center;
  text-align: center;
}

.settings-about__brand {
  display: grid;
  gap: 8px;
  justify-items: center;
}

.settings-about__logo {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--text-strong);
  color: var(--surface-solid);
  font-size: 16px;
  font-weight: 700;
  box-shadow: var(--shadow-soft);
}

.settings-about__name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-strong);
  margin: 0;
}

.settings-about__version {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
}

.settings-about__divider {
  width: 100%;
  height: 1px;
  background: var(--line);
}

.settings-about__stack-text {
  font-size: 11px;
  color: var(--muted);
}

.settings-about__links {
  display: flex;
  gap: 16px;
}

.settings-about__link {
  font-size: 11px;
  color: var(--accent);
  text-decoration: none;
  transition: opacity 0.2s ease;
}

.settings-about__link:hover {
  opacity: 0.75;
  text-decoration: underline;
}
```

Also update the media query to include settings responsive behavior:

```css
@media (max-width: 960px) {
  .command-layout,
  .placeholder-surface {
    grid-template-columns: 1fr;
  }

  .settings-tab-bar__label {
    display: none;
  }

  .settings-section {
    max-width: none;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles.css
git commit -m "feat: add settings surface CSS with glassmorphism design tokens"
```

---

### Task 8: Wire Settings into AppShell and App.vue

**Files:**
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/app/App.vue`

- [ ] **Step 1: Replace placeholder in AppShell.vue**

In `src/renderer/components/AppShell.vue`, replace lines 45–51 (the `v-else` placeholder section) with:

```vue
import SettingsSurface from '../settings/SettingsSurface.vue'

<!-- ... in template, replace the v-else section: -->
<SettingsSurface v-else />
```

Full updated template:

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
      />
      <SettingsSurface v-else />
    </section>
  </main>
</template>
```

And add the import in the `<script setup>`:

```typescript
import SettingsSurface from '../settings/SettingsSurface.vue'
```

- [ ] **Step 2: Load settings in App.vue on mount**

In `src/renderer/app/App.vue`, add settings store initialization:

```typescript
import { useSettingsStore } from '@renderer/stores/settings'

const settingsStore = useSettingsStore()

// Inside onMounted, after bootstrap:
onMounted(async () => {
  const bootstrapState = await window.stoa.getBootstrapState()
  workspaceStore.hydrate(bootstrapState)

  await settingsStore.loadSettings()

  unsubscribeSessionEvent = window.stoa?.onSessionEvent?.((event: SessionStatusEvent) => {
    // ... existing code
  })
})
```

- [ ] **Step 3: Run type check**

Run: `npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/AppShell.vue src/renderer/app/App.vue
git commit -m "feat: wire SettingsSurface into AppShell, load settings on mount"
```

---

### Task 9: Update NewProjectModal with Native Folder Picker

**Files:**
- Modify: `src/renderer/components/command/NewProjectModal.vue`

- [ ] **Step 1: Replace path text input with Browse button**

Update `src/renderer/components/command/NewProjectModal.vue`:

Replace the path `GlassFormField` (lines 56–62) with a native picker:

```vue
<!-- Replace the path GlassFormField with: -->
<div class="form-field">
  <span class="form-field__label">项目路径</span>
  <div class="settings-item__row">
    <input
      id="project-path"
      class="form-field__input settings-item__path-input"
      :value="draftPath"
      placeholder="点击 Browse 选择文件夹"
      :disabled="pending"
      data-new-project-field="path"
      @click="browseProjectPath"
      readonly
    />
    <button
      class="button-ghost settings-item__browse"
      type="button"
      :disabled="pending"
      @click="browseProjectPath"
    >Browse</button>
  </div>
</div>
```

Add the browse function in `<script setup>`:

```typescript
async function browseProjectPath() {
  const path = await window.stoa.pickFolder({ title: '选择项目目录' })
  if (path) {
    draftPath.value = path
    if (!draftName.value) {
      draftName.value = path.split(/[/\\]/).filter(Boolean).pop() ?? ''
    }
  }
}
```

This also auto-fills the project name from the folder name if the user hasn't typed one — nice UX touch.

- [ ] **Step 2: Run type check**

Run: `npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/command/NewProjectModal.vue
git commit -m "feat: replace project path input with native folder picker"
```

---

### Task 10: Update E2E Config Guard Tests

**Files:**
- Modify: `tests/e2e/main-config-guard.test.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`

- [ ] **Step 1: Add new channel registration guards**

In `tests/e2e/main-config-guard.test.ts`, add to the IPC channel registration test to verify the 6 new channels are registered:

```typescript
// Add to the existing IPC channel registration assertions:
const expectedChannels = [
  'project:bootstrap',
  'project:create',
  'project:set-active',
  'session:create',
  'session:set-active',
  'session:input',
  'session:resize',
  'session:event',
  'terminal:data',
  'settings:get',
  'settings:set',
  'dialog:pick-folder',
  'dialog:pick-file',
  'settings:detect-shell',
  'settings:detect-provider',
]
```

- [ ] **Step 2: Add new IPC round-trip tests**

In `tests/e2e/ipc-bridge.test.ts`, add test cases for `settings:get`, `settings:set`, `dialog:pick-folder`, `dialog:pick-file`, `settings:detect-shell`, `settings:detect-provider` through the FakeIpcBus.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass except the known `sandbox: false` guard test

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/main-config-guard.test.ts tests/e2e/ipc-bridge.test.ts
git commit -m "test: add settings IPC channel guards and round-trip tests"
```

---

### Task 11: Add Settings Component Tests

**Files:**
- Create: `src/renderer/components/settings/SettingsSurface.test.ts`

- [ ] **Step 1: Write component test**

Create `src/renderer/components/settings/SettingsSurface.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsSurface from './SettingsSurface.vue'
import SettingsTabBar from './SettingsTabBar.vue'

vi.stubGlobal('stoa', {
  getSettings: vi.fn().mockResolvedValue({ shellPath: '', terminalFontSize: 14, providers: {} }),
  setSetting: vi.fn().mockResolvedValue(undefined),
  detectShell: vi.fn().mockResolvedValue('/bin/zsh'),
  detectProvider: vi.fn().mockResolvedValue(null),
  pickFolder: vi.fn().mockResolvedValue(null),
  pickFile: vi.fn().mockResolvedValue(null)
})

describe('SettingsSurface', () => {
  function mountSettings() {
    setActivePinia(createPinia())
    return mount(SettingsSurface, {
      global: {
        stubs: {
          GeneralSettings: { template: '<div data-stub="general" />' },
          ProvidersSettings: { template: '<div data-stub="providers" />' },
          AboutSettings: { template: '<div data-stub="about" />' }
        }
      }
    })
  }

  it('renders with General tab active by default', () => {
    const wrapper = mountSettings()
    const tabBar = wrapper.findComponent(SettingsTabBar)
    expect(tabBar.props('activeTab')).toBe('general')
  })

  it('has data-surface="settings" attribute', () => {
    const wrapper = mountSettings()
    expect(wrapper.find('[data-surface="settings"]').exists()).toBe(true)
  })

  it('renders all three tab buttons', () => {
    const wrapper = mountSettings()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/renderer/components/settings/SettingsSurface.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/SettingsSurface.test.ts
git commit -m "test: add settings surface component tests"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass except the known `sandbox: false` guard test

- [ ] **Step 2: Run type check**

Run: `npx vue-tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete settings surface redesign — General, Providers, About tabs with native pickers"
```
