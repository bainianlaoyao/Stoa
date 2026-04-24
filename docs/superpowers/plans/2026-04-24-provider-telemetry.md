# Provider Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `turn_complete` telemetry for Claude Code, Codex, and OpenCode without per-session sidecar files, while keeping session routing stable for concurrent sessions in one project.

**Architecture:** Start with provider interface spikes so the transport assumptions are proven before large implementation changes. Then land backend/provider transport changes behind tests, followed by renderer/status updates and behavior assets.

**Tech Stack:** TypeScript, Vitest, Vue 3, Electron, Express, Playwright

---

### Task 1: Sync Spec And Establish Spike Targets

**Files:**
- Create: `docs/superpowers/specs/2026-04-24-provider-telemetry-design.md`
- Create: `docs/superpowers/plans/2026-04-24-provider-telemetry.md`
- Modify: `research/2026-04-24-provider-telemetry-handoff.md`

- [ ] **Step 1: Copy the reviewed spec into the worktree**

Run: `git diff -- docs/superpowers/specs/2026-04-24-provider-telemetry-design.md`
Expected: shows the worktree-local spec copy only

- [ ] **Step 2: Update the handoff to match the shared-dispatcher design**

Required edits:
- remove `/hooks/codex`
- remove `sessionIdMap` as a Codex/OpenCode routing dependency
- mark Codex/OpenCode env visibility as spike gates

- [ ] **Step 3: Commit the planning docs**

```bash
git add docs/superpowers/specs/2026-04-24-provider-telemetry-design.md docs/superpowers/plans/2026-04-24-provider-telemetry.md research/2026-04-24-provider-telemetry-handoff.md
git commit -m "docs: capture provider telemetry execution plan"
```

### Task 2: Codex/OpenCode Interface Spikes

**Files:**
- Create: `research/2026-04-24-provider-telemetry-spikes.md`
- Create: `src/extensions/providers/codex-provider.spike.test.ts`
- Create: `src/extensions/providers/opencode-provider.spike.test.ts`

- [ ] **Step 1: Write failing spike tests for env-driven transport assumptions**

Test targets:
- Codex shared notify script content references `process.env.STOA_SESSION_ID`
- OpenCode shared plugin content references `process.env.STOA_SESSION_ID` or equivalent runtime env access

- [ ] **Step 2: Run only the new spike tests and watch them fail**

Run: `npx vitest run src/extensions/providers/codex-provider.spike.test.ts src/extensions/providers/opencode-provider.spike.test.ts`
Expected: FAIL because shared transport files and env-reading logic do not exist yet

- [ ] **Step 3: Implement the minimal shared sidecar generation to satisfy the spike tests**

Code targets:
- `src/extensions/providers/codex-provider.ts`
- `src/extensions/providers/opencode-provider.ts`

- [ ] **Step 4: Re-run the spike tests**

Run: `npx vitest run src/extensions/providers/codex-provider.spike.test.ts src/extensions/providers/opencode-provider.spike.test.ts`
Expected: PASS

- [ ] **Step 5: Record the remaining unverified external-interface assumptions**

Document:
- real Codex notify payload still needed
- real runtime env visibility still needs manual/provider-level confirmation if unit tests can only assert generated file content

### Task 3: Claude Hook Adapter And Webhook Route

