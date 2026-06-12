---
date: 2026-06-07
topic: terminal-sidebar-test-coverage
status: completed
mode: context-gathering
sources: 22
---

## Context Report: Terminal Page Right Sidebar — Test Coverage & Productionization Gaps

### Why This Was Gathered

To inventory existing test coverage for the right sidebar on the terminal page, identify gaps in the behavior/topology/journey test architecture, and determine what new test assets are needed before the right sidebar can be considered production-grade.

### Summary

The right sidebar has **extensive Tier 1 (unit) and Tier 2 (e2e integration) coverage** — 11 test files covering the sidebar store, composable logic, component rendering, and all three panels (FileExplorer, SearchPanel, SourceControl/Git). However, it has **zero dedicated behavior/topology/journey assets** in the Tier 3 testing architecture. The only sidebar touch-point in the journey layer is the `workspace-quick-access` journey, which merely asserts `sidebar.visible` as a side-effect. Productionizing the right sidebar requires new behavior specs, topology contracts, and dedicated journeys covering panel switching, resize persistence, state preservation across project switches, and keyboard shortcuts.

---

### Key Findings

#### 1. Unit Test Coverage (Tier 1) — Strong

**RightSidebar component** — 14 test cases in `RightSidebar.test.ts`:
- Open/close CSS class toggling (`right-sidebar-closed`)
- Resize handle presence and DOM structure
- Close button (click, aria-label, keyboard shortcut tooltip)
- Panel area slot rendering with v-show
- Width matching sidebar store default (280px)
- Active-project panel count
- Resize handle always in DOM (no v-if)

**TabBar component** — 8 test cases within `RightSidebar.test.ts`:
- Container rendering
- Visible panel tabs from registry (explorer + search; git hidden without project)
- Git panel shown when project active
- `aria-current="true"` on active tab
- `select` event emission on click
- Tab labels from registry
- SVG icons per visible panel
- Shortcut in title tooltip

**Sidebar Store** — 22 test cases in `sidebar.test.ts`:
- Defaults (open=false, activeTab='explorer', width=280, sessionListWidth=240)
- `setOpen`, `toggle`, `setActiveTab`, `setWidth` (with clamping), `setSessionListWidth` (with clamping)
- Per-project tab persistence (`activeTabByProject`, `restoreProjectTab`)
- `revealInExplorer` / `clearPendingReveal`
- Hydration from IPC (success, clamp, null, error)
- Persistence via `setSidebarState`

**useSidebarPanels composable** — 10 test cases in `useSidebarPanels.test.ts`:
- Default 3-panel registration (explorer, search, git)
- Panel metadata (icon, label, shortcut, gitOnly)
- `getPanel` lookup
- `visiblePanels` filtering (gitOnly hidden without project)
- `registerPanel` / `unregisterPanel`

**useSidebarShortcuts composable** — 10 test cases in `useSidebarShortcuts.test.ts`:
- Ctrl+B toggle (open, close)
- Ctrl+Shift+E → explorer, Ctrl+Shift+F → search, Ctrl+Shift+G → git
- Non-matching keys ignored
- Listener cleanup on unmount

**useSidebarResize composable** — no dedicated test file exists.
- ⚠️ `src/renderer/composables/useSidebarResize.ts` (117 lines) has **zero unit tests**.

**FileExplorer panel** — 28 test cases in `FileExplorer.test.ts`:
- Container, no-project state, toolbar buttons
- File rows rendering, empty directory
- Double-click open, single-click expand
- Keyboard navigation (ArrowDown, ArrowUp, Enter, F2, Delete)
- Context menu (rename, delete, copy path, copy relative path, reveal, duplicate, find in folder)
- Drag and drop (draggable, dragstart data, drop rename)
- File type icons
- Reveal-in-explorer watcher (pendingRevealPath → clearPendingReveal)
- Context menu close via overlay
- Toolbar actions (new file, collapse all, refresh)

**SearchPanel** — 16 test cases in `SearchPanel.test.ts`:
- Container, input, button, filter toggles, placeholder
- Debounced search (300ms), immediate on Enter
- Search button immediate trigger
- Stale request cancellation
- Filter toggles (case, whole word, regex)
- Match click → fsOpenFile

