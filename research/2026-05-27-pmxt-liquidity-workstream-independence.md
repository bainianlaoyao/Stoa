---
date: 2026-05-27
topic: PMXT liquidity-testing workstream independence evaluation
status: completed
mode: context-gathering
sources: 8
---

## Context Report: PMXT/Polymarket Liquidity-Testing Workstream Independence

### Why This Was Gathered

Determine whether a dedicated PMXT/Polymarket liquidity-testing workstream can proceed independently from the ongoing multi-day backtest continuity research (tabicl5m_evo / FastMatrixEngine), and what the minimal viable deliverable would be.

### Summary

**Yes — fully independent.** The liquidity-testing workstream shares zero code, state, or infrastructure with either this repo (Stoa / ultra_simple_panel) or the tabicl5m_evo backtest continuity project. Polymarket's CLOB API provides unauthenticated read-only orderbook access, so a minimal liquidity probe can be built with no dependencies on any existing project component. The two workstreams can run in parallel with no coordination overhead.

### Key Findings

#### 1. No Polymarket/PMXT Code Exists in This Repo

Grep for `polymarket`, `PMXT`, `pmxt`, `liquidity`, `orderbook`, `spread`, `backtest` across the entire Stoa-owned codebase returned **zero matches**. This repo is an Electron IDE panel application. The only hits were from vendored upstreams (orca, entire-cli, evolver) and those were about generic file-tree depth, test depth, or search depth — nothing trading-related.

| Search Term | Files Found (Stoa-owned) |
|---|---|
| polymarket / PMXT / pmxt | 0 |
| liquidity / orderbook / spread | 0 |
| backtest | 0 |

#### 2. The Backtest Continuity Work Lives in a Separate Project

The multi-day backtest continuity research is happening in project `tabicl5m_evo` (FastMatrixEngine), documented in `research/2026-05-27-tabicl5m-evo-session-audit.md`. That project has its own codebase with:
- `fast_engine.py`, `runner.py`, `real_data_acceptance.py`, `artifact_store.py`
- Phase-gating infrastructure (phase0-4)
- Its own test suite (30 source files, 24 test files)

None of this infrastructure is relevant to a Polymarket liquidity probe.

#### 3. Polymarket CLOB API Provides Sufficient Read-Only Access

The Polymarket Central Limit Order Book (CLOB) API exposes public endpoints sufficient for a liquidity probe:

| Endpoint | Method | Auth Required | Purpose |
|---|---|---|---|
| `/book` | GET | No | Full orderbook (bids/asks with price + size) |
| `/markets` | GET | No | Market catalog with condition_ids and token_ids |
| `/prices` | GET | No | Current/ historical prices |
| `/sampling-simplified-markets` | GET | No | Simplified market data including spreads |

Base URL: `https://clob.polymarket.com`

The `py-clob-client` Python library (`pip install py-clob-client`) wraps these endpoints. For a read-only probe, raw `requests` calls work equally well — no API key needed.

**Sources:**
- [Polymarket py-clob-client GitHub](https://github.com/Polymarket/py-clob-client)
- [Polymarket API Docs](https://docs.polymarket.com)
- [py-clob-client on PyPI](https://pypi.org/project/py-clob-client/)

#### 4. Minimal Deliverable

A single Python script (~100-200 LOC) that:

1. Calls `GET /markets` to enumerate active binary markets
2. For each target market, calls `GET /book?token_id=...` to retrieve bids/asks
3. Computes per-market liquidity metrics:
   - **Spread**: best_ask - best_bid
   - **Mid price**: (best_ask + best_bid) / 2
   - **Depth at N cents**: cumulative volume within N cents of mid
   - **Total bid/ask volume**: sum of all sizes on each side
4. Outputs a timestamped CSV or JSON artifact

No authentication, no order placement, no write operations. Pure read-only data collection.

#### 5. What Can Be Built Fully in Parallel vs. What Should Wait

| Component | Parallel? | Rationale |
|---|---|---|
| Market enumeration script | **Yes — fully parallel** | No shared state with anything |
| Orderbook snapshot collector | **Yes — fully parallel** | Public API, no auth needed |
| Spread/depth computation | **Yes — fully parallel** | Pure math on collected data |
| Time-series liquidity tracking | **Yes — fully parallel** | Just adds a polling loop |
| Integration with backtest engine | **No — should wait** | Depends on FastMatrixEngine continuity work completing |
| Live trading signal pipeline | **No — should wait** | Requires order placement auth + backtest validation |
| Cross-market correlation analysis | **Yes — fully parallel** | Can be done on collected snapshots |

The only things that should wait are downstream consumers that need backtest-validated signals. The data collection and analysis layer is completely unblocked.

#### 6. Recommended Acceptance Criteria

| # | Criterion | Measurable |
|---|---|---|
| AC-1 | Script successfully polls orderbook for >= 10 active markets | Count of markets with non-empty bids+asks |
| AC-2 | Spread computed for each polled market | All spreads in [0, 1] range |
| AC-3 | Depth buckets computed at 1c, 5c, 10c from mid | Cumulative volume at each level |
| AC-4 | Output artifact written (CSV or JSON) with timestamp | File exists, parseable |
| AC-5 | Polling runs for >= 60 seconds without errors | Zero unhandled exceptions |
| AC-6 | Script works without API key or authentication | No credentials in config or env |

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Zero Polymarket/PMXT code in Stoa repo | Grep search | All `src/**` paths, 0 matches |
| Backtest continuity is in tabicl5m_evo, not this repo | Local research report | `research/2026-05-27-tabicl5m-evo-session-audit.md:21-35` |
| Session 6d50e911 is doing multi-day continuity research | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:21` |
| Polymarket CLOB API base URL | Official docs | `https://clob.polymarket.com` |
| GET /book returns bids/asks without auth | Polymarket API docs | `https://docs.polymarket.com` |
| py-clob-client Python library available | PyPI / GitHub | `https://github.com/Polymarket/py-clob-client` |
| GET /markets lists active markets with token_ids | Polymarket API docs | `https://docs.polymarket.com` |
| B6 plan verification status FAIL in tabicl5m_evo | Session audit | `research/2026-05-27-tabicl5m-evo-session-audit.md:43` |

### Risks / Unknowns

- [!] Web search MCP tools hit rate limits during this research — could not verify if Polymarket API has changed endpoints since training data cutoff (Jan 2026). **Recommend confirming endpoint availability with a live `curl https://clob.polymarket.com/markets` before building.**
- [?] PMXT acronym used in the request is not defined in any repo file. Assuming it refers to a Polymarket-focused workstream. If PMXT is an internal tool name, the independence assessment may change.
- [!] Polymarket may have rate limits on unauthenticated `/book` polling. A production probe should implement backoff and respect any `X-RateLimit-*` headers.
- [?] The tabicl5m_evo session audit is from today (2026-05-27). If that project's continuity work completes soon, the "should wait" items may unblock faster than expected.
