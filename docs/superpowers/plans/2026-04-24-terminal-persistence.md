# Terminal Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the command surface keep the primary xterm mounted for every existing session state so status changes never replace the terminal viewport.

**Architecture:** Remove status-driven terminal/overlay branching from `TerminalViewport.vue`, keep terminal lifecycle tied to session identity and font settings only, and surface session metadata through a non-destructive status bar. Update tests and AI-first behavior/topology assets so any future regression fails in unit and generated coverage.

**Tech Stack:** Vue 3 SFCs, Vitest, Playwright, testing contract assets

---

### Task 1: Lock the regression with failing tests

**Files:**
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
- Modify: `testing/topology/terminal.topology.ts`

- [ ] **Step 1: Add terminal persistence assertions for non-running statuses**

```ts
test.each(['needs_confirmation', 'exited'] as const)(
  'keeps xterm mounted for %s sessions',
  async (status) => {
    const wrapper = mount(TerminalViewport, {
      props: {
        project: baseProject,
        session: { ...baseSession, status },
      },
    })

    await flushTerminal()

    expect(wrapper.find('[data-testid="terminal-xterm"]').exists()).toBe(true)
  }
)
```

- [ ] **Step 2: Remove overlay topology contract**

```ts
export const terminalTopology = defineTopology({
  surface: 'terminal',
  testIds: {
    viewport: 'terminal-viewport',
    xterm: 'terminal-xterm',
    shell: 'terminal-shell',
    xtermMount: 'terminal-xterm-mount',
    statusBar: 'terminal-status-bar',
    emptyState: 'terminal-empty-state'
  }
})
```

- [ ] **Step 3: Run focused tests and confirm they fail first**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts testing/topology/terminal.topology.test.ts`
Expected: `TerminalViewport` fails because `needs_confirmation` / `exited` still render the old non-terminal branch.

### Task 2: Replace destructive viewport branching with persistent terminal UI

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`

- [ ] **Step 1: Keep terminal mount keyed by session identity instead of status**

```ts
const hasSession = computed(() => Boolean(props.project && props.session))

watch(
  [() => props.session?.id ?? null, () => settingsStore.terminalFontSize],
  ([sessionId]) => {
    disposeTerminal()
    if (sessionId) {
      scheduleTerminalSetup()
    }
  }
)
```

- [ ] **Step 2: Render a non-destructive status bar above the terminal**

```vue
<template v-if="project && session">
  <div class="terminal-viewport__xterm" data-testid="terminal-xterm">
    <div class="terminal-viewport__shell" data-testid="terminal-shell">
      <header class="terminal-viewport__status-bar" data-testid="terminal-status-bar">
        <div class="terminal-viewport__status-copy">
          <p class="terminal-viewport__session-title">{{ session.title }}</p>
          <p class="terminal-viewport__session-summary">{{ session.summary }}</p>
        </div>
        <div class="terminal-viewport__status-meta">
          <span>{{ session.type }}</span>
          <span>{{ session.status }}</span>
        </div>
      </header>
      <div ref="terminalContainer" class="terminal-viewport__xterm-mount" data-testid="terminal-xterm-mount" />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add `needs_confirmation` visual treatment in the hierarchy rail**

```css
.route-dot.awaiting_input,
.route-dot.turn_complete,
.route-dot.awaiting,
.route-dot.degraded,
.route-dot.needs_confirmation {
  background: var(--color-warning);
}
```

- [ ] **Step 4: Run focused tests again**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: PASS

### Task 3: Update behavior assets and verify the repo gate

**Files:**
- Modify: `testing/behavior/session.behavior.ts`
- Modify: `testing/behavior/session.behavior.test.ts`
- Modify: `testing/journeys/session-telemetry.journey.ts`
- Modify: `testing/journeys/session-telemetry.journey.test.ts`
- Modify: `tests/e2e-playwright/recovery-journey.test.ts`

- [ ] **Step 1: Add permission-confirmation persistence coverage**

```ts
expects: [
  'session.status=needs_confirmation',
  'terminal.liveSessionPreserved',
  'command.sessionStatusVisible',
  'persisted.sessionStatusUpdated'
]
```

- [ ] **Step 2: Update Playwright assertions to require xterm for restored sessions**

```ts
await expect(terminalViewport.getByTestId('terminal-xterm')).toBeVisible()
await expect(terminalViewport.getByTestId('terminal-status-bar')).toBeVisible()
```

- [ ] **Step 3: Run the full quality gate**

Run:
- `npm run test:generate`
- `npm run typecheck`
- `npx vitest run`
- `npm run test:e2e`
- `npm run test:behavior-coverage`

Expected: all commands exit `0`.
