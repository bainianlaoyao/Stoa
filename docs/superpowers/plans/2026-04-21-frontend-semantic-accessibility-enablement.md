# Frontend Semantic Accessibility Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the renderer semantically testable so Tier 3 component tests and Tier 4 Playwright tests can genuinely prefer accessibility/semantic locators over CSS selectors.

**Architecture:** This plan is a prerequisite enablement pass, not a feature rewrite. It upgrades the renderer's interaction contract by adding accessible names, semantic roles, stable active-state semantics, and narrowly scoped test hooks only where semantics are still insufficient. The outcome is a frontend surface that can be queried through `getByRole`, `getByLabel`, `getByText`, and a small exception path for terminal/canvas and boot-integrity surfaces.

**Tech Stack:** Vue 3, TypeScript, Pinia, existing renderer components, @vue/test-utils, Vitest.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | Modify | Convert project/session hierarchy into semantically queryable interactive structure |
| `src/renderer/components/GlobalActivityBar.vue` | Modify | Add accessible names to icon-first navigation buttons |
| `src/renderer/components/primitives/BaseModal.vue` | Modify | Add close-button accessible name and minimal focus semantics |
| `src/renderer/components/primitives/GlassFormField.vue` | Modify | Strengthen field labeling contract and support stable field-level targeting |
| `src/renderer/components/command/NewProjectModal.vue` | Modify | Wrap modal actions in semantic form/error structure |
| `src/renderer/components/command/NewSessionModal.vue` | Modify | Wrap modal actions in semantic form/error structure |
| `src/renderer/components/AppShell.vue` | Modify | Add stable viewport/surface semantics for top-level renderer shell |
| `src/renderer/components/TerminalViewport.vue` | Modify | Add semantic shell hooks around terminal/empty-state/details regions without pretending canvas text is accessible |
| `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts` | Modify | Replace CSS-driven assertions with semantic assertions where markup now permits |
| `src/renderer/components/command/NewProjectModal.test.ts` | Modify | Prefer dialog/label/button queries over class selectors |
| `src/renderer/components/command/NewSessionModal.test.ts` | Modify | Prefer dialog/label/button queries over class selectors |
| `src/renderer/components/AppShell.test.ts` or nearest shell test file | Create/Modify | Add semantic shell/activity assertions if no existing shell test covers them |
| `AGENTS.md` | Modify | Add repository-level rule requiring semantic locators for Tier 3/Tier 4 tests |
| `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md` | Modify | Declare this plan as an explicit prerequisite dependency |

---

## Completion Contract

This prerequisite plan is complete only when all of the following are true:

1. Buttons and interactive items used by component tests or Playwright journeys expose stable accessible names.
2. Project/session hierarchy items can be queried semantically, not only by CSS class shape.
3. Modal fields can be queried reliably with `getByLabel(...)`.
4. Error messages important to user feedback expose appropriate alert/live semantics.
5. Tier 3 component tests for the touched components prefer semantic queries.
6. `AGENTS.md` explicitly states the semantic locator rule and its allowed exceptions.

---

## Task 1: Establish repository-level semantic locator policy

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md`

- [ ] **Step 1: Add a hard rule to `AGENTS.md`**

Add a new subsection near the testing quality rules that states:

```md
## Locator Strategy Rule

For Tier 3 component tests and Tier 4 Playwright/Electron tests:

- MUST prefer semantic locators (`getByRole`, `getByLabel`, `getByText`) over CSS selectors
- MUST fix component semantics first when a semantic locator cannot work
- MAY use `data-testid` only as an explicit fallback when semantic queries are insufficient
- MAY use CSS selectors only for boot-integrity smoke checks, terminal/canvas shell containers, or documented temporary exceptions
```

- [ ] **Step 2: Update the test rollout plan header to declare this plan as a prerequisite**

At the top of `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md`, add a short dependency notice:

```md
> **Prerequisite:** Complete `docs/superpowers/plans/2026-04-21-frontend-semantic-accessibility-enablement.md` before implementing Phase 5 or Phase 6 of this rollout.
```

- [ ] **Step 3: Run targeted doc verification**

Run: `npx vitest run tests/e2e/main-config-guard.test.ts`

Expected: existing documented result only; no new failures introduced by plan updates. If the known `sandbox: false` guard remains the only intentional failure, document that explicitly in the implementation notes.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/superpowers/plans/2026-04-21-test-strategy-rollout.md
git commit -m "docs: require semantic locators for component and Playwright tests"
```

## Task 2: Make hierarchy interactions semantically queryable

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Write failing hierarchy semantics tests**

Add tests that express the desired user-facing contract:

