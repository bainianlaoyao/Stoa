# Unified Session Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone meta-session architecture with a unified session-tree control plane, renderer, and test suite where all provider-managed sessions can use `stoa-ctl`, subsessions appear in the frontend, and the full repository quality gate passes.

**Architecture:** Extend the existing work-session model with tree lineage fields and a host-derived read model, then route CLI, HTTP control, IPC, and renderer state through one session-supervisor path. Remove the meta-session feature stack instead of adapting it, and rebuild the test/assets surface around `SessionNodeSnapshot`, `SessionGraphEvent`, subtree lifecycle semantics, and session-scoped auth.

**Tech Stack:** TypeScript, Electron main/preload IPC, Vue 3 + Pinia, Vitest, Playwright, Node CLI tooling

---

## File Structure

**Core shared/session model**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/state-store.ts`
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/main/launch-tracked-session-runtime.ts`

**Unified control plane**
- Create: `src/core/session-visibility-service.ts`
- Create: `src/core/session-supervisor.ts`
- Create: `src/core/session-control-server.ts`
- Create: `src/core/session-command-env.ts`
- Create: `src/core/session-bootstrap-prompt-service.ts`
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/main/index.ts`
- Modify: `src/core/stoa-ctl-port-file.ts`
- Modify: `tools/stoa-ctl/index.ts`

**Renderer / preload**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/TerminalSessionDeck.vue`
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Delete or stop referencing: `src/renderer/stores/meta-session.ts`
- Delete or stop referencing: `src/renderer/components/meta-session/*`

**Tests / generated assets**
- Modify: `src/shared/project-session.test.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `src/core/session-runtime.test.ts`
- Create: `src/core/session-visibility-service.test.ts`
- Create: `src/core/session-supervisor.test.ts`
- Create: `src/core/session-control-server.test.ts`
- Create: `src/core/session-command-env.test.ts`
- Create: `src/core/session-bootstrap-prompt-service.test.ts`
- Modify: `tools/stoa-ctl/index.test.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`
- Modify: `tests/e2e/frontend-store-projection.test.ts`
- Modify: `tests/e2e/store-lifecycle-sync.test.ts`
- Create: `tests/e2e/session-tree-lifecycle.test.ts`
- Create: `tests/e2e/session-graph-event-sync.test.ts`
- Replace: `testing/behavior/meta-session.behavior.ts`
- Replace: `testing/topology/meta-session.topology.ts`
- Replace: `testing/journeys/meta-session.journey.ts`
- Modify: `testing/generators/generate-playwright.ts`
- Modify: `testing/generators/generate-playwright.test.ts`
- Modify: `testing/generators/behavior-coverage.test.ts`

### Task 1: Shared Session Tree Contract

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/state-store.ts`
- Modify: `src/shared/project-session.test.ts`

- [ ] **Step 1: Write the failing shared-contract tests**

Add tests for:
- `SessionSummary` lineage fields
- persisted session lineage fields
- session file schema version bump
- `SessionGraphEvent` and `SessionNodeSnapshot` runtime shape

```ts
test('accepts persisted session lineage fields', () => {
  const input = {
    id: 'session-child',
    project_id: 'project-1',
    type: 'codex',
    title: 'child',
    summary: 'Waiting',
    runtime_state: 'created',
    turn_state: 'idle',
    last_turn_outcome: 'none',
    external_session_id: null,
    created_at: '2026-05-29T00:00:00.000Z',
    updated_at: '2026-05-29T00:00:00.000Z',
    last_state_sequence: 0,
    archived: false,
    parent_session_id: 'session-root',
    created_by_session_id: 'session-root',
  }

  expect(isPersistedSession(input)).toBe(true)
})
```

- [ ] **Step 2: Run the focused shared-contract tests to verify RED**

Run: `rtk npx vitest run src/shared/project-session.test.ts`
Expected: FAIL because lineage fields, graph event types, and schema expectations do not exist yet.

- [ ] **Step 3: Implement the minimal shared-contract changes**

Implement:
- additive `parentSessionId` / `createdBySessionId` on runtime summary
- additive `parent_session_id` / `created_by_session_id` on persisted session
- `SessionTreeMeta`, `SessionNodeSnapshot`, `SessionGraphEvent`
- schema version bump in shared types/state-store validator defaults

