---
date: 2026-05-27
topic: tabicl5m_evo parallel workstream candidates
status: completed
mode: context-gathering
sources: 1
---

## Context Report: tabicl5m_evo Parallel Workstream Candidates

### Why This Was Gathered

Determine which `tabicl5m_evo` workstreams can be safely parallelized given the active multi-day backtest continuity research (session `6d50e911`) and known verification gaps (B6 FAIL, drawdown parity FAIL).

### Summary

Of the 4 active sessions, only `6d50e911` is producing high-value output — deep, systematic research on cross-day backtest continuity. The backtest subsystem has 3 known failing gates (B6 aggregation, drawdown parity, hard review remediation 0/6). Two workstreams can start immediately with low collision risk, two are blocked on the continuity research concluding, and two should follow after verification gaps close.

### Source Limitation

The referenced files `research/2026-05-25-multi-day-backtest-continuity.md` and `research/2026-05-22-hard-review-remediation.md` do **not exist** in this repo. All findings derive from `research/2026-05-27-tabicl5m-evo-session-audit.md` and the session contexts it summarizes. The hard review remediation tasks are referenced but their content is not accessible here — the 6 tasks should be enumerated from the `tabicl5m_evo` project directly before committing to parallel work.

---

### Workstream Recommendations

#### WS-1: Drawdown Parity Snapshot Fix

**Classification**: `can run now`

**Rationale**: The B6 plan verification FAIL explicitly identifies the cause as "missing raw portfolio net value curve snapshots" (`research/2026-05-27-tabicl5m-evo-session-audit.md:43-44`). This is a data output gap in the drawdown evaluation pipeline — it needs the snapshot generation code to produce raw portfolio net value curves that match the reference data. This is architecturally independent of the multi-day continuity seam being researched by session `6d50e911`.

**Likely touched files**:
- Backtest evaluation/metrics module (drawdown calculation, curve snapshot generation)
- Artifact store write path for new snapshot type
- Corresponding test files

**Collision risk**: **LOW** — drawdown metrics and curve snapshot output are downstream of the engine, not at the continuity seam. session `6d50e911`'s research touches `fast_engine.py` seam placement and `runner.py` integration — different subsystem.

**Dependency**: None. Benchmark gate already PASS (4.9M–13.9M rows/sec, 217× speedup) confirms engine performance is stable (`research/2026-05-27-tabicl5m-evo-session-audit.md:42`).

---

#### WS-2: Legacy Carry-Forward Evidence Verification Tests

**Classification**: `can run now`

**Rationale**: session `6d50e911` prompt 3 completed read-only research on "legacy carry-forward evidence chain (BTC 2026-02-24→25 phase01)" (`research/2026-05-27-tabicl5m-evo-session-audit.md:29`). The research phase is done. Writing verification tests that assert the carry-forward behavior matches the documented evidence chain is a natural next step that doesn't require the continuity seam to be placed.

**Likely touched files**:
- Legacy artifact JSON test fixtures
- Carry-forward verification test module
- Possibly `artifact_store.py` read paths

**Collision risk**: **LOW** — test-layer work only. session `6d50e911`'s remaining prompts (4: phase gating, 5: write boundary analysis) touch different files (`semantics.py`, `runtime_loop.py`, git status diff).

**Dependency**: The carry-forward research conclusions from prompt 3 must be available to the worker. If session `6d50e911` hasn't saved its findings externally, the worker needs access to that session's output.

---

#### WS-3: Phase Gating Coverage Test Suite

**Classification**: `can run now`

**Rationale**: session `6d50e911` prompt 4 audited "phase gating coverage (phase0/1 open-only, phase2/3/4 block)" as read-only research (`research/2026-05-27-tabicl5m-evo-session-audit.md:30`). The audit identified which phases have coverage and which don't. Writing actual test cases for the uncovered phase-gating paths can proceed independently — the research has already identified the gaps.

**Likely touched files**:
- Phase-related test files
- `semantics.py` (phase definitions)
- `live/runtime_loop.py` (phase execution paths)

**Collision risk**: **LOW-MODERATE** — touches `semantics.py` and `runtime_loop.py` which are also in session `6d50e911` prompt 4's scope. However, prompt 4 is read-only research, and writing tests doesn't modify the source files being researched. If `6d50e911` later recommends changes to these files, those changes would benefit from the new tests.

**Dependency**: Same as WS-2 — the worker needs the research conclusions from prompt 4.

---

#### WS-4: Multi-Day Continuity Seam Implementation

**Classification**: `blocked by continuity seam`

**Rationale**: session `6d50e911` is actively researching where to place the cross-segment/cross-day seam in `FastMatrixEngine` (`research/2026-05-27-tabicl5m-evo-session-audit.md:26-28`). This is the prerequisite for all continuity implementation. The session has completed 5 sequential prompts and may produce more. Implementation cannot begin until the seam placement decision is made and the runner/acceptance integration points are specified.

**Likely touched files** (once unblocked):
- `fast_engine.py` — seam placement, segment boundary logic
- `runner.py` — cross-day orchestration
- `real_data_acceptance.py` — acceptance criteria for continuity
- `artifact_store.py` — carry-forward artifact persistence
- All related test files

**Collision risk**: **HIGH** once started — this is the core engine modification. All other engine-touching work should avoid these files until the seam is in place.

