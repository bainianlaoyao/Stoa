---
date: 2026-04-28
topic: evolver native hooks and bridge necessity
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Evolver Native Hooks And Bridge Necessity

### Why This Was Gathered
Answer which host tools Evolver natively supports for hook-based injection, and whether the current Stoa-side interception and bridge architecture is unnecessary overengineering.

### Summary
Evolver already has native integration surfaces for `Cursor`, `Claude Code`, `Codex`, and `Kiro`, plus stdout-driven host cooperation for `OpenClaw`. But those native integrations are intentionally lightweight: `SessionStart` injects recent memory from a memory graph, `PostToolUse`/edit hooks do keyword-level signal detection, and `Stop` does git-diff-based outcome recording. They do not replace Stoa’s durable provider-evidence capture, session-scoped materialization, runtime state tracking, or provider-selected review/distillation flow.

### Key Findings
- Evolver natively detects and installs adapters for `cursor`, `claude-code`, `codex`, and `kiro`.
- Native Claude/Codex/Cursor/Kiro support is hook-level integration, not transcript-ingestion integration.
- The native `session-start` script only reads a memory graph file, preferring `MEMORY_GRAPH_PATH` when present.
- The native `signal-detect` and `session-end` scripts are heuristic and lightweight. They inspect edit content or git diff text; they do not ingest provider-native transcripts or durable evidence snapshots.
- Our current repository already simplified the runtime hook surface: for Claude, Stoa owns the webhook hooks and only reuses the Evolver `SessionStart` injector wrapper.
- The extra Stoa layers are justified if the goal is durable session evidence, deterministic per-project/session publish, selected-provider review/distill, and idempotent state tracking.
- The extra layers would be unnecessary only if the goal were merely “inject a recent memory graph into Claude/Codex at session start and record rough outcomes”.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Evolver supports `cursor`, `claude-code`, `codex`, `kiro` adapters | `research/upstreams/evolver/src/adapters/hookAdapter.js` | lines 5-9, 34-40 |
| Cursor hooks are `sessionStart`, `afterFileEdit` with matcher `Write`, and `stop` | `research/upstreams/evolver/src/adapters/cursor.js` | lines 7-33 |
| Claude Code hooks are `SessionStart`, `PostToolUse` with matcher `Write`, and `Stop` | `research/upstreams/evolver/src/adapters/claudeCode.js` | lines 8-47 |
| Codex hooks are `SessionStart`, `PostToolUse`, and `Stop`; adapter also enables `codex_hooks` and injects `AGENTS.md` guidance | `research/upstreams/evolver/src/adapters/codex.js` | lines 8-35, 37-57, 60-70, 91-113 |
| Kiro uses `promptSubmit`, `postToolUse write`, and `agentStop` because it lacks a true session-start event | `research/upstreams/evolver/src/adapters/kiro.js` | lines 14-31, 35-60 |
| README documents `setup-hooks` for Cursor and Claude Code, and native stdout cooperation for OpenClaw | `research/upstreams/evolver/README.md` | lines 124-135, 176-183 |
| Native session-start injection only reads recent entries from a memory graph and prefers `MEMORY_GRAPH_PATH` | `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | lines 28-40, 124-140 |
| Native signal detection is keyword scanning over edit content/diff only | `research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js` | lines 6-29, 40-55 |
| Native session-end derives outcome from git diff stats and records to Hub/local graph | `research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js` | lines 52-77, 79-91, 129-147, 157-193 |
| Stoa plan explicitly assumes native session-end/signal-detect do not replace transcript-backed evidence capture | `docs/superpowers/plans/2026-04-27-full-evolver-integration-cli-ai-provider.md` | lines 48-55 |
| Stoa architecture intentionally owns durable evidence snapshots, materialization, runtime state, and selected-provider review/distill | `docs/superpowers/plans/2026-04-27-full-evolver-integration-cli-ai-provider.md` | lines 5-7, 21-27, 36-37, 276-279, 353-359 |
| Session bridge persists provider evidence snapshots before notifying the memory runtime | `src/main/session-event-bridge.ts` | lines 73-90, 224-245 |
| Memory runtime only triggers maintainer work on `agent.turn_completed` | `src/core/memory/runtime.ts` | lines 18-31 |
| Maintainer does summary -> materialize -> Evolver run -> review export/approve/reject -> distill completion -> runtime-state updates | `src/core/memory/evolver-maintainer.ts` | lines 97-167, 183-235, 249-275 |
| Injector selects a successful publishable run, calls native `publish-context --target=claude-code`, writes `.stoa/generated/evolver-context/claude-code.jsonl`, and tracks publish state | `src/core/memory/claude-code-injector.ts` | lines 74-142, 146-183 |
| Current Claude provider keeps Stoa webhook hooks and only reuses an Evolver `SessionStart` wrapper that sets `MEMORY_GRAPH_PATH` from the generated context file | `src/extensions/providers/claude-code-provider.ts` | lines 68-121, 132-173 |
| Launch path injects Claude context before runtime start/resume | `src/main/launch-tracked-session-runtime.ts` | lines 48-63 |
| Patched Evolver already exposes machine-readable `publish-context`, `review export/approve/reject`, and `distill prepare/complete` surfaces | `research/upstreams/evolver/src/stoa/publishContext.js` | lines 11-47, 70-89, 128-149 |
| Patched Evolver review bridge exports structured review payload and apply/reject actions | `research/upstreams/evolver/src/stoa/reviewBridge.js` | lines 19-57, 59-88, 90-166 |
| Patched Evolver distill bridge exposes structured prepare/complete file-based interfaces | `research/upstreams/evolver/src/stoa/distillBridge.js` | lines 8-39, 42-73 |

### Risks / Unknowns
- Codex is natively listed as a hook adapter upstream, but this repository still does not implement a verified Codex published-context consumer path equivalent to the Claude `MEMORY_GRAPH_PATH` wrapper.
- If the product requirement is reduced to “basic memory injection plus rough signal capture”, the current Stoa maintainer/injector stack is heavier than necessary.
- If Stoa keeps owning review decisions, be careful not to duplicate semantics with future upstream Evolver review/distill evolution.

## Context Handoff: Evolver Native Hooks And Bridge Necessity

Start here: `research/2026-04-28-evolver-native-hooks-and-bridge-necessity.md`

Context only. Use the saved report as the source of truth.
