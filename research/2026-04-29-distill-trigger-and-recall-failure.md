---
date: 2026-04-29
topic: distill trigger and recall failure
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Distill Trigger And Recall Failure

### Why This Was Gathered
Explain when `distill` is actually triggered in the real Stoa UI, and why `recall` can fail at runtime.

### Summary
`distill` is not a prompt-start event. In the current implementation it is a post-turn maintenance phase that starts only after the provider emits `Stop` or `StopFailure`, the turn evidence is sealed, and the asynchronous maintenance runner reaches `prepareDistill -> inference.invoke(purpose='distill') -> completeDistill`. The toast is only visible in the renderer if that notification belongs to the currently active session.

`recall` is a best-effort subprocess call fired on `UserPromptSubmit`. It fails when the bundled Evolver `host-bridge recall` command exits non-zero or does not emit parseable JSON. Stoa currently degrades that failure to a warning and skips the recall injection instead of failing the user turn.

### Key Findings
- `UserPromptSubmit` is the only place that triggers recall. It trims `promptText`, calls `evolverBridge.recall(...)`, emits a success/info toast on delivery, and logs a warning on failure instead of propagating the error. [src/main/session-event-bridge.ts:393](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:393)
- `Stop` and `StopFailure` are the lifecycle hooks that trigger post-turn finalization. Finalization seals the turn, records the sealed evidence, and asynchronously starts `runTurnMaintenanceJob(...)`. [src/main/session-event-bridge.ts:449](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:449) [src/main/session-event-bridge.ts:460](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:460)
- Distill is not the first maintenance step. The runner resolves inference/execution capability, calls `processTurn`, then runs `review`, then `solidify`, then `distill`. The distill phase event is emitted only after `prepareDistill`, LLM invocation with `purpose: 'distill'`, and `completeDistill(...)` all succeed. [src/core/memory/turn-maintenance-runner.ts:70](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:70) [src/core/memory/turn-maintenance-runner.ts:146](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:146)
- Real UI notifications come from the main process `onTurnPhaseEvent` hook. `distill` becomes the toast title `Memory distilled` or `Distill failed`, then is pushed over `IPC_CHANNELS.memoryNotification`. [src/main/index.ts:396](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:396) [src/main/index.ts:555](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:555)
- The renderer only shows memory toasts for the active session. If the user switches sessions before the phase notification arrives, the toast is intentionally dropped. [src/renderer/app/App.vue:124](D:/Data/DEV/ultra_simple_panel/src/renderer/app/App.vue:124)
- Not every runtime can reach distill. If inference or execution capability resolution fails, the runtime host drops to `recall-only`, and the maintenance runner returns a skipped job before any solidify/distill phase event is emitted. [src/core/memory/runtime-host.ts:67](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:67) [src/core/memory/runtime-host.ts:105](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:105) [src/core/memory/turn-maintenance-runner.ts:72](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:72)
- Today, `claude-code` is the only implemented inference path for full turn maintenance. `codex` and `api` explicitly throw `"not implemented"` in the runtime host, which means those settings can still allow recall but will prevent distill. [src/core/memory/runtime-host.ts:72](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:72)
- Recall is executed by the Evolver client as `host-bridge recall --request-file=... --json`. The subprocess wrapper throws `JsonCommandError("Command failed: <command>")` when that command exits non-zero without parseable JSON. It also throws if the process output is not valid JSON. [src/core/memory/evolver-client.ts:145](D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:145) [src/core/memory/evolver-client.ts:285](D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:285) [src/core/memory/command-runner.ts:51](D:/Data/DEV/ultra_simple_panel/src/core/memory/command-runner.ts:51)
- The hook adapter maps provider lifecycle into these states: `UserPromptSubmit -> agent.turn_started`, `Stop -> agent.turn_completed`, `StopFailure -> agent.turn_failed`. That is why recall happens at prompt submission, while distill happens only after a completed or failed turn end hook arrives. [src/core/hook-event-adapter.ts:158](D:/Data/DEV/ultra_simple_panel/src/core/hook-event-adapter.ts:158)

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Recall runs on `UserPromptSubmit` and is degraded to warning on failure | `src/main/session-event-bridge.ts` | [393-428](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:393) |
| Turn maintenance starts from `Stop` / `StopFailure` finalization | `src/main/session-event-bridge.ts` | [449-520](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:449) |
| Distill is a later maintenance phase after review/solidify | `src/core/memory/turn-maintenance-runner.ts` | [84-169](D:/Data/DEV/ultra_simple_panel/src/core/memory/turn-maintenance-runner.ts:84) |
| Main process converts phase events into memory toasts | `src/main/index.ts` | [396-418](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:396), [546-571](D:/Data/DEV/ultra_simple_panel/src/main/index.ts:546) |
| Renderer only shows active-session notifications | `src/renderer/app/App.vue` | [124-129](D:/Data/DEV/ultra_simple_panel/src/renderer/app/App.vue:124) |
| Unsupported inference paths force `recall-only` mode | `src/core/memory/runtime-host.ts` | [67-85](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:67), [105-124](D:/Data/DEV/ultra_simple_panel/src/core/memory/runtime-host.ts:105) |
| Recall is executed via bundled Evolver `host-bridge recall` | `src/core/memory/evolver-client.ts` | [145-146](D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:145), [285-311](D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-client.ts:285) |
| Low-level recall failure is a subprocess/JSON contract error | `src/core/memory/command-runner.ts` | [51-97](D:/Data/DEV/ultra_simple_panel/src/core/memory/command-runner.ts:51) |

### Risks / Unknowns
- [!] Stoa currently logs only the summary recall error message at the session-event bridge layer, not the child process `stdout`/`stderr`, so the exact underlying Evolver-side fault is not visible from the UI path alone.
- [!] If the active session changes before the phase notification arrives, the renderer drops the toast by design; this can make a real distill run appear as if nothing happened.
- [!] If the user selects `codex` or `api` as `evolverInferenceProvider`, distill will not run under the current implementation because full maintenance is unavailable in those paths.

## Context Handoff: Distill Trigger And Recall Failure

Start here: `research/2026-04-29-distill-trigger-and-recall-failure.md`

Context only. Use the saved report as the source of truth.
