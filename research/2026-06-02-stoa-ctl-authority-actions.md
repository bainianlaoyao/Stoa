---
date: 2026-06-02
topic: stoa-ctl subsession authority action audit — status/report explicitness check
status: completed
mode: context-gathering
sources: 12
---

## Context Report: stoa-ctl Subsession Authority Action Audit

### Why This Was Gathered
Verify that the current diff correctly makes `status`, `output`, `report`, and `wait` authority actions explicit (no reuse of `inspect`), and identify any remaining gaps in authority enforcement, type convergence, or test coverage.

### Summary
The diff correctly introduces four new explicit authority actions (`status`, `report`, `wait`, `read-output`) at every layer — CLI, control server, supervisor, and visibility service. **No `inspect` reuse was found in any new code path.** Two structural issues remain: (1) the action union type is duplicated rather than imported, and (2) the visibility-service test file has zero coverage for the new actions despite the runtime code being correct.

### Key Findings

#### 1. New endpoints use explicit authority actions — no `inspect` reuse ✅

Every new supervisor method passes its own action string to `requireVisibleSession`:

| Method | Action | Location |
|--------|--------|----------|
| `getSessionStatus` | `'status'` | `session-supervisor.ts:113` |
| `getSessionOutput` | `'read-output'` | `session-supervisor.ts:118` |
| `getCompletionReport` | `'report'` | `session-supervisor.ts:126` |
| `waitForSession` | `'wait'` | `session-supervisor.ts:139` |

#### 2. Visibility service grants all read-like actions identically ✅

`session-visibility-service.ts:70-76` now lists all read-like actions in one `if` block, granting `{ allowed: true }` uniformly:

```typescript
if (
  action === 'inspect'
  || action === 'status'
  || action === 'report'
  || action === 'prompt'
  || action === 'wait'
  || action === 'read-output'
) {
  return { allowed: true }
}
```

This is correct and symmetric.

#### 3. Authority action union type is duplicated — not imported ⚠️

The `AuthorityAction` type is defined in `session-visibility-service.ts:3`:

```typescript
export type AuthorityAction = 'inspect' | 'status' | 'report' | 'prompt' | 'create' | 'destroy' | 'wait' | 'read-output'
```

But `session-supervisor.ts:163` and `:185` hardcode an identical inline union:

```typescript
action: 'inspect' | 'status' | 'report' | 'prompt' | 'create' | 'destroy' | 'wait' | 'read-output'
```

The supervisor imports `SessionVisibilityReader` from the visibility module but does **not** import `AuthorityAction`. If a new action is added to one location but not the other, the divergence would be caught only at runtime, not by the type checker.

**Risk:** Medium — easy to fix, silent if missed.

#### 4. `'inspect'` in supervisor action union is dead code ⚠️

The `inspectSession` method (`session-supervisor.ts:64-78`) does its own manual visibility check — it never calls `assertAuthority` or `requireVisibleSession`. Therefore `'inspect'` in the union types at lines 163 and 185 is never passed to `checkAuthority`. The old `/ctl/session/:id/inspect` route in the control server (`session-control-server.ts:119`) calls `supervisor.inspectSession` directly, bypassing the authority framework entirely.

This is not a bug — the `inspect` route predates the authority framework — but it means `inspect` exists in the action union as a vestigial member. A future refactor that adds `inspect`-specific authorization logic to the visibility service would be unreachable from the actual inspect endpoint.

**Risk:** Low — cosmetic, but could mislead future contributors.

#### 5. Visibility-service test has zero coverage for new actions ⚠️

`session-visibility-service.test.ts` tests only: `'inspect'`, `'prompt'`, `'create'`, `'destroy'`.

**No tests exist for:** `'status'`, `'report'`, `'wait'`, `'read-output'`.

Since all read-like actions share the same allow logic in the visibility service (`session-visibility-service.ts:70-76`), the runtime behavior is correct. However, if a future commit splits the allow logic (e.g., restricting `wait` but not `status`), the test gap means the change would be unverified at the authority layer.

**Risk:** Medium — test gap at the single point of authority truth.

#### 6. Triple authority check in `waitForSession` ⚡

`waitForSession` (`session-supervisor.ts:134-158`) performs three authority checks for session callers:

1. Line 139: `requireVisibleSession(caller, targetId, 'wait')` — first `'wait'` check
2. Line 149: `requireVisibleSession(caller, targetId, 'wait')` — **duplicate** `'wait'` check after waiting
3. Line 150: `this.getSessionOutput(caller, targetId)` → internally checks `'read-output'` at line 118

