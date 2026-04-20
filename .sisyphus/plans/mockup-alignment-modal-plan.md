# Implementation Plan: Mockup Alignment + Modal Forms

## Goal

Align the frontend to match `style-h-editorial-white-glass-toolbar.html` by:
1. Rewriting `WorkspaceHierarchyPanel.vue` to render the mockup's route-column layout directly
2. Adding reusable `BaseModal.vue` and `GlassFormField.vue` primitives
3. Creating `NewProjectModal.vue` and `NewSessionModal.vue` as glassmorphism popup forms
4. Adding modal CSS to `styles.css`
5. Simplifying the prop chain by moving draft state into the panel level

## Scope

### IN Scope
- `WorkspaceHierarchyPanel.vue` — full rewrite
- `BaseModal.vue` — new reusable primitive
- `GlassFormField.vue` — new reusable form field primitive
- `NewProjectModal.vue` — new modal component
- `NewSessionModal.vue` — new modal component
- `styles.css` — add modal + form CSS
- `App.vue` — remove draft refs, simplify to emit-only
- `AppShell.vue` — remove draft prop passthrough
- `CommandSurface.vue` — remove draft prop passthrough

### OUT of Scope
- Queue/Inbox panel classes and components (future work)
- Tree panel classes and components (future work)
- Detail panel classes (future work)
- Terminal/viewport changes (already working)
- GlobalActivityBar changes (already working)
- Deleting `WorkspaceList.vue` (just stop importing it; delete later as cleanup)

---

## Reusable Component Analysis

### What Already Exists (REUSE)
| Component | File | Reuse As-Is |
|-----------|------|-------------|
| GlobalActivityBar | `components/GlobalActivityBar.vue` | ✅ No changes |
| TerminalMetaBar | `command/TerminalMetaBar.vue` | ✅ No changes |
| TerminalViewport | `TerminalViewport.vue` | ✅ No changes |
| AppShell | `AppShell.vue` | ✅ Layout unchanged, only prop simplification |
| CommandSurface | `command/CommandSurface.vue` | ✅ Layout unchanged, only prop simplification |

### What Must Be Built
| Component | File | Purpose |
|-----------|------|---------|
| `BaseModal` | `components/primitives/BaseModal.vue` | Reusable modal: Teleport + overlay + escape + backdrop click + Transition |
| `GlassFormField` | `components/primitives/GlassFormField.vue` | Reusable label + input/select wrapper using design tokens |
| `NewProjectModal` | `command/NewProjectModal.vue` | "New Project" form with name + path fields |
| `NewSessionModal` | `command/NewSessionModal.vue` | "New Session" form with title + type fields |

### What Gets Rewritten
| Component | File | Action |
|-----------|------|--------|
| `WorkspaceHierarchyPanel` | `command/WorkspaceHierarchyPanel.vue` | Full rewrite: remove WorkspaceList import, render route-column layout directly with modals |

---

## Implementation Steps

### Step 1: Add Modal + Form CSS to `styles.css`

**File:** `src/renderer/styles.css` (append at end, before media query)

Add these classes using existing design tokens:

```css
/* ── Modal Overlay ── */
.modal-overlay { ... }         /* fixed inset-0, rgba(0,0,0,0.3), z-50 */
.modal-panel { ... }           /* glass panel, centered, max-width, border-radius var(--radius-lg) */
.modal-panel__header { ... }   /* title + close button layout */
.modal-panel__title { ... }    /* text-strong, 13px, font-weight 600 */
.modal-panel__close { ... }    /* subtle icon button */
.modal-panel__body { ... }     /* form content area, padding */
.modal-panel__footer { ... }   /* action buttons row */

/* ── Form Fields ── */
.form-field { ... }            /* grid gap 6px */
.form-field__label { ... }     /* muted, 10px, uppercase, letter-spacing */
.form-field__input { ... }     /* glass input: surface-solid bg, border var(--line), radius-sm */
.form-field__input:focus { ... }/* accent ring */
.form-field__select { ... }    /* same as input but for select */

/* ── Transition ── */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
```

All values must use design tokens: `var(--surface-solid)`, `var(--line)`, `var(--radius-sm)`, `var(--text-strong)`, `var(--muted)`, etc.

### Step 2: Create `BaseModal.vue` (Reusable Primitive)

**File:** `src/renderer/components/primitives/BaseModal.vue`

```typescript
// Props: show: boolean, title: string
// Emits: update:show, close
// Features:
//   - <Teleport to="body">
//   - <Transition name="modal">
//   - Backdrop overlay click → close
//   - Escape key → close
//   - aria-modal="true", role="dialog", aria-labelledby
//   - <slot /> for body content
//   - <slot name="footer" /> for action buttons
// Uses classes: modal-overlay, modal-panel, modal-panel__header, etc.
```

~70 lines. No external dependencies. No focus trap (Electron app).

### Step 3: Create `GlassFormField.vue` (Reusable Primitive)

**File:** `src/renderer/components/primitives/GlassFormField.vue`

```typescript
// Props: label: string, modelValue: string
// Emits: update:modelValue
// Renders: label + input/select using design tokens
// Uses classes: form-field, form-field__label, form-field__input
// Support <select> via slot or type prop
```

~30 lines.

### Step 4: Create `NewProjectModal.vue`

**File:** `src/renderer/components/command/NewProjectModal.vue`

