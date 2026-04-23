# Terminal Outer Shell Padding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reintroduce responsive terminal breathing room with an outer visual shell while keeping xterm geometry unchanged.

**Architecture:** Add a shell wrapper around the live terminal mount in `TerminalViewport.vue`, keep the xterm mount edge-to-edge inside that shell, and move the shell spacing to a shared design token in `styles.css`. Lock the behavior with focused component tests that verify the wrapper structure and preserve the no-padding-on-`.xterm` rule.

**Tech Stack:** Vue 3, scoped component CSS, xterm.js, Vitest, shared CSS design tokens

---

### Task 1: Lock the new terminal shell structure in tests

**Files:**
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Test: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions that the running terminal renders a new `.terminal-viewport__shell` wrapper and that the xterm mount lives inside that wrapper.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`
Expected: FAIL because `.terminal-viewport__shell` does not exist yet.

- [ ] **Step 3: Implement the minimal structure**

Update `TerminalViewport.vue` to insert the shell wrapper between `.terminal-viewport__xterm` and `.terminal-viewport__xterm-mount`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`
Expected: PASS for the new shell structure assertions.

### Task 2: Add responsive shell spacing without touching xterm geometry

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/styles.css`
- Test: `src/renderer/components/TerminalViewport.test.ts`

- [ ] **Step 1: Write the failing test**

Add an assertion that `.terminal-viewport__xterm-shell` does not return and that `.xterm` remains the direct xterm surface class, preserving the geometry-safe layout expectation around the mount.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`
Expected: FAIL until the new shell class names and structure match the updated assertions.

- [ ] **Step 3: Write minimal implementation**

Add a shared token like `--terminal-shell-gap: clamp(10px, 1.4vw, 18px);` in `src/renderer/styles.css`, then style `.terminal-viewport__shell` in `TerminalViewport.vue` to:
- apply responsive padding from the token
- keep the outer dark shell look aligned with terminal tokens
- keep `.terminal-viewport__xterm-mount` free of padding
- keep `.xterm` and `.xterm-viewport` free of layout padding

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts src/renderer/terminal/xterm-runtime.test.ts`
Expected: PASS

### Task 3: Run the repository quality gate

**Files:**
- Verify only

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: PASS with zero unexpected failures.
