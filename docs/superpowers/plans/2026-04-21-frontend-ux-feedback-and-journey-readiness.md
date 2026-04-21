# Frontend UX Feedback and Journey Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the renderer expose real user-facing feedback, resilience cues, and journey-ready state transitions so Tier 3 and Tier 4 tests can validate perceived UX instead of only internal state changes.

**Architecture:** This is a prerequisite UX-contract pass, not a backend/runtime rewrite. It adds explicit pending/loading states, dismissal guards, visible recovery messaging, and long-journey-friendly renderer affordances around existing project/session flows. The outcome is a frontend that can be tested for responsiveness, visibility, obscuration, recovery clarity, and end-to-end journey continuity using meaningful assertions rather than inferred state.

**Tech Stack:** Vue 3, TypeScript, Pinia, existing renderer components, @vue/test-utils, Vitest, Playwright (consumer of this plan, not implemented here).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/stores/workspaces.ts` | Modify | Add pending/loading/recovery-facing UI state used by create flows and recovery messaging |
| `src/renderer/app/App.vue` | Modify | Drive pending lifecycle for project/session creation and keep modals open until success/failure is resolved |
| `src/renderer/components/primitives/BaseModal.vue` | Modify | Support non-dismissible pending mode and block accidental close during active operations |
| `src/renderer/components/command/NewProjectModal.vue` | Modify | Show create-project pending feedback, disabled states, and visible error continuity |
| `src/renderer/components/command/NewSessionModal.vue` | Modify | Show create-session pending feedback, disabled states, and visible error continuity |
| `src/renderer/components/TerminalViewport.vue` | Modify | Render clearer starting/recovery/exited states and visible UX-friendly lifecycle messaging |
| `src/renderer/components/AppShell.vue` | Modify | Surface journey-level pending cues where appropriate (active surface, queue state, recovery visibility) |
| `src/renderer/components/command/NewProjectModal.test.ts` | Modify | Assert loading/disabled/error behavior and modal blocking semantics |
| `src/renderer/components/command/NewSessionModal.test.ts` | Modify | Assert loading/disabled/error behavior and modal blocking semantics |
| `src/renderer/components/TerminalViewport.test.ts` | Modify | Assert starting/recovery/exited overlays and visible UX messaging |
| `src/renderer/app/App.test.ts` | Modify | Assert pending lifecycle, modal persistence on error, and store-driven feedback transitions |
| `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md` | Modify | Declare this plan as an explicit prerequisite for Phase 5 and Phase 6 |

---

## Completion Contract

This prerequisite plan is complete only when all of the following are true:

1. Creating a project or session exposes a visible pending/loading state.
2. Submit controls become disabled during active creation work and cannot be double-triggered.
3. Modals do not silently disappear before async success/failure is known.
4. Errors remain visible in context instead of appearing only after the modal has already closed.
5. Non-running session states such as `starting`, `bootstrapping`, `exited`, and recovery-related states expose visibly distinct UX cues.
6. Renderer-visible recovery messaging exists so resilience tests can assert what the user sees after restart.
7. Tier 3 and Tier 4 plans can write pending-state, visibility, and long-journey assertions against real UI feedback rather than imagined future states.

---

## Task 1: Add explicit pending state to workspace store and app flow

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/app/App.vue`

- [ ] **Step 1: Write failing state-management tests for create pending flows**

Add tests that express the intended UX contract:

```typescript
it('tracks project creation pending state until createProject resolves', async () => {
  const store = useWorkspaceStore()
  store.beginProjectCreate()
  expect(store.isCreatingProject).toBe(true)
  store.finishProjectCreate()
  expect(store.isCreatingProject).toBe(false)
})

it('tracks session creation pending state until createSession resolves', async () => {
  const store = useWorkspaceStore()
  store.beginSessionCreate('project-1')
  expect(store.isCreatingSession).toBe(true)
  expect(store.pendingSessionProjectId).toBe('project-1')
  store.finishSessionCreate()
  expect(store.isCreatingSession).toBe(false)
})
```

- [ ] **Step 2: Add pending flags and helpers to `workspaces.ts`**

Extend the store with dedicated UI-facing state such as:
1. `isCreatingProject`
2. `isCreatingSession`
3. `pendingSessionProjectId`
4. optional `pendingMessage`

Also add explicit helpers like:
1. `beginProjectCreate()` / `finishProjectCreate()`
2. `beginSessionCreate(projectId)` / `finishSessionCreate()`

Do not overload `lastError` to represent pending state.

- [ ] **Step 3: Update `App.vue` to drive pending lifecycle correctly**

Change the create flow so that:
1. pending starts before the async IPC call;
2. pending ends only after success or failure;
3. create handlers no longer rely on the child modal closing optimistically before the async result is known;
4. success closes the modal intentionally;
5. failure keeps the modal open and preserves the visible error context.

