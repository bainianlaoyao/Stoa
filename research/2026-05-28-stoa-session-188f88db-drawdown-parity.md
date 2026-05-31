---
date: 2026-05-28
topic: Stoa session 188f88db drawdown parity snapshot fix
status: completed
mode: context-gathering
sources: 4
---

## Context Report: Stoa Session `session_188f88db` — Drawdown Parity Snapshot Fix

### Why This Was Gathered
Need to understand what this tabicl5m_evo work session actually accomplished, what root cause it addressed, and what it left unresolved.

### Summary
Session fixed a drawdown parity test failure in `tabicl5m_evo` caused by the backtest bundle lacking raw portfolio net-value curve snapshot artifacts. The agent (gpt-5.4 xhigh, 37 min) added snapshot generation/publishing and a `read_json_artifact()` reader, then rewrote drawdown parity tests to derive values from raw curves instead of scalar `max_drawdown_rate`. 38 of 39 targeted tests pass; one out-of-scope continuity test still fails.

### Task Classification
**Bug fix** — backtest artifact pipeline gap causing drawdown parity test failures.

### Root Cause
Two compounding gaps:
1. **Write side**: Backtest bundle only persisted `trade_events` and the scalar `max_drawdown_rate` — never wrote raw portfolio net-value curve snapshots.
2. **Read side**: Only `read_report`/`read_summary` existed; no ability to read named JSON artifacts by manifest digest. Legacy path only exposed realized-only scalar reconstruction.

Consequence: drawdown parity tests were forced to depend on scalar values rather than the original curve, making parity verification unreliable.

### Key Findings
- New module `src/tabicl5m/backtest/net_value_curve_artifact.py` handles snapshot generation.
- `legacy_drawdown_artifact.py` extended to reconstruct legacy raw curves.
- `report_reader.py` gained `read_json_artifact()` for reading named JSON artifacts by manifest digest.
- `runner.py` now publishes `portfolio_net_value_curve_snapshots.json` as part of the backtest bundle.
- Deterministic project values and legacy recoverability now derive from raw curves, not scalars.
- Agent intentionally avoided touching `fast_engine.py`, `runner.py` internals, or `real_data_acceptance.py` (per task constraints, though `runner.py` was modified for publishing).

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Root cause: missing raw curve snapshots + no JSON artifact reader | Session output | stoa-ctl `--level full` lines 24, 29, 38 |
| New file: net_value_curve_artifact.py | Session output | lines 110, 350 |
| read_json_artifact() added to report_reader.py | Session output | line 115-116 |
| runner.py publishes portfolio_net_value_curve_snapshots.json | Session output | line 120 |
| 38 passed, 1 failed | Session output | line 318 |
| Remaining failure: continuity manifest digest mismatch | Session output | lines 489-499 |
| Ruff check/format clean | Session output | lines 266, 278 |

### Touched Files

**Source (4)**:
- `src/tabicl5m/backtest/net_value_curve_artifact.py` (new)
- `src/tabicl5m/backtest/legacy_drawdown_artifact.py` (modified)
- `src/tabicl5m/backtest/report_reader.py` (modified)
- `src/tabicl5m/backtest/runner.py` (modified)

**Tests (4)**:
- `tests/backtest/test_legacy_drawdown_artifact.py`
- `tests/backtest/test_backtest_report_reader.py`
- `tests/backtest/test_ready_to_run_runner.py`
- `tests/backtest/test_backtest_drawdown_parity.py`

### Remaining Failure
`test_btc_phase01_calendar_day_continuity_comparison_sidecar_matches_local_sources` — continuity bundle manifest digest mismatch originating in `real_data_acceptance.load_backtest_trade_events()`. Agent explicitly noted this is out of scope per the task instruction "不要顺手改 continuity seam".

### Risks / Unknowns
- [!] The one remaining failure (`continuity_comparison`) is in a different subsystem (continuity seam) and was explicitly deferred — it will block a fully green suite.
- [?] Whether `runner.py` modification violated the task constraint "避免改 runner.py 除非有硬证据证明必须" — the session appears to have justified it (publishing the snapshot artifact), but the justification is implicit.
- [?] No mention of broader test suite run (only targeted backtest tests) — regression risk to non-backtest areas is unknown.