**SourceControl/Git panel** — no dedicated component test file.
- ⚠️ `src/renderer/components/right-sidebar/git/SourceControlPanel.vue` (33.1K) has **no component-level unit test**.
- Git store is tested at e2e level in `sidebar-e2e.test.ts` (see below).

#### 2. E2E Integration Test Coverage (Tier 2) — Strong

**`tests/e2e/sidebar-e2e.test.ts`** — 42.0K, 6 describe blocks:
- **Sidebar Store** (13 tests): defaults, toggle, setOpen, setActiveTab, setWidth clamping, hydration, persistence
- **Search Store** (10 tests): defaults, hasResults, search with options, empty query guard, success/error/searching states, clearResults
- **Git Store** (19 tests): defaults, computed properties, refreshStatus/refreshBranches/refreshLog, stage/unstage/discard, commit/push/pull/fetch, checkout/createBranch, rebase/merge, clearError, refreshAll
- **IPC Channel Registration** (3 tests): channel existence, preload bridge methods, naming convention
- **Sidebar Visibility & CSS** (3 tests): state preservation on toggle, re-opening restores tab+width, toggle cycles without side effects
- **Per-Project Tab Persistence** (3 tests): setActiveTab records per project, restore on project switch, persistence through setSidebarState
- **Reveal in Explorer** (4 tests): open+switch tab, clear pending, overwrite, opens even if closed
- **Keyboard Shortcut Simulation** (2 tests): toggle cycle, tab cycling
- **Cross-Project Persistence** (2 tests): width+open persist, sessionListWidth persists
- **Atomic Write & Backup Recovery** (2 tests): backup before overwrite, fallback to backup on corrupt primary
- **Git Lifecycle** (4 tests): full status→stage→commit→push, branch create→checkout, rebase/merge, error recovery

**`tests/e2e/search-integration.test.ts`** — 15.5K: search store integration.

**`tests/e2e/git-integration.test.ts`** — 19.9K: git store integration.

#### 3. Playwright E2E (Tier 3-ish) — Moderate

**`tests/e2e-playwright/sidebar-interaction.test.ts`** — 5.3K, 5 tests:
- Toggle opens and closes
- Tab switching shows correct panel (explorer/search/git with v-show checks)
- Grid layout changes when sidebar opens/closes (3-column CSS verification)
- Resize handle exists and width is reactive
- Width persists after close/reopen

**`tests/e2e-playwright/file-explorer.test.ts`** — 10.1K: Real Electron Playwright file explorer tests.

**`tests/e2e-playwright/search-panel.test.ts`** — 5.6K: Real Electron Playwright search panel tests.

**`tests/e2e-playwright/git-panel.test.ts`** — 5.1K: Real Electron Playwright git panel tests.

**`tests/e2e-playwright/helpers/sidebar-actions.ts`** — Comprehensive helper library (open, close, switchTab, assertVisible/Hidden, plus FileExplorer/SearchPanel/Git helpers).

**`tests/e2e-playwright/fixtures/sidebar-test-project.ts`** — Test fixture creating a temp git project with staged/unstaged/untracked files.

#### 4. Behavior / Topology / Journey Assets (Tier 3) — **Critical Gap**

**Topology:**
- `terminal.topology.ts` — Declares `sidebarToggle: 'workspace.sidebar-toggle'` but **no dedicated right-sidebar topology**. No testIds for `right-sidebar`, `sidebar-resize-handle`, `sidebar-close-btn`, `sidebar-tab-bar`, `sidebar-tab-explorer`, `sidebar-tab-search`, `sidebar-tab-git`, `file-explorer`, `search-panel`, `source-control-panel`.
- `activity-bar.topology.ts` — Activity bar only; not sidebar.

**Behavior:**
- `session.behavior.ts` — Contains `workspaceQuickAccessBehavior` which mentions `sidebar.visible` in expects but only as a side-effect of the workspace quick-access journey. **No dedicated sidebar behavior spec** for:
  - Sidebar open/close/toggle lifecycle
  - Panel switching (explorer ↔ search ↔ git)
  - Resize persistence and clamping
  - Per-project tab memory
  - Keyboard shortcuts (Ctrl+B, Ctrl+Shift+E/F/G)
  - Reveal-in-explorer flow

