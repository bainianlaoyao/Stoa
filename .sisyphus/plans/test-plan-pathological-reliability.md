# Pathological Reliability Test Plan

## Current State

- **17 test files**, **31 tests** total
- **4 tests FAILING** (broken by our refactor — old DOM selectors + removed props)
- **10 components untested** (including all 4 new files)
- **No coverage configuration**

## Goal

Every user-visible behavior tested. Every emit contract asserted. Every edge case enumerated. Zero ambiguity about what works.

---

## Part A: Fix Broken Tests (3 files, 4 tests)

### A1. `WorkspaceHierarchyPanel.test.ts` — Full rewrite

The old tests query `.workspace-card--session`, `.workspace-create-panel__submit`, `data-parent-group`, `.workspace-list__eyebrow` — none of these exist anymore.

**Delete and rewrite. All new tests below.**

### A2. `AppShell.test.ts` — Remove stale props

Remove `projectName`, `projectPath`, `sessionTitle`, `sessionType` from all mount calls.

### A3. `CommandSurface.test.ts` — Fix selector

Change `.route-column` → `.workspace-hierarchy-panel`. Remove stale props.

---

## Part B: New Test Files (7 files)

### B1. `src/renderer/components/primitives/BaseModal.test.ts`

```
describe('BaseModal')

  Props: show=true, title="Test Modal"

  Render tests:
  ✅ renders .modal-overlay when show=true
  ✅ does NOT render when show=false
  ✅ renders .modal-panel with role="dialog" and aria-modal="true"
  ✅ renders title in .modal-panel__title with unique id
  ✅ aria-labelledby on panel matches title element id
  ✅ renders close button .modal-panel__close
  ✅ renders slot content in .modal-panel__body

  Close behavior:
  ✅ clicking .modal-panel__close emits update:show with false
  ✅ clicking .modal-overlay (self) emits update:show with false
  ✅ clicking .modal-panel content does NOT close (event does not bubble to overlay)

  Escape key:
  ✅ pressing Escape when show=true emits update:show with false
  ✅ pressing Escape when show=false does nothing (listener not attached)
  ✅ pressing other keys (Enter, Tab) does NOT close

  Lifecycle:
  ✅ removes keydown listener on unmount (no memory leak)
  ✅ removes keydown listener when show transitions from true to false
  ✅ adds keydown listener when show transitions from false to true

  Edge cases:
  ✅ multiple rapid show/hide toggles — final state correct
```

**Test count: ~15**

### B2. `src/renderer/components/primitives/GlassFormField.test.ts`

```
describe('GlassFormField')

  Text input (type='text', default):
  ✅ renders .form-field label
  ✅ renders .form-field__input
  ✅ does NOT render .form-field__select
  ✅ input value matches modelValue prop
  ✅ input placeholder matches placeholder prop
  ✅ typing emits update:modelValue with new value

  Select input (type='select'):
  ✅ renders .form-field__select
  ✅ does NOT render .form-field__input
  ✅ renders option elements from options prop
  ✅ changing select emits update:modelValue with selected value
  ✅ select value matches modelValue prop

  Edge cases:
  ✅ empty options array renders empty select (no crash)
  ✅ modelValue not in options — select still renders without error
  ✅ undefined type defaults to 'text' (renders input, not select)
```

**Test count: ~13**

### B3. `src/renderer/components/command/NewProjectModal.test.ts`

```
describe('NewProjectModal')

  Render:
  ✅ renders two GlassFormField instances (name + path)
  ✅ renders 创建 button (.button-primary)
  ✅ renders 取消 button (.button-ghost)
  ✅ passes title "新建项目" to BaseModal

  Validation:
  ✅ submit with empty name + path → does NOT emit create
  ✅ submit with name only → does NOT emit create
  ✅ submit with path only → does NOT emit create
  ✅ submit with whitespace-only name → does NOT emit create
  ✅ submit with whitespace-only path → does NOT emit create

  Happy path:
  ✅ fill name + path → click 创建 → emits create with { name, path }
  ✅ emitted name/path are trimmed (no leading/trailing whitespace)
  ✅ after submit → emits update:show with false (closes modal)
  ✅ after submit → draft fields are reset (re-open modal has empty fields)

  Cancel:
  ✅ clicking 取消 → emits update:show with false
  ✅ clicking 取消 → does NOT emit create
```

