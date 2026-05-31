---
date: 2026-05-27
topic: CLOB/prediction-market liquidity validation best practices (Polymarket/PMXT-style)
status: completed
mode: context-gathering
sources: 8
---

## Context Report: CLOB Liquidity & Slippage Validation

### Why This Was Gathered

To determine what metrics, test designs, and risk factors matter when validating prediction-market CLOB liquidity in a paper/live-like testing workflow, using Polymarket as the canonical reference implementation.

### Summary

Polymarket's official CLOB API and SDKs expose a rich surface for measuring execution quality beyond simple fill/no-fill. The key metrics are spread, depth (order book walk), price impact (via `calculateMarketPrice`), partial-fill behavior (FAK vs FOK), fee rates, tick-size constraints, and heartbeat/cancellation dynamics. The official Python SDK integration tests demonstrate a robust pattern: estimate price first, place with minimum sizes, poll for order visibility, and guard cleanup with `finally` blocks. Naive round-trip tests are misleading due to maker-taker asymmetry, fee drag, tick-size rounding, and the CLOB's heartbeat-based order cancellation.

---

### Q1: Metrics Beyond Fill/No-Fill

Based on the official CLOB API endpoints and data types:

| Metric | API Surface | What It Measures |
|--------|-------------|------------------|
| **Spread** | `GET /spread`, `POST /spreads` | Bid-ask gap; direct measure of immediate execution cost |
| **Depth (order book)** | `GET /book`, `POST /books` → `OrderBookSummary.bids[]`, `OrderBookSummary.asks[]` each with `price` + `size` | Available liquidity at each price level |
| **Price impact** | `calculateBuyMarketPrice()` / `calculateSellMarketPrice()` — walks the book accumulating `size * price` until `amountToMatch` is reached | Expected execution price for a given order size; the core slippage metric |
| **Partial-fill rate** | `OrderResponse.takingAmount` vs `OrderResponse.makingAmount` + `OrderType.FAK` (Fill and Kill, allows partial) vs `OrderType.FOK` (Fill or Kill, all-or-nothing) | How often orders are partially filled; FAK enables this measurement |
| **Tick-size compliance** | `GET /tick-size` → `TickSize` enum (`"0.1" | "0.01" | "0.001" | "0.0001"`) + `priceValid()` validation | Whether price is quantized correctly; invalid prices are rejected |
| **Fee rate** | `GET /fee-rate` → `base_fee` in bps | Per-token fee; affects net slippage |
| **Time-to-fill** | `OrderResponse.status` (`"live"`, `"matched"`, `"delayed"`) + polling `list_open_orders()` | Latency from order submission to execution |
| **Cancel/failure rate** | `OrderResponse.success`, `OrderResponse.errorMsg` + `cancel_order()`, `cancel_orders()`, `cancel_market_orders()`, `cancel_all()` | Whether orders are accepted, rejected, or cancelled |
| **Liquidity rewards** | `GET /rewards/user/percentages`, `GET /rewards/markets/current` → `rewards_max_spread` | Maker incentive programs that skew book composition |

