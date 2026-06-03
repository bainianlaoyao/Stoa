---
date: 2026-06-02
topic: stoa-ctl subsession diff risk scan
status: completed
mode: context-gathering
sources: 12
---

## Context Report: stoa-ctl Subsession Diff — Risk Scan

### Why This Was Gathered

Review the current working-tree diff for correctness regressions introduced during the stoa-ctl subsession fix. Scope: types, permissions, waiters, dimension parameter semantics. Excludes the three previously-known issues.

### Summary

The diff adds four new observation endpoints (`status`, `output`, `wait`, `report`), partial dimension support (`--cols`/`--rows`), an `--external-session-id` flag, and an event-driven waiter mechanism. **One critical issue** found: partial dimension merge overwrites remembered values with `undefined`. **One important issue**: `--timeout-ms` is not validated on the CLI side. The waiter lifecycle, permission model, and type chain are sound.

### Key Findings

#### 1. [CRITICAL] Partial dimensions merge destroys remembered values

**Trigger**: Caller passes `--cols 132` but NOT `--rows` (or vice versa).

**Chain of failure**:

1. CLI sends `{ initialCols: 132 }` (no `initialRows`) — `tools/stoa-ctl/index.ts:301-306`
2. Server parses → `initialCols: 132, initialRows: undefined` — `src/core/session-control-server.ts:339-340`
3. `createWorkSessionWithRuntime` constructs `explicitDimensions` — `src/main/index.ts:974-978`:
   ```ts
   explicitDimensions = { cols: 132, rows: undefined }
   ```
   The condition `payload.initialCols !== undefined || payload.initialRows !== undefined` is true because EITHER is present, but the object includes BOTH, with the absent one set to `undefined`.
4. Merge in `launchSessionRuntimeWithGuard` — `src/main/index.ts:884-886`:
   ```ts
   initialDimensions = { ...rememberedDimensions, ...explicitDimensions }
   // e.g. { ...{ cols: 120, rows: 30 }, ...{ cols: 132, rows: undefined } }
   // → { cols: 132, rows: undefined }
   ```
   **The remembered `rows: 30` is overwritten by `undefined`.**
5. `hasCompleteSessionDimensions` returns `false` → `rememberSessionDimensions` not called — `src/main/index.ts:892-894`
6. PTY falls back to hardcoded default `rows: 30` — `src/core/pty-host.ts:119`

**Impact**: When a subsession is created with only one dimension specified, the other dimension loses its remembered value and falls back to the PTY default (120×30). The remembered value for the unspecified axis is silently discarded.

**Fix direction**: Either (a) filter out `undefined` entries before constructing `explicitDimensions`, or (b) require both `--cols` and `--rows` to be specified together at the CLI level, or (c) only spread defined keys.

#### 2. [IMPORTANT] `--timeout-ms` not validated in CLI, silently falls back to 300s

**Location**: `tools/stoa-ctl/index.ts:345-346`

```ts
const timeoutMs = parseFlagValue(rest, '--timeout-ms')
const query = timeoutMs ? `?timeoutMs=${encodeURIComponent(timeoutMs)}` : ''
```

The raw string value is URL-encoded and forwarded. If the user passes `--timeout-ms abc` or `--timeout-ms -5`, the server-side `Number.parseInt("abc")` → `NaN` → `Number.isFinite(NaN)` → `false` → `undefined` → default 300 000 ms.

**Impact**: User receives no error feedback; the timeout silently becomes 5 minutes regardless of the specified value. Negative values also silently fall back.

**Contrast**: The `--cols`/`--rows` flags are validated with `parsePositiveIntegerFlag` at `tools/stoa-ctl/index.ts:172-181`, which throws `CliUsageError` for invalid input.

**Fix direction**: Apply `parsePositiveIntegerFlag` (or a similar validator that allows `0`) to `--timeout-ms` before forwarding.

#### 3. [OK] Waiter lifecycle is sound