For a session caller, this means `checkAuthority` is invoked 3 times per `waitForSession` call. The duplicate `'wait'` check at line 149 is redundant — the session hasn't changed identity while waiting. The escalation to `'read-output'` may be intentional (wait implies read), but it means a caller with `'wait'` authority but not `'read-output'` would get a 403 after the wait completes.

**Risk:** Low — redundant work, slight semantic coupling between `'wait'` and `'read-output'`.

#### 7. CLI tests cover all new commands ✅

`tools/stoa-ctl/index.test.ts` tests all four new CLI commands with correct endpoint assertions:

| CLI Command | Endpoint | Test Location |
|-------------|----------|---------------|
| `session status` | `/ctl/session/:id/status` | `index.test.ts:354-378` |
| `session output` | `/ctl/session/:id/output` | `index.test.ts:380-398` |
| `session wait` | `/ctl/session/:id/wait?timeoutMs=...` | `index.test.ts:400-422` |
| `session report` | `/ctl/session/:id/completion-report` | `index.test.ts:424-447` |

#### 8. Control server tests cover all new endpoints with error paths ✅

`session-control-server.test.ts` includes:

- `/ctl/session/:id/status` — happy path + `unknown_session` + `forbidden_authority_scope` (lines 249-304)
- `/ctl/session/:id/output` — happy path + `forbidden_authority_scope` (lines 306-332)
- `/ctl/session/:id/completion-report` — happy path + `no_completion_yet` + `forbidden_authority_scope` (lines 334-405)
- `/ctl/session/:id/wait` — happy path + `wait_timeout` (408) + `unknown_session` (lines 407-453)

#### 9. Supervisor tests cover all new methods with error paths ✅

`session-supervisor.test.ts` — `subsession observation controls` describe block (lines 317-493) tests:

- `getSessionStatus` — unknown_session + forbidden_authority_scope
- `waitForSession` — terminal shortcut, wait-until-completion, timeout
- `getSessionOutput` — visible session replay
- `getCompletionReport` — no_completion_yet, completed report, failed report

#### 10. `ensureSessionCaller` removed — was dead code ✅

The old `ensureSessionCaller` function (`tools/stoa-ctl/index.ts:169-176`) was a no-op assertion that returned early when the caller was NOT a session. It was correctly removed in this diff and replaced with `parsePositiveIntegerFlag`.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| New actions are explicit, no `inspect` reuse | `session-supervisor.ts` | `:113`, `:118`, `:126`, `:139` |
| Visibility service updated for all new actions | `session-visibility-service.ts` | `:3`, `:70-76` |
| `AuthorityAction` type defined | `session-visibility-service.ts` | `:3` |
| Action union duplicated in supervisor | `session-supervisor.ts` | `:163`, `:185` |
| `inspectSession` bypasses authority framework | `session-supervisor.ts` | `:64-78` |
| `inspect` route calls old method directly | `session-control-server.ts` | `:119-131` |
| Visibility test has no new-action coverage | `session-visibility-service.test.ts` | entire file (256 lines) |
| Triple check in `waitForSession` | `session-supervisor.ts` | `:139`, `:149`, `:150→118` |
| CLI tests for status/output/wait/report | `tools/stoa-ctl/index.test.ts` | `:354-447` |
| Control server error path tests | `session-control-server.test.ts` | `:249-453` |
| Supervisor method tests | `session-supervisor.test.ts` | `:317-493` |
| Dead `ensureSessionCaller` removed | `tools/stoa-ctl/index.ts` diff | old `:169-176` removed |
| `capabilities` endpoint updated | `session-control-server.ts` | `:99-105` |

### Risks / Unknowns

- **[!] Duplicated action union type** — `session-supervisor.ts:163,185` hardcodes the same union as `session-visibility-service.ts:3`. A future add-to-one-miss-the-other would compile but fail at runtime. Import `AuthorityAction` instead.
- **[!] No visibility-service tests for `status`/`report`/`wait`/`read-output`** — The single authority truth point is untested for 4 of its 8 actions. Add at least a parametric smoke test.
- **[!] Dead `'inspect'` in supervisor action union** — Harmless but misleading. The actual `inspectSession` path (`session-supervisor.ts:64-78`) never touches `assertAuthority`.
- **[?] `wait` authority implies `read-output` authority** — `waitForSession` calls `getSessionOutput` internally, meaning `'wait'` silently requires `'read-output'`. Not a bug today (same allow logic), but a hidden coupling.

---

## Context Handoff: stoa-ctl Authority Action Audit

Start here: `research/2026-06-02-stoa-ctl-authority-actions.md`

Context only. Use the saved report as the source of truth.
