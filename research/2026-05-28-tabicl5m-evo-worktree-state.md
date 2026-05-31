---
date: 2026-05-28
topic: tabicl5m_evo worktree state before integration
status: completed
mode: context-gathering
sources: 3
---

## Context Report: tabicl5m_evo Git/Worktree State

### Why This Was Gathered
Need to know whether the tabicl5m_evo repo is in a clean, committable state before any integration work. Specifically: is it dirty, which files are modified/untracked, and do the four completed sessions' changes appear to be present together.

### Summary
The repo is on `main` at `d0e6b45` with a **dirty working tree** — 56 files changed (+7624 / -1959 lines). No commits are staged. There are 56 modified tracked files and 17 untracked files. The changes span backtest, prediction, data_sources, live, contracts, and tests, consistent with multiple sessions' worth of accumulated work that has not been committed yet.

### Key Findings

1. **Branch**: `main` at commit `d0e6b45` (`test(backtest): freeze B6 gate evidence and residual acceptance gaps`).
2. **Dirty working tree**: 56 tracked files modified, 0 staged. All changes are unstaged (` M` prefix = modified in worktree, not staged).
3. **Untracked files (17)**: Mix of new source modules, new test files, new fixtures, and temp artifacts:
   - New source: `legacy_drawdown_artifact.py`, `net_value_curve_artifact.py`, `phase01_parity_comparison.py`, `real_data_acceptance.py`, `pmxt_rows.py`, `polymarket_liquidity_probe.py`, `polymarket_pmxt_backfill.py`, `external_tabicl_loader.py`
   - New tests: `test_legacy_drawdown_artifact.py`, `test_phase01_parity_comparison.py`, `test_real_data_acceptance.py`, `test_polymarket_liquidity_probe.py`, `test_polymarket_pmxt_backfill.py`, `test_external_tabicl_loader.py`
   - New fixtures: 5 legacy comparison/comparison JSON files under `fixtures/release_gates/backtest_replay/b6_plan_verification/`
   - Temp artifacts: `.claude_phase_gate_patch.txt`, `.tmp/`
4. **Recent commits** (10 shown): Appear to be session checkpoint commits. The latest (`d0e6b45`) was itself a session freeze commit, but additional unstaged work has accumulated on top.
5. **Diff magnitude**: +7624 insertions, -1959 deletions across 56 files — this is a substantial uncommitted delta, consistent with multiple sessions' work.
6. **Sessions' changes present together**: Yes. The modified and untracked files collectively cover:
   - Backtest engine (fast_engine, legacy drawdown, net value curve, phase01 parity, real data acceptance)
   - Prediction (backfill, binance history, semantics, external tabicl loader)
   - Data sources (PMXT parquet, polymarket liquidity probe, PMXT backfill)
   - Live (observation, runtime loop)
   - Contracts (import boundaries, shared config)
   This breadth matches what four parallel sessions would produce — backtest+prediction+data_sources+live workstreams are all represented in the dirty tree.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Branch is `main` at `d0e6b45` | `git branch --show-current` + `git rev-parse --short HEAD` | CLI output |
| 56 modified tracked files, all unstaged | `git status --short` | CLI output, all lines prefixed ` M` |
| 17 untracked files (new modules, tests, fixtures, temp) | `git status --short` | CLI output, lines prefixed `??` |
| +7624/-1959 line delta | `git diff --stat` | CLI output |
| Latest commit: `d0e6b45` freeze B6 gate evidence | `git log --oneline -10` | CLI output |
| Four workstreams represented (backtest/prediction/data_sources/live) | Modified file paths span all four directories | `git status --short` |

### Risks / Unknowns

- [!] **Uncommitted work at risk**: All 56 modified + 17 untracked files are not committed. Any `git checkout` or `git reset --hard` would lose them.
- [!] **Temp artifacts present**: `.claude_phase_gate_patch.txt` and `.tmp/` are likely session artifacts that should not be committed.
- [?] **Test suite status unknown**: Not checked whether `pytest` passes on this dirty tree — the +7624 lines may include in-progress or incomplete work.
- [?] **Staged vs unstaged intent unclear**: Everything is unstaged. It is unknown whether the sessions intentionally left work uncommitted for later batching or if commits were missed.

## Context Handoff: tabicl5m_evo Worktree State

Start here: `research/2026-05-28-tabicl5m-evo-worktree-state.md`

Context only. Use the saved report as the source of truth.