```typescript
// Uses BaseModal + GlassFormField
// Props: show: boolean
// Emits: update:show, create: [{ name: string; path: string }]
// Internal state: localDraftName, localDraftPath (v-model refs)
// On submit: validate non-empty → emit create → reset drafts → close
// Fields: 项目名称 (text), 项目路径 (text)
```

~50 lines.

### Step 5: Create `NewSessionModal.vue`

**File:** `src/renderer/components/command/NewSessionModal.vue`

```typescript
// Uses BaseModal + GlassFormField
// Props: show: boolean
// Emits: update:show, create: [{ title: string; type: SessionType }]
// Internal state: localDraftTitle, localDraftType
// On submit: validate non-empty → emit create → reset drafts → close
// Fields: 会话标题 (text), 会话类型 (select: shell | opencode)
```

~55 lines.

### Step 6: Rewrite `WorkspaceHierarchyPanel.vue`

**File:** `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

Full rewrite. Remove WorkspaceList import. Render directly:

```
<aside class="workspace-hierarchy-panel">
  <div class="route-body">
    <div class="route-actions">
      <button class="route-action" @click="showNewProject = true">
        <span class="route-action-label">New Project</span>
        <span class="route-action-icon">+</span>
      </button>
    </div>
    <div class="route-group">
      <div class="group-label">Projects</div>
      <div v-for="project in hierarchy" class="route-project">
        <div class="route-item" :class="{ 'route-item--active': project.id === activeProjectId }" @click="...">
          <div class="route-dot idle" />
          <div class="route-copy">
            <div class="route-name">{{ project.name }}</div>
            <div class="route-path">{{ project.path }}</div>
          </div>
          <div class="route-project-actions">
            <button class="route-add-session" @click.stop="openSessionModal(project.id)">+</button>
          </div>
        </div>
        <button
          v-for="session in project.sessions"
          class="route-item child"
          :class="{ 'route-item--active': session.id === activeSessionId }"
          @click="selectSession(session.id)"
        >
          <div class="route-dot" :class="session.status" />
          <div class="route-copy">
            <div class="route-name">{{ session.title }}</div>
            <div class="route-time">{{ session.type }}</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</aside>

<NewProjectModal v-model:show="showNewProject" @create="..." />
<NewSessionModal v-model:show="showNewSession" @create="..." />
```

**Props simplified to:**
```typescript
defineProps<{
  hierarchy: ProjectHierarchyNode[]
  activeProjectId: string | null
  activeSessionId: string | null
}>()
```

**Emits simplified to:**
```typescript
defineEmits<{
  selectProject: [projectId: string]
  selectSession: [sessionId: string]
  createProject: [payload: { name: string; path: string }]
  createSession: [payload: { projectId: string; type: SessionType; title: string }]
}>()
```

No more `projectName`, `projectPath`, `sessionTitle`, `sessionType` or their `update:` events.

### Step 7: Simplify Prop Chain (App → AppShell → CommandSurface)

**`App.vue`:**
- Remove `draftProjectName`, `draftProjectPath`, `draftSessionTitle`, `draftSessionType` refs
- Remove `v-model:project-name`, `v-model:project-path`, `v-model:session-title`, `v-model:session-type` bindings
- Simplify `handleProjectCreate` to accept payload: `{ name: string; path: string }`
- Simplify `handleSessionCreate` to accept payload: `{ projectId: string; type: SessionType; title: string }`
- Update emits: `createProject` now receives the form data directly

**`AppShell.vue`:**
- Remove `projectName`, `projectPath`, `sessionTitle`, `sessionType` props
- Remove their `update:` emits
- Pass through only: `hierarchy`, `activeProjectId`, `activeSessionId`, `activeProject`, `activeSession`
- Forward `createProject` and `createSession` with their new payload shapes

**`CommandSurface.vue`:**
- Same removal of draft props/emits
- Pass through simplified props to WorkspaceHierarchyPanel

---

## Execution Strategy

All steps are **sequential** (each depends on the prior):

1. CSS first (Step 1) — everything else depends on these classes
2. Primitives (Steps 2-3) — modals depend on these
3. Modals (Steps 4-5) — panel depends on these
4. Panel rewrite (Step 6) — integrates everything
5. Prop chain cleanup (Step 7) — final wiring

Parallel opportunities:
- Steps 2 + 3 can run in parallel (BaseModal + GlassFormField are independent)
- Steps 4 + 5 can run in parallel after Step 2 completes (both modals are independent)

## Files Changed

| File | Action | Est. Lines Changed |
|------|--------|--------------------|
| `styles.css` | Append CSS | +80 lines |
| `primitives/BaseModal.vue` | New file | ~70 lines |
| `primitives/GlassFormField.vue` | New file | ~30 lines |
| `command/NewProjectModal.vue` | New file | ~50 lines |
| `command/NewSessionModal.vue` | New file | ~55 lines |
| `command/WorkspaceHierarchyPanel.vue` | Full rewrite | ~100 lines (was 49) |
| `App.vue` | Remove draft refs, simplify handlers | -20 lines |
| `AppShell.vue` | Remove 4 props + 4 emits | -10 lines |
| `CommandSurface.vue` | Remove 4 props + 4 emits | -10 lines |

**Total: ~4 new files, 5 modified files, ~255 net new lines**

## Verification

After all steps:
1. `lsp_diagnostics` on all changed files — must be clean
2. `pnpm typecheck` — must pass
3. Visual: app loads, sidebar shows hierarchy, "New Project" button opens modal, form submits create project, session "+" opens session modal
