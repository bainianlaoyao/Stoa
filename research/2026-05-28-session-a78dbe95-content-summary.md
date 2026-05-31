---
date: 2026-05-28
topic: Stoa session_a78dbe95 content summary
status: completed
mode: context-gathering
sources: 5
---

## Context Report: session_a78dbe95 — Polymarket CLOB Read-Only Liquidity Probe Research

### Why This Was Gathered

Characterize what concrete task session `session_a78dbe95-1cf7-4409-8eff-38de8b5cb9ae` in project `tabicl5m_evo` completed, what it concluded, and what gaps remain.

### Summary

This session was a **4-prompt, read-only context-research sprint** focused entirely on Polymarket/PMXT CLOB API feasibility for building a read-only liquidity probe. It produced **2 saved research reports** covering API surface, SDK patterns, repo-level integration readiness, and sampling constraints. The session concluded that a minimal liquidity probe is fully unblocked and independent of all other project work.

### Task Classification

**Pure read-only context research** — no code was written, no project files were modified. The session produced research reports only.

### Prompt Breakdown

| # | Prompt Topic | Key Deliverable |
|---|---|---|
| A | Polymarket official read-only market data API endpoints | Confirmed `/book`, `/markets`, `/prices`, `/spread`, `/tick-size`, `/fee-rate` are all unauthenticated GET endpoints |
| B | Polymarket SDK order book / tick size / market-id usage patterns | Documented `py-clob-client` (TS) and `py-sdk` (Python) data structures, book-walk algorithm, tick-size enum, metered test pattern |
| C | Current repo code related to Polymarket/PMXT/liquidity | Confirmed **zero existing code** in Stoa repo — completely greenfield |
| D | Real read-only sampling runtime constraints | Confirmed no-auth works, no sandbox exists, production-only endpoint, rate limits unspecified |

### Reports Produced

1. `research/2026-05-27-clob-liquidity-validation.md` — Covers prompts A and B. 8 sources, detailed API endpoint table, order types, fee mechanics, book-walk algorithm, tick-size enum, heartbeat cancellation, SDK test patterns.

2. `research/2026-05-27-pmxt-liquidity-workstream-independence.md` — Covers prompts C and D. 8 sources, independence assessment, minimal deliverable spec (100-200 LOC Python script), acceptance criteria table, parallelism matrix.

### Final Conclusions

1. **A read-only liquidity probe is fully feasible** — Polymarket's CLOB API at `https://clob.polymarket.com` exposes `/book`, `/markets`, `/spread`, `/tick-size`, `/fee-rate` without authentication.
2. **The workstream is 100% independent** from the tabicl5m_evo backtest continuity research and from the Stoa Electron app. Zero shared code, zero coordination needed.
3. **No existing code to build on** — grep for polymarket/pmxt/liquidity/orderbook returned zero hits in the Stoa codebase. Greenfield.
4. **Recommended minimal deliverable**: single Python script (~100-200 LOC) that enumerates active markets, snapshots orderbooks, computes spread/depth/mid-price, outputs timestamped CSV/JSON.
5. **The official SDK integration tests** (`Polymarket/py-sdk` `test_clob_orders.py`) demonstrate the canonical pattern: estimate price first, place with minimum sizes, poll for visibility, guard cleanup with `finally`.
6. **No sandbox/testnet exists** — `https://clob.polymarket.com` is production-only. Phase 1 (read-only) is safe; any order placement spends real USDC on Polygon.

### Key Findings

- `OrderBookSummary` type exposes `bids[]` and `asks[]` each with `price` + `size`, plus `tick_size`, `min_order_size`, `last_trade_price`
- `TickSize` enum: `"0.1" | "0.01" | "0.001" | "0.0001"` with `ROUNDING_CONFIG`
- `calculateBuyMarketPrice()` / `calculateSellMarketPrice()` walk the book accumulating `size * price` until `amountToMatch` is reached — the canonical slippage metric
- Fee rate available via `GET /fee-rate` → `base_fee` in bps
- Heartbeat system: 10s timeout triggers cancel-all — relevant for any live order management, not for read-only
- Order types: GTC, FOK, GTD, FAK (Fill and Kill, allows partial fill)
- Naive "buy then immediately sell" round-trip testing is misleading due to maker-taker asymmetry, fee drag, book depletion, tick-size rounding, heartbeat cancellation

### Explicit Caveats

1. [!] **API endpoint stability unverified** — web search MCP tools hit rate limits during research; could not confirm if endpoints changed after Jan 2026 training cutoff. Recommend live `curl https://clob.polymarket.com/markets` before building.
2. [!] **No sandbox/testnet** — production-only. Read-only is safe; any write operation is real money.
3. [?] **Rate limits unspecified** — official docs mention pagination (cursor-based) but rate-limit specifics not found. Aggressive polling may hit undocumented limits.
4. [?] **PMXT meaning** — acronym not defined in any repo file. Assumed to mean Polymarket exchange. If PMXT is a separate tool/exchange, findings may not apply.
5. [?] **WebSocket/streaming** — TS client imports WebSocket modules but stream implementation not fully traced. Real-time monitoring may need streaming API beyond REST polling.

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| Session issued 4 research prompts (A-D) on PMXT/Polymarket | `rtk stoa-ctl work-sessions context` CLI output | Session slim context |
| CLOB API endpoints documented with auth requirements | `research/2026-05-27-clob-liquidity-validation.md` | Lines 22-36 |
| OrderBookSummary type fields | `Polymarket/clob-client` | `src/types.ts:316-328` |
| Book-walk algorithm for price impact | `Polymarket/clob-client` | `src/order-builder/helpers.ts` |
| TickSize enum and ROUNDING_CONFIG | `Polymarket/clob-client` | `src/order-builder/helpers.ts` |
| Heartbeat 10s cancel-all | `Polymarket/clob-client` | `src/client.ts` |
| Metered test pattern from py-sdk | `Polymarket/py-sdk` | `tests/integration/test_clob_orders.py` |
| Zero Polymarket code in Stoa repo | Grep results | All `src/**` paths, 0 matches |
| Workstream fully independent | `research/2026-05-27-pmxt-liquidity-workstream-independence.md` | Lines 17, 75-87 |
| Minimal deliverable spec | `research/2026-05-27-pmxt-liquidity-workstream-independence.md` | Lines 62-73 |

### Risks / Unknowns

- [!] API endpoints may have changed since training data cutoff — live verification needed before implementation
- [!] No testnet/sandbox — any order placement is real USDC on Polygon
- [?] Rate limits on unauthenticated `/book` polling are undocumented
- [?] RFQ system is a separate execution path with different slippage characteristics (not researched in depth)