```typescript
it('exposes the project list with stable accessible names', async () => {
  render(WorkspaceHierarchyPanel, { props: baseProps })
  expect(screen.getByRole('button', { name: /my project/i })).toBeInTheDocument()
})

it('marks the active session with a semantic active state', async () => {
  render(WorkspaceHierarchyPanel, { props: activeSessionProps })
  expect(screen.getByRole('button', { name: /deploy/i })).toHaveAttribute('aria-current', 'true')
})
```

If the current test stack does not yet use Testing Library, adapt the assertion style but keep the semantic target the same.

- [ ] **Step 2: Replace clickable project divs with semantic interactive elements**

Update `WorkspaceHierarchyPanel.vue` so that:
1. project rows are buttons or elements with equivalent interactive semantics;
2. active project/session expose an explicit state marker such as `aria-current="true"` or `aria-selected="true"`;
3. the project group label becomes a semantic heading instead of a plain div;
4. the panel root has a stable accessible name like `aria-label="Workspace hierarchy"`.

Do not keep the current clickable `<div>` pattern.

- [ ] **Step 3: Add accessible names to hierarchy action buttons**

Specifically:
1. the `New Project` button must be queryable by name;
2. the `+` add-session button must expose `aria-label="Add session to <project name>"` or equivalent contextual naming;
3. session buttons should expose names that include the title, and optionally type if needed for disambiguation.

- [ ] **Step 4: Replace CSS-first tests with semantic assertions**

Rewrite the component test so the primary assertions use semantic queries for:
1. project selection;
2. session selection;
3. new project action;
4. add-session action;
5. active-state semantics.

Retain CSS assertions only where they validate visual state styling distinct from semantic behavior.

- [ ] **Step 5: Run the hierarchy test file**

Run: `npx vitest run src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
git commit -m "feat: add semantic interaction contract to workspace hierarchy"
```

## Task 3: Make activity and shell navigation semantically queryable

**Files:**
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Modify: `src/renderer/components/AppShell.vue`

- [ ] **Step 1: Write failing shell/navigation semantic assertions**

Add or update shell-level tests so they expect:
1. the activity bar to be queryable as named navigation;
2. each activity button to be queryable by accessible name, not only by `data-activity-item`;
3. the active surface to expose a semantic active indicator.

- [ ] **Step 2: Add accessible names to activity buttons**

Update `GlobalActivityBar.vue` so each icon button exposes a stable name via visible text or `aria-label`. Use the existing item titles as the semantic source of truth; do not maintain two conflicting label vocabularies.

- [ ] **Step 3: Add semantic shell hooks in `AppShell.vue`**

Add a stable label or role strategy for the main viewport/surface container so Playwright can distinguish:
1. the global activity navigation;
2. the command surface;
3. placeholder/settings surface.

This should be additive, not a redesign of layout.

- [ ] **Step 4: Run related renderer tests**

Run: `npx vitest run src/renderer/app/App.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/GlobalActivityBar.vue src/renderer/components/AppShell.vue src/renderer/app/App.test.ts
git commit -m "feat: add semantic navigation and shell surface hooks"
```

## Task 4: Strengthen modal and form accessibility contracts

**Files:**
- Modify: `src/renderer/components/primitives/BaseModal.vue`
- Modify: `src/renderer/components/primitives/GlassFormField.vue`
- Modify: `src/renderer/components/command/NewProjectModal.vue`
- Modify: `src/renderer/components/command/NewSessionModal.vue`
- Modify: `src/renderer/components/command/NewProjectModal.test.ts`
- Modify: `src/renderer/components/command/NewSessionModal.test.ts`

- [ ] **Step 1: Write failing semantic modal tests**

Add tests for both modals that assert:
1. the modal is found with `getByRole('dialog', { name: ... })`;
2. fields are found with `getByLabel(...)`;
3. submit/cancel buttons are found with `getByRole('button', { name: ... })`;
4. error messages are announced with `role="alert"` or `aria-live`.

- [ ] **Step 2: Add missing accessible names and focus semantics to `BaseModal.vue`**

Update the modal primitive so that:
1. the close button has an explicit accessible name;
2. opening the modal moves focus into the dialog;
3. closing the modal does not leave focus lost;
4. existing dialog semantics remain intact.

Do not build an elaborate full focus-trap library here; implement the minimal robust behavior needed for keyboard and test semantics.

- [ ] **Step 3: Strengthen `GlassFormField.vue` contract**

Add stable field-level identification without breaking the existing label-wrapping pattern. Acceptable options:
1. generated `id` + `for` linkage;
2. an optional `testId` prop that applies to the concrete input/select;
3. both, if needed.

The primary contract must still be label-based querying.

- [ ] **Step 4: Update project/session modals to use semantic form structure**

