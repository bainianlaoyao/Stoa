---
date: 2026-06-02
topic: stoa-ctl subsession protocol/contract coverage audit
status: completed
mode: context-gathering
sources: 25
---

## Context Report: stoa-ctl Subsession Protocol/Contract Coverage

### Why This Was Gathered

Independent review of the current diff for protocol/contract completeness across the new subsession observation commands (`status`, `output`, `wait`, `report`, extended `create`). Focused on type coherence, authority model consistency, error contract completeness, and test coverage gaps.

### Summary

The new subsession protocol is structurally sound — type definitions in `project-session.ts` are complete and consumed correctly by the supervisor, control server, and CLI. However, there are **3 bugs**, **6 test coverage gaps**, and **2 contract quality issues** that should be addressed before merging.

---

### Key Findings

#### BUG-1: `getSessionStatus` and `getCompletionReport` use wrong authority action

`getSessionStatus` delegates to `requireVisibleSession(caller, targetId, 'inspect')` and `getCompletionReport` also uses `'inspect'`. These should use dedicated actions (`'status'`, `'report'`) for semantic correctness and to allow future permission differentiation.

| Method | Current Action | Expected Action |
|--------|---------------|-----------------|
| `getSessionStatus` | `'inspect'` | `'status'` (or at minimum `'wait'`) |
| `getCompletionReport` | `'inspect'` | `'report'` (or at minimum `'wait'`) |

**Impact**: Functionally harmless today because all observation actions are `allowed: true` in the visibility service. But the authority action names in `SessionVisibilityService.checkAuthority` don't include `'status'` or `'report'`, so if someone adds authorization logic for these later, the wrong action will be checked.

**Source**: `src/core/session-supervisor.ts:113`, `src/core/session-supervisor.ts:126`

#### BUG-2: `AuthorityAction` type union is incomplete

The `AuthorityAction` type is `'inspect' | 'prompt' | 'create' | 'destroy' | 'wait' | 'read-output'` but the supervisor passes `'inspect'` for `getSessionStatus` and `getCompletionReport`. If those were corrected to use proper action names, `AuthorityAction` would need `'status'` and `'report'` added. More importantly, the supervisor's private `assertAuthority` method has a hardcoded union that duplicates the `AuthorityAction` type rather than importing it — a drift risk.

**Source**: `src/core/session-visibility-service.ts:3`, `src/core/session-supervisor.ts:163`

#### BUG-3: Dead code in `/ctl/session/create` handler

The second `400 Missing parentId` block (`session-control-server.ts:406-413`) is unreachable. The flow is:

1. `caller.type === 'local-user' && !projectId` → 400 Missing projectId (returns)
2. `caller.type === 'local-user' && projectId && !parentId` → root create (returns)
3. `caller.type === 'local-user' && !parentId` → 400 Missing parentId

Block 3 can never be reached because if we get past block 2 with `local-user`, `projectId` must be falsy — but block 1 already returned for that case. The dead code is harmless but confusing.

**Source**: `src/core/session-control-server.ts:406-413`

#### GAP-1: `getSessionStatus` has zero supervisor-level tests

The `SessionSupervisor.getSessionStatus()` method is not tested at all in `session-supervisor.test.ts`. No test verifies:
- Correct `SessionStatusSnapshot` field mapping
- `phase` derivation via `derivePresencePhase`
- `hasCompletionReport` computed flag
- Authority rejection for session callers
- `unknown_session` error for missing targets

**Source**: `src/core/session-supervisor.test.ts` (section absent)

#### GAP-2: Missing control server tests for new endpoint error paths

The control server tests cover happy paths for `status`, `output`, `wait`, and `completion-report`, but are missing these error path tests:

| Endpoint | Missing Test |
|----------|-------------|
| `/ctl/session/:id/status` | 403 `forbidden_authority_scope`, 404 `unknown_session` |
| `/ctl/session/:id/output` | 403 `forbidden_authority_scope`, 404 `unknown_session` |
| `/ctl/session/:id/completion-report` | 403 `forbidden_authority_scope`, 404 `unknown_session` |
| `/ctl/session/:id/wait` | 403 `forbidden_authority_scope`, 404 `unknown_session` |

Every existing endpoint (`inspect`, `prompt`, `destroy`) has authority rejection tests. The new endpoints should match.

