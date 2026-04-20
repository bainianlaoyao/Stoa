# Frontend Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the renderer frontend into the latest authoritative hierarchical operator console with a functional Command surface, reachable Queue/Tree placeholders, and tokenized glass styling while preserving existing IPC, Pinia truth model, and xterm terminal lifecycle.

**Architecture:** Keep `App.vue` as the bootstrap/event boundary and move the product shell into dedicated components. Preserve canonical workspace/session truth in the store and shared types, derive hierarchy only in the renderer UI, and keep `TerminalViewport.vue` as the xterm lifecycle owner while wrapping it in new command-surface UI.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, xterm.js, electron-vite

---

### Task 1: Build the top-level app shell

**Files:**
- Create: `src/renderer/components/AppShell.vue`
- Create: `src/renderer/components/GlobalActivityBar.vue`
- Modify: `src/renderer/app/App.vue`
- Test: `src/renderer/components/AppShell.test.ts`

- [ ] **Step 1: Write the failing shell test**

```ts
// src/renderer/components/AppShell.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AppShell from '@renderer/components/AppShell.vue'

describe('AppShell', () => {
  it('shows all top-level activity items and defaults to command view', () => {
    const wrapper = mount(AppShell, {
      props: {
        workspaces: [],
        activeWorkspaceId: null,
        activeWorkspace: null,
        name: '',
        path: '',
        providerId: 'local-shell',
        errorMessage: ''
      }
    })

    const labels = wrapper.findAll('[data-activity-item]').map((node) => node.attributes('data-activity-item'))

    expect(labels).toEqual(['command', 'queue', 'tree', 'settings'])
    expect(wrapper.find('[data-surface="command"]').exists()).toBe(true)
    expect(wrapper.find('[data-surface="queue"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/components/AppShell.test.ts`
Expected: FAIL because `AppShell.vue` does not exist yet.

- [ ] **Step 3: Write minimal shell implementation**

Create `src/renderer/components/AppShell.vue` and `src/renderer/components/GlobalActivityBar.vue` with a local `activeSurface` state defaulting to `command`, rendering four activity items and only the command surface initially. Update `src/renderer/app/App.vue` to render `AppShell` and pass through the current workspace props and handlers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/renderer/components/AppShell.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/AppShell.vue src/renderer/components/GlobalActivityBar.vue src/renderer/app/App.vue src/renderer/components/AppShell.test.ts
git commit -m "feat: add renderer app shell"
```

### Task 2: Add hierarchical command navigation model

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Create: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Create: `src/renderer/components/command/HierarchyNode.vue`
- Test: `src/renderer/stores/workspaces.test.ts`
- Test: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`

- [ ] **Step 1: Write the failing store test for derived hierarchy**

```ts
it('derives hierarchical groups from canonical workspaces without mutating truth state', () => {
  const store = useWorkspaceStore()

  store.hydrate({
    activeWorkspaceId: 'ws_2',
    terminalWebhookPort: 42017,
    workspaces: [
      {
        workspaceId: 'ws_1',
        name: 'infra-control',
        path: 'D:/infra-control',
        providerId: 'opencode',
        status: 'running',
        summary: 'deploy gateway',
        cliSessionId: 'sess_a1',
        isProvisional: false
      },
      {
        workspaceId: 'ws_2',
        name: 'infra-control',
        path: 'D:/infra-control',
        providerId: 'opencode',
        status: 'awaiting_input',
        summary: 'need confirmation',
        cliSessionId: 'sess_a2',
        isProvisional: false
      }
    ]
  })

  expect(store.workspaceHierarchy).toHaveLength(1)
  expect(store.workspaceHierarchy[0]?.children).toHaveLength(2)
  expect(store.activeWorkspace?.workspaceId).toBe('ws_2')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/stores/workspaces.test.ts`
Expected: FAIL because `workspaceHierarchy` does not exist yet.

- [ ] **Step 3: Write the failing hierarchy panel test**