**Files:**
- Create: `src/core/hook-event-adapter.ts`
- Create: `src/core/hook-event-adapter.test.ts`
- Modify: `src/core/webhook-server.ts`
- Modify: `src/core/webhook-server.test.ts`
- Modify: `src/core/webhook-server-validation.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Test cases:
- Claude `Stop` becomes canonical `turn_complete`
- Claude `PermissionRequest` becomes canonical `needs_confirmation`
- unrelated Claude events return `null`

- [ ] **Step 2: Write failing webhook tests for `POST /hooks/claude-code`**

Test cases:
- accepts valid raw hook body with `x-stoa-session-id`, `x-stoa-project-id`, `x-stoa-secret`
- rejects missing/invalid headers

- [ ] **Step 3: Run the new core tests and verify failure**

Run: `npx vitest run src/core/hook-event-adapter.test.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts`
Expected: FAIL because adapter file and hook route do not exist

- [ ] **Step 4: Implement the minimal adapter and route**

Code targets:
- add `adaptClaudeCodeHook()`
- extend webhook server options to resolve secrets for `/hooks/claude-code`

- [ ] **Step 5: Re-run the core tests**

Run: `npx vitest run src/core/hook-event-adapter.test.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts`
Expected: PASS

### Task 4: Provider Sidecars And Session Status Type

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/extensions/providers/claude-code-provider.ts`
- Modify: `src/extensions/providers/claude-code-provider.test.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] **Step 1: Write failing provider tests**

Test cases:
- Claude sidecar writes shared `settings.local.json` with literal webhook URL and required headers
- Codex sidecar writes shared `config.toml` and shared notify script
- OpenCode plugin emits only explicit state-changing statuses
- `SessionStatus` accepts `turn_complete`

- [ ] **Step 2: Run provider-focused tests and verify failure**

Run: `npx vitest run src/extensions/providers/claude-code-provider.test.ts src/extensions/providers/opencode-provider.test.ts tests/e2e/provider-integration.test.ts`
Expected: FAIL on missing `turn_complete` and old sidecar content

- [ ] **Step 3: Implement minimal provider changes**

Code targets:
- add `turn_complete`
- update non-regressible statuses
- generate shared provider artifacts
- flip `supportsStructuredEvents()` as appropriate

- [ ] **Step 4: Re-run provider-focused tests**

Run: `npx vitest run src/extensions/providers/claude-code-provider.test.ts src/extensions/providers/opencode-provider.test.ts tests/e2e/provider-integration.test.ts`
Expected: PASS except for unrelated baseline failures outside these files

### Task 5: Runtime Bridge And Event Persistence

**Files:**
- Modify: `src/main/session-event-bridge.ts`
- Modify: `src/main/session-event-bridge.test.ts`
- Modify: `tests/e2e/webhook-runtime-integration.test.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`

- [ ] **Step 1: Write failing tests for `turn_complete` persistence**

Test cases:
- Claude raw hook persists `turn_complete`
- canonical events carrying `turn_complete` reach controller and renderer
- generic OpenCode events do not regress explicit statuses

- [ ] **Step 2: Run runtime integration tests and verify failure**

Run: `npx vitest run src/main/session-event-bridge.test.ts tests/e2e/webhook-runtime-integration.test.ts`
Expected: FAIL before bridge/server/provider changes are fully wired

- [ ] **Step 3: Implement minimal bridge wiring**

Code targets:
- connect hook route to controller flow
- keep `/events` canonical path unchanged

- [ ] **Step 4: Re-run runtime integration tests**

Run: `npx vitest run src/main/session-event-bridge.test.ts tests/e2e/webhook-runtime-integration.test.ts`
Expected: PASS except for unrelated baseline failures

### Task 6: Renderer Status Handling

**Files:**
- Modify: `src/renderer/components/TerminalViewport.vue`
- Modify: `src/renderer/components/TerminalViewport.test.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
- Modify: `tests/e2e-playwright/session-event-journey.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Test cases:
- `turn_complete` keeps the live terminal mounted
- status dot receives `turn_complete` class
- Playwright session event journey can assert the new status class

- [ ] **Step 2: Run renderer-focused tests and verify failure**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: FAIL because renderer does not yet know `turn_complete`

- [ ] **Step 3: Implement minimal renderer changes**

Code targets:
- add `turn_complete` to live terminal statuses
- add status-dot styling using existing tokens/patterns

- [ ] **Step 4: Re-run renderer-focused tests**

Run: `npx vitest run src/renderer/components/TerminalViewport.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
Expected: PASS except for unrelated baseline failures

### Task 7: Behavior Assets And Verification

**Files:**
- Modify: `testing/behavior/*`
- Modify: `testing/topology/*`
- Modify: `testing/journeys/*`
- Regenerate: `tests/generated/**/*`

- [ ] **Step 1: Add or update declared behavior coverage for `turn_complete`**

Required coverage:
- non-shell provider turn completion
- confirmation gate transitions
- visible renderer status propagation

- [ ] **Step 2: Regenerate generated journeys**

Run: `npm run test:generate`
Expected: generated Playwright artifacts update deterministically

- [ ] **Step 3: Run full verification**

Run:
```bash
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected:
- report the actual status honestly
- if unrelated baseline failures remain, list them explicitly

- [ ] **Step 4: Commit the implementation**

```bash
git add .
git commit -m "feat: add provider telemetry turn completion pipeline"
```
