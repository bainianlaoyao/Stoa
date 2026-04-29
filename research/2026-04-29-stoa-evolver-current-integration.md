---
date: 2026-04-29
topic: stoa-evolver-current-integration
status: completed
mode: context-gathering
sources: 11
---

## Context Report: Stoa Evolver Current Integration

### Why This Was Gathered
Answer whether Stoa is truly wired to Evolver today, how that wiring works, and which session types actually participate.

### Summary
Stoa is genuinely wired to the bundled Evolver runtime, not a fake in-memory stub. The main Electron process resolves a bundled Evolver repo, instantiates `EvolverClient`, and passes it into `SessionEventBridge`, which calls Evolver on `SessionStart`, `UserPromptSubmit`, `PostToolUse(Write)`, and turn finalization.

Current session support is uneven. `claude-code` is the only session type verified end-to-end with real LLM behavior and real memory injection. `codex` has a real hook integration path in code and webhook adaptation, so it is structurally integrated but not yet proven by the same real memory E2E. `opencode` is registered as a possible consumer, but its sidecar emits plain `/events` without memory evidence, so it does not actually enter the Evolver memory lifecycle today.

### Key Findings
- Stoa main process instantiates a real `EvolverClient` from a bundled Evolver checkout and injects it into `SessionEventBridge`.
- `EvolverClient` talks to Evolver through CLI `host-bridge` actions such as `warm-start`, `recall`, `observe-write`, `process-turn`, `prepare-review`, and `prepare-distill`.
- `SessionEventBridge` invokes Evolver on `SessionStart` and `UserPromptSubmit`, sends write observations on `PostToolUse(Write)`, and seals turns on `Stop` / `StopFailure`.
- `claude-code` installs native Claude hooks that post to `/hooks/claude-code`, including `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `StopFailure`, and `PermissionRequest`.
- `codex` installs Codex hooks that post to `/hooks/codex`, including `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop`.
- Webhook validation only recognizes memory-runtime evidence providers `claude-code` and `codex`.
- `opencode` posts to `/events` with ordinary state payloads only; it does not attach `evidence`, so the memory lifecycle short-circuits before any Evolver call.
- The real three-run experiment script is Claude-only and wires both `EvolverClient` and `TurnMaintenanceRunner`; this is the only confirmed real memory flow today.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Main process resolves bundled Evolver and injects `evolverBridge` into `SessionEventBridge` | `src/main/index.ts` | `src/main/index.ts:512-527` |
| Bundled Evolver resolves from packaged resources or `research/upstreams/evolver` | `src/core/memory/bundled-evolver.ts` | `src/core/memory/bundled-evolver.ts:36-45`, `src/core/memory/bundled-evolver.ts:68-97` |
| `EvolverClient` uses real CLI `host-bridge` actions | `src/core/memory/evolver-client.ts` | `src/core/memory/evolver-client.ts:141-201`, `src/core/memory/evolver-client.ts:246-280` |
| Session lifecycle calls `warmStart`, `recall`, `observeWrite`, and turn sealing | `src/main/session-event-bridge.ts` | `src/main/session-event-bridge.ts:345-428`, `src/main/session-event-bridge.ts:431-553` |
| Memory consumers are enumerated as `claude-code`, `codex`, `opencode` | `src/main/session-event-bridge.ts` | `src/main/session-event-bridge.ts:597-600` |
| Claude provider installs hooks posting to `/hooks/claude-code` | `src/extensions/providers/claude-code-provider.ts` | `src/extensions/providers/claude-code-provider.ts:93-115`, `src/extensions/providers/claude-code-provider.ts:126-215` |
| Codex provider installs hooks posting to `/hooks/codex` | `src/extensions/providers/codex-provider.ts` | `src/extensions/providers/codex-provider.ts:41-132` |
| Webhook server only validates memory evidence providers `claude-code` and `codex`; it exposes `/hooks/claude-code` and `/hooks/codex` | `src/core/webhook-server.ts` | `src/core/webhook-server.ts:8-10`, `src/core/webhook-server.ts:223-275`, `src/core/webhook-server.ts:277-340` |
| Hook adapters build `evidence` only for Claude and Codex | `src/core/hook-event-adapter.ts` | `src/core/hook-event-adapter.ts:11-55`, `src/core/hook-event-adapter.ts:58-149` |
| OpenCode provider only writes a plugin that posts ordinary `/events` payloads without `evidence` | `src/extensions/providers/opencode-provider.ts` | `src/extensions/providers/opencode-provider.ts:31-40`, `src/extensions/providers/opencode-provider.ts:43-63` |
| Real experiment is Claude-only and wires `TurnMaintenanceRunner` with real inference/execution capabilities | `scripts/run-real-first-round-experiment.ts` | `scripts/run-real-first-round-experiment.ts:68-92`, `scripts/run-real-first-round-experiment.ts:94-140` |

### Risks / Unknowns
- `codex` is structurally wired, but I did not find a real multi-run memory experiment equivalent to the Claude experiment in this pass.
- `opencode` being listed in `toMemoryConsumer()` can mislead readers into thinking it already participates in memory injection, but its event path does not provide the required hook evidence today.
- The full turn-maintenance path in mainline depends on runtime files under `src/core/memory/*`; some of those new files are currently being hidden from git by the broad `.gitignore` `memory` rule, which is a source-control risk rather than a runtime design issue.

## Context Handoff: Stoa Evolver Current Integration

Start here: `research/2026-04-29-stoa-evolver-current-integration.md`

Context only. Use the saved report as the source of truth.
