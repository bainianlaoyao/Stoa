---
date: 2026-06-02
topic: stoa-ctl subsession CLI & test coverage audit
status: completed
mode: context-gathering
sources: 28
---

## Context Report: stoa-ctl Subsession CLI & Test Coverage Audit

### Why This Was Gathered
Independent review of the current subsession CLI changes (`tools/stoa-ctl/`, `session-control-server`, `session-supervisor`) for user-facing bugs, CLI/server contract mismatches, and must-add tests.

### Summary
The CLI surface is well-structured but has one user-facing contract mismatch (`includeArchived` is silently ignored), one dead-code function with a buggy assertion body, two unreachable server branches in the create handler, and several test gaps in both CLI and server layers. No data-loss or security bugs were found.

---

### Key Findings

#### BUG-1: `includeArchived` query param is silently dropped (user-facing)

The CLI passes `?includeArchived=1` on `session list --include-archived` but the server route handler at `session-control-server.ts:103` ignores query params entirely. The supervisor's `listSessions()` method also has no filtering parameter.

**Impact**: User passes `--include-archived`, gets the same result as without it. No error is returned. Silent feature gap.

| Detail | Value |
|--------|-------|
| CLI sends | `/ctl/session/list?includeArchived=1` |
| Server reads | Nothing — calls `supervisor.listSessions(caller)` unconditionally |
| Supervisor signature | `listSessions(caller: CallerIdentity)` — no filter param |

#### BUG-2: `ensureSessionCaller` is dead code with a broken assertion

Defined at `tools/stoa-ctl/index.ts:172-176` but never called anywhere in the codebase. Additionally, the assertion body is a no-op — when the caller is NOT a session, it just `return`s instead of throwing:

```typescript
function ensureSessionCaller(caller: CallerMode): asserts caller is Extract<CallerMode, { kind: 'session' }> {
  if (caller.kind !== 'session') {
    return   // ← should throw, not return
  }
}
```

**Impact**: Not currently reachable, so no runtime effect. But if anyone calls it expecting it to enforce session-only access, it silently passes non-session callers.

#### DEAD-1: Unreachable branch in create handler (line 357)

`session-control-server.ts:357`: `if (!isRootCreate && !parentId)` — always false because `isRootCreate = !parentId`. When `!isRootCreate` is true, `parentId` is truthy, so `!parentId` is false.

#### DEAD-2: Unreachable branch in create handler (line 406-413)

`session-control-server.ts:406`: `if (caller.type === 'local-user' && !parentId)` — after line 367 handles the `local-user + projectId + !parentId` case and line 349 returns 400 for `local-user + !projectId`, this branch is unreachable.

---

### Test Coverage Gaps

#### CLI Test Gaps (`tools/stoa-ctl/index.test.ts`)

| Gap | Commands Affected | Severity |
|-----|-------------------|----------|
| No test for `health` via session caller | `health` | Medium |
| No test for `capabilities` | `capabilities` | Medium |
| No test for `wait` without `--timeout-ms` | `session wait` | Medium |
| No test for invalid `--type` value | `session create` | High |
| No test for non-numeric `--cols`/`--rows` | `session create` | Low |
| No test for `--cols`/`--rows` via session caller | `session create` | Low |
| No test for missing session ID on subcommands | `status`, `output`, `wait`, `report`, `prompt`, `destroy` | High |
| No test for whitespace-only `--text` | `session prompt` | Medium |
| No test for `session list` without `--include-archived` verifying correct URL | `session list` | Low |

**Most impactful**: Missing session ID tests. The CLI guards with `if (!sessionId)` → `CliUsageError`, but none of these branches are tested for `status`, `output`, `wait`, `report`, or `destroy`. Only `inspect` is indirectly covered by not passing an ID in the `unknown_session` test.

#### Server Test Gaps (`session-control-server.test.ts`)