**Test count: ~13**

### B4. `src/renderer/components/command/NewSessionModal.test.ts`

```
describe('NewSessionModal')

  Render:
  ✅ renders GlassFormField for title (type text)
  ✅ renders GlassFormField for session type (type select)
  ✅ select has 'shell' and 'opencode' options
  ✅ renders 创建 button
  ✅ renders 取消 button

  Validation:
  ✅ submit with empty title → does NOT emit create
  ✅ submit with whitespace-only title → does NOT emit create

  Happy path:
  ✅ fill title → submit → emits create with { title, type: 'shell' }
  ✅ change type to opencode → submit → emits create with { title, type: 'opencode' }
  ✅ title is trimmed in emitted payload
  ✅ after submit → emits update:show with false
  ✅ after submit → title reset, type reset to 'shell'

  Cancel:
  ✅ clicking 取消 → emits update:show with false
  ✅ clicking 取消 → does NOT emit create

  State persistence:
  ✅ type selection persists across multiple opens (if not submitted)
```

**Test count: ~12**

### B5. `src/renderer/components/GlobalActivityBar.test.ts`

```
describe('GlobalActivityBar')

  Render:
  ✅ renders .activity-bar nav element
  ✅ renders brand "V" in .activity-bar__brand
  ✅ renders 4 activity items with correct data-activity-item values: command, queue, tree, settings
  ✅ active item has .activity-bar__item--active class
  ✅ inactive items do NOT have --active class

  Interaction:
  ✅ clicking an item emits select with correct surface id
  ✅ clicking already-active item still emits select

  Pending badge:
  ✅ renders .activity-bar__dot on queue item when pendingCount > 0
  ✅ does NOT render dot when pendingCount === 0
  ✅ does NOT render dot on non-queue items even with pendingCount > 0
```

**Test count: ~10**

### B6. `src/renderer/components/command/TerminalMetaBar.test.ts`

```
describe('TerminalMetaBar')

  With project + session:
  ✅ renders .terminal-meta
  ✅ renders primary group with project.id and session.id
  ✅ renders secondary group with session.type and session.status

  Without data:
  ✅ renders nothing when project is null
  ✅ renders nothing when session is null
  ✅ renders nothing when both are null
```

**Test count: ~6**

### B7. `src/renderer/app/App.test.ts`

```
describe('App (root)')

  NOTE: App.vue uses Pinia store + window.vibecoding IPC — must mock both.

  Bootstrap:
  ✅ on mount → calls window.vibecoding.getBootstrapState
  ✅ on mount → hydrates store with bootstrap data

  Project selection:
  ✅ selectProject event → calls workspaceStore.setActiveProject
  ✅ selectProject event → calls window.vibecoding.setActiveProject

  Session selection:
  ✅ selectSession event → calls workspaceStore.setActiveSession
  ✅ selectSession event → calls window.vibecoding.setActiveSession

  Project creation:
  ✅ createProject event → calls window.vibecoding.createProject with payload
  ✅ createProject event → adds result to store
  ✅ createProject event → sets created project as active

  Session creation:
  ✅ createSession event → calls window.vibecoding.createSession with payload
  ✅ createSession event → adds result to store
  ✅ createSession event → sets created session as active
```

**Test count: ~11**

---

## Part C: Rewrite `WorkspaceHierarchyPanel.test.ts` (1 file, exhaustive)

