# Workspace Quick Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add active-session workspace quick actions that open the selected session's project directory in VS Code or the operating system file browser.

**Architecture:** Session workspace resolution remains project-based: `session.projectId` resolves to `ProjectSummary.path`. Renderer components emit typed open-workspace events upward; `App.vue` calls a new preload API; the main process validates IPC payloads and launches either Electron `shell.openPath` or a safe VS Code launcher using structured `spawn` arguments.

**Tech Stack:** Electron main/preload IPC, Vue 3 Composition API with `<script setup lang="ts">`, Pinia, TypeScript, Vitest, Playwright behavior assets.

---

## Baseline Note

The initial worktree baseline command `npx vitest run` failed before feature changes:

- `tests/e2e/main-config-guard.test.ts` expects a legacy `IPC_CHANNELS.sessionEvent` push from `SessionRuntimeController`.
- Several PTY/webhook integration tests timed out and `node-pty` reported `AttachConsole failed`.

These failures must be re-evaluated during final verification. If they remain unrelated to this feature, document them before merge; if they block the repository gate, fix the underlying code in this branch.

## File Structure

- Modify `src/shared/project-session.ts`: add workspace open and IDE settings types, default settings, and `RendererApi.openWorkspace`.
- Modify `src/core/ipc-channels.ts`: add `workspaceOpen`.
- Create `src/core/workspace-launcher.ts`: validate workspace open requests, resolve workspace path, open file browser, launch VS Code safely.
- Create `src/core/workspace-launcher.test.ts`: unit tests for validation, path resolution, Electron shell errors, and spawn safety.
- Modify `src/preload/index.ts`: expose `openWorkspace`.
- Modify `src/main/index.ts`: register `workspace:open` handler.
- Create `src/renderer/components/command/WorkspaceQuickActions.vue`: focused UI for the two quick actions.
- Create `src/renderer/components/command/WorkspaceQuickActions.test.ts`: component tests for enabled/disabled state and emitted targets.
- Modify `src/renderer/components/TerminalViewport.vue`: render quick actions above the terminal shell.
- Modify `src/renderer/components/TerminalViewport.test.ts`: assert actions are present only when active project/session exist.
- Modify `src/renderer/components/command/CommandSurface.vue`: forward `openWorkspace`.
- Modify `src/renderer/components/AppShell.vue`: forward `openWorkspace`.
- Modify `src/renderer/app/App.vue`: call `window.stoa.openWorkspace` and set `workspaceStore.lastError` on failure.
- Modify existing AppShell/CommandSurface/App tests to cover propagation and error behavior.
- Modify settings components/tests to add a single-option VS Code IDE setting and executable `pickFile`.
- Modify `tests/e2e/ipc-bridge.test.ts`: fake round trip for `openWorkspace`.
- Modify `tests/e2e/main-config-guard.test.ts`: static guard for RendererApi/preload/main/channel registration.
- Modify `testing/topology/command.topology.ts`: add quick action test ids.
- Modify `testing/behavior/session.behavior.ts` or add `testing/behavior/workspace.behavior.ts`: declare workspace quick access behavior.
- Add or modify journey assets and regenerate generated Playwright specs with `npm run test:generate`.

## Component Map

- `WorkspaceQuickActions.vue`: presentational toolbar. Props: `project`, `session`. Emits: `openWorkspace` with `ide` or `file-manager`.
- `TerminalViewport.vue`: terminal composition surface. It renders `WorkspaceQuickActions` and terminal runtime; it does not call IPC directly.
- `CommandSurface.vue` and `AppShell.vue`: event forwarding only.
- `App.vue`: side-effect owner for renderer-to-preload calls and error state.

