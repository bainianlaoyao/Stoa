# Evolver Data Flow — Current Boundary State

> **Last updated:** 2026-04-30 (Task 9 — hard boundary cleanup)

## Boundary Model

- **Stoa** = host application. Owns session lifecycle, evidence capture, provider orchestration, and all integration responsibility.
- **Evolver** = vendored third-party engine dependency at `research/upstreams/evolver/`, pinned to upstream commit `bc17fda`. Read-only. Stoa never modifies files inside it.
- **Adapter** = `EvolverEngineAdapter` (thin, currently no-op). The only integration surface Stoa uses.

## Current State

The adapter is intentionally no-op. Investigation found no clean upstream entry points for memory actions (recall, distill, observe) that work without patching Evolver internals. Rather than maintain patched bridge surfaces, Stoa holds a hard boundary:

- No `src/stoa/*` inside the vendored Evolver tree.
- No bridge, client, CLI protocol, or host-bridge.
- No `publish-context`, `uv-pip capsule`, or JSON-over-stdin protocol.
- No memory inspection product surface in the renderer.

## Integration Responsibility

Stoa owns all integration responsibility. If Evolver capabilities are needed in the future, Stoa will:

1. Define the adapter contract in `src/` (Stoa-owned code).
2. Implement against clean upstream APIs only (no patching).
3. Keep the vendored tree read-only at all times.

## Files

| Concern | Location |
|---|---|
| Adapter interface | `src/core/evolver-engine-adapter.ts` |
| Vendored upstream | `research/upstreams/evolver/` (read-only) |
| Upstream inventory | `research/2026-04-30-evolver-upstream-hardcoding-inventory.md` |

## Non-goals

- No Stoa-owned memory database or selection layer.
- No compatibility shim for legacy injector, bridge, or CLI architectures.
- No migration code for old direct-memory pipelines.