Specifically:
1. wrap fields/actions in a real `<form>` where appropriate;
2. use submit buttons with explicit `type`;
3. surface error text with `role="alert"` or `aria-live="assertive"`;
4. preserve the current create/cancel behavior.

- [ ] **Step 5: Rewrite modal tests to prefer semantic queries**

Replace class selectors like `.button-primary` or direct `.form-field__input` lookups with semantic queries as the primary path.

- [ ] **Step 6: Run both modal test files**

Run: `npx vitest run src/renderer/components/command/NewProjectModal.test.ts src/renderer/components/command/NewSessionModal.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/primitives/BaseModal.vue src/renderer/components/primitives/GlassFormField.vue src/renderer/components/command/NewProjectModal.vue src/renderer/components/command/NewSessionModal.vue src/renderer/components/command/NewProjectModal.test.ts src/renderer/components/command/NewSessionModal.test.ts
git commit -m "feat: add semantic dialog and form contracts for command modals"
```

## Task 5: Add terminal-region semantic shell hooks without faking terminal text accessibility

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write failing semantic region tests**

Add tests that assert:
1. empty state region can be found semantically;
2. metadata/details overlay exposes meaningful labels;
3. running terminal shell exposes a stable container hook for Playwright screenshot and buffer-adjacent assertions.

- [ ] **Step 2: Add semantic hooks to `TerminalViewport.vue`**

Update the component so that:
1. the empty state has a stable named region or descriptive text target;
2. the overlay/details area remains semantically structured;
3. the xterm container is labeled as a terminal surface container, without claiming the canvas text itself is accessible.

Do not try to solve canvas accessibility here; this task is only about the surrounding semantic shell.

- [ ] **Step 3: Keep terminal-specific exceptions explicit in tests**

In the updated test file, document that terminal content semantics are validated through data flow and later Playwright buffer hooks, not through `getByRole` on the xterm canvas.

- [ ] **Step 4: Run the terminal test file**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts
git commit -m "feat: add semantic shell hooks around terminal viewport"
```

## Task 6: Verify prerequisite readiness for the test rollout

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md`

- [ ] **Step 1: Add readiness notes for Phase 5 and Phase 6 consumers**

At the top of the rollout plan or before Phase 5, document the dependency explicitly:

```md
Phase 5 and Phase 6 assume the semantic contracts established by `2026-04-21-frontend-semantic-accessibility-enablement.md` are already in place. Do not implement semantic-locator-first tests before this prerequisite is complete.
```

- [ ] **Step 2: Update Phase 5 wording to prefer semantic component queries**

Where Phase 5 currently focuses on data-flow gaps only, add a short note that touched component tests should use semantic queries whenever the prerequisite plan made them available.

- [ ] **Step 3: Update Phase 6 wording to narrow CSS-selector exceptions**

State explicitly that CSS selectors remain acceptable only for:
1. smoke boot-integrity shell checks;
2. terminal/canvas shell containers;
3. documented temporary exceptions.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-21-test-strategy-rollout.md
git commit -m "docs: make semantic frontend enablement a prerequisite for test rollout"
```

---

## Self-Review: Plan Coverage Against Validated Risks and Gaps

### 1. Spec Coverage

| Risk/Gap | Plan Coverage |
|----------|--------------|
| Tier 3/Tier 4 semantic locator policy is advisory only | Task 1: AGENTS.md rule + rollout dependency note |
| Project hierarchy is not semantically queryable | Task 2: hierarchy interaction contract |
| Activity bar buttons lack stable accessible names | Task 3: semantic navigation labels |
| Modal close/actions/error states are under-specified for accessibility | Task 4: modal and form contract upgrade |
| Terminal region lacks stable semantic shell hooks | Task 5: terminal shell semantics without fake canvas accessibility |
| Existing rollout plan does not clearly depend on frontend semantic enablement | Task 6: explicit prerequisite declaration |

### 2. Placeholder Scan

- No TBD, TODO, or deferred placeholders remain.
- Every task names exact files and explicit verification commands.
- The plan distinguishes semantic requirements from terminal/canvas exceptions instead of blurring them.

### 3. Type Consistency

- Component names and file paths match the current renderer structure.
- Locator strategy remains consistent with the validated requirement: semantic-first, CSS exception-only.
- The prerequisite plan is scoped to renderer semantics, not broader unrelated accessibility work.

### 4. Dependency Scope

- This plan is intentionally prerequisite-only.
- It should complete before Phase 5 or Phase 6 of `2026-04-21-test-strategy-rollout.md` begin.
- It does not replace the testing rollout; it enables the rollout to satisfy its semantic-locator claim truthfully.
