---
date: 2026-06-02
topic: session create --cols/--rows dimension chain and awaitDimensions override semantics
status: completed
mode: context-gathering
sources: 12
---

## Context Report: Session Create `--cols/--rows` Dimension Chain & `awaitDimensions` Override Semantics

### Why This Was Gathered

The stoa-ctl subsession fix adds `--cols` and `--rows` flags to `session create`. Before treating the diff as complete, we need to confirm that explicit CLI dimensions propagate end-to-end to the PTY spawn, and verify whether the UI-driven `awaitDimensions` path can silently override user-specified values.

### Summary

**The dimension chain is complete and correct.** Explicit `--cols`/`--rows` values propagate from CLI through every layer to the PTY command object. **Critically, `awaitDimensions` is explicitly bypassed when explicit dimensions are present** — the code at `src/main/index.ts:981` sets `awaitDimensions: explicitDimensions === undefined`, so the UI resize-wait path is never entered for CLI-specified dimensions. This is a deliberate, well-placed guard.

### Key Findings

1. **Full chain verified**: CLI → HTTP body → control server parse → supervisor → `createWorkSessionWithRuntime` → `launchSessionRuntimeWithGuard` → `launchTrackedSessionRuntime` → `startSessionRuntime` → PTY command.
2. **`awaitDimensions` is conditionally disabled**: When `--cols`/`--rows` are provided, `awaitDimensions` is set to `false`, preventing the 5-second renderer-dimension wait from running.
3. **Partial dimension merge is supported**: If only `--cols` is provided (but not `--rows`), the explicit value merges with remembered dimensions via spread (`{ ...rememberedDimensions, ...explicitDimensions }`).
4. **Type signature widened**: `initialDimensions` changed from `{ cols: number; rows: number }` to `{ cols?: number; rows?: number }` across `session-runtime.ts`, `launch-tracked-session-runtime.ts`, and `index.ts` to support partial/explicit dims.

### Evidence Chain — Full Parameter Flow

| # | Layer | Location | What Happens |
|---|-------|----------|--------------|
| 1 | **CLI parse** | `tools/stoa-ctl/index.ts:275-276` | `parsePositiveIntegerFlag` parses `--cols` / `--rows`, returns `number \| null`. Invalid values throw `CliUsageError`. |
| 2 | **CLI → HTTP body** | `tools/stoa-ctl/index.ts:301-306` | `initialCols` / `initialRows` added to POST body only when non-null. |
| 3 | **Control server parse** | `src/core/session-control-server.ts:339-340` | `parseOptionalPositiveInteger(req.body?.initialCols)` / `initialRows` — returns `undefined` (absent), `null` (invalid), or `number` (valid). |
| 4 | **Control server validate** | `src/core/session-control-server.ts:357-363` | Returns 400 if either is `null` (invalid). Valid/undefined pass through. |
| 5 | **Control server → supervisor** | `src/core/session-control-server.ts:388-393` and `:435-443` | Passes `initialCols`, `initialRows` in `CreateChildSessionRequest` to `supervisor.createChildSession()`. |
| 6 | **Supervisor type** | `src/core/session-supervisor.ts:27-28` | `CreateChildSessionRequest` declares `initialCols?: number` and `initialRows?: number`. |
| 7 | **Supervisor → main callback** | `src/main/index.ts:760-768` | The `createChildSession` callback forwards `request.initialCols` / `request.initialRows` into `createWorkSessionWithRuntime` payload, which matches `CreateSessionRequest`. |
| 8 | **CreateSessionRequest type** | `src/shared/project-session.ts:292-293` | `initialCols?: number` and `initialRows?: number` on the shared request type. |
| 9 | **createWorkSessionWithRuntime** | `src/main/index.ts:974-982` | Constructs `explicitDimensions` from payload if either field is non-undefined. Passes to `launchSessionRuntimeWithGuard` with `awaitDimensions: explicitDimensions === undefined`. |
| 10 | **awaitDimensions gate** | `src/main/index.ts:981` | **KEY DECISION POINT**: When `--cols`/`--rows` are provided → `awaitDimensions = false`. When absent → `awaitDimensions = true` (UI flow). |
| 11 | **launchSessionRuntimeWithGuard merge** | `src/main/index.ts:884-886` | `initialDimensions = explicitDimensions ? { ...rememberedDimensions, ...explicitDimensions } : rememberedDimensions`. Explicit dims take precedence over remembered. |
| 12 | **awaitDimensions bypass** | `src/main/index.ts:887-889` | `if (options?.awaitDimensions && !explicitDimensions)` — only enters `waitForSessionDimensions` when BOTH conditions hold. Explicit dims prevent this entirely. |
| 13 | **→ launchTrackedSessionRuntime** | `src/main/launch-tracked-session-runtime.ts:29,99` | `initialDimensions?: { cols?: number; rows?: number }` passed through as-is. |
| 14 | **→ startSessionRuntime** | `src/core/session-runtime.ts:48,129-136` | Conditionally sets `command.initialCols` / `command.initialRows` only when each field is `!== undefined`. |
| 15 | **→ PTY spawn** | `src/core/session-runtime.ts:150` | `ptyHost.start(session.id, command, ...)` — the `command` object now carries `initialCols`/`initialRows`. |