```ts
// src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkspaceHierarchyPanel from '@renderer/components/command/WorkspaceHierarchyPanel.vue'

describe('WorkspaceHierarchyPanel', () => {
  it('renders parent and child rows with the active child selected', () => {
    const wrapper = mount(WorkspaceHierarchyPanel, {
      props: {
        hierarchy: [
          {
            id: 'group-1',
            title: 'infra-control',
            children: [
              { workspaceId: 'ws_1', label: 'deploy gateway', status: 'running', summary: 'running', lastSeen: '1h', active: false },
              { workspaceId: 'ws_2', label: 'need confirmation', status: 'awaiting_input', summary: 'awaiting', lastSeen: '2h', active: true }
            ]
          }
        ]
      }
    })

    expect(wrapper.find('[data-parent-group="group-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-workspace-id="ws_2"]').attributes('data-active')).toBe('true')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: FAIL because component does not exist yet.

- [ ] **Step 5: Write minimal derived hierarchy and panel implementation**

Add a derived `workspaceHierarchy` computed to the store that groups workspaces by `name + path` into parent groups and maps each canonical workspace into a child display node. Then implement `WorkspaceHierarchyPanel.vue` plus `HierarchyNode.vue` to render parent/child rows and emit `select` for child nodes only.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/renderer/stores/workspaces.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/stores/workspaces.ts src/renderer/stores/workspaces.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/HierarchyNode.vue src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
git commit -m "feat: add hierarchical workspace navigation"
```

### Task 3: Adapt the command surface around the persistent terminal

**Files:**
- Create: `src/renderer/components/command/CommandSurface.vue`
- Create: `src/renderer/components/command/TerminalMetaBar.vue`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Test: `src/renderer/components/TerminalViewport.test.ts`
- Test: `src/renderer/components/command/CommandSurface.test.ts`

- [ ] **Step 1: Write the failing command surface test**

```ts
// src/renderer/components/command/CommandSurface.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandSurface from '@renderer/components/command/CommandSurface.vue'

describe('CommandSurface', () => {
  it('renders hierarchy panel and terminal meta for the active workspace', () => {
    const workspace = {
      workspaceId: 'ws_1',
      name: 'infra-control',
      path: 'D:/infra-control',
      providerId: 'opencode',
      status: 'running',
      summary: 'gateway deploy',
      cliSessionId: 'sess_1',
      isProvisional: false,
      providerPort: 42017
    }

    const wrapper = mount(CommandSurface, {
      props: {
        hierarchy: [],
        activeWorkspace: workspace,
        activeWorkspaceId: 'ws_1'
      }
    })

    expect(wrapper.find('[data-command-surface="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('sess_1')
    expect(wrapper.text()).toContain('opencode')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/components/command/CommandSurface.test.ts`
Expected: FAIL because component does not exist yet.

- [ ] **Step 3: Extend terminal test before implementation**

Add a failing assertion in `src/renderer/components/TerminalViewport.test.ts` proving the terminal surface still routes input using the owning workspace ID after a workspace switch.

- [ ] **Step 4: Run terminal test to verify it fails for the new assertion**

Run: `pnpm test src/renderer/components/TerminalViewport.test.ts`
Expected: FAIL if the new behavior is not yet represented.

- [ ] **Step 5: Write minimal command surface implementation**

Create `CommandSurface.vue` that composes `WorkspaceHierarchyPanel` and the terminal area. Add `TerminalMetaBar.vue` for workspace/session/provider/status metadata. Update `TerminalViewport.vue` so it can render cleanly inside the new command surface while preserving the existing `Map<string, Terminal>` and event subscription lifecycle.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/renderer/components/command/CommandSurface.test.ts src/renderer/components/TerminalViewport.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/command/CommandSurface.vue src/renderer/components/command/TerminalMetaBar.vue src/renderer/components/TerminalViewport.vue src/renderer/components/command/CommandSurface.test.ts src/renderer/components/TerminalViewport.test.ts
git commit -m "feat: rebuild command surface around terminal"
```

### Task 4: Add Queue placeholder surface

**Files:**
- Create: `src/renderer/components/inbox/InboxQueueSurface.vue`
- Test: `src/renderer/components/inbox/InboxQueueSurface.test.ts`

- [ ] **Step 1: Write the failing queue placeholder test**

```ts
// src/renderer/components/inbox/InboxQueueSurface.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import InboxQueueSurface from '@renderer/components/inbox/InboxQueueSurface.vue'

