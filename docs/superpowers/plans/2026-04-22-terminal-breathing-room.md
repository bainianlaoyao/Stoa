# Terminal Breathing Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tokenized inner gutter to the running terminal so terminal text no longer sits against the black frame.

**Architecture:** Keep `TerminalViewport.vue` as the single terminal renderer entrypoint, but split the running terminal mount into an outer dark shell and an inner xterm mount. Add terminal spacing tokens in `src/renderer/styles.css`, lock the structure with `TerminalViewport.test.ts`, then verify the full Vitest suite.

**Tech Stack:** Vue 3, TypeScript, xterm.js, Vitest, happy-dom

---

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/components/TerminalViewport.test.ts` | TDD for the new running-state shell and mount structure |
| `src/renderer/components/TerminalViewport.vue` | Running-state terminal DOM structure and scoped styling |
| `src/renderer/styles.css` | Shared terminal spacing tokens |

### Task 1: Lock the new running terminal structure with tests

**Files:**
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Write the failing test**

Add assertions to the existing running-state test so the new shell structure is required before implementation.

```ts
test('mounts xterm shell and inner mount when session is running', async () => {
  const { default: TerminalViewport } = await import('./TerminalViewport.vue')
  const wrapper = mount(TerminalViewport, {
    props: { project: baseProject, session: baseSession },
  })
  await nextTick()
  await nextTick()

  expect(wrapper.find('.terminal-viewport__xterm').exists()).toBe(true)
  expect(wrapper.find('.terminal-viewport__xterm-shell').exists()).toBe(true)
  expect(wrapper.find('.terminal-viewport__xterm-mount').exists()).toBe(true)
  expect(wrapper.find('.terminal-viewport__overlay').exists()).toBe(false)
})
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: FAIL because `.terminal-viewport__xterm-shell` and `.terminal-viewport__xterm-mount` do not exist yet.

- [ ] **Step 3: Implement the minimal running-state structure**

Update the template so xterm mounts inside a dedicated shell and inner mount node.

```vue
<div v-if="isRunning" class="terminal-viewport__xterm">
  <div class="terminal-viewport__xterm-shell">
    <div ref="terminalContainer" class="terminal-viewport__xterm-mount" />
  </div>
</div>
```

Add terminal spacing tokens in `src/renderer/styles.css`.

```css
:root {
  --terminal-shell-padding: 16px;
  --terminal-content-padding: 10px;
}
```

Update scoped terminal styles to use the new layers.

```css
.terminal-viewport__xterm {
  height: 100%;
  width: 100%;
  border-radius: var(--radius-sm);
  background: var(--terminal-bg);
  overflow: hidden;
}

.terminal-viewport__xterm-shell {
  height: 100%;
  width: 100%;
  padding: var(--terminal-shell-padding);
}

.terminal-viewport__xterm-mount {
  height: 100%;
  width: 100%;
}

.terminal-viewport__xterm-mount :deep(.xterm) {
  height: 100%;
  padding: var(--terminal-content-padding);
}
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts`

Expected: PASS

### Task 2: Verify the full suite

**Files:**
- Modify: any touched terminal files only if regressions are found

- [ ] **Step 1: Run the full Vitest suite**

Run: `npx vitest run`

Expected: PASS with zero unexpected failures, except the known intentional `sandbox: false` guard failure if it is still present in this branch.

- [ ] **Step 2: Review final diff**

Confirm the diff only introduces:

- tokenized terminal spacing
- running-state shell + mount structure
- updated terminal component tests

No compatibility code, migration code, or unrelated UI redesign should be included.