- [ ] **Step 4: Re-run focused shared-contract tests**

Run: `rtk npx vitest run src/shared/project-session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit task slice**

```bash
git add src/shared/project-session.ts src/core/state-store.ts src/shared/project-session.test.ts
git commit -m "feat: add session tree shared contracts"
```

### Task 2: Project Session Manager Tree Persistence

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Test: `src/shared/project-session.test.ts`

- [ ] **Step 1: Write failing manager tests for tree semantics**

Add tests for:
- child creation under same project
- direct-child-only create semantics at manager boundary
- subtree archive
- subtree restore
- recovery-plan ordering respects parents before descendants

```ts
test('archives a whole session subtree', async () => {
  const manager = await ProjectSessionManager.create({ persist: false })
  const project = await manager.createProject({ path: projectPath })
  const root = await manager.createSession({ projectId: project.id, type: 'codex', title: 'root' })
  const child = await manager.createSession({ projectId: project.id, type: 'codex', title: 'child', parentSessionId: root.id, createdBySessionId: root.id })
  const grandchild = await manager.createSession({ projectId: project.id, type: 'codex', title: 'grandchild', parentSessionId: child.id, createdBySessionId: child.id })

  await manager.archiveSessionSubtree(child.id)

  expect(manager.getSession(child.id)?.archived).toBe(true)
  expect(manager.getSession(grandchild.id)?.archived).toBe(true)
  expect(manager.getSession(root.id)?.archived).toBe(false)
})
```

- [ ] **Step 2: Run manager tests to verify RED**

Run: `rtk npx vitest run src/core/project-session-manager.test.ts`
Expected: FAIL because subtree helpers and lineage-aware create logic do not exist.

- [ ] **Step 3: Implement minimal manager/tree persistence**

Implement:
- mapper support for lineage fields
- additive lineage-aware `createSession`
- subtree archive/restore helpers
- read-model derivation helper for node snapshots
- recovery-plan parent-before-child ordering

- [ ] **Step 4: Re-run manager tests**

Run: `rtk npx vitest run src/core/project-session-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit task slice**

```bash
git add src/core/project-session-manager.ts src/core/project-session-manager.test.ts
git commit -m "feat: persist session tree state"
```

### Task 3: Visibility Service And Runtime Auth

**Files:**
- Create: `src/core/session-visibility-service.ts`
- Create: `src/core/session-visibility-service.test.ts`
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/main/launch-tracked-session-runtime.ts`
- Modify: `src/core/session-runtime.test.ts`

- [ ] **Step 1: Write failing tests for visibility and session token auth**

Add tests for:
- same-depth-plus-descendants visible set
- invisible targets collapse to `unknown_session`
- runtime token registration/invalidation lifecycle
- all provider sessions receive env vars needed for `stoa-ctl`

```ts
test('returns same-depth peers and descendants for visibility scope', () => {
  const service = new SessionVisibilityService(sessionNodes)
  expect(service.visibleSessionIds('session-A')).toEqual(['session-A', 'session-B', 'session-A1'])
})
```

- [ ] **Step 2: Run focused tests to verify RED**

Run: `rtk npx vitest run src/core/session-visibility-service.test.ts src/core/session-runtime.test.ts`
Expected: FAIL because the service and token/env behavior do not exist yet.

- [ ] **Step 3: Implement minimal visibility service and token registry**

Implement:
- visibility and authority calculation service
- runtime-controller ephemeral token registry
- env propagation using existing live session secret as `STOA_CTL_SESSION_TOKEN`

- [ ] **Step 4: Re-run focused tests**

Run: `rtk npx vitest run src/core/session-visibility-service.test.ts src/core/session-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit task slice**

```bash
git add src/core/session-visibility-service.ts src/core/session-visibility-service.test.ts src/main/session-runtime-controller.ts src/core/session-runtime.ts src/main/launch-tracked-session-runtime.ts src/core/session-runtime.test.ts
git commit -m "feat: add session visibility and runtime auth"
```

### Task 4: Unified Control Server And CLI