## Task 1: Shared Contracts and Launcher Core

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/ipc-channels.ts`
- Create: `src/core/workspace-launcher.ts`
- Create: `src/core/workspace-launcher.test.ts`

- [ ] **Step 1: Write failing launcher tests**

Create `src/core/workspace-launcher.test.ts` with tests for:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectSummary, SessionSummary } from '@shared/project-session'
import { openWorkspace, validateOpenWorkspaceRequest } from './workspace-launcher'

function projectFixture(path: string): ProjectSummary {
  return {
    id: 'project_1',
    name: 'Alpha',
    path,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function sessionFixture(): SessionSummary {
  return {
    id: 'session_1',
    projectId: 'project_1',
    type: 'shell',
    runtimeState: 'alive',
    agentState: 'unknown',
    hasUnseenCompletion: false,
    runtimeExitCode: null,
    runtimeExitReason: null,
    lastStateSequence: 0,
    blockingReason: null,
    title: 'shell-1',
    summary: 'Shell',
    recoveryMode: 'fresh-shell',
    externalSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastActivatedAt: null,
    archived: false
  }
}

describe('workspace launcher', () => {
  test('rejects invalid IPC payloads before resolving state', () => {
    expect(() => validateOpenWorkspaceRequest(null)).toThrow('Invalid workspace open request.')
    expect(() => validateOpenWorkspaceRequest({ sessionId: '', target: 'ide' })).toThrow('Invalid workspace open request.')
    expect(() => validateOpenWorkspaceRequest({ sessionId: 'session_1', target: 'unknown' })).toThrow('Invalid workspace open target.')
  })

  test('opens the project directory through the OS file browser', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-open-'))
    const shellOpenPath = vi.fn().mockResolvedValue('')

    await openWorkspace({
      request: { sessionId: 'session_1', target: 'file-manager' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: { workspaceIde: { id: 'vscode', executablePath: '' } },
      shellOpenPath,
      spawnProcess: vi.fn()
    })

    expect(shellOpenPath).toHaveBeenCalledWith(workspaceDir)
  })

  test('launches VS Code with structured detached spawn options', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'stoa-workspace-code-'))
    const child = { unref: vi.fn() }
    const spawnProcess = vi.fn().mockReturnValue(child)

    await openWorkspace({
      request: { sessionId: 'session_1', target: 'ide' },
      projects: [projectFixture(workspaceDir)],
      sessions: [sessionFixture()],
      settings: { workspaceIde: { id: 'vscode', executablePath: 'code.cmd' } },
      shellOpenPath: vi.fn(),
      spawnProcess
    })

    expect(spawnProcess).toHaveBeenCalledWith('code.cmd', [workspaceDir], expect.objectContaining({
      cwd: workspaceDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    }))
    expect(child.unref).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run launcher tests and verify RED**

Run: `npx vitest run src/core/workspace-launcher.test.ts`

Expected: FAIL because `src/core/workspace-launcher.ts` does not exist and shared settings types do not include `workspaceIde`.

- [ ] **Step 3: Implement shared contracts and launcher**

Update `src/shared/project-session.ts` with:

```ts
export type WorkspaceOpenTarget = 'ide' | 'file-manager'
export type WorkspaceIdeId = 'vscode'

export interface WorkspaceIdeSettings {
  id: WorkspaceIdeId
  executablePath: string
}

export interface OpenWorkspaceRequest {
  sessionId: string
  target: WorkspaceOpenTarget
}
```

Add `workspaceIde: WorkspaceIdeSettings` to `AppSettings`, set `DEFAULT_SETTINGS.workspaceIde` to `{ id: 'vscode', executablePath: '' }`, and add `openWorkspace: (request: OpenWorkspaceRequest) => Promise<void>` to `RendererApi`.

Add `workspaceOpen: 'workspace:open'` to `src/core/ipc-channels.ts`.

Create `src/core/workspace-launcher.ts` with runtime validation, project/session lookup, directory validation, `shell.openPath` handling, and structured spawn.

- [ ] **Step 4: Run launcher tests and verify GREEN**

Run: `npx vitest run src/core/workspace-launcher.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit launcher core**

```bash
git add src/shared/project-session.ts src/core/ipc-channels.ts src/core/workspace-launcher.ts src/core/workspace-launcher.test.ts
git commit -m "feat: add workspace launcher core"
```

## Task 2: IPC Wiring

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/main-config-guard.test.ts`

- [ ] **Step 1: Write failing IPC guard tests**

Update IPC bridge and main config guard tests so they expect:

- `RendererApi.openWorkspace`
- preload `async openWorkspace(...)`
- `IPC_CHANNELS.workspaceOpen === 'workspace:open'`
- `ipcMain.handle(IPC_CHANNELS.workspaceOpen, ...)`

- [ ] **Step 2: Run IPC tests and verify RED**

Run: `npx vitest run tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts`

Expected: FAIL because preload and main do not expose/register `openWorkspace`.

- [ ] **Step 3: Implement IPC wiring**

In preload, invoke `IPC_CHANNELS.workspaceOpen`.

In main, import `openWorkspace` from `@core/workspace-launcher` and register a handler that passes manager snapshot arrays, current settings, `shell.openPath`, and `spawn`.

- [ ] **Step 4: Run IPC tests and verify GREEN**

Run: `npx vitest run tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts`

Expected: PASS or only pre-existing baseline failures clearly unrelated to `workspaceOpen`.

- [ ] **Step 5: Commit IPC wiring**

```bash
git add src/preload/index.ts src/main/index.ts tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts
git commit -m "feat: expose workspace open IPC"
```

## Task 3: Renderer Quick Actions

**Files:**
- Create: `src/renderer/components/command/WorkspaceQuickActions.vue`
- Create: `src/renderer/components/command/WorkspaceQuickActions.test.ts`
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Modify: `src/renderer/components/command/CommandSurface.vue`
- Modify: `src/renderer/components/command/CommandSurface.test.ts`
- Modify: `src/renderer/components/AppShell.vue`
- Modify: `src/renderer/components/AppShell.test.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/app/App.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `WorkspaceQuickActions.test.ts` to assert:

- It does not render actions without both project and session.
- It emits `openWorkspace` with `ide`.
- It emits `openWorkspace` with `file-manager`.
- It uses `workspace.open-ide` and `workspace.open-file-manager` test ids.

- [ ] **Step 2: Run component tests and verify RED**

Run: `npx vitest run src/renderer/components/command/WorkspaceQuickActions.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement component and event propagation**

Create `WorkspaceQuickActions.vue` with `<script setup lang="ts">`, typed props/emits, token-based scoped CSS, and buttons labelled `Open in VS Code` and `Reveal in File Browser`.

Forward `openWorkspace` from `TerminalViewport` to `CommandSurface` to `AppShell` to `App.vue`.

In `App.vue`, clear `workspaceStore.lastError`, call `window.stoa.openWorkspace({ sessionId, target })`, and set `lastError` on rejection.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run: `npx vitest run src/renderer/components/command/WorkspaceQuickActions.test.ts src/renderer/components/TerminalViewport.test.ts src/renderer/components/command/CommandSurface.test.ts src/renderer/components/AppShell.test.ts src/renderer/app/App.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit renderer quick actions**

```bash
git add src/renderer/components/command/WorkspaceQuickActions.vue src/renderer/components/command/WorkspaceQuickActions.test.ts src/renderer/components/TerminalViewport.vue src/renderer/components/TerminalViewport.test.ts src/renderer/components/command/CommandSurface.vue src/renderer/components/command/CommandSurface.test.ts src/renderer/components/AppShell.vue src/renderer/components/AppShell.test.ts src/renderer/app/App.vue src/renderer/app/App.test.ts
git commit -m "feat: add workspace quick actions"
```

## Task 4: Settings Surface

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.vue`
- Modify: `src/renderer/components/settings/GeneralSettings.test.ts`
- Modify related settings store tests if settings default shape requires updates.

- [ ] **Step 1: Write failing settings tests**

Add tests that assert:

- The settings UI displays a single VS Code workspace IDE option.
- Browsing for the executable calls `pickFile`.
- Updating the path writes `workspaceIde` with `id: 'vscode'`.

- [ ] **Step 2: Run settings tests and verify RED**

Run: `npx vitest run src/renderer/components/settings/GeneralSettings.test.ts src/renderer/stores/settings.ts`

Expected: FAIL because the UI does not expose workspace IDE settings.

- [ ] **Step 3: Implement settings UI**

Add a compact token-based settings row for workspace IDE and executable path. Use existing path field/listbox patterns. Do not add unsupported IDE options.

- [ ] **Step 4: Run settings tests and verify GREEN**

Run: `npx vitest run src/renderer/components/settings/GeneralSettings.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit settings**

```bash
git add src/renderer/components/settings/GeneralSettings.vue src/renderer/components/settings/GeneralSettings.test.ts src/renderer/stores/settings.ts src/renderer/stores/update.test.ts src/renderer/stores/workspaces.test.ts
git commit -m "feat: configure workspace IDE"
```

## Task 5: Behavior Assets and Generated Journeys

**Files:**
- Modify: `testing/topology/command.topology.ts`
- Modify or create: `testing/behavior/workspace.behavior.ts`
- Modify or create: `testing/journeys/workspace-quick-access.journey.ts`
- Modify generator tests if required.
- Generated: `tests/generated/playwright/*.generated.spec.ts` via `npm run test:generate`.

- [ ] **Step 1: Write failing behavior/topology/journey tests**

Add tests for the two quick action topology ids and a critical behavior `workspace.quickAccess.open`.

- [ ] **Step 2: Run behavior asset tests and verify RED**

Run: `npx vitest run testing/topology testing/behavior testing/journeys`

Expected: FAIL until new assets are implemented.

- [ ] **Step 3: Implement behavior assets**

Add the topology ids:

- `workspaceOpenIdeButton: 'workspace.open-ide'`
- `workspaceOpenFileManagerButton: 'workspace.open-file-manager'`

Add behavior/journey assets that describe active-session workspace opening and path verification.

- [ ] **Step 4: Regenerate Playwright assets**

Run: `npm run test:generate`

Expected: generated files are updated deterministically.

- [ ] **Step 5: Commit behavior assets**

```bash
git add testing tests/generated package.json
git commit -m "test: model workspace quick access behavior"
```

## Task 6: Final Verification and Merge

**Files:**
- All changed files.

- [ ] **Step 1: Run required gate**

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected: all commands exit 0. If baseline failures remain, fix the underlying code or document why merge is blocked.

- [ ] **Step 2: Review branch diff**

Run:

```bash
git status --short
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: only intentional feature commits and generated outputs.

- [ ] **Step 3: Merge to main from the primary worktree**

Run from `D:\Data\DEV\ultra_simple_panel` after verifying the main worktree has no user changes that would be overwritten:

```bash
git switch main
git merge --no-ff feature/workspace-quick-access
```

Expected: merge succeeds without conflict.

- [ ] **Step 4: Verify main after merge**

Run the required gate again on main:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected: all commands exit 0.