- [ ] **Step 4: Run app/store tests**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts src/renderer/app/App.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/workspaces.ts src/renderer/app/App.vue src/renderer/stores/workspaces.test.ts src/renderer/app/App.test.ts
git commit -m "feat: add pending lifecycle state for project and session creation"
```

## Task 2: Make create modals visibly responsive during async work

**Files:**
- Modify: `src/renderer/components/primitives/BaseModal.vue`
- Modify: `src/renderer/components/command/NewProjectModal.vue`
- Modify: `src/renderer/components/command/NewSessionModal.vue`
- Modify: `src/renderer/components/command/NewProjectModal.test.ts`
- Modify: `src/renderer/components/command/NewSessionModal.test.ts`

- [ ] **Step 1: Write failing modal responsiveness tests**

Add tests that assert:
1. clicking create immediately disables submit and cancel controls while pending;
2. the submit button text changes to something like `创建中...` or `启动中...`;
3. the modal cannot be dismissed via overlay click or Escape while pending;
4. on failure, the modal remains open and shows the error inline.

Use concrete assertions such as:

```typescript
expect(screen.getByRole('button', { name: '创建中...' })).toBeDisabled()
expect(screen.getByRole('dialog', { name: '新建会话' })).toBeVisible()
```

- [ ] **Step 2: Add a non-dismissible pending mode to `BaseModal.vue`**

Introduce a prop such as `dismissible?: boolean` or `busy?: boolean` so the modal can:
1. ignore overlay click while busy;
2. ignore Escape while busy;
3. optionally disable the close button while busy.

Do not silently trap the user forever; this behavior is only for active async work.

- [ ] **Step 3: Add visible pending UI to both modals**

Update `NewProjectModal.vue` and `NewSessionModal.vue` so that:
1. they accept pending state from the parent/store;
2. submit buttons change label during pending;
3. submit and cancel actions become disabled during pending;
4. field inputs become read-only or disabled during pending where appropriate;
5. the modal closes only on confirmed success, not on optimistic submit.

- [ ] **Step 4: Keep error continuity visible**

Ensure that failed creation leaves the modal open with the current field values intact so the user can fix the issue without re-entering everything.

- [ ] **Step 5: Run modal test files**

Run: `npx vitest run src/renderer/components/command/NewProjectModal.test.ts src/renderer/components/command/NewSessionModal.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/primitives/BaseModal.vue src/renderer/components/command/NewProjectModal.vue src/renderer/components/command/NewSessionModal.vue src/renderer/components/command/NewProjectModal.test.ts src/renderer/components/command/NewSessionModal.test.ts
git commit -m "feat: add visible pending and error continuity to create modals"
```

## Task 3: Add visible session lifecycle and recovery messaging

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write failing lifecycle-feedback tests**

Add tests that distinguish what the user sees for at least these states:
1. `starting`
2. `bootstrapping`
3. `running`
4. `exited`
5. recovery-related post-relaunch states

The tests should assert different visible text or affordances, not only that a generic overlay exists.

- [ ] **Step 2: Replace the binary running/not-running overlay contract**

Update `TerminalViewport.vue` so it no longer treats all non-running states the same. At minimum:
1. `starting` / `bootstrapping` show a visible progress or waiting message;
2. `exited` shows a clear exited summary;
3. recovery states surface a visible message like `会话已恢复` or equivalent recovery cue;
4. the running terminal remains visually distinct from status overlays.

- [ ] **Step 3: Preserve terminal-specific exceptions**

Do not pretend xterm canvas text is semantically accessible. The goal is to expose visible shell feedback around the terminal, not to fake terminal internals.

- [ ] **Step 4: Run the terminal test file**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts
git commit -m "feat: add visible lifecycle and recovery feedback to terminal viewport"
```

## Task 4: Add visibility and obscuration-friendly modal/surface behavior

**Files:**
- Modify: `src/renderer/components/primitives/BaseModal.vue`
- Modify: `src/renderer/components/AppShell.vue`
- Modify: relevant component tests if needed

- [ ] **Step 1: Write failing visibility/obscuration assertions**

Add tests that capture user-perceived modal behavior:
1. when the modal is open, the dialog is visible;
2. background primary actions cannot be triggered through the overlay;
3. closing and reopening restores expected focus and interaction targets.

- [ ] **Step 2: Strengthen modal overlay behavior**

Ensure the overlay truly blocks background interaction from the user's perspective. This may include:
1. keeping the modal overlay above the shell consistently;
2. ensuring click-through does not occur;
3. keeping focus semantics coherent while the modal is active.

- [ ] **Step 3: Add stable visual state hooks for key surfaces**

