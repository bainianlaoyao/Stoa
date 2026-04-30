---
date: 2026-04-29
topic: evolver runtime host current state
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Evolver Runtime Host Current State

### Why This Was Gathered
Re-verify the current Stoa x Evolver integration before deciding how memory-stage notifications should work in the frontend.

### Summary
The integration has moved beyond the earlier "memory AI provider + single bridge" shape. Current code splits the flow into two layers: `SessionEventBridge` handles `warmStart / recall / observeWrite`, while a separate `TurnMaintenanceRunner` drives post-turn `processTurn -> review -> solidify -> distill` using host-provided inference and execution capabilities. The renderer already has read-only memory introspection IPCs, but there is still no real renderer UI consuming them.

### Key Findings
- Settings and public contracts no longer expose `memoryAiProvider`; they now expose `evolverInferenceProvider` and `evolverExecutionMode`, plus read-only memory inspection requests in the shared `RendererApi`. [src/shared/project-session.ts:12-13](D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:12), [src/shared/project-session.ts:129-169](D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:129), [src/shared/project-session.ts:231-268](D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:231)
- The preload bridge now exports four read-only memory APIs: `getMemoryStateSummary`, `traceMemoryTurn`, `explainMemoryRecall`, and `getMemoryAsset`. [src/preload/index.ts:75-85](D:/Data/DEV/ultra_simple_panel/src/preload/index.ts:75)
- Main process boot no longer wires a raw `EvolverClient` directly into the app. It constructs a `memoryRuntimeHost`, injects both `evolverBridge` and `turnMaintenanceRunner` into `SessionEventBridge`, and exposes the read-only memory IPC handlers through `memoryRuntimeHost.evolverBridge`. [src/main/index.ts:511-529](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:511), [src/main/index.ts:989-1002](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:989)
- Lifecycle split is now explicit: `SessionEventBridge` handles `SessionStart -> warmStart`, `UserPromptSubmit -> recall`, `PostToolUse(Write) -> observeWrite`, and `Stop/StopFailure -> finalizeTurn`. [src/main/session-event-bridge.ts:371-425](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:371)
- Turn-end maintenance is a second-stage runner. After sealing evidence, `SessionEventBridge` queues a maintenance job and delegates to `turnMaintenanceRunner.run(...)` instead of calling a single `processTurn` path itself. [src/main/session-event-bridge.ts:433-500](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:433), [src/main/session-event-bridge.ts:503-560](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:503)
- `TurnMaintenanceRunner` executes the upstream-like sequence `processTurn -> prepareReview/completeReview -> prepareSolidify/completeSolidify -> prepareDistill/completeDistill`, using resolved host inference and execution capabilities. [src/core/memory/turn-maintenance-runner.ts:46-130](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:46)
- The runtime host can degrade to `recall-only`. If inference or execution cannot be resolved, availability is marked `recall-only`, but a `TurnMaintenanceRunner` is still returned; at runtime the runner can skip maintenance and emit a synthetic `job_<turn>_skipped`. [src/core/memory/runtime-host.ts:104-121](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:104), [src/core/memory/turn-maintenance-runner.ts:54-65](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:54)
- Inference provider support is currently asymmetric: `claude-code` resolves to a capability, while `codex` and `api` inference throw `"not implemented"` in the runtime host. That means "selected provider" and "usable full maintenance path" are not equivalent today. [src/core/memory/runtime-host.ts:66-85](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:66)
- Upstream `hostBridge process-turn` already computes richer results including `signalKey`, `outcomeEventId`, and `distilledCapsuleIds`, but Stoa's shared `ProcessTurnResult` still only exposes `jobId`. That contract currently hides detail needed for precise distill notifications. [research/upstreams/evolver/src/stoa/hostBridge.js:601-650](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:601), [src/shared/memory-runtime.ts:114-122](D:/Data/DEV/ultra_simple_panel/src/shared/memory-runtime.ts:114)
- The latest design spec confirms the intended boundary: Stoa is the runtime host, Evolver is the memory engine, read-only introspection UI is allowed, and the current implementation is still transitional rather than final. [docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md:7-33](D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md:7), [docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md:18-22](D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md:18)
- The renderer still has no visible memory UI. The main app boot path hydrates workspace, observability, settings, and update state only, and the visible providers settings UI only persists the Evolver inference provider. I did not find non-test renderer consumers of the four memory APIs beyond their preload exports. [src/renderer/app/App.vue:115-144](D:/Data/DEV/ultra_simple_panel/src/renderer/app/App.vue:115), [src/renderer/components/settings/ProvidersSettings.vue:79-102](D:/Data/DEV/ultra_simple_panel/src/renderer/components/settings/ProvidersSettings.vue:79), [src/preload/index.ts:75-85](D:/Data/DEV/ultra_simple_panel/src/preload/index.ts:75)

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Settings moved to Evolver host contracts | `src/shared/project-session.ts` | [12-13](D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:12), [129-169](D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:129), [231-268](D:/Data/DEV/ultra_simple_panel/src/shared/project-session.ts:231) |
| Preload exports read-only memory IPCs | `src/preload/index.ts` | [75-85](D:/Data/DEV/ultra_simple_panel/src/preload/index.ts:75) |
| Main boot uses `createMemoryRuntimeHost` and exposes memory IPCs through it | `src/main/index.ts` | [511-529](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:511), [989-1002](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:989) |
| Event bridge now owns recall-side lifecycle only | `src/main/session-event-bridge.ts` | [371-425](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:371) |
| Turn maintenance is queued separately after stop | `src/main/session-event-bridge.ts` | [433-560](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:433) |
| Maintenance runner executes review, solidify, distill | `src/core/memory/turn-maintenance-runner.ts` | [46-130](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:46) |
| Runtime host can fall back to recall-only | `src/core/memory/runtime-host.ts` | [104-121](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:104) |
| Codex and API inference are not implemented for maintenance | `src/core/memory/runtime-host.ts` | [66-85](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:66) |
| Upstream process-turn returns richer data than Stoa surfaces | `research/upstreams/evolver/src/stoa/hostBridge.js`, `src/shared/memory-runtime.ts` | [601-650](D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/stoa/hostBridge.js:601), [114-122](D:/Data/DEV/ultra_simple_panel/src/shared/memory-runtime.ts:114) |
| Current spec is target-state, not implementation snapshot | `docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md` | [18-22](D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md:18), [26-33](D:/Data/DEV/ultra_simple_panel/docs/superpowers/specs/2026-04-29-stoa-evolver-runtime-host-design.md:26) |

### Risks / Unknowns
- [!] `validation` is the wrong integration term for the current Stoa layer if we want precise UI semantics. The executable phase exposed by the runner is `solidify`, which may or may not map 1:1 to user-facing "validation".
- [!] `ProcessTurnResult` is still too thin for reliable distill-result toasts. We can detect that maintenance finished, but not how many capsules were distilled unless we extend the Stoa contract or query a trace endpoint after completion.
- [!] Full maintenance is conditional. In `recall-only` mode, recall can still work while review/solidify/distill silently skip at runtime.
- [?] There is still no dedicated renderer-side event channel for memory lifecycle notifications. The cleanest path may be a new ephemeral IPC/pub-sub layer rather than overloading observability snapshots.
- [?] The latest spec allows read-only introspection UI, but current implementation remains transitional. Any notification design should target current code paths without assuming the target rewrite has already landed.

## Context Handoff: Evolver Runtime Host Current State

Start here: `research/2026-04-29-evolver-runtime-host-current-state.md`

Context only. Use the saved report as the source of truth.