**Source**: `src/core/session-control-server.test.ts:252-346`

#### GAP-3: No supervisor test for `getCompletionReport` with `interrupted`/`cancelled` outcomes

`toCompletionReport` treats `interrupted` and `cancelled` as terminal outcomes (returns a report). The test covers `failed` and `no_completion_yet`, but never verifies `interrupted` or `cancelled` outcomes produce a report.

**Source**: `src/core/session-supervisor.ts:231-233`, `src/core/session-supervisor.test.ts:367-398`

#### GAP-4: Server create test doesn't verify `externalSessionId`/`initialCols`/`initialRows` passthrough

The CLI test verifies these fields reach the HTTP body, but no control server test sends them and verifies they reach the `createChildSession` supervisor mock. The server code clearly passes them, but there's no end-to-end server test.

**Source**: `src/core/session-control-server.test.ts:415-570`

#### GAP-5: No supervisor test for `getSessionOutput` authority rejection

Only the happy path is tested. Missing: session caller with no visibility, session caller with visibility but no `read-output` authority.

**Source**: `src/core/session-supervisor.test.ts:357-365`

#### GAP-6: `waitForSession` TOCTOU — no test for state change between wait and final read

`waitForSession` calls `requireVisibleSession` twice — once before the wait loop and once after. Between these calls, the session state could theoretically change (e.g., session destroyed). No test covers this scenario. The double-call is correct but untested.

**Source**: `src/core/session-supervisor.ts:134-158`

#### QUALITY-1: No validation for `initialCols`/`initialRows` range

Neither the CLI nor the server validates that `initialCols` and `initialRows` are positive integers. Passing `--cols 0` or `--cols -1` would forward the value to the session creation layer without rejection.

**Source**: `tools/stoa-ctl/index.ts:306-309`, `src/core/session-control-server.ts:335-336`

#### QUALITY-2: `SessionCompletionReport` leaks internal `hasUnseenCompletion` flag

The `SessionCompletionReport` interface includes `hasUnseenCompletion: boolean`, which is an internal UI state flag. A completion report consumer doesn't need this — it's a "was the completion acknowledged" flag from the parent session's perspective. This should be reviewed for whether it belongs in the public contract.

**Source**: `src/shared/project-session.ts:348`

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Status uses wrong authority action | `session-supervisor.ts` | `:113` |
| Completion-report uses wrong authority action | `session-supervisor.ts` | `:126` |
| AuthorityAction missing status/report | `session-visibility-service.ts` | `:3` |
| Dead code in create handler | `session-control-server.ts` | `:406-413` |
| No getSessionStatus supervisor tests | `session-supervisor.test.ts` | (section absent) |
| Missing error path tests for new endpoints | `session-control-server.test.ts` | `:252-346` |
| No interrupted/cancelled completion report test | `session-supervisor.test.ts` | `:367-398` |
| No create passthrough test for new fields | `session-control-server.test.ts` | `:415-570` |
| No output authority rejection test | `session-supervisor.test.ts` | `:357-365` |
| TOCTOU in waitForSession double-read | `session-supervisor.ts` | `:134-158` |
| No dimension validation | `stoa-ctl/index.ts` | `:306-309` |
| hasUnseenCompletion in report contract | `project-session.ts` | `:348` |
| Type compatibility confirmed | `observability.ts` | `:35` |
| derivePresencePhase input contract | `session-state-reducer.ts` | `:12-25` |

### Risks / Unknowns

- [!] **BUG-1 is a latent misauthorization risk** — if someone adds per-action authorization rules for status/report, the current `'inspect'` action name will bypass them silently.
- [!] **GAP-1 means the status projection contract is completely untested at the supervisor layer** — the `hasCompletionReport` computed field and `phase` derivation could break without detection.
- [?] **The `SessionWaitResult.report` field is typed as `SessionCompletionReport | null`** but `waitForSession` only returns after the session is terminal (or throws `wait_timeout`). In practice the report should always be non-null after a successful wait, making the nullable type overly conservative. However, due to the TOCTOU gap (GAP-6), it could theoretically be null.
- [?] **`waitForSessionStateChange` is optional in `SessionSupervisorDeps`** — when absent, the supervisor falls back to a 25ms polling loop (`session-supervisor.ts:277`). This polling path is never tested with a real timeout scenario.