Add or preserve stable hooks around:
1. modal visibility;
2. command surface visibility;
3. empty-state vs active-session transitions.

These hooks are for UX-state assertions, not as a replacement for semantic locators.

- [ ] **Step 4: Run affected component tests**

Run: `npx vitest run src/renderer/components/primitives/BaseModal.test.ts src/renderer/components/AppShell.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/primitives/BaseModal.vue src/renderer/components/AppShell.vue src/renderer/components/primitives/BaseModal.test.ts src/renderer/components/AppShell.test.ts
git commit -m "feat: harden modal visibility and surface interaction contracts"
```

## Task 5: Prepare one long-chain UX journey contract for Playwright consumers

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md`
- Modify: `src/renderer/app/App.test.ts`

- [ ] **Step 1: Write a failing app-level journey-oriented unit/integration test**

Add a compact renderer-side test that covers a mini journey:
1. bootstrap empty state;
2. create project request begins;
3. pending state appears;
4. create completes;
5. session lifecycle update changes visible renderer state.

This is not the final Playwright mega-journey. It exists to prove the renderer now supports such a journey coherently.

- [ ] **Step 2: Update the rollout plan to require at least one full long-chain Playwright journey**

Add an explicit requirement in Phase 6 that one E2E file must chain together:
1. empty-state startup;
2. project creation;
3. session creation;
4. terminal interaction;
5. webhook or session-event transition;
6. interruption/recovery verification.

Call out `test.step()` explicitly as the required structure for this long journey.

- [ ] **Step 3: Add timeout/retry guidance for long journeys**

In the rollout plan, require:
1. no `waitForTimeout()` usage;
2. condition-based waits only;
3. `test.step()` decomposition;
4. realistic timeout expectations for Electron startup and recovery.

- [ ] **Step 4: Run the app test file**

Run: `npx vitest run src/renderer/app/App.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app/App.test.ts docs/superpowers/plans/2026-04-21-test-strategy-rollout.md
git commit -m "docs: require journey-driven Playwright coverage and renderer feedback readiness"
```

## Task 6: Declare this plan as a formal prerequisite in the rollout

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-test-strategy-rollout.md`

- [ ] **Step 1: Add explicit prerequisite notice at the top of the rollout plan**

Add:

```md
> **Prerequisite:** Complete `docs/superpowers/plans/2026-04-21-frontend-ux-feedback-and-journey-readiness.md` before implementing Phase 5 or Phase 6 assertions that depend on visible pending states, obscuration guarantees, recovery messaging, or long-chain user journeys.
```

- [ ] **Step 2: Update Phase 5 and Phase 6 dependency notes**

State explicitly that:
1. Phase 5 pending-state assertions assume this prerequisite is complete;
2. Phase 6 visual/perceptual, recovery-messaging, and long-chain journey assertions assume this prerequisite is complete.

- [ ] **Step 3: Update plan self-review risk coverage**

Add a new risk line covering:
`Pending-state and journey-readiness UX contract not yet enforceable` → this prerequisite plan.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-21-test-strategy-rollout.md
git commit -m "docs: add UX feedback prerequisite for advanced Playwright assertions"
```

---

## Self-Review: Plan Coverage Against Validated Risks and Gaps

### 1. Spec Coverage

| Risk/Gap | Plan Coverage |
|----------|--------------|
| No visible pending state during async create flows | Task 1 + Task 2 |
| Modal closes before async failure is knowable to the user | Task 1 + Task 2 |
| No disabled/loading affordances preventing double submit | Task 2 |
| Terminal viewport treats all non-running states the same | Task 3 |
| Recovery state is visible only as raw metadata, not UX messaging | Task 3 |
| Obscuration/click-through modal guarantees are not testable as UX assertions | Task 4 |
| No explicit long-chain journey contract for Playwright | Task 5 |
| Test rollout plan does not yet depend on UX feedback readiness | Task 6 |

### 2. Placeholder Scan

- No TBD, TODO, or vague "handle loading" placeholders remain.
- Every task names exact files and explicit verification commands.
- The plan distinguishes renderer UX feedback work from the later Playwright/Vitest consumers of that work.

### 3. Type Consistency

- Store-level pending flags remain separate from existing persisted project/session summaries.
- Recovery UX messaging is scoped to renderer presentation and does not change backend recovery semantics.
- The plan complements, rather than overlaps with, the semantic accessibility prerequisite plan.

### 4. Dependency Scope

- This plan is a prerequisite enablement layer for advanced UX assertions.
- It should complete before the pending-state, visual/perceptual, and long-chain journey parts of Phase 5 and Phase 6 are implemented.
- It does not replace the semantic accessibility prerequisite; both plans are inputs to the final test rollout.
