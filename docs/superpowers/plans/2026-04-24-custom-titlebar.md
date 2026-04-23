# Custom Frameless Title Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows system title bar + Electron menu bar with a modern, integrated custom title bar branded "stoa".

**Architecture:** Make the BrowserWindow frameless, add IPC channels for minimize/maximize/close, create a TitleBar.vue component with drag region and window controls, integrate it into AppShell.vue above the existing grid layout.

**Tech Stack:** Electron (frameless window), Vue 3 Composition API, Tailwind CSS v4, IPC via preload bridge.

---

### Task 1: Add window control IPC channels

**Files:**
- Modify: `src/core/ipc-channels.ts`

- [ ] **Step 1: Add three new channel constants**

Add `windowMinimize`, `windowMaximize`, and `windowClose` to `IPC_CHANNELS`:

```typescript
export const IPC_CHANNELS = {
  projectBootstrap: 'project:bootstrap',
  projectCreate: 'project:create',
  projectSetActive: 'project:set-active',
  sessionCreate: 'session:create',
  sessionSetActive: 'session:set-active',
  sessionTerminalReplay: 'session:terminal-replay',
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
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
} as const
```

- [ ] **Step 2: Commit**

```bash
git add src/core/ipc-channels.ts
git commit -m "feat: add window control IPC channels"
```

---

### Task 2: Register window control IPC handlers in main process

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add IPC handlers for minimize, maximize, close**

After the existing `ipcMain.handle(IPC_CHANNELS.settingsDetectProvider, ...)` block (around line 266), add:

```typescript
  ipcMain.handle(IPC_CHANNELS.windowMinimize, () => {
    mainWindow?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.windowMaximize, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle(IPC_CHANNELS.windowClose, () => {
    mainWindow?.close()
  })
```