**Journeys:**
- `workspace-quick-access.journey.ts` — Only journey touching sidebar. Asserts `sidebar.visible` as one of three quick-access variants. **No dedicated sidebar journey**.

**Generated Playwright:**
- `workspace-quick-access.generated.spec.ts` — Auto-generated; asserts sidebar toggle click → `right-sidebar` visible. Only covers the simplest open path.

**Behavior Coverage:**
- `behavior-coverage.ts` / `behavior-coverage.test.ts` — The coverage machinery exists but **sidebar has no behavior entry to classify**. The sidebar is invisible to the coverage system.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| RightSidebar unit tests (14 cases) | `RightSidebar.test.ts` | `src/renderer/components/right-sidebar/RightSidebar.test.ts:83-273` |
| TabBar unit tests (8 cases) | `RightSidebar.test.ts` | `src/renderer/components/right-sidebar/RightSidebar.test.ts:15-79` |
| Sidebar store unit tests (22 cases) | `sidebar.test.ts` | `src/renderer/stores/sidebar.test.ts:1-297` |
| useSidebarPanels tests (10 cases) | `useSidebarPanels.test.ts` | `src/renderer/composables/useSidebarPanels.test.ts:1-139` |
| useSidebarShortcuts tests (10 cases) | `useSidebarShortcuts.test.ts` | `src/renderer/composables/useSidebarShortcuts.test.ts:1-171` |
| **useSidebarResize: NO TEST** | `useSidebarResize.ts` | `src/renderer/composables/useSidebarResize.ts` (0 test files) |
| FileExplorer panel tests (28 cases) | `FileExplorer.test.ts` | `src/renderer/components/right-sidebar/explorer/FileExplorer.test.ts:1-689` |
| SearchPanel tests (16 cases) | `SearchPanel.test.ts` | `src/renderer/components/right-sidebar/search/SearchPanel.test.ts:1-281` |
| **SourceControlPanel: NO COMPONENT TEST** | `SourceControlPanel.vue` | `src/renderer/components/right-sidebar/git/SourceControlPanel.vue` (0 test files) |
| Sidebar e2e integration (60+ cases) | `sidebar-e2e.test.ts` | `tests/e2e/sidebar-e2e.test.ts:1-1263` |
| Playwright sidebar interaction (5 cases) | `sidebar-interaction.test.ts` | `tests/e2e-playwright/sidebar-interaction.test.ts:1-157` |
| Playwright sidebar helpers | `sidebar-actions.ts` | `tests/e2e-playwright/helpers/sidebar-actions.ts:1-257` |
| Playwright sidebar test fixture | `sidebar-test-project.ts` | `tests/e2e-playwright/fixtures/sidebar-test-project.ts:1-73` |
| Playwright file explorer tests | `file-explorer.test.ts` | `tests/e2e-playwright/file-explorer.test.ts` |
| Playwright search panel tests | `search-panel.test.ts` | `tests/e2e-playwright/search-panel.test.ts` |
| Playwright git panel tests | `git-panel.test.ts` | `tests/e2e-playwright/git-panel.test.ts` |
| Terminal topology (only sidebarToggle) | `terminal.topology.ts` | `testing/topology/terminal.topology.ts:1-16` |
| **No right-sidebar topology** | (missing) | `testing/topology/right-sidebar.topology.ts` does not exist |
| **No sidebar behavior spec** | (missing) | `testing/behavior/sidebar.behavior.ts` does not exist |
| **No sidebar journey** | (missing) | `testing/journeys/sidebar*.journey.ts` does not exist |
| workspace-quick-access journey (only sidebar touchpoint) | `workspace-quick-access.journey.ts` | `testing/journeys/workspace-quick-access.journey.ts:1-11` |
| Generated workspace quick-access spec | `workspace-quick-access.generated.spec.ts` | `tests/generated/playwright/workspace-quick-access.generated.spec.ts:1-62` |
| RightSidebar.vue source | `RightSidebar.vue` | `src/renderer/components/right-sidebar/RightSidebar.vue:1-97` |
| TabBar.vue source | `TabBar.vue` | `src/renderer/components/right-sidebar/TabBar.vue:1-71` |
| useSidebarResize source | `useSidebarResize.ts` | `src/renderer/composables/useSidebarResize.ts:1-121` |

