---
date: 2026-04-23
topic: testing-paradigms
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Testing Development Paradigms

### Why This Was Gathered
To understand how the project structures, writes, and runs tests across all layers (unit, component, integration, E2E), so future test work follows established conventions.

### Summary
The project uses a **two-tier test strategy**: **Vitest** for all unit/component tests (core logic, Pinia stores, Vue components, pure-function utilities) and **Playwright** for full Electron E2E journey tests. There are **40 unit/component test files** and **5 E2E test files**. Testing is deeply integrated with the Electron + Vue 3 + Pinia + xterm.js stack, with well-established mocking patterns for each domain.

---

### Key Findings

#### 1. Test Framework Stack

| Layer | Framework | Config File | Runner Command |
|-------|-----------|-------------|----------------|
| Unit / Component | Vitest ^3.2.4 | `vitest.config.ts` | `pnpm test` / `pnpm test:watch` |
| E2E | Playwright ^1.59.1 | `playwright.config.ts` | (manual `npx playwright test`) |

Vitest config (`vitest.config.ts:1-20`):
- Uses `happy-dom` as the DOM environment
- Pool: `forks` (not threads — likely for native module compat)
- Excludes `.worktrees/`, `dist/`, `e2e-playwright/`
- Vue plugin enabled via `@vitejs/plugin-vue`
- Path aliases: `@renderer`, `@core`, `@shared`, `@extensions`

Playwright config (`playwright.config.ts:1-18`):
- Test dir: `./tests/e2e-playwright`
- Single worker, no parallelism
- 60s test timeout, 10s expect timeout
- Trace on first retry, screenshots on failure, video retained on failure
- 1 retry on CI only

#### 2. Unit/Component Test Patterns

**a. Pure function tests** (core layer):
- Files: `src/core/state-store.test.ts`, `src/core/shell-command.test.ts`, `src/core/settings-detector.test.ts`, etc.
- Pattern: import functions directly, test with real filesystem (temp dirs) or pure inputs
- Temp dirs created via `mkdtemp()`, cleaned up in `afterEach`
- No mocking framework needed for pure logic
- Example: `src/core/state-store.test.ts:1-102` — creates temp JSON files, writes/reads/validates

**b. Pinia store tests** (renderer state layer):
- Files: `src/renderer/stores/workspaces.test.ts`
- Pattern: `setActivePinia(createPinia())` in `beforeEach`, then exercise store actions and check state
- No component mounting — pure store logic testing
- Example: `src/renderer/stores/workspaces.test.ts:1-293` — hydrate → assert derived state → archive/restore

**c. Vue component tests** (renderer UI layer):
- Files: 30+ component test files in `src/renderer/components/`
- Uses `@vue/test-utils` (`mount()`) with `createPinia()` as global plugin
- Pattern: mock `window.stoa` (the `RendererApi` bridge) in `beforeEach` with `vi.fn()` stubs
- Data-testid convention: `data-activity-item`, `data-surface`, `data-command-surface`, `data-settings-field`, `data-archive-restore`
- ARIA-based assertions: `aria-label`, `aria-current`, `role="region"`, `role="dialog"`
- Test descriptions use behavioral language: "shows all top-level activity items", "switches to archive surface when..."
- Example: `src/renderer/components/AppShell.test.ts:1-194`