- [ ] **Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: register window control IPC handlers"
```

---

### Task 3: Expose window controls in preload bridge

**Files:**
- Modify: `src/shared/project-session.ts` (RendererApi interface)
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add methods to RendererApi interface**

In `src/shared/project-session.ts`, add to the `RendererApi` interface (before the closing `}`):

```typescript
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
```

- [ ] **Step 2: Add implementations in preload**

In `src/preload/index.ts`, add after the `detectProvider` method inside the `api` object:

```typescript
  async minimizeWindow() {
    return ipcRenderer.invoke('window:minimize')
  },
  async maximizeWindow() {
    return ipcRenderer.invoke('window:maximize')
  },
  async closeWindow() {
    return ipcRenderer.invoke('window:close')
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/project-session.ts src/preload/index.ts
git commit -m "feat: expose window controls in preload bridge"
```

---

### Task 4: Make BrowserWindow frameless

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Update createMainWindow to use frameless window**

In `src/main/index.ts`, modify the `createMainWindow` function. Change the `BrowserWindow` constructor options:

```typescript
function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
```

Key changes: added `frame: false`, changed `backgroundColor` from `'#0b1020'` to `'#f4f5f8'` (matches canvas color).

- [ ] **Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: make BrowserWindow frameless for custom title bar"
```

---

### Task 5: Create TitleBar.vue component

**Files:**
- Create: `src/renderer/components/TitleBar.vue`

- [ ] **Step 1: Create the TitleBar component**

```vue
<script setup lang="ts">
function minimize(): void {
  void window.stoa.minimizeWindow()
}

function maximize(): void {
  void window.stoa.maximizeWindow()
}

function close(): void {
  void window.stoa.closeWindow()
}
</script>

<template>
  <div class="flex items-center h-9 shrink-0 select-none border-b border-line" style="-webkit-app-region: drag;">
    <!-- Brand -->
    <div class="w-14 flex items-center justify-center" style="-webkit-app-region: no-drag;">
      <div class="w-6 h-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft">S</div>
    </div>
    <span class="text-[13px] font-semibold tracking-tight text-text-strong">stoa</span>

    <!-- Spacer (draggable) -->

    <!-- Window controls -->
    <div class="ml-auto flex h-full" style="-webkit-app-region: no-drag;">
      <button
        class="inline-flex items-center justify-center w-[46px] h-full text-subtle hover:text-text hover:bg-black-soft transition-colors duration-150"
        aria-label="Minimize"
        type="button"
        @click="minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="none"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        class="inline-flex items-center justify-center w-[46px] h-full text-subtle hover:text-text hover:bg-black-soft transition-colors duration-150"
        aria-label="Maximize"
        type="button"
        @click="maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button
        class="inline-flex items-center justify-center w-[46px] h-full text-subtle hover:bg-[#e81123] hover:text-surface-solid transition-colors duration-150"
        aria-label="Close"
        type="button"
        @click="close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
      </button>
    </div>
  </div>
</template>
```

Design notes:
- 36px height (`h-9`), full width flex row
- Left: brand logo "S" in same style as GlobalActivityBar's brand badge, then "stoa" text
- Right: three window control buttons (minimize/maximize/close) with Windows-style SVG icons
- Close button: hover turns red (`#e81123`) with white icon
- Entire bar is draggable via `-webkit-app-region: drag`, buttons are `no-drag`
- Uses existing project design tokens (`text-text-strong`, `bg-black-soft`, `border-line`, etc.)

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/TitleBar.vue
git commit -m "feat: add TitleBar.vue with stoa branding and window controls"
```

---

### Task 6: Integrate TitleBar into AppShell layout

**Files:**
- Modify: `src/renderer/components/AppShell.vue`

- [ ] **Step 1: Import TitleBar and update layout**

Add the import and wrap the layout in a flex column so TitleBar sits above the main grid:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import TitleBar from './TitleBar.vue'
import GlobalActivityBar from './GlobalActivityBar.vue'
import CommandSurface from './command/CommandSurface.vue'
import ArchiveSurface from './archive/ArchiveSurface.vue'
import SettingsSurface from './settings/SettingsSurface.vue'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import type { ProjectHierarchyNode } from '@renderer/stores/workspaces'
import type { AppSurface } from './GlobalActivityBar.vue'

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

const activeSurface = ref<AppSurface>('command')

const archivedSessions = computed(() => {
  return props.hierarchy.flatMap((project) =>
    project.archivedSessions.map((session) => ({
      ...session,
      projectName: project.name,
      projectPath: project.path
    }))
  )
})
</script>

<template>
  <div class="flex flex-col h-full">
    <TitleBar />
    <main class="grid grid-cols-[56px_1fr] flex-1 min-h-0 p-0 gap-0">
      <GlobalActivityBar :active-surface="activeSurface" @select="activeSurface = $event" />

      <section class="min-w-0 min-h-0 m-3 ml-0 border border-black/[0.04] rounded-2xl bg-surface backdrop-blur-[40px] saturate-[1.2] shadow-premium overflow-hidden" aria-label="Application viewport">
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
          :archived-sessions="archivedSessions"
          @restore-session="emit('restoreSession', $event)"
        />
        <SettingsSurface v-else />
      </section>
    </main>
  </div>
</template>
```

Changes from current:
1. Added `import TitleBar from './TitleBar.vue'`
2. Wrapped everything in `<div class="flex flex-col h-full">`
3. Added `<TitleBar />` as first child
4. Changed `<main class="grid ... h-full ...">` to `<main class="grid ... flex-1 min-h-0 ...">` (removed `h-full`, added `flex-1 min-h-0`)

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/AppShell.vue
git commit -m "feat: integrate TitleBar into AppShell layout"
```

---

### Task 7: Update GlobalActivityBar brand to match stoa

**Files:**
- Modify: `src/renderer/components/GlobalActivityBar.vue`

- [ ] **Step 1: Change brand badge from "V" to "S"**

In `GlobalActivityBar.vue`, the brand badge currently reads "V". Since the title bar now shows the brand, the activity bar's brand badge should match. Change line 73:

From:
```html
<div data-testid="activity-brand" class="w-6 h-6 mx-auto mb-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft">V</div>
```

To:
```html
<div data-testid="activity-brand" class="w-6 h-6 mx-auto mb-6 grid place-items-center rounded-lg bg-text-strong text-surface-solid text-xs font-bold tracking-wide shadow-soft">S</div>
```

This is just changing the letter from `V` to `S`.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/GlobalActivityBar.vue
git commit -m "feat: update activity bar brand badge to stoa"
```

---

### Task 8: Manual smoke test

- [ ] **Step 1: Run the app**

```bash
npm run dev
```

- [ ] **Step 2: Verify the following**

- [ ] No system title bar visible
- [ ] No menu bar (File/Edit/View/Window/Help) visible
- [ ] Custom title bar shows "stoa" logo + text on the left
- [ ] Window control buttons work: minimize, maximize/restore, close
- [ ] Title bar blank area is draggable
- [ ] Close button hover turns red
- [ ] App layout is correct (no overflow or broken sizing)
- [ ] GlobalActivityBar brand badge shows "S"

- [ ] **Step 3: Final commit if any fixes needed**