| Gap | Endpoint | Severity |
|-----|----------|----------|
| `includeArchived` query param ignored (BUG-1) | `GET /ctl/session/list` | High |
| No test for `externalSessionId` in create body | `POST /ctl/session/create` | Medium |
| No test for `initialCols`/`initialRows` in create body | `POST /ctl/session/create` | Medium |
| No test for session caller create with `forbidden_authority_scope` | `POST /ctl/session/create` | Medium |
| No test for unknown session on create (local-user with bad parentId) | `POST /ctl/session/create` | Low |
| No test for `destroy` with `unknown_session` | `POST /ctl/session/:id/destroy` | Low |

#### Supervisor Test Gaps (`session-supervisor.test.ts`)

| Gap | Method | Severity |
|-----|--------|----------|
| No test for `getSessionStatus` with invisible target | `getSessionStatus` | Medium |
| No test for `waitForSession` that completes via state change (not pre-terminal) | `waitForSession` | Medium |
| No test for `getCompletionReport` with `cancelled`/`interrupted` outcomes | `getCompletionReport` | Low |
| No test for `destroySession` when session caller targets itself | `destroySession` | Low |

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| `ensureSessionCaller` dead code | `tools/stoa-ctl/index.ts` | `:172-176` |
| `ensureSessionCaller` never called | grep across codebase | only 1 definition, 0 calls |
| `includeArchived` sent by CLI | `tools/stoa-ctl/index.ts` | `:255` |
| `includeArchived` ignored by server | `src/core/session-control-server.ts` | `:103-107` |
| `includeArchived` not in supervisor | `src/core/session-supervisor.ts` | `:55` (no filter param) |
| Dead branch `!isRootCreate && !parentId` | `src/core/session-control-server.ts` | `:357` |
| Dead branch `local-user && !parentId` fallback | `src/core/session-control-server.ts` | `:406` |
| CLI missing-ID guard (untested for 5 commands) | `tools/stoa-ctl/index.ts` | `:330, :346, :360, :376, :407` |
| Port file type has no `activeMetaSessionId` | `src/core/stoa-ctl-port-file.ts` | `:6-11` |
| `CreateChildSessionRequest` includes optional fields | `src/core/session-supervisor.ts` | `:22-30` |
| Server reads `externalSessionId`/`initialCols`/`initialRows` | `src/core/session-control-server.ts` | `:330-336` |
| Server passes optional fields to supervisor | `src/core/session-control-server.ts` | `:371-377, :418-424` |

---

### Risks / Unknowns

- **[!] BUG-1 `includeArchived`**: User-facing feature gap. CLI documents `--include-archived` in usage text, server ignores it. If archived sessions exist, the user gets incorrect results with no error signal.
- **[!] Dead code in create handler**: Two unreachable branches suggest the create path logic was refactored but cleanup was incomplete. The dead branch at line 406 was probably meant to catch a case that's now handled earlier.
- **[?] `--cols`/`--rows` validation**: CLI uses `Number.parseInt()` which silently returns `NaN` for non-numeric input. The server checks `typeof req.body?.initialCols === 'number'`, which would reject `NaN`-serialized values. But if `NaN` is JSON-serialized as `null`, behavior is undefined. Edge case, not tested.
- **[?] Port file legacy field**: The test at `index.test.ts:536-539` passes `activeMetaSessionId` to the port file reader as `as any`, confirming it's a legacy field. The port file type definition at `stoa-ctl-port-file.ts:6-11` doesn't include it. This is handled correctly (ignored) but the `as any` cast is a code smell.

---

### Must-Add Tests (Priority Order)

1. **CLI: missing session ID for `status`, `output`, `wait`, `report`, `destroy`** — 5 symmetric untested branches
2. **CLI: invalid `--type` value** — `ensureSessionType` throws but never tested
3. **Server: `includeArchived` ignored** — either implement the feature or remove the CLI flag
4. **CLI: `health` and `capabilities` commands** — zero coverage
5. **Server: `externalSessionId`/`initialCols`/`initialRows` in create** — fields are parsed but never verified in test
6. **CLI: `wait` without `--timeout-ms`** — default timeout path untested