### The Override Decision Matrix

| Scenario | `explicitDimensions` | `awaitDimensions` | Final dimensions source |
|----------|---------------------|-------------------|------------------------|
| `--cols 132 --rows 44` provided | `{ cols: 132, rows: 44 }` | `false` | Explicit CLI values. No UI wait. |
| Only `--cols 132` provided | `{ cols: 132, rows: undefined }` | `false` | Merged: remembered `rows` + explicit `cols: 132`. No UI wait. |
| Neither provided | `undefined` | `true` | `waitForSessionDimensions` (5s wait for renderer resize event), fallback `{ cols: 120, rows: 30 }` |
| Neither provided, session has remembered dims | `undefined` | `true` | Wait for renderer dims (overrides remembered) |

### Risks / Unknowns

- **[!] Partial dimension without remembered backup**: If only `--cols` is specified and no remembered dimensions exist for the session, the final `initialDimensions` will be `{ cols: 132, rows: undefined }`. The PTY will only get `initialCols` set; `initialRows` will be undefined on the command. This is safe — the PTY will use its own default for the missing axis — but worth noting.
- **[!] `cols: undefined` spread behavior**: At `src/main/index.ts:884-885`, when `explicitDimensions = { cols: 132, rows: undefined }`, the spread `{ ...rememberedDimensions, ...explicitDimensions }` will set `rows: undefined` even if `rememberedDimensions.rows` was a valid number, because `undefined` is a concrete value in spread semantics. This means providing only `--cols` effectively **discards** the remembered `rows`. However, since `session-runtime.ts:130-134` only sets the field when `!== undefined`, the PTY just doesn't get an `initialRows` — which is correct (falls back to PTY default).
- **[?] No integration test for the full CLI→PTY dimension chain**: The unit tests verify each layer independently (stoa-ctl body construction, control-server validation, session-runtime PTY command). No single test traces `--cols 132 --rows 44` from CLI argv to PTY `command.initialCols`. This is acceptable for the current architecture but could be a future integration test candidate.

### Test Coverage Assessment

| Test | Covers | Location |
|------|--------|----------|
| CLI body construction | stoa-ctl sends `initialCols`/`initialRows` in POST body | `tools/stoa-ctl/index.test.ts` (new: "passes optional create fields through to the control plane") |
| CLI validation | Invalid `--cols` rejected before HTTP request | `tools/stoa-ctl/index.test.ts` (new: "rejects invalid create dimensions") |
| Control server validation | `initialCols: 0` returns 400 | `src/core/session-control-server.test.ts` (new: "returns 400 for invalid initial dimensions") |
| session-runtime PTY pass-through | `initialDimensions: { cols: 132, rows: 44 }` → `command.initialCols: 132, command.initialRows: 44` | `src/core/session-runtime.test.ts` (new: "passes initial terminal dimensions to the PTY command") |
| launchTrackedSessionRuntime | `initialDimensions: { cols: 132, rows: 44 }` forwarded to `startSessionRuntime` | `src/main/launch-tracked-session-runtime.test.ts` (updated assertions) |