---

### Risks / Unknowns

**[!] Critical Gaps for Productionization:**

1. **No `useSidebarResize` unit tests** — The resize composable (117 lines) handles mousedown/mousemove/mouseup with rAF throttling, dynamic max-width computation, and DOM overlay creation. This is complex pointer-event logic with zero test coverage. A production sidebar needs tests for: drag start/stop, min/max clamping during drag, rAF throttle behavior, blur cleanup, direction inversion.

2. **No `SourceControlPanel.vue` component test** — At 33.1K, this is the largest panel component with no isolated unit test. Git store logic is tested at e2e level, but the component's template rendering (branch selector, commit input, staged/changes/untracked sections, diff view) is untested at the component level.

3. **No dedicated right-sidebar topology contract** — `testing/topology/` has no `right-sidebar.topology.ts`. The 10+ `data-testid` attributes used by RightSidebar, TabBar, FileExplorer, SearchPanel, and SourceControlPanel are not declared in any topology. This means generated Playwright journeys cannot reference these testIds systematically.

4. **No sidebar behavior spec** — The behavior architecture has no entry for the sidebar surface. This means:
   - Sidebar behaviors are invisible to `behavior-coverage` reporting
   - No `coverageBudget` or `risk` classification exists
   - No interruptions (e.g., resize during tab switch, rapid open/close, concurrent panel loads) are declared
   - No observation layers are specified

5. **No dedicated sidebar journey** — Only the `workspace-quick-access` journey touches the sidebar, and only to assert `sidebar.visible`. Missing journeys:
   - Sidebar full lifecycle (open → switch tabs → resize → close → reopen → verify state)
   - Per-project tab memory (switch projects → verify tab restored)
   - Keyboard shortcut-driven panel navigation
   - Reveal-in-explorer end-to-end

**[?] Unknowns:**

- Whether the Playwright tests (`sidebar-interaction.test.ts`, `file-explorer.test.ts`, `search-panel.test.ts`, `git-panel.test.ts`) are actually running in CI or are skipped/unstable.
- Whether the generated Playwright spec is deterministic after `npm run test:generate`.
- Whether `dynamicMaxWidth` in the resize composable is tested in the Playwright grid-layout test (it checks column widths but not dynamic max-width clamping).

---

### Productionization Test Asset Checklist

To bring the right sidebar to production quality, the following test assets need to be **created** or **updated**:

#### New Files Required

| Asset | File | Priority |
|-------|------|----------|
| Right-sidebar topology | `testing/topology/right-sidebar.topology.ts` | **P0** |
| Right-sidebar topology test | `testing/topology/right-sidebar.topology.test.ts` | **P0** |
| Sidebar behavior spec | `testing/behavior/sidebar.behavior.ts` | **P0** |
| Sidebar behavior test | `testing/behavior/sidebar.behavior.test.ts` | **P0** |
| Sidebar lifecycle journey | `testing/journeys/sidebar-lifecycle.journey.ts` | **P1** |
| Sidebar lifecycle journey test | `testing/journeys/sidebar-lifecycle.journey.test.ts` | **P1** |
| Sidebar panel-switch journey | `testing/journeys/sidebar-panel-switch.journey.ts` | **P1** |
| Sidebar panel-switch journey test | `testing/journeys/sidebar-panel-switch.journey.test.ts` | **P1** |
| useSidebarResize unit test | `src/renderer/composables/useSidebarResize.test.ts` | **P0** |
| SourceControlPanel component test | `src/renderer/components/right-sidebar/git/SourceControlPanel.test.ts` | **P1** |

#### Updates Required

