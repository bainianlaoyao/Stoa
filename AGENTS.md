# AGENTS.md

## Global Instruction

All agents and contributors working in this repository must treat `docs/engineering/design-language.md` as a global visual and frontend constraint.

That file defines the authoritative design language for this project.

## Required Rule

For any UI, frontend, preview, or visual implementation work:

- Read and follow `docs/engineering/design-language.md`
- Do not introduce conflicting visual language unless the user explicitly requests it
- Do not hardcode visual primitives that should come from shared design tokens
- Preserve the project's Modern Minimalist Glassmorphism + Clean UI direction

## Priority

If a task touches styling, layout, panels, controls, previews, or renderer-facing components, the design-language document is a hard constraint, not a suggestion.

Only direct user instruction can override it.

不允许写任何兼容性代码, 做任何兼容性迁移行为. 我们处于原型开发阶段.所有改进做breaking change.

## Quality Gate — E2E Tests Must Pass

No implementation is considered complete until `npx vitest run` passes with **zero unexpected failures**.

### Mandatory Test Commands

```bash
# Run the full test suite (must be executed after any code change)
npx vitest run
```

### Quality Compliance Rules

1. **All tests must pass.** If a test fails, the implementation is not done. Fix the code, not the test.
2. **The sandbox: false guard test is a known intentional failure** tracking a real production bug (`tests/e2e/main-config-guard.test.ts`). This is the ONLY acceptable failing test. Once the bug is fixed, this test must pass too.
3. **Do not delete or skip failing tests** to make the suite green. Fix the underlying code.
4. **Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`** in any test file.

### Test Architecture

The test suite is organized in three tiers. Every tier must pass independently:

#### Tier 1: Unit Tests (`src/**/*.test.ts`)

Direct tests for individual modules with isolated mocks. Fast, no file system side effects.

- `src/core/project-session-manager.test.ts` — Project/session CRUD, recovery plans
- `src/core/state-store.test.ts` — JSON persistence read/write
- `src/core/webhook-server.test.ts` — HTTP endpoint acceptance
- `src/core/webhook-server-validation.test.ts` — All event validation rejection branches
- `src/core/session-runtime.test.ts` — Resume vs fresh-start command selection
- `src/core/session-runtime-callbacks.test.ts` — onData/onExit callbacks, default values, canResume branches
- `src/core/pty-host.test.ts` — PTY spawn, write, resize boundaries, dispose, exit cleanup
- `src/core/app-logger.test.ts` — Log file writing
- `src/main/preload-path.test.ts` — Preload path resolution, webPreferences config
- `src/extensions/providers/opencode-provider.test.ts` — OpenCode command building
- `src/extensions/panels/index.test.ts` — Panel registry
- `src/renderer/stores/workspaces.test.ts` — Pinia store hydrate/hierarchy/active cascading
- `src/renderer/app/App.test.ts` — Root component bootstrap/IPC mock/error handling
- `src/renderer/components/**/*.test.ts` — All Vue component tests

#### Tier 2: E2E Integration Tests (`tests/e2e/*.test.ts`)

Full pipeline tests using real file system, real HTTP requests, real Pinia stores. No module-level mocks except for Electron IPC.

- `tests/e2e/backend-lifecycle.test.ts` — Fresh start → multi-project → session CRUD → state persistence → restart recovery → webhook server → session runtime → provider commands
- `tests/e2e/frontend-store-projection.test.ts` — Real backend → Pinia hydrate → computed properties → active cascading → store-backend consistency
- `tests/e2e/error-edge-cases.test.ts` — Duplicate paths, orphan sessions, state corruption recovery, concurrent managers, rapid operations, path normalization
- `tests/e2e/provider-integration.test.ts` — Provider registry, command building, environment variables, sidecar file writing with real disk verification
- `tests/e2e/ipc-bridge.test.ts` — Simulated FakeIpcBus round-trip: renderer → preload → ipcMain → manager → response
- `tests/e2e/app-bridge-guard.test.ts` — App.vue behavior when window.vibecoding is undefined/partially defined/null responses
- `tests/e2e/main-config-guard.test.ts` — Static analysis: sandbox:false presence, IPC channel registration completeness, preload type contract

#### Tier 3: Config Guard Tests (static analysis)

Source-code text analysis that catches configuration drift. These tests read source files as strings and verify structural correctness — they catch bugs that runtime tests miss because the runtime never loads Electron.

- WebPreferences must include `sandbox: false`
- IPC handler registration must use `IPC_CHANNELS` constants (not hardcoded strings)
- Preload must expose exactly the methods defined in `RendererApi`
- Channel names must match between preload and main process

### When Adding New Code

- **New core module** → Add unit test in `src/core/`
- **New Vue component** → Add component test alongside it in `src/renderer/components/`
- **New IPC channel** → Add round-trip test in `tests/e2e/ipc-bridge.test.ts` AND registration guard in `tests/e2e/main-config-guard.test.ts`
- **New provider** → Add tests in `tests/e2e/provider-integration.test.ts`
- **New store action/computed** → Add tests in `tests/e2e/frontend-store-projection.test.ts`
- **Run `npx vitest run`** → Verify zero unexpected failures before declaring done
