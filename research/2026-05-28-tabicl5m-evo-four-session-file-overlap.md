---
date: 2026-05-28
topic: tabicl5m_evo four-session file overlap and merge order
status: completed
mode: context-gathering
sources: 5
---

## Context Report: tabicl5m_evo Four-Session File Overlap / Conflict Surface

### Why This Was Gathered

Determine which files were touched by more than one session to assess merge difficulty and recommend integration order.

### Summary

Two files overlap across the four sessions; the remaining work is disjoint. The drawdown-parity session (`188f88db`) is the linchpin — it modified shared source code (`runner.py`) plus two test files that later sessions also touched. Integration should start there.

### Session Touched-File Inventory

#### Session 188f88db — Drawdown Parity Snapshot Fix

**Source (4)**:
| File | Change Type |
|------|------------|
| `src/tabicl5m/backtest/net_value_curve_artifact.py` | **new** |
| `src/tabicl5m/backtest/legacy_drawdown_artifact.py` | modified |
| `src/tabicl5m/backtest/report_reader.py` | modified |
| `src/tabicl5m/backtest/runner.py` | modified (publishes snapshot artifact) |

**Tests (4)**:
| File | Change Type |
|------|------------|
| `tests/backtest/test_legacy_drawdown_artifact.py` | modified |
| `tests/backtest/test_backtest_report_reader.py` | modified |
| `tests/backtest/test_ready_to_run_runner.py` | modified |
| `tests/backtest/test_backtest_drawdown_parity.py` | modified |

Source: `research/2026-05-28-stoa-session-188f88db-drawdown-parity.md:47-59`

---

#### Session 7dd68633 — Carry-Forward Test Hardening

**Source (0)**: No source modifications. Existing code already satisfied constraints.

**Tests (2)**:
| File | Change Type |
|------|------------|
| `tests/backtest/test_phase01_parity_comparison.py` | modified (test added at :183) |
| `tests/backtest/test_backtest_drawdown_parity.py` | modified (tests added at :673, :726, :735) |

Source: `research/2026-05-28-tabicl5m-session-7dd68633-carry-forward-tests.md:27-46`

---

#### Session 0bf4c051 — Phase-Gating Coverage Fill

**Source (0)**: Additive tests only. No production logic changes.

**Tests (3)**:
| File | Change Type |
|------|------------|
| `tests/backtest/test_fast_engine_conformance.py` | modified (tests at :381, :403) |
| `tests/backtest/test_ready_to_run_runner.py` | modified (tests at :460, :489) |
| `tests/live/test_live_loop.py` | modified (tests at :672, :688) |

Source: `research/2026-05-28-tabicl5m-evo-phase-gating-session.md:22-35`

---

#### Session a78dbe95 — Polymarket Liquidity Probe

**Source (1)**:
| File | Change Type |
|------|------------|
| `src/tabicl5m/data_sources/polymarket_liquidity_probe.py` | **new** |

**Tests (1)**:
| File | Change Type |
|------|------------|
| `tests/data_sources/test_polymarket_liquidity_probe.py` | **new** |

Note: Earlier report (`research/2026-05-28-session-a78dbe95-content-summary.md`) classified this as "research only." The four-session conclusions report corrects this: full session context confirms implementation + sample run. Trust the conclusions report.

Source: `research/2026-05-28-tabicl5m-evo-four-session-conclusions.md:36-41`

---

### Overlap Analysis

| Overlapping File | Sessions | Conflict Likelihood | Nature |
|-----------------|----------|--------------------|----|
| `tests/backtest/test_backtest_drawdown_parity.py` | 188f88db, 7dd68633 | **Medium** | Both add/modify tests in same file. 188f88db rewrote drawdown parity tests to derive from raw curves; 7dd68633 added carry-forward regression tests + skip guards at tail of file. |
| `tests/backtest/test_ready_to_run_runner.py` | 188f88db, 0bf4c051 | **Low-Medium** | 188f88db modified existing tests (drawdown artifact reading); 0bf4c051 appended new phase-gating tests at higher line numbers (:460, :489). Likely additive, low collision. |

**No other overlaps.** Sessions 7dd68633 and 0bf4c051 share no files. Session a78dbe95 is fully isolated (different subtree: `data_sources/`).

---

### Recommended Merge Order

```
1. session_188f88db  (drawdown parity — modifies source + two shared test files)
2. session_7dd68633  (carry-forward — adds to test_backtest_drawdown_parity.py)
3. session_0bf4c051  (phase-gating — adds to test_ready_to_run_runner.py)
4. session_a78dbe95  (liquidity probe — fully independent, merge at any point)
```

**Rationale**: 188f88db is the foundation — it adds the `net_value_curve_artifact` module and `read_json_artifact()` that later sessions may implicitly depend on. Merging 7dd68633 and 0bf4c051 after it lets their test additions land on top of the rewritten drawdown parity baseline. a78dbe95 is a clean leaf with zero coupling.

**Reconciliation needed**: 0bf4c051 observed the old `portfolio_net_value_curve_snapshots.json` failure during regression, while 188f88db reports that artifact pipeline as fixed. After merging 188f88db, re-run the phase-gating regression to confirm the failure is resolved.

---

### Risks / Unknowns

- [!] The four sessions ran in separate worktrees/branches. Nothing here proves they have already been integrated together.
- [!] `test_ready_to_run_runner.py:144` (`test_run_ready_to_run_backtest_returns_canonical_manifest`) was failing in both 188f88db (as out-of-scope continuity failure) and 0bf4c051 (as pre-existing). This may persist post-merge.
- [?] Whether 188f88db's rewrite of drawdown parity tests shifts line numbers enough to create textual merge conflicts in 7dd68633's additions at :673+. Depends on whether both sessions branched from the same base commit.
- [?] No session ran the full repository quality gate. Post-integration validation is mandatory.
