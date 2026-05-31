# Right Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resizable right sidebar to Stoa with File Explorer, Search, and basic Git management panels.

**Architecture:** The sidebar sits as a third column in AppShell's grid layout. A manual WorktreeSelector lets users pick which project's directory to operate on (unlike Orca which auto-binds to active worktree). All file/git/search operations go through new IPC channels to the main process, following Stoa's existing `domain:resource-action` naming convention.

**Tech Stack:** Vue 3 Composition API, Pinia, @tanstack/vue-virtual, node:fs, child_process.spawn('git'), ripgrep

---

## Phase 0: IPC Infrastructure

### Task 0.1: Create shared sidebar types

**Files:**
- Create: `src/shared/sidebar-types.ts`

- [ ] **Step 1: Create the type definitions file**

All types for the three sidebar panels (filesystem, search, git) plus sidebar UI state.

### Task 0.2: Add IPC channel constants

**Files:**
- Modify: `src/core/ipc-channels.ts`

- [ ] **Step 1: Add new channel constants for fs/git/search**

Following the existing `domain:resource-action` pattern.

### Task 0.3: Extend RendererApi interface

**Files:**
- Modify: `src/shared/project-session.ts` (RendererApi interface)

- [ ] **Step 1: Add all new method signatures to RendererApi**

fs*, git*, onFsChanged methods.

### Task 0.4: Extend preload bridge

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Implement all new preload API methods**

Wire each method to the corresponding IPC channel.

### Task 0.5: Create filesystem IPC handlers

**Files:**
- Create: `src/main/sidebar-fs-handlers.ts`
- Modify: `src/main/index.ts` (register handlers)

- [ ] **Step 1: Implement fs read/write/create/rename/delete handlers**
- [ ] **Step 2: Implement fs search handler (rg + git grep fallback)**
- [ ] **Step 3: Implement fs watcher (chokidar → push events)**
- [ ] **Step 4: Register all handlers in main/index.ts**

### Task 0.6: Create git IPC handlers

**Files:**
- Create: `src/main/sidebar-git-handlers.ts`
- Modify: `src/main/index.ts` (register handlers)

- [ ] **Step 1: Implement git status/commit/push/pull/fetch/rebase/merge/stage/unstage/discard handlers**
- [ ] **Step 2: Implement git branches/log/diff handlers**
- [ ] **Step 3: Register all handlers in main/index.ts**

---

## Phase 1: Sidebar Shell

### Task 1.1: Create sidebar Pinia store

**Files:**
- Create: `src/renderer/stores/sidebar.ts`

### Task 1.2: Create RightSidebar shell component

**Files:**
- Create: `src/renderer/components/right-sidebar/RightSidebar.vue`
- Create: `src/renderer/components/right-sidebar/WorktreeSelector.vue`
- Create: `src/renderer/components/right-sidebar/TabBar.vue`

### Task 1.3: Create useSidebarResize composable

**Files:**
- Create: `src/renderer/composables/useSidebarResize.ts`

### Task 1.4: Modify AppShell layout

**Files:**
- Modify: `src/renderer/components/AppShell.vue`

Add third grid column, render RightSidebar.

---

## Phase 2: File Explorer

### Task 2.1: Create useFileTree composable

**Files:**
- Create: `src/renderer/composables/useFileTree.ts`

### Task 2.2: Create useFileWatch composable

**Files:**
- Create: `src/renderer/composables/useFileWatch.ts`

### Task 2.3: Create FileExplorer components

**Files:**
- Create: `src/renderer/components/right-sidebar/explorer/FileExplorer.vue`
- Create: `src/renderer/components/right-sidebar/explorer/FileExplorerRow.vue`
- Create: `src/renderer/components/right-sidebar/explorer/FileExplorerToolbar.vue`

---

## Phase 3: Search

### Task 3.1: Create search Pinia store

**Files:**
- Create: `src/renderer/stores/search.ts`

### Task 3.2: Create Search components

**Files:**
- Create: `src/renderer/components/right-sidebar/search/SearchPanel.vue`
- Create: `src/renderer/components/right-sidebar/search/SearchHeader.vue`
- Create: `src/renderer/components/right-sidebar/search/SearchResultRow.vue`

---

## Phase 4: Source Control

### Task 4.1: Create git Pinia store

**Files:**
- Create: `src/renderer/stores/git.ts`

### Task 4.2: Create Source Control components

**Files:**
- Create: `src/renderer/components/right-sidebar/git/SourceControlPanel.vue`
- Create: `src/renderer/components/right-sidebar/git/GitCommitArea.vue`
- Create: `src/renderer/components/right-sidebar/git/GitStatusList.vue`
- Create: `src/renderer/components/right-sidebar/git/GitBranchSelector.vue`

---

## Phase 5: Integration

### Task 5.1: Terminal reflow on sidebar resize

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`

### Task 5.2: Run full quality gate

```bash
npm run test:generate && npm run typecheck && npx vitest run
```
