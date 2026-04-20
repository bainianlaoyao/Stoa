# Terminal Left Rail Style-h Gap Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the command surface left rail closer to the authoritative `style-h` route-column pattern by fixing the remaining structure, density, and metadata gaps without changing unrelated surfaces.

**Architecture:** Keep the current command surface and hierarchy data model, but tighten the left rail DOM and CSS to match the `style-h` route-column language more faithfully. Limit changes to `WorkspaceHierarchyPanel.vue`, `HierarchyNode.vue`, and the left-rail-related sections of `styles.css`, with tests covering the new structure.

**Tech Stack:** Vue 3, TypeScript, Vitest, CSS

---

### Task 1: Add failing tests for the remaining left-rail gaps

**Files:**
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions for all of the following in `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`:

- parent row renders a trailing metadata/time element
- parent row exposes a separate `+ Session` affordance element
- child row no longer requires summary + status pill density to pass the test
- parent row carries a dedicated route-column class hook

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test "src/renderer/components/command/WorkspaceHierarchyPanel.test.ts"`
Expected: FAIL because the current implementation does not yet satisfy all new structure assertions.

- [ ] **Step 3: Write minimal implementation**

Update `WorkspaceHierarchyPanel.vue`, `HierarchyNode.vue`, and left-rail CSS in `styles.css` so the parent row includes trailing meta, a distinct `+ Session` affordance, and a tighter route-column structure closer to `style-h`.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test "src/renderer/components/command/WorkspaceHierarchyPanel.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/HierarchyNode.vue src/renderer/styles.css
git commit -m "fix: align terminal left rail with style-h"
```

### Task 2: Verify the isolated left-rail fix and full renderer safety

**Files:**
- Modify if needed: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify if needed: `src/renderer/components/command/HierarchyNode.vue`
- Modify if needed: `src/renderer/styles.css`

- [ ] **Step 1: Run focused renderer tests**

Run: `corepack pnpm test "src/renderer/components/command/WorkspaceHierarchyPanel.test.ts" "src/renderer/components/AppShell.test.ts" "src/renderer/components/TerminalViewport.test.ts"`
Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run: `corepack pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `corepack pnpm build`
Expected: PASS

- [ ] **Step 4: Run minimal manual QA**

Run: start dev server and verify the left rail shows:

- tighter route-column spacing
- visible parent meta/time slot
- separate `+ Session` affordance
- lighter child-row information density than before

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: verify style-h left rail fix"
```