**Files:**
- Create: `src/core/session-supervisor.ts`
- Create: `src/core/session-supervisor.test.ts`
- Create: `src/core/session-control-server.ts`
- Create: `src/core/session-control-server.test.ts`
- Create: `src/core/session-command-env.ts`
- Create: `src/core/session-command-env.test.ts`
- Create: `src/core/session-bootstrap-prompt-service.ts`
- Create: `src/core/session-bootstrap-prompt-service.test.ts`
- Modify: `src/core/stoa-ctl-port-file.ts`
- Modify: `src/core/ipc-channels.ts`
- Modify: `src/main/index.ts`
- Modify: `tools/stoa-ctl/index.ts`
- Modify: `tools/stoa-ctl/index.test.ts`

- [ ] **Step 1: Write failing tests for supervisor, control routes, and CLI**

Add tests for:
- `whoami` local-user vs session caller
- session create/inspect/prompt/destroy routes
- authority failures for destroy same-depth peer
- CLI command parsing for `session *`
- no `activeMetaSessionId` fallback

```ts
test('session destroy rejects same-depth peer target', async () => {
  const response = await request(server)
    .post('/ctl/session/peer-id/destroy')
    .set('x-stoa-session-id', 'session-a')
    .set('x-stoa-session-token', liveToken)

  expect(response.status).toBe(403)
  expect(response.body.error.code).toBe('forbidden_authority_scope')
})
```

- [ ] **Step 2: Run focused backend/CLI tests to verify RED**

Run: `rtk npx vitest run src/core/session-supervisor.test.ts src/core/session-control-server.test.ts src/core/session-command-env.test.ts src/core/session-bootstrap-prompt-service.test.ts tools/stoa-ctl/index.test.ts`
Expected: FAIL because unified server, CLI, and prompt/env services do not exist yet.

- [ ] **Step 3: Implement minimal unified backend control plane**

Implement:
- session supervisor
- unified control server
- CLI rewrite to `session` commands
- prompt/env services
- `main/index.ts` wiring away from meta-session stack

- [ ] **Step 4: Re-run focused backend/CLI tests**