describe('InboxQueueSurface', () => {
  it('renders a queue list/detail placeholder shell', () => {
    const wrapper = mount(InboxQueueSurface)

    expect(wrapper.find('[data-queue-list]').exists()).toBe(true)
    expect(wrapper.find('[data-queue-detail]').exists()).toBe(true)
    expect(wrapper.text()).toContain('placeholder')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/components/inbox/InboxQueueSurface.test.ts`
Expected: FAIL because component does not exist yet.

- [ ] **Step 3: Write minimal queue placeholder surface**

Create a reachable Queue surface with a left list lane, right detail lane, placeholder messaging, and a disabled acknowledge action.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/renderer/components/inbox/InboxQueueSurface.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/inbox/InboxQueueSurface.vue src/renderer/components/inbox/InboxQueueSurface.test.ts
git commit -m "feat: add queue placeholder surface"
```

### Task 5: Add Context Tree placeholder surface

**Files:**
- Create: `src/renderer/components/tree/ContextTreeSurface.vue`
- Test: `src/renderer/components/tree/ContextTreeSurface.test.ts`

- [ ] **Step 1: Write the failing tree placeholder test**

```ts
// src/renderer/components/tree/ContextTreeSurface.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContextTreeSurface from '@renderer/components/tree/ContextTreeSurface.vue'

describe('ContextTreeSurface', () => {
  it('renders a tree/detail placeholder shell with file status marks', () => {
    const wrapper = mount(ContextTreeSurface)

    expect(wrapper.find('[data-tree-list]').exists()).toBe(true)
    expect(wrapper.find('[data-tree-detail]').exists()).toBe(true)
    expect(wrapper.text()).toContain('READ')
    expect(wrapper.text()).toContain('MOD')
    expect(wrapper.text()).toContain('NEW')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/components/tree/ContextTreeSurface.test.ts`
Expected: FAIL because component does not exist yet.

- [ ] **Step 3: Write minimal tree placeholder surface**

Create a reachable Tree surface with a left tree lane, right detail lane, static representative rows, and read-only placeholder messaging.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/renderer/components/tree/ContextTreeSurface.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/tree/ContextTreeSurface.vue src/renderer/components/tree/ContextTreeSurface.test.ts
git commit -m "feat: add tree placeholder surface"
```

### Task 6: Replace renderer styling with tokenized glass shell styles

**Files:**
- Modify: `src/renderer/styles.css`
- Optionally Create: `src/renderer/styles/tokens.css`
- Optionally Create: `src/renderer/styles/shell.css`

- [ ] **Step 1: Write semantic rendering assertions before the style rewrite**

Add assertions to existing shell/surface tests for semantic hooks used by the style system, including active activity item, active hierarchy node, placeholder lane containers, and status-dot attributes.

- [ ] **Step 2: Run targeted tests to verify the assertions fail if hooks are missing**

Run: `pnpm test src/renderer/components/AppShell.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/inbox/InboxQueueSurface.test.ts src/renderer/components/tree/ContextTreeSurface.test.ts`
Expected: FAIL if required semantic hooks are not yet present.

- [ ] **Step 3: Write the tokenized style system**

Refactor `src/renderer/styles.css` to use the authoritative design tokens and shell language:

- add `--canvas`, `--surface`, `--surface-solid`, `--text-strong`, `--text`, `--muted`, `--subtle`, `--accent`, `--line`, radius, shadow, `--font-ui`, `--font-mono`
- implement quiet activity bar, premium glass viewport, lighter internal panels, and dark terminal focal surface
- remove or replace existing conflicting hardcoded dark-shell primitives from the rewritten surfaces

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `pnpm test src/renderer/components/AppShell.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/inbox/InboxQueueSurface.test.ts src/renderer/components/tree/ContextTreeSurface.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles.css src/renderer/components/AppShell.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/inbox/InboxQueueSurface.test.ts src/renderer/components/tree/ContextTreeSurface.test.ts
git commit -m "feat: apply tokenized renderer design system"
```

### Task 7: Final verification and manual QA

**Files:**
- Modify if needed: any failing renderer file from prior tasks

- [ ] **Step 1: Run full renderer and project tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Run manual QA in the actual app**

Run: `pnpm dev`

Verify all of the following in the real UI:

- activity bar shows Command, Queue, Tree, Settings
- Command is default active surface
- left command rail is hierarchical, not flat
- selecting a child row changes the active workspace context
- terminal remains usable and still receives data/input correctly
- Queue surface is reachable and renders a stable placeholder shell
- Tree surface is reachable and renders a stable placeholder shell

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: complete renderer frontend rewrite"
```