| Asset | File | Change |
|-------|------|--------|
| Terminal topology | `testing/topology/terminal.topology.ts` | Add right-sidebar testIds or reference new topology |
| workspace-quick-access journey | `testing/journeys/workspace-quick-access.journey.ts` | Add sidebar.open state assertion as explicit variant |
| behavior-coverage | `testing/generators/behavior-coverage.test.ts` | Add sidebar behavior coverage expectations |
| Generated Playwright | `tests/generated/playwright/` | Regenerate after new journeys added |

#### Suggested Right-Sidebar Topology testIds

```typescript
// testing/topology/right-sidebar.topology.ts
{
  surface: 'right-sidebar',
  testIds: {
    root: 'right-sidebar',
    resizeHandle: 'sidebar-resize-handle',
    closeBtn: 'sidebar-close-btn',
    tabBar: 'sidebar-tab-bar',
    tabExplorer: 'sidebar-tab-explorer',
    tabSearch: 'sidebar-tab-search',
    tabGit: 'sidebar-tab-git',
    fileExplorer: 'file-explorer',
    searchPanel: 'search-panel',
    sourceControlPanel: 'source-control-panel',
  }
}
```

#### Suggested Sidebar Behavior Dimensions

1. **sidebar.toggle** — Actor: user. Goal: open/close sidebar. Entities: sidebar-state, panel-registry. Expects: CSS class toggle, state preserved. Interruptions: rapid toggle, toggle during resize.
2. **sidebar.panelSwitch** — Actor: user. Goal: switch active panel tab. Entities: panel-tab, active-tab. Expects: v-show swap, tab marker update. Interruptions: switch during panel loading.
3. **sidebar.resize** — Actor: user. Goal: resize sidebar width. Entities: resize-handle, width, min/max. Expects: width clamped, persisted on commit. Interruptions: resize past boundary, resize during tab switch.
4. **sidebar.projectSwitch** — Actor: system. Goal: preserve/restore sidebar state on project switch. Entities: project, activeTabByProject, width. Expects: tab restored, width preserved. Interruptions: concurrent project switches.
5. **sidebar.keyboardShortcuts** — Actor: user. Goal: control sidebar via keyboard. Entities: Ctrl+B, Ctrl+Shift+E/F/G. Expects: toggle, tab switch + open. Interruptions: shortcut during input focus.
6. **sidebar.revealInExplorer** — Actor: system. Goal: open sidebar to explorer with file path. Entities: pendingRevealPath, explorer-panel. Expects: sidebar opened, explorer tab, path revealed. Interruptions: path deleted before reveal.

---

### Existing Coverage Matrix

| Test Surface | Unit Tests | E2E Integration | Playwright | Behavior | Topology | Journey |
|-------------|:----------:|:---------------:|:----------:|:--------:|:--------:|:-------:|
| RightSidebar.vue | ✅ 14 | — | ✅ 5 | ❌ | ❌ | ❌ |
| TabBar.vue | ✅ 8 | — | ✅ (via sidebar) | ❌ | ❌ | ❌ |
| sidebar store | ✅ 22 | ✅ 13 | — | ❌ | ❌ | ❌ |
| search store | — | ✅ 10 | ✅ (search-panel) | ❌ | ❌ | ❌ |
| git store | — | ✅ 19 | ✅ (git-panel) | ❌ | ❌ | ❌ |
| useSidebarPanels | ✅ 10 | — | — | ❌ | ❌ | ❌ |
| useSidebarShortcuts | ✅ 10 | — | — | ❌ | ❌ | ❌ |
| **useSidebarResize** | **❌ 0** | — | ✅ partial | ❌ | ❌ | ❌ |
| FileExplorer | ✅ 28 | — | ✅ dedicated | ❌ | ❌ | ❌ |
| SearchPanel | ✅ 16 | — | ✅ dedicated | ❌ | ❌ | ❌ |
| **SourceControlPanel** | **❌ 0** | — | ✅ dedicated | ❌ | ❌ | ❌ |
| IPC channels | — | ✅ 3 | — | — | — | — |
| State persistence | — | ✅ 2 | — | ❌ | ❌ | ❌ |
| Quick-access journey | — | — | ✅ generated | ✅ partial | ✅ partial | ✅ |
