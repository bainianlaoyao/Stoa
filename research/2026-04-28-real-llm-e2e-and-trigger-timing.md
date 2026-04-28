---
date: 2026-04-28
topic: real llm e2e and trigger timing
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Real LLM E2E And Trigger Timing

### Why This Was Gathered
Answer whether the current E2E suite proves the real-LLM memory path works, and identify the exact runtime trigger timing for distillation and Claude memory injection.

### Summary
The current suite proves the core backend memory pipeline can run through a real LLM provider, real git/worktree setup, real Evolver CLI, and real state persistence. It does not prove one single fully integrated path from a live provider webhook all the way into the next real Claude launch consuming memory in one test; that coverage is split across focused tests.

### Key Findings
- The real-LLM E2E path is covered at the maintainer layer: the test creates a real evidence snapshot, persists it, selects `memoryAiProvider: 'api'`, and calls `EvolverMaintainer.processTurnCompletion(...)` with the real MiniMax API provider.
- Distillation is triggered only after a completed turn has been ingested, Evolver has run, review is approved, and `tryCompleteDistillation(...)` is entered.
- Injection is triggered only for Claude sessions, before the runtime is launched or resumed.
- Claude consumption of injected memory happens through the SessionStart hook wrapper, which sets `MEMORY_GRAPH_PATH` from `.stoa/generated/evolver-context/claude-code.jsonl` if the file exists.
- The “full chain” is therefore split into three validated segments:
  - event/evidence ingestion to memory runtime notification
  - maintainer run/review/distill with real LLM
  - injector publish/write plus Claude wrapper consumption

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Real API E2E persists evidence and calls maintainer directly | `tests/e2e/evolver-memory-real-api.test.ts` | lines 104-121 |
| Real API E2E sets `memoryAiProvider: 'api'` | `tests/e2e/evolver-memory-real-api.test.ts` | line 113 |
| Real API E2E full pipeline test description | `tests/e2e/evolver-memory-real-api.test.ts` | line 94 |
| Session bridge persists evidence before notifying memory runtime | `src/main/session-event-bridge.ts` | lines 81-86, 224-245 |
| Memory runtime only reacts to `agent.turn_completed` and queues per session | `src/core/memory/runtime.ts` | lines 18-38 |
| Maintainer entry point | `src/core/memory/evolver-maintainer.ts` | line 97 |
| Distillation runs only after approved review state | `src/core/memory/evolver-maintainer.ts` | lines 196-201, 249-273 |
| Maintainer marks Claude publication as pending only after success | `src/core/memory/evolver-maintainer.ts` | lines 227-235 |
| Launch path injects Claude context before starting runtime | `src/main/launch-tracked-session-runtime.ts` | lines 45-58 |
| Injector calls `publishContext('claude-code')` and writes generated file | `src/core/memory/claude-code-injector.ts` | lines 74-126, 146 |
| Claude wrapper sets `MEMORY_GRAPH_PATH` from generated `claude-code.jsonl` on SessionStart | `src/extensions/providers/claude-code-provider.ts` | lines 114-147 |
| Real injector E2E exists and calls injector directly | `tests/e2e/evolver-memory-pipeline.test.ts` | lines 355, 462 |

### Risks / Unknowns
- The real-LLM E2E test bypasses the live provider webhook path by persisting evidence and calling the maintainer directly, so it does not validate the entire live provider-to-memory chain in one shot.
- The injector E2E validates `publish-context` and file generation, and the provider test validates SessionStart wrapper consumption, but there is no single test that launches a real Claude session and proves it actually consumes the generated memory in the next session.
- The current real-LLM path is Claude-consumer-only. Codex can act as the summarizer/reviewer/distiller provider, but not as a published-context consumer in this flow.

## Context Handoff: Real LLM E2E And Trigger Timing

Start here: `research/2026-04-28-real-llm-e2e-and-trigger-timing.md`

Context only. Use the saved report as the source of truth.
