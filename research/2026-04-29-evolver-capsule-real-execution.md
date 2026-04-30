---
date: 2026-04-29
topic: evolver capsule real execution distinction
status: completed
mode: context-gathering
sources: 7
---

> **Status: DEPRECATED.** This document describes investigation done before the Stoa x Evolver hard boundary cleanup (2026-04-30). The `host-bridge` / `publish-context` / `uv-pip capsule` / `src/stoa/*` surfaces described here are no longer part of Stoa's integration. See `research/2026-04-30-evolver-upstream-hardcoding-inventory.md` for the current boundary state.

## Context Report: Evolver Capsule and Real Execution

### Why This Was Gathered
To answer whether upstream Evolver requires "real execution" for capsule generation, and whether the current Stoa-integrated run satisfied that requirement.

### Summary
The answer depends on what "real execution" means.

In this run, the capsule was derived from real Claude tool execution evidence on a real repository: actual `pip install -e .`, actual `uv sync`, real tool results, and real file writes were recorded into turn evidence. However, Evolver itself did not launch a second autonomous execution/validation run in the `process-turn` path. The current Stoa integration uses Evolver's `host-bridge` path, where `process-turn` extracts capsules directly from persisted evidence text.

### Key Findings
- Upstream README distinguishes read-only evolution logic from the small subset that actually executes commands.
- Upstream examples that say "first real execution" refer to distillation/validation runs recorded as EvolutionEvents.
- Our experiment did not call `evolver run`; it used `warm-start`, `recall`, `observe-write`, and `process-turn` through `host-bridge`.
- In `host-bridge`, capsule creation is done by `persistExtractedCapsules(...)`, which pattern-matches persisted evidence text and upserts a capsule.
- The evidence text for this run contains real Bash/Write/Read tool calls and real command outputs, including `pip install -e .` and `uv sync`.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| upstream says `src/evolve.js` is read-only and `solidify.js` is the command-executing component | upstream README | `research/upstreams/evolver/README.md:427` |
| upstream event examples explicitly call out `first real execution` / `second independent execution` | upstream events | `research/upstreams/evolver/assets/gep/events.jsonl:1` |
| our experiment constructs `EvolverClient` and uses `SessionEventBridge`, not `evolver.run()` | experiment script | `scripts/run-real-first-round-experiment.ts:66` |
| `EvolverClient` has `warmStart/recall/observeWrite/processTurn` mapped to `host-bridge` actions | client | `src/core/memory/evolver-client.ts:90` |
| `host-bridge process-turn` creates capsules by `persistExtractedCapsules(evidenceEntries)` | upstream hostBridge | `research/upstreams/evolver/src/stoa/hostBridge.js:558` |
| capsule extraction is simple evidence-text pattern matching for `use uv` + `instead of pip` style signals | upstream hostBridge | `research/upstreams/evolver/src/stoa/hostBridge.js:220` |
| session event bridge seals turn evidence and asynchronously calls `evolverBridge.processTurn(...)` | bridge | `src/main/session-event-bridge.ts:427` |
| real tool execution evidence includes actual `pip install -e .` stdout | sealed evidence | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/evidence/session_3853db69-3108-484c-b91d-639674a97c0d/a7a2d714-e1a7-4010-bb0d-7c2c1035151b/transcript.jsonl:18` |
| real tool execution evidence includes actual `uv sync` stdout | sealed evidence | `C:/Users/30280/AppData/Local/Temp/stoa-first-round-real-Vyvp1l/project/.stoa/memory/evidence/session_120e5cee-c9e4-4bcc-a78a-475a5b14fa67/4bb78cb0-6022-478d-8a8e-e36f97bcfe8f/transcript.jsonl:7` |

### Bottom Line
- If "real execution" means "the memory is grounded in a real agent run with real tool outputs", then yes, this run had that.
- If "real execution" means "Evolver itself initiated another execution/validation cycle before minting the capsule", then no, this run did not do that.
- The current Stoa integration is a lighter-weight post-hoc evidence distillation path, not the full upstream autonomous evolution/solidify path.

### Risks / Unknowns
- This answer is specific to the current `host-bridge process-turn` integration path, not to every possible Evolver command.
- If you want upstream-stronger semantics, you would need a path that turns candidate capsules/genes into validated EvolutionEvents with explicit execution traces, rather than only evidence-text extraction.

## Context Handoff: Evolver Capsule and Real Execution

Start here: `research/2026-04-29-evolver-capsule-real-execution.md`

Context only. Use the saved report as the source of truth.