Source: [Polymarket/clob-client `src/types.ts`](https://github.com/Polymarket/clob-client/blob/main/src/types.ts) — `OrderType`, `OrderResponse`, `OrderBookSummary`, `OrderSummary`, `TickSize` types.
Source: [Polymarket/clob-client `src/endpoints.ts`](https://github.com/Polymarket/clob-client/blob/main/src/endpoints.ts) — all endpoint constants.
Source: [Polymarket/clob-client `src/order-builder/helpers.ts`](https://github.com/Polymarket/clob-client/blob/main/src/order-builder/helpers.ts) — `calculateBuyMarketPrice()`, `calculateSellMarketPrice()` implementation showing the book-walk algorithm.

### Q2: Robust Test Design for Phase-Window Execution Probes

The official `Polymarket/py-sdk` integration tests at [`tests/integration/test_clob_orders.py`](https://github.com/Polymarket/py-sdk/blob/main/tests/integration/test_clob_orders.py) demonstrate the canonical pattern:

**Phase 1 — Pre-trade estimation (read-only, no funds at risk):**
```python
# Estimate expected price before placing any order
price = await public_client.estimate_market_price(
    token_id=token_id, side="BUY", amount=amount
)
assert Decimal(0) < price < Decimal(1)
```
This uses the same `calculateBuyMarketPrice` / `calculateSellMarketPrice` book walk that the SDK uses for real order pricing. It is the canonical "what should this cost?" probe.

**Phase 2 — Minimum-size order placement (metered, real funds):**
```python
@pytest.mark.metered
async def test_place_limit_order_buy_creates_visible_open_order_and_cancels_cleanly(...):
    placed = await client.place_limit_order(
        token_id=token_id, price=price, size=size, side="BUY"
    )
    assert isinstance(placed, AcceptedOrder)
    assert await _wait_for_order_visible(client, token_id=token_id, order_id=placed_id)
```

**Phase 3 — Cleanup with guaranteed rollback:**
```python
finally:
    if placed_id is not None:
        with contextlib.suppress(Exception):
            await client.cancel_order(order_id=placed_id)
```

**Key design elements from the official tests:**

1. **`@pytest.mark.metered`** — Tests that spend funds require explicit opt-in (`POLYMARKET_RUN_METERED_TESTS=1`). This separates "read-only integration tests" from "spends real money tests".

2. **Polling with retry bounds** — `_wait_for_order_visible()` polls up to 8 times at 0.25s intervals (2s total). This handles CLOB eventual-consistency without arbitrary sleeps.

3. **Minimum-size guards** — All tests use `_minimum_order_size(market)` and `_minimum_tick_size(market)` from the market metadata, not hardcoded values.

4. **Insufficient-liquidity assertion** — The SDK defines `InsufficientLiquidityError` and tests it explicitly with an absurdly large amount.

5. **Status assertion** — `response.status in ("live", "matched", "delayed")` validates only known-good terminal states.

6. **Pre-trade vs post-trade comparison** — `estimate_market_price` (read-only) is tested independently from `place_market_order` (metered), enabling the former to run in any environment.

Source: [Polymarket/py-sdk `tests/integration/test_clob_orders.py`](https://github.com/Polymarket/py-sdk/blob/main/tests/integration/test_clob_orders.py) — all integration test patterns.
Source: [Polymarket/py-sdk `README.md`](https://github.com/Polymarket/py-sdk/blob/main/README.md) — metered test documentation.

### Q3: Why Naive "Buy Then Immediately Sell" Is Misleading

Based on the CLOB mechanics visible in the source code:

| Risk | Mechanism | Why It Distorts |
|------|-----------|-----------------|
| **Maker-taker asymmetry** | `postOnly` flag exists for maker-only orders; market orders are always taker | A "buy then sell" round-trip crosses the spread twice. The spread cost appears as "slippage" but is actually the cost of taking liquidity both ways. You're not measuring market quality — you're measuring your own taker cost. |
| **Fee drag** | `GET /fee-rate` returns per-token `base_fee` in bps; fees are charged on proceeds | Round-trip fees are not symmetrical. A buy at price P and sell at price P still incurs net fee loss. This masks the true fill quality. |
| **Book depletion & recovery** | `calculateBuyMarketPrice` walks the book; after a fill, the book state changes | Your buy consumes the best ask levels. When you immediately sell, the book hasn't recovered — you're selling into a book you just depleted. The measured "sell price" reflects your own impact, not resting liquidity. |
| **Tick-size rounding** | `ROUNDING_CONFIG` with tick sizes from 0.1 to 0.0001; `roundDown`, `roundUp`, `roundNormal` applied to maker/taker amounts | Price and size are quantized. A round-trip at the minimum tick may round differently in each direction, creating phantom P&L that isn't real market movement. |
| **Heartbeat cancellation** | `POST /v1/heartbeats` — if heartbeat isn't sent within 10s, all orders are cancelled | In a test harness with timing issues, orders may be cancelled by the heartbeat watchdog before the "sell" leg executes, producing a false "no liquidity" signal. |
| **FAK partial fills** | `OrderType.FAK` = "Fill and Kill: can be partially filled, unfilled portion cancelled" | A FAK round-trip may partially fill on both legs, making P&L calculation ambiguous without tracking `takingAmount`/`makingAmount` precisely. |
| **`delayed` status** | `OrderResponse.status` can be `"delayed"` | An order in "delayed" state hasn't landed on-chain yet. Selling against a position that isn't confirmed creates a phantom position test. |

Source: [Polymarket/clob-client `src/types.ts`](https://github.com/Polymarket/clob-client/blob/main/src/types.ts) — `OrderType.FAK` documentation, `postOnly` flag, `OrderResponse` status values.
Source: [Polymarket/clob-client `src/client.ts`](https://github.com/Polymarket/clob-client/blob/main/src/client.ts) — heartbeat documentation ("If heartbeats are started and one isn't sent within 10s, all orders will be cancelled"), `calculateMarketPrice` implementation.
Source: [Polymarket/clob-client `src/order-builder/helpers.ts`](https://github.com/Polymarket/clob-client/blob/main/src/order-builder/helpers.ts) — `ROUNDING_CONFIG`, book-walk logic.

### Q4: Assessment — Is This a Good Parallel Track Now?

**Yes, with specific scoping constraints.**

The evidence supports building a liquidity-validation test harness as a parallel track, because:

1. **The read-only surface is rich and well-defined.** The CLOB API exposes `/book`, `/spread`, `/midpoint`, `/price`, `/tick-size`, `/fee-rate`, and `/prices-history` — all without authentication. A phase-1 harness can measure spread, depth, price impact, and tick-size compliance using only read-only endpoints.

2. **The official SDK already models the testing pattern.** The `@pytest.mark.metered` / `InsufficientLiquidityError` / polling-with-retry pattern from `Polymarket/py-sdk` is a proven design for live-like testing. It doesn't need to be invented — it needs to be adapted.

3. **The metrics are observable from the API.** Every metric in Q1 has a corresponding endpoint or client method. No external data sources are needed.

**Recommended scope for the parallel track:**

| Phase | Scope | Risk | Depends On |
|-------|-------|------|------------|
| **Phase 1** | Read-only probe: snapshot book depth, compute spread, walk book for price impact at 3 size tiers, check tick-size validity, record fee rates | Zero financial risk | CLOB API read-only access (`https://clob.polymarket.com`) |
| **Phase 2** | Estimate-and-compare: use `estimate_market_price` (or reimpl book-walk) before/after synthetic events (e.g., large market news), compare estimated vs actual prices | Zero financial risk | Same as Phase 1 + event timestamps |
| **Phase 3** | Metered micro-execution: place minimum-size FAK orders, measure `takingAmount`/`makingAmount`/`status`/latency, cancel immediately | Minimal financial risk (minimum order sizes are small) | Authenticated CLOB access with funded wallet |
| **Phase 4** | Round-trip analysis (only after Phase 3 validates): controlled buy-hold-sell with explicit accounting for spread×2 + fees + tick rounding | Moderate financial risk | Same as Phase 3 + position management |

**Do NOT start at Phase 4.** The evidence is clear that round-trip testing without first characterizing the one-way metrics (spread, depth, price impact, fees) will produce misleading results.

Source: All findings above; synthesis based on the primary-source evidence chain.

---

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| OrderType enum: GTC, FOK, GTD, FAK with FAK partial-fill semantics | `Polymarket/clob-client` | `src/types.ts:159-178` |
| OrderResponse: success, errorMsg, orderID, status, takingAmount, makingAmount | `Polymarket/clob-client` | `src/types.ts:193-201` |
| OrderBookSummary: bids/asks with price+size, tick_size, min_order_size, last_trade_price | `Polymarket/clob-client` | `src/types.ts:316-328` |
| Spread endpoints: GET /spread, POST /spreads | `Polymarket/clob-client` | `src/endpoints.ts` |
| Book-walk price impact calculation (calculateBuyMarketPrice, calculateSellMarketPrice) | `Polymarket/clob-client` | `src/order-builder/helpers.ts` |
| Heartbeat: 10s timeout triggers cancel-all | `Polymarket/clob-client` | `src/client.ts` (postHeartbeat JSDoc) |
| TickSize enum: 0.1, 0.01, 0.001, 0.0001 with ROUNDING_CONFIG | `Polymarket/clob-client` | `src/order-builder/helpers.ts` |
| Metered test pattern with polling retry, minimum-size guards, InsufficientLiquidityError | `Polymarket/py-sdk` | `tests/integration/test_clob_orders.py` |
| AcceptedOrder status values: "live", "matched", "delayed" | `Polymarket/py-sdk` | `tests/integration/test_clob_orders.py` |
| SDK design: read-only client vs authenticated client, domain types | `Polymarket/py-sdk` | `docs/sdk-direction.md` |
| RFQ alternative execution path | `Polymarket/clob-client` | `src/rfq-client.ts` |
| Liquidity reward percentages endpoint | `Polymarket/clob-client` | `src/endpoints.ts` (GET_LIQUIDITY_REWARD_PERCENTAGES) |
| Fee rate per token in bps | `Polymarket/clob-client` | `src/endpoints.ts` (GET_FEE_RATE), `src/client.ts` (getFeeRateBps) |

### Risks / Unknowns

- [!] **No sandbox/testnet for CLOB.** The CLOB endpoint `https://clob.polymarket.com` is production-only. The official SDK tests use `@pytest.mark.metered` to gate real-money tests. There is no documented testnet or paper-trading environment. Phase 1 (read-only) is safe; Phase 3+ spends real USDC on Polygon.
- [!] **RFQ system is a separate execution path.** The CLOB client includes an `RfqClient` with its own request/quote/approve flow. RFQ fills may have different slippage characteristics than CLOB order-book fills. Any comprehensive harness should account for both paths.
- [?] **Websocket/streaming book updates.** The TS client imports WebSocket-related modules but the stream implementation details were not fully traced. Real-time book monitoring may require the streaming API, not just REST polling.
- [?] **Rate limits on read-only endpoints.** The official docs mention pagination (cursor-based) but rate-limit specifics were not found in the client source. Aggressive probing in Phase 1 may hit undocumented rate limits.
- [?] **PMXT-specific differences.** The research focused on Polymarket's official SDKs. PMXT (if a separate exchange) may have different order types, fee structures, or book mechanics. If PMXT is the Polymarket exchange itself, the findings apply directly.

---

## Context Handoff: CLOB Liquidity Validation

Start here: `research/2026-05-27-clob-liquidity-validation.md`

Context only. Use the saved report as the source of truth. All URLs are to official Polymarket GitHub repositories.