**d. xterm.js-heavy component tests** (terminal):
- Files: `src/renderer/components/TerminalViewport.test.ts`, `src/renderer/terminal/xterm-runtime.test.ts`
- Pattern: `vi.mock()` all xterm addon packages (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-unicode11`, `@xterm/addon-web-links`, `@xterm/addon-webgl`)
- Custom mock Terminal class tracks `instances[]`, `writes[]`, `options`
- Uses `vi.useFakeTimers()` for timeout/fallback behavior testing
- Dynamic import (`await import('./TerminalViewport.vue')`) to apply mocks before component loads
- Example: `src/renderer/components/TerminalViewport.test.ts:1-544`

**e. CSS/style guard tests** (static analysis):
- Files: `src/renderer/styles.typography.test.ts`
- Pattern: reads source files as strings, asserts absence of bad patterns (e.g., no `font-size: 10px`, no `font-weight: 300`)
- Example: `src/renderer/styles.typography.test.ts:1-27`

**f. Settings-aware component tests**:
- Files: `src/renderer/components/settings/GeneralSettings.test.ts`
- Pattern: full `window.stoa` mock with all `RendererApi` methods, `attachTo: document.body` for DOM interactions
- Tests user interactions (button clicks, select changes) that call through to the Electron bridge mock
- Example: `src/renderer/components/settings/GeneralSettings.test.ts:1-149`

#### 3. E2E Test Patterns (Playwright + Electron)

**Fixture architecture** (`tests/e2e-playwright/fixtures/electron-app.ts`):
- `launchElectronApp()`: launches Electron from `out/main/index.js`, sets `VIBECODING_E2E=1` env var, creates temp state dir
- Waits for `.app-shell` selector + `[data-surface="command"]` visibility
- Returns `{ electronApp, page, stateDir, close, kill, killAndRelaunch, relaunch }`
- `cleanupStateDir()`: retries removal with EBUSY handling (Windows-specific)
- Debug hooks: `readTerminalBuffer()`, `waitForTerminalDebugHook()`, `getMainE2EDebugState()`, `postWebhookEvent()`

**UI action helpers** (`tests/e2e-playwright/helpers/ui-actions.ts`):
- `createProject()`: clicks "New Project", fills dialog, asserts row visible
- `createSession()`: clicks "Add session", fills dialog, asserts row visible
- `focusTerminalInput()`: waits for `__VIBECODING_TERMINAL_DEBUG__` hook, clicks xterm helper textarea
- `runTerminalCommand()`: types command + Enter into terminal

**Journey patterns**:
- `app-smoke.test.ts`: boot sentinel + empty state checks
- `project-session-journey.test.ts`: create project → create shell/opencode session → verify
- `terminal-journey.test.ts`: terminal I/O, session isolation, visual screenshot regression
- `session-event-journey.test.ts`: session event lifecycle via webhook
- `recovery-journey.test.ts`: kill-and-relaunch, verify session state recovery (shell and opencode)

**E2E conventions**:
- Each test owns its app lifecycle (launch in try, close/cleanup in finally)
- Uses `expect.poll()` for async state queries through main process debug hooks
- Visual regression via `toHaveScreenshot()` with `maxDiffPixels: 400`
- Chinese UI text used in assertions (项目名称, 会话标题, 新建项目, etc.)
- `waitForSessionStatus()` helper polls main process debug state

#### 4. Import & Assertion Conventions

**Imports**:
```typescript
import { describe, expect, test, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
```

**Naming**:
- Test files: co-located with source, `<ComponentOrModule>.test.ts`
- `describe()` blocks: named after the module/component under test
- `test()`/`it()`: behavioral descriptions, not technical ("shows X when Y", "switches to Z when...")

**Assertions**:
- Structural: `wrapper.find('[data-xxx]').exists()`, `toContainText()`
- ARIA: `wrapper.get('button[aria-label="X"]')`, `toHaveAttribute('aria-current', 'true')`
- State: direct property access on Pinia stores
- Emitted events: `wrapper.emitted('eventName')`

#### 5. Test Coverage Map

| Source Directory | Test Files | Count |
|-----------------|------------|-------|
| `src/core/` | state-store, shell-command, webhook-server, webhook-server-validation, app-logger, pty-host, project-session-manager, settings-detector, session-runtime, session-runtime-callbacks | 10 |
| `src/main/` | preload-path, session-event-bridge, session-runtime-controller | 3 |
| `src/shared/` | project-session | 1 |
| `src/renderer/stores/` | workspaces | 1 |
| `src/renderer/components/` | AppShell, TerminalViewport, GlobalActivityBar, WorkspaceList, PanelExtensions, CommandSurface, ArchiveSurface, NewProjectModal, WorkspaceHierarchyPanel, TerminalMetaBar, ProviderFloatingCard, ProviderRadialMenu, GeneralSettings, SettingsSurface, ProvidersSettings, SettingsTabBar, AboutSettings, BaseModal, GlassFormField, ContextTreeSurface, InboxQueueSurface, App | 22 |
| `src/renderer/terminal/` | xterm-runtime | 1 |
| `src/renderer/` | styles.typography | 1 |
| `src/extensions/` | panels/index, providers/opencode-provider | 2 |
| `tests/e2e-playwright/` | app-smoke, project-session-journey, session-event-journey, terminal-journey, recovery-journey | 5 |
| **Total** | | **~46** |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Vitest is the unit test runner | `package.json` | `:16-17,41` |
| Playwright is the E2E runner | `playwright.config.ts` | `:1-18` |
| happy-dom environment for Vitest | `vitest.config.ts` | `:16` |
| Co-located test files pattern | glob `src/**/*.test.ts` | 40 files found |
| Vue Test Utils + Pinia in component tests | `AppShell.test.ts` | `:1-6` |
| xterm.js full mock pattern | `TerminalViewport.test.ts` | `:8-70` |
| Temp dir + real FS pattern for core tests | `state-store.test.ts` | `:1-31` |
| Window.stoa mock pattern for renderer API | `AppShell.test.ts` | `:33-61` |
| CSS static analysis pattern | `styles.typography.test.ts` | `:1-27` |
| Electron launch fixture for E2E | `fixtures/electron-app.ts` | `:66-117` |
| Visual screenshot regression | `terminal-journey.test.ts` | `:131-135` |
| Recovery journey (kill+relaunch) | `recovery-journey.test.ts` | `:36-85` |
| UI action helpers | `helpers/ui-actions.ts` | `:1-59` |
| TypeScript test config | `tsconfig.vitest.json` | `:1-15` |
| `@vue/test-utils` as devDependency | `package.json` | `:34` |

### Risks / Unknowns

- [!] No `coverage` configuration in `vitest.config.ts` — coverage is not tracked or enforced
- [!] No CI/CD configuration visible — test execution in CI is unknown
- [?] Playwright tests require a pre-built Electron app (`out/main/index.js` must exist before running)
- [?] No test script for Playwright in `package.json` — E2E must be run manually
- [!] `pool: 'forks'` in Vitest config suggests potential native module compatibility concerns (node-pty, electron)
- [!] Chinese UI text in test assertions may cause encoding issues depending on system locale