Run: `rtk npx vitest run src/core/session-supervisor.test.ts src/core/session-control-server.test.ts src/core/session-command-env.test.ts src/core/session-bootstrap-prompt-service.test.ts tools/stoa-ctl/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit task slice**

```bash
git add src/core/session-supervisor.ts src/core/session-supervisor.test.ts src/core/session-control-server.ts src/core/session-control-server.test.ts src/core/session-command-env.ts src/core/session-command-env.test.ts src/core/session-bootstrap-prompt-service.ts src/core/session-bootstrap-prompt-service.test.ts src/core/stoa-ctl-port-file.ts src/core/ipc-channels.ts src/main/index.ts tools/stoa-ctl/index.ts tools/stoa-ctl/index.test.ts
git commit -m "feat: unify session control plane and cli"
```

### Task 5: Renderer Session Tree And Meta-Session Removal

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/TerminalSessionDeck.vue`
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/components/GlobalActivityBar.vue`
- Delete or stop referencing: `src/renderer/stores/meta-session.ts`
- Delete or stop referencing: `src/renderer/components/meta-session/*`
- Test: `src/renderer/stores/workspaces.test.ts`
- Test: `src/renderer/components/command/*.test.ts`
- Test: `src/renderer/app/App.test.ts`

- [ ] **Step 1: Write failing renderer/store/component tests**

Add tests for:
- `upsertSession` inserts unknown child
- recursive hierarchy projection
- parent auto-expand on `kind="created"`
- background child create does not steal active session
- meta-session surface/button removal

```ts
test('upserts unknown child session from graph event', () => {
  const store = useWorkspaceStore()
  store.hydrate(bootstrapWithRootOnly)
  store.applySessionGraphEvent(childCreatedEvent)

  expect(store.projectHierarchy[0].sessions[0].children[0].session.id).toBe('session-child')
})
```

- [ ] **Step 2: Run focused renderer tests to verify RED**

Run: `rtk npx vitest run src/renderer/stores/workspaces.test.ts src/renderer/app/App.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/command/CommandSurface.test.ts src/renderer/components/command/TerminalSessionDeck.test.ts src/renderer/components/AppShell.test.ts src/renderer/components/GlobalActivityBar.test.ts`
Expected: FAIL because store and component tree behavior do not exist yet and meta-session UI still exists.

- [ ] **Step 3: Implement minimal renderer cutover**

Implement:
- preload bridge updates for node snapshots and graph events
- store `upsertSession` and recursive tree projection
- command-surface recursive UI
- active/focus rules for background-created child sessions
- remove meta-session store/surface wiring

- [ ] **Step 4: Re-run focused renderer tests**

Run: `rtk npx vitest run src/renderer/stores/workspaces.test.ts src/renderer/app/App.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/command/CommandSurface.test.ts src/renderer/components/command/TerminalSessionDeck.test.ts src/renderer/components/AppShell.test.ts src/renderer/components/GlobalActivityBar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit task slice**

```bash
git add src/preload/index.ts src/renderer/stores/workspaces.ts src/renderer/app/App.vue src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/CommandSurface.vue src/renderer/components/command/TerminalSessionDeck.vue src/renderer/components/AppShell.vue src/renderer/components/GlobalActivityBar.vue src/renderer/stores/workspaces.test.ts src/renderer/app/App.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts src/renderer/components/command/CommandSurface.test.ts src/renderer/components/command/TerminalSessionDeck.test.ts src/renderer/components/AppShell.test.ts src/renderer/components/GlobalActivityBar.test.ts
git commit -m "feat: render unified session tree"
```

### Task 6: E2E, Behavior Assets, And Full Gate

**Files:**
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`
- Modify: `tests/e2e/frontend-store-projection.test.ts`
- Modify: `tests/e2e/store-lifecycle-sync.test.ts`
- Create: `tests/e2e/session-tree-lifecycle.test.ts`
- Create: `tests/e2e/session-graph-event-sync.test.ts`
- Replace: `testing/behavior/meta-session.behavior.ts`
- Replace: `testing/topology/meta-session.topology.ts`
- Replace: `testing/journeys/meta-session.journey.ts`
- Modify: `testing/generators/generate-playwright.ts`
- Modify: `testing/generators/generate-playwright.test.ts`
- Modify: `testing/generators/behavior-coverage.test.ts`

- [ ] **Step 1: Write failing integration/e2e/behavior tests first**

Add tests for:
- IPC round-trip of new session control methods
- session graph event envelope
- background child session visibility in renderer
- subtree destroy/restore
- same-depth peer prompt allowed but destroy forbidden
- regenerated behavior/topology/journey assets for session tree

- [ ] **Step 2: Run focused integration/e2e tests to verify RED**

Run: `rtk npx vitest run tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts tests/e2e/frontend-store-projection.test.ts tests/e2e/store-lifecycle-sync.test.ts`
Expected: FAIL because contracts, guards, and projections still reflect the old model.

- [ ] **Step 3: Implement remaining integration assets and rewrites**

Implement:
- IPC/e2e rewrites
- behavior/topology/journey replacements
- generator updates

- [ ] **Step 4: Regenerate generated tests**

Run: `rtk npm run test:generate`
Expected: PASS and updated `tests/generated/` artifacts for the session tree flow.

- [ ] **Step 5: Run typecheck and full quality gate**

Run these commands in order:

```bash
rtk npm run typecheck
rtk npx vitest run
rtk npm run test:e2e
rtk npm run test:behavior-coverage
```

Expected: all PASS

- [ ] **Step 6: Commit final integration slice**

```bash
git add tests/e2e testing tests/generated
git commit -m "test: cover unified session tree end to end"
```

## Spec Coverage Check

- Unified session model: Task 1, Task 2
- Subtree lifecycle semantics: Task 2, Task 6
- Visibility and authority scope: Task 3, Task 4, Task 6
- All sessions expose `stoa-ctl`: Task 3, Task 4
- Unified CLI/control plane: Task 4
- Frontend subsession visibility and management: Task 5, Task 6
- Remove meta-session product layer: Task 4, Task 5, Task 6
- Full repository quality gate: Task 6

## Placeholder Scan

No `TODO`, `TBD`, or “similar to above” placeholders are intentionally left in the plan. All tasks point to exact files and concrete verification commands.

## Type Consistency

Planned new names are consistent across tasks:
- `SessionTreeMeta`
- `SessionNodeSnapshot`
- `SessionGraphEvent`
- `SessionVisibilityService`
- `SessionSupervisor`
- `SessionControlServer`
- `SessionCommandEnv`
- `SessionBootstrapPromptService`