The `sessionStateWaiters` map in `src/main/session-runtime-controller.ts:134-155` properly:
- Cleans up waiters on both timeout and update paths (`finish` function at line 141-148)
- Removes the Set from the Map when empty (line 144-146)
- Uses `[...waiters]` copy in `finishSessionStateChange` (line 160) to avoid mutation during iteration
- Promise `resolve` is idempotent — double-invocation is a no-op

No memory leak detected.

#### 4. [OK] Permission model correctly extended

`src/core/session-visibility-service.ts:1` — `AuthorityAction` type extended from 4 to 8 variants. The `checkAuthority` method at `src/core/session-visibility-service.ts:70-78` correctly allows all read-like actions (`inspect`, `status`, `report`, `prompt`, `wait`, `read-output`) for visible sessions, and retains the `create`/`destroy` authority check unchanged.

#### 5. [OK] `ensureSessionCaller` removal is safe

The removed function at `tools/stoa-ctl/index.ts` (old lines 168-171):
```ts
function ensureSessionCaller(caller: CallerMode): asserts caller is Extract<CallerMode, { kind: 'session' }> {
  if (caller.kind !== 'session') {
    return  // <-- returns instead of throwing
  }
}
```
This was a no-op assertion — it never threw. Removal is correct.

#### 6. [OK] `waitUntilTerminal` fallback polling

`src/core/session-supervisor.ts:276-277` — When `waitForSessionStateChange` is not provided (test-only path), the fallback polls at 1–25 ms intervals. In production, `waitForSessionStateChange` is always provided via `SessionRuntimeController`, so this fallback never executes. Acceptable for test mocks.

#### 7. [OBSERVATION] Long-polling on GET `/wait`

`src/core/session-control-server.ts` — The `/ctl/session/:id/wait` endpoint is a GET that blocks up to 300 s. For localhost CLI-to-app communication this is fine. Noted for awareness only — no action needed.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Partial dimensions merge creates `{ cols: N, rows: undefined }` | `src/main/index.ts` | `:974-978` |
| Spread overwrites remembered with `undefined` | `src/main/index.ts` | `:884-886` |
| `hasCompleteSessionDimensions` rejects partial dims | `src/main/index.ts` | `:892-893` |
| PTY defaults when `initialRows` is unset | `src/core/pty-host.ts` | `:118-119` |
| `--timeout-ms` not validated | `tools/stoa-ctl/index.ts` | `:345-346` |
| `--cols`/`--rows` validated with `parsePositiveIntegerFlag` | `tools/stoa-ctl/index.ts` | `:172-181, 275-277` |
| Server-side `parseOptionalPositiveInteger` rejects 0/negative/float | `src/core/session-control-server.ts` | `:21-29` |
| Waiter cleanup on both timeout and update | `src/main/session-runtime-controller.ts` | `:141-148` |
| `AuthorityAction` extended to 8 variants | `src/core/session-visibility-service.ts` | `:1` |
| `ensureSessionCaller` was a no-op | `tools/stoa-ctl/index.ts` | old `:168-171` (removed) |
| `waitUntilTerminal` fallback polls 1-25ms | `src/core/session-supervisor.ts` | `:276-277` |
| Wait default 300s, validated with `Math.max(0, ...)` | `src/core/session-supervisor.ts` | `:140` |

### Risks / Unknowns

- [!] **Partial dimensions**: Any caller that specifies only one of `--cols`/`--rows` will lose the remembered value for the other dimension. This affects subsession creation from CLI when the parent session had non-default dimensions.
- [!] **Silent timeout fallback**: `--timeout-ms` with invalid value gives no error and silently uses 300s — the user may assume their custom timeout is in effect.
- [?] No test coverage exists for the partial-dimension scenario (only `--cols` without `--rows`). The existing test at `tools/stoa-ctl/index.test.ts:187-238` only covers the all-fields-present case.
- [?] No test coverage for `--timeout-ms` validation on the CLI side.
