# Persistent AI Terminal Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep live `codex`, `opencode`, and `claude-code` terminal sessions mounted in the renderer so session switching and command-surface switching do not recreate their xterm instances.

**Architecture:** Keep `CommandSurface` mounted across top-level surface switches and introduce a session terminal deck that lazily creates one `TerminalViewport` per activated AI session, then hides/shows those stable component instances instead of replacing them. Leave `shell` sessions on the simpler active-session path in this slice.

**Tech Stack:** Vue 3, Composition API with `<script setup>`, Pinia, Vitest, Vue Test Utils, xterm.js

---

### Task 1: Add failing AppShell test for command-surface persistence

**Files:**
- Modify: `src/renderer/components/AppShell.test.ts`
- Test: `src/renderer/components/AppShell.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that mounts `AppShell`, switches from command to archive and back, and asserts the `CommandSurface` component instance remains present rather than being destroyed and recreated.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/AppShell.test.ts`
Expected: FAIL because `AppShell.vue` currently uses `v-if / v-else-if` and unmounts `CommandSurface`.

- [ ] **Step 3: Write minimal implementation**

Change `AppShell.vue` so `CommandSurface` stays mounted and uses visibility classes/attributes instead of conditional rendering for the command surface.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/AppShell.test.ts`
Expected: PASS

### Task 2: Add failing command-surface tests for persistent AI session deck

**Files:**
- Modify: `src/renderer/components/command/CommandSurface.test.ts`
- Create: `src/renderer/components/command/TerminalSessionDeck.test.ts`
- Test: `src/renderer/components/command/CommandSurface.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that:

- switch from AI session A to AI session B and assert both `TerminalViewport` instances still exist
- switch from AI session A to shell session S and assert only the shell active path is used for shell
- keep only the active AI terminal visible

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/command/CommandSurface.test.ts src/renderer/components/command/TerminalSessionDeck.test.ts`
Expected: FAIL because no terminal deck component exists and `CommandSurface` renders only one active `TerminalViewport`.

- [ ] **Step 3: Write minimal implementation**

Create `TerminalSessionDeck.vue` and update `CommandSurface.vue` to render it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/command/CommandSurface.test.ts src/renderer/components/command/TerminalSessionDeck.test.ts`
Expected: PASS

### Task 3: Implement persistent terminal deck component

**Files:**
- Create: `src/renderer/components/command/TerminalSessionDeck.vue`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Test: `src/renderer/components/command/TerminalSessionDeck.test.ts`

- [ ] **Step 1: Implement deck state and stable activated-session cache**

Use `<script setup lang="ts">`, compute AI sessions from hierarchy, keep a `Set`/array of activated AI session ids, and map ids back to `SessionSummary` plus owning `ProjectSummary`.

- [ ] **Step 2: Render one `TerminalViewport` per activated AI session**

Render stable keyed children for activated AI sessions with `v-show`-style visibility and token-based styling only.

- [ ] **Step 3: Keep shell path separate**

Render the existing active-session path for `shell` sessions only, so this slice does not broaden persistence scope unnecessarily.

- [ ] **Step 4: Preserve `openWorkspace` event forwarding**

Forward the child `openWorkspace` event unchanged.

- [ ] **Step 5: Run targeted tests**

Run: `npx vitest run src/renderer/components/command/TerminalSessionDeck.test.ts src/renderer/components/command/CommandSurface.test.ts src/renderer/components/TerminalViewport.test.ts`
Expected: PASS

### Task 4: Regression coverage for top-level surface switching

**Files:**
- Modify: `src/renderer/components/AppShell.test.ts`
- Test: `src/renderer/components/AppShell.test.ts`

- [ ] **Step 1: Add regression test for command-to-settings-to-command persistence**

Assert the command surface remains mounted while hidden and becomes visible again with the same subtree after switching back.

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/AppShell.test.ts`
Expected: PASS

### Task 5: Full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-05-persistent-ai-terminal-deck-design.md` if implementation reality diverges
- Modify: `docs/superpowers/plans/2026-05-05-persistent-ai-terminal-deck.md` only if needed for accuracy

- [ ] **Step 1: Run repository generation/type/unit gates**

Run: `npm run test:generate`
Expected: exit 0

Run: `npm run typecheck`
Expected: exit 0

Run: `npx vitest run`
Expected: exit 0

- [ ] **Step 2: Run end-to-end and behavior coverage gates**

Run: `npm run test:e2e`
Expected: exit 0

Run: `npm run test:behavior-coverage`
Expected: exit 0

- [ ] **Step 3: Confirm objective against real evidence**

Check:

- `AppShell` no longer unmounts `CommandSurface`
- AI-session terminal instances persist across session switches
- shell path remains non-persistent in this slice
- all required gates pass fresh