```
describe('WorkspaceHierarchyPanel')

  === RENDER ===

  With populated hierarchy:
  ✅ renders .workspace-hierarchy-panel aside
  ✅ renders .route-body container
  ✅ renders "New Project" button in .route-actions
  ✅ renders "Projects" .group-label
  ✅ renders one .route-project div per project in hierarchy
  ✅ renders project name in .route-name
  ✅ renders project path in .route-path
  ✅ renders one .route-item.child button per session
  ✅ renders session title in .route-name
  ✅ renders session type in .route-time
  ✅ renders .route-dot with session.status as class
  ✅ renders "+" .route-add-session button per project

  With empty hierarchy:
  ✅ renders "New Project" button
  ✅ renders "Projects" group label
  ✅ renders zero .route-project divs
  ✅ does NOT crash

  Active states:
  ✅ project matching activeProjectId has .route-item--active
  ✅ session matching activeSessionId has .route-item--active
  ✅ only ONE active project when multiple exist
  ✅ only ONE active session when multiple exist
  ✅ no active class when activeProjectId is null
  ✅ no active class when activeSessionId is null

  === INTERACTION ===

  Project selection:
  ✅ clicking project row emits selectProject with project.id
  ✅ clicking inactive project emits correct id
  ✅ clicking already-active project still emits selectProject

  Session selection:
  ✅ clicking session row emits selectSession with session.id
  ✅ clicking session does NOT also emit selectProject (event isolation)

  Add session button:
  ✅ clicking "+" button does NOT emit selectProject (click.stop works)
  ✅ clicking "+" does NOT emit createSession directly
  ✅ clicking "+" opens NewSessionModal (showNewSession becomes true)

  New Project button:
  ✅ clicking "New Project" opens NewProjectModal (showNewProject becomes true)

  === MODAL INTEGRATION ===

  NewProjectModal:
  ✅ NewProjectModal is rendered in DOM
  ✅ NewProjectModal receives v-model:show binding
  ✅ NewProjectModal create event → emits createProject with { name, path } payload

  NewSessionModal:
  ✅ NewSessionModal is rendered in DOM
  ✅ NewSessionModal create event → emits createSession with { projectId, type, title }
  ✅ projectId in payload matches the project whose "+" was clicked
  ✅ clicking "+" on different projects changes targetProjectId
  ✅ last clicked project's id is used in createSession payload

  === EDGE CASES ===

  ✅ project with zero sessions — renders project row, no session buttons, no crash
  ✅ project with many sessions (10+) — all rendered
  ✅ hierarchy with multiple projects — all rendered with correct data
  ✅ very long project name — does not crash, text present
  ✅ special characters in name/path — rendered correctly
```

**Test count: ~35**

---

## Part D: Update Existing Tests (2 files)

### D1. `AppShell.test.ts`

Current test passes stale props. Fix:
- Remove `projectName`, `projectPath`, `sessionTitle`, `sessionType` from mount props
- Add test: createProject event passes payload through
- Add test: createSession event passes payload through
- Add test: pendingCount computed from hierarchy sessions

### D2. `CommandSurface.test.ts`

- Remove stale props
- Fix `.route-column` → `.workspace-hierarchy-panel`
- Add test: createProject event passes payload through
- Add test: createSession event passes payload through

---

## Execution Order

Tests are independent per file. But logically:

| Phase | Files | Dependency |
|-------|-------|-----------|
| 1 | Fix broken tests (A2, A3, D1, D2) | Must pass before new tests — existing baseline |
| 2 | Primitives (B1, B2) | No dependencies |
| 3 | Modals (B3, B4) | Depend on primitives existing |
| 4 | Panel rewrite (C) | Depends on modals existing |
| 5 | Top-level (B5, B6, B7) | Independent of each other |

Within each phase, files can be parallelized.

---

## Total Test Count

| File | Tests |
|------|-------|
| `BaseModal.test.ts` (new) | ~15 |
| `GlassFormField.test.ts` (new) | ~13 |
| `NewProjectModal.test.ts` (new) | ~13 |
| `NewSessionModal.test.ts` (new) | ~12 |
| `GlobalActivityBar.test.ts` (new) | ~10 |
| `TerminalMetaBar.test.ts` (new) | ~6 |
| `App.test.ts` (new) | ~11 |
| `WorkspaceHierarchyPanel.test.ts` (rewrite) | ~35 |
| `AppShell.test.ts` (update) | +3 |
| `CommandSurface.test.ts` (update) | +2 |
| **Total NEW** | **~120** |
| **Total after fix** | **~120 new + 27 existing = ~147** |

Current: 31 tests (4 failing)
After: ~147 tests (0 failing)
Delta: +116 tests, +7 new test files, +3 updated test files