**Dependency**: Blocked on session `6d50e911` completing its research and producing actionable seam placement + integration point specifications.

---

#### WS-5: Hard Review Remediation (independent subset)

**Classification**: `should follow after verification` (partially — see below)

**Rationale**: 6 remediation tasks exist, none started (`research/2026-05-27-tabicl5m-evo-session-audit.md:46`). Without access to the actual task list (file `research/2026-05-22-hard-review-remediation.md` does not exist in this repo), the parallelizability is uncertain. However, based on the known gate results:
- Tasks related to **documentation, logging, or observability** — likely `can run now`
- Tasks related to **drawdown/metric fixes** — overlap with WS-1, should coordinate
- Tasks related to **continuity/cross-day behavior** — `blocked by continuity seam`
- Tasks related to **test coverage** — may overlap with WS-2/WS-3

**Likely touched files**: Unknown without the task list.

**Collision risk**: **MODERATE to HIGH** — depends heavily on which tasks touch the backtest core vs. peripheral systems.

**Dependency**: Must read the actual remediation task list from the `tabicl5m_evo` project to classify each task's dependency status.

---

#### WS-6: B6 Aggregation Gate Re-verification

**Classification**: `should follow after verification`

**Rationale**: B6 plan verification FAIL at the aggregation gate (`research/2026-05-27-tabicl5m-evo-session-audit.md:41`). The aggregation gate is a composite — it likely requires all sub-gates (including drawdown parity) to pass. Fixing WS-1 (drawdown parity) and any other failing sub-gates first, then re-running B6 verification, is the correct order.

**Likely touched files**:
- B6 verification plan / gate configuration
- Possibly verification infrastructure scripts

**Collision risk**: **LOW** — this is a verification orchestration step, not engine modification.

**Dependency**: Blocked on WS-1 (drawdown parity fix) completing. Possibly also blocked on hard review remediation tasks if those affect sub-gate results.

---

### Dependency Graph

```
WS-1 (drawdown parity) ──────────────┐
                                      ├──► WS-6 (B6 re-verification)
WS-5 (hard review, independent) ──────┘

WS-2 (carry-forward tests) ─── independent, can run now
WS-3 (phase gating tests) ──── independent, can run now

WS-4 (continuity seam) ◄── blocked on session 6d50e911 research
WS-5 (hard review, dependent subset) ◄── blocked on WS-4 or WS-1 depending on task
```

### Parallelism Summary

| Workstream | Status | Safe to Start | Collision Risk |
|------------|--------|---------------|----------------|
| WS-1: Drawdown parity fix | `can run now` | Yes | LOW |
| WS-2: Carry-forward verification tests | `can run now` | Yes (needs prompt 3 output) | LOW |
| WS-3: Phase gating coverage tests | `can run now` | Yes (needs prompt 4 output) | LOW-MOD |
| WS-4: Continuity seam implementation | `blocked by continuity seam` | No | HIGH (once started) |
| WS-5: Hard review remediation | `should follow after verification` | Partial (needs task list) | MOD-HIGH |
| WS-6: B6 re-verification | `should follow after verification` | No (needs WS-1) | LOW |

### Risks / Unknowns

- [!] **Source gap**: `research/2026-05-22-hard-review-remediation.md` and `research/2026-05-25-multi-day-backtest-continuity.md` do not exist in this repo. The hard review task list is referenced but its content is inaccessible here. This limits WS-5 classification confidence.
- [!] **Research output accessibility**: WS-2 and WS-3 depend on session `6d50e911`'s research conclusions being externally available. If conclusions only exist in session memory, workers cannot access them.
- [?] **session `6d50e911` completion timeline**: Unknown whether the 5 prompts completed are the full research or if more are planned. The "safe write boundary analysis" (prompt 5) suggests the session may be wrapping up its research phase.
- [!] **Collision risk for WS-4**: Once unblocked, the continuity seam implementation will touch the highest-risk files (`fast_engine.py`, `runner.py`). All other workstreams should avoid these files during WS-4 execution.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Session 6d50e911 has 5 sequential context-research prompts on continuity | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:22-32` |
| B6 plan verification status is FAIL (aggregation gate) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:41` |
| Benchmark gate PASS (4.9M–13.9M rows/sec, 217× speedup) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:42` |
| Drawdown parity FAIL (missing raw portfolio net value curve snapshots) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:43-44` |
| Online fetch PASS (3/3 scenarios) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:45` |
| Real data acceptance PASS (6 dates, BTC/USDT) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:46` |
| Hard review remediation 6 tasks, none started | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:47` |
| Prompt 1 scope: FastMatrixEngine seam placement | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:27` |
| Prompt 2 scope: runner/real-data acceptance integration | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:28` |
| Prompt 3 scope: legacy carry-forward (BTC 2026-02-24→25) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:29` |
| Prompt 4 scope: phase gating coverage audit | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:30` |
| Prompt 5 scope: safe write boundary analysis | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:31` |
| Session b13b4987 broad status review (single Q&A, concluded) | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:37-48` |
| Referenced files do not exist in this repo | File system check | `research/2026-05-25-multi-day-backtest-continuity.md` (missing), `research/2026-05-22-hard-review-remediation.md` (missing) |
