# Claude Settings Sources Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the diagnostic-only Claude `--setting-sources user,project,local` argument from production Stoa Claude sessions while keeping tests and observability docs aligned with the actual provider contract.

**Architecture:** Product Claude sessions should rely on Claude Code's normal settings discovery for `<workspace>/.claude/settings.local.json`. Headless/manual probes may still use `--setting-sources` outside the provider, but the provider command builder must not encode that diagnostic workaround as a runtime invariant.

**Tech Stack:** TypeScript provider definitions, Vitest unit/e2e tests, Markdown architecture documentation.

---

## Scope

This is a narrow cleanup plan. It does not redesign session presence, hook payload parsing, renderer state projection, or Claude status colors.

## File Map

- Modify `src/extensions/providers/claude-code-provider.ts`: remove `CLAUDE_SETTINGS_SOURCE_ARGS` and stop appending it in `createCommand()`.
- Modify `src/extensions/providers/claude-code-provider.test.ts`: update command argument expectations so `--setting-sources` is absent.
- Modify `tests/e2e/provider-integration.test.ts`: update Claude provider command expectations so `--setting-sources` is absent.
- Modify `docs/architecture/provider-observable-information.md`: align Claude provider facts with current code: structured events are supported; registered hooks include `UserPromptSubmit`, `PreToolUse`, `Stop`, `StopFailure`, and `PermissionRequest`; production command examples do not include `--setting-sources`.

---

### Task 1: Lock the New Claude Command Contract in Tests

**Files:**
- Modify: `src/extensions/providers/claude-code-provider.test.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] **Step 1: Update the fresh-start unit expectation**

In `src/extensions/providers/claude-code-provider.test.ts`, change the first command args assertion from:

```ts
expect(command.args).toEqual(['--session-id', 'external-123', '--setting-sources', 'user,project,local'])
```

to:

```ts
expect(command.args).toEqual(['--session-id', 'external-123'])
```

- [ ] **Step 2: Update the unit test that currently requires the settings source argument**

In `src/extensions/providers/claude-code-provider.test.ts`, replace:

```ts
test('adds settings source args so project-local hook settings are loaded', async () => {
  const provider = createClaudeCodeProvider()

  const command = await provider.buildStartCommand({
    session_id: 'session_claude_settings',
    project_id: 'project_alpha',
    path: 'D:/alpha',
    title: 'Claude Alpha',
    type: 'claude-code',
    external_session_id: 'external-settings'
  }, {
    webhookPort: 43127,
    sessionSecret: 'secret',
    providerPort: 43128
  })

  expect(command.args).toContain('--setting-sources')
  expect(command.args).toContain('user,project,local')
})
```

with:

```ts
test('does not add diagnostic-only settings source args to production sessions', async () => {
  const provider = createClaudeCodeProvider()

  const command = await provider.buildStartCommand({
    session_id: 'session_claude_settings',
    project_id: 'project_alpha',
    path: 'D:/alpha',
    title: 'Claude Alpha',
    type: 'claude-code',
    external_session_id: 'external-settings'
  }, {
    webhookPort: 43127,
    sessionSecret: 'secret',
    providerPort: 43128
  })

  expect(command.args).not.toContain('--setting-sources')
  expect(command.args).not.toContain('user,project,local')
})
```

- [ ] **Step 3: Update skip-permissions unit expectations**

In `src/extensions/providers/claude-code-provider.test.ts`, change the fresh-start skip-permissions expectation from:

```ts
expect(command.args).toEqual([
  '--session-id',
  'external-456',
  '--setting-sources',
  'user,project,local',
  '--dangerously-skip-permissions'
])
```

to:

```ts
expect(command.args).toEqual([
  '--session-id',
  'external-456',
  '--dangerously-skip-permissions'
])
```

Change the resume skip-permissions expectation from:

```ts
expect(command.args).toEqual([
  '--resume',
  'external-789',
  '--setting-sources',
  'user,project,local',
  '--dangerously-skip-permissions'
])
```

to:

```ts
expect(command.args).toEqual([
  '--resume',
  'external-789',
  '--dangerously-skip-permissions'
])
```

- [ ] **Step 4: Update e2e provider integration expectations**

In `tests/e2e/provider-integration.test.ts`, change the Claude fresh-start expectation from:

```ts
expect(command.args).toEqual([
  '--session-id',
  '11111111-1111-1111-1111-111111111111',
  '--setting-sources',
  'user,project,local'
])
```

to:

```ts
expect(command.args).toEqual([
  '--session-id',
  '11111111-1111-1111-1111-111111111111'
])
```

Change the Claude resume expectation from:

```ts
expect(command.args).toEqual([
  '--resume',
  '11111111-1111-1111-1111-111111111111',
  '--setting-sources',
  'user,project,local'
])
```

to:

```ts
expect(command.args).toEqual([
  '--resume',
  '11111111-1111-1111-1111-111111111111'
])
```

- [ ] **Step 5: Run focused tests and confirm they fail before implementation**

Run:

```bash
npx vitest run src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected before implementation: FAIL because `claude-code-provider.ts` still appends `--setting-sources user,project,local`.

---

### Task 2: Remove the Diagnostic Argument from the Claude Provider

