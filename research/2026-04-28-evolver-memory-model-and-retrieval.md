---
date: 2026-04-28
topic: evolver memory model and retrieval
status: completed
mode: context-gathering
sources: 14
---

## Context Report: Evolver Memory Model And Retrieval

### Why This Was Gathered
Correct an overly flat explanation of Evolver memory and answer whether Stoa should model memory as a single published blob or as a retrievable memory base with consumer-specific delivery.

### Summary
Evolver memory is not a single document. It is closer to a scoped memory substrate composed of memory graph events plus related asset stores such as genes, capsules, event logs, failed capsules, reflections, and narrative summaries. Runtime consumption already works by retrieving or selecting a relevant slice of that substrate: the native `session-start` hook reads recent entries from the memory graph, while selector / reflection / narrative modules expose separate retrieval and synthesis surfaces. In Stoa terms, `publish-context` should be treated as a delivery view or retrieval result, not as “the memory itself”.

### Key Findings
- Evolver’s baseline run model is: scan `memory/`, select Gene/Capsule, emit a GEP prompt, then record an auditable `EvolutionEvent`.
- Evolver stores multiple asset classes, not one memory file: genes, capsules, events, external candidates, failed capsules, scoped evolution outputs, and the memory graph used by hooks.
- The native Claude/Codex session-start path already behaves like retrieval, not replay: it resolves `MEMORY_GRAPH_PATH`, reads only the last few entries, and injects a short summary.
- The memory graph module exposes APIs for advice, signal snapshots, hypotheses, attempts, outcomes, and external candidates, which is consistent with an evented memory database rather than a flat publish artifact.
- The selector module is a separate retrieval/decision layer: it selects gene/capsule combinations, computes drift, supports multi-gene chunks, and emits a selector decision.
- Reflection and narrative are separate synthesis layers on top of the event history, not the same thing as the memory graph itself.
- In the patched Stoa bridge, `publish-context` is already a rendered target-specific view: it declares `target`, `source_refs`, `selection_policy`, and returns consumer-shaped `content`.
- In the current app, `run` is a Stoa/Evolver orchestration unit that pins one materialized evidence snapshot set, one scoped worktree, one scoped memory/evolution asset tree, and one review/distill lifecycle. That is an operational boundary, not the conceptual definition of memory.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Evolver run scans memory, selects Gene/Capsule, emits prompt, records EvolutionEvent | `research/upstreams/evolver/README.md` | 106-114 |
| README restates scan -> select -> emit -> record flow | `research/upstreams/evolver/README.md` | 161-164 |
| Memory dir / evolution dir / scoped evolution dir are first-class paths | `research/upstreams/evolver/src/gep/paths.js` | 102-126 |
| Asset stores include genes, capsules, events, candidates, external candidates, failed capsules | `research/upstreams/evolver/src/gep/assetStore.js` | 168-175 |
| Native session-start prefers `MEMORY_GRAPH_PATH` | `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | 28-39 |
| Native session-start reads last entries from memory graph and injects a short summary | `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | 124-146 |
| Memory graph module exports advice / signal snapshot / hypothesis / attempt / outcome / external candidate APIs | `research/upstreams/evolver/src/gep/memoryGraph.js` | 1 |
| Memory graph adapter exports `getAdvice`, record APIs, and graph path helpers | `research/upstreams/evolver/src/gep/memoryGraphAdapter.js` | 1 |
| Selector exports gene/capsule selection, drift, multi-gene chunk, and selector decision APIs | `research/upstreams/evolver/src/gep/selector.js` | 1 |
| Reflection exports reflection context building and persistence APIs | `research/upstreams/evolver/src/gep/reflection.js` | 1 |
| Narrative memory exports record/load/trim summary APIs | `research/upstreams/evolver/src/gep/narrativeMemory.js` | 1 |
| Patched `publish-context` returns target, source refs, content, and selection policy metadata | `research/upstreams/evolver/src/stoa/publishContext.js` | 11-47 |
| Claude-specific published context is a rendered, deduped last-5 memory-graph view | `research/upstreams/evolver/src/stoa/publishContext.js` | 70-88, 128-149 |
| Current app models published context as target-specific content with `source_refs` and `selection_policy` | `src/shared/memory-runtime.ts` | 71-100 |
| Current app treats a run as a scoped worktree + memory/evolution/gep asset bundle tied to one turn-completion process | `src/core/memory/evolver-maintainer.ts` | 122-167, 206-220 |
| Current app currently picks latest publishable run and publishes for `claude-code` specifically | `src/core/memory/claude-code-injector.ts` | 74-124 |

### Risks / Unknowns
- The upstream GEP internals are partly obfuscated, so exported interfaces are clearer than implementation detail for `memoryGraph`, `selector`, `reflection`, and `narrativeMemory`.
- The current Stoa `publish-context` bridge is still too Claude-shaped for a future where all session types become first-class consumers.
- If Stoa keeps “latest publishable run” as a hard prerequisite for every consumer injection, it may over-couple consumer retrieval to a particular approval lifecycle that not every consumer actually needs.

## Context Handoff: Evolver Memory Model And Retrieval

Start here: `research/2026-04-28-evolver-memory-model-and-retrieval.md`

Context only. Use the saved report as the source of truth.