**Files:**
- Modify: `src/extensions/providers/claude-code-provider.ts`

- [ ] **Step 1: Remove the constant**

Delete this line from `src/extensions/providers/claude-code-provider.ts`:

```ts
const CLAUDE_SETTINGS_SOURCE_ARGS = ['--setting-sources', 'user,project,local'] as const
```

- [ ] **Step 2: Simplify `createCommand()`**

Replace:

```ts
function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]): ProviderCommand {
  const effectiveArgs = [...args, ...CLAUDE_SETTINGS_SOURCE_ARGS]
  return {
    command: claudeCommand(context),
    args: context.claudeDangerouslySkipPermissions === true
      ? [...effectiveArgs, '--dangerously-skip-permissions']
      : effectiveArgs,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}
```

with:

```ts
function createCommand(target: ProviderRuntimeTarget, context: ProviderCommandContext, args: string[]): ProviderCommand {
  return {
    command: claudeCommand(context),
    args: context.claudeDangerouslySkipPermissions === true
      ? [...args, '--dangerously-skip-permissions']
      : args,
    cwd: target.path,
    env: createProviderEnv(target, context)
  }
}
```

- [ ] **Step 3: Run focused tests and confirm they pass**

Run:

```bash
npx vitest run src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected after implementation: PASS.

- [ ] **Step 4: Commit the provider cleanup**

Run:

```bash
git add src/extensions/providers/claude-code-provider.ts src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts
git commit -m "fix: remove claude diagnostic settings source args"
```

---

### Task 3: Update Provider Observability Documentation

**Files:**
- Modify: `docs/architecture/provider-observable-information.md`

- [ ] **Step 1: Update the Claude provider descriptor table**

In `docs/architecture/provider-observable-information.md`, under `Part 1: Claude-Code Provider`, change:

```md
| `supportsStructuredEvents` | `false` |
```

to:

```md
| `supportsStructuredEvents` | `true` |
```

- [ ] **Step 2: Update the Claude command-line examples**

In the Claude command-line flags table, ensure the examples are:

```md
| Scenario | Command |
|----------|---------|
| Fresh start | `claude --session-id <uuid>` |
| Resume | `claude --resume <uuid>` |
| With skip-permissions | either command + `--dangerously-skip-permissions` |
```

Do not add `--setting-sources` to production command examples. If the document needs to mention it, add a separate note:

```md
`--setting-sources user,project,local` was useful for isolated headless diagnostics, but it is not part of Stoa's production Claude provider command contract.
```

- [ ] **Step 3: Update the Claude hook registration table**

Replace the Claude registered hooks table with:

```md
| Hook Event | Matcher | Target URL |
|------------|---------|------------|
| `UserPromptSubmit` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `PreToolUse` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `Stop` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `StopFailure` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `PermissionRequest` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
```

- [ ] **Step 4: Update the Claude adapter mapping summary**

Update the nearby Claude mapping table so it reflects the currently registered events. If the current adapter still ignores some fields, say that explicitly:

```md
| `hook_event_name` | Status Produced | event_type |
|-------------------|----------------|------------|
| `"UserPromptSubmit"` | current code mapping from `hook-event-adapter.ts` | `"claude-code.UserPromptSubmit"` |
| `"PreToolUse"` | current code mapping from `hook-event-adapter.ts` | `"claude-code.PreToolUse"` |
| `"Stop"` | current code mapping from `hook-event-adapter.ts` | `"claude-code.Stop"` |
| `"StopFailure"` | current code mapping from `hook-event-adapter.ts` | `"claude-code.StopFailure"` |
| `"PermissionRequest"` | current code mapping from `hook-event-adapter.ts` | `"claude-code.PermissionRequest"` |
```

Before committing, replace `current code mapping from hook-event-adapter.ts` with the exact statuses from `src/core/hook-event-adapter.ts`; do not leave that phrase in the final document.

- [ ] **Step 5: Confirm no stale `--setting-sources` contract remains**

Run:

```bash
rg -n "setting-sources|user,project,local" src tests docs/architecture/provider-observable-information.md
```

Expected: no matches in `src` or `tests`; documentation may contain only the diagnostic note from Step 2.

- [ ] **Step 6: Commit the documentation cleanup**

Run:

```bash
git add docs/architecture/provider-observable-information.md
git commit -m "docs: align claude observability contract"
```

---

### Task 4: Run Required Verification

**Files:**
- No source edits.

- [ ] **Step 1: Regenerate generated tests**

Run:

```bash
npm run test:generate
```

Expected: exits `0`.

- [ ] **Step 2: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: exits `0`.

- [ ] **Step 3: Run Vitest**

Run:

```bash
npx vitest run
```

Expected: exits `0`.

- [ ] **Step 4: Run Electron Playwright journeys**

Run:

```bash
npm run test:e2e
```

Expected: exits `0`.

- [ ] **Step 5: Run behavior coverage**

Run:

```bash
npm run test:behavior-coverage
```

Expected: exits `0`.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff -- src/extensions/providers/claude-code-provider.ts src/extensions/providers/claude-code-provider.test.ts tests/e2e/provider-integration.test.ts docs/architecture/provider-observable-information.md
```

Expected: only intentional changes are present. Unrelated pre-existing untracked files may remain untracked.

