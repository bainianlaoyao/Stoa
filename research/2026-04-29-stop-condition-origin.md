---
date: 2026-04-29
topic: stop condition origin
status: completed
mode: context-gathering
sources: 7
---

## Context Report: Stop Condition Origin

### Why This Was Gathered
Answer whether the current `Stop` condition is determined by the LLM itself or by surrounding runtime/provider machinery.

### Summary
In the current Stoa implementation, `Stop` is not inferred by Stoa and is not derived from rendered output. Stoa installs provider-native hook sidecars or plugins, then trusts the provider runtime to emit end-of-turn events such as `Stop`, `StopFailure`, or `session.idle`.

That means the immediate stop condition is owned by the provider runtime, not by Stoa. The LLM can influence it indirectly by deciding to continue, ask for tools, request permission, or finalize an answer, but Stoa only reacts after the provider runtime emits the terminal lifecycle event.

### Key Findings
- Session startup installs a provider sidecar before launching the provider command. This is the mechanism that wires provider-native lifecycle hooks back into Stoa. [src/core/session-runtime.ts:57-73](D:/Data/DEV/ultra_simple_panel/src/core/session-runtime.ts:57)
- Claude sessions register provider-native hooks for `UserPromptSubmit`, `PostToolUse`, `Stop`, `StopFailure`, and `PermissionRequest`, all forwarded to Stoa's local webhook. Stoa does not compute stop itself for Claude; it waits for Claude's hook system to send `Stop` / `StopFailure`. [src/extensions/providers/claude-code-provider.ts:93-111](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-code-provider.ts:93) [src/extensions/providers/claude-code-provider.ts:244-245](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-code-provider.ts:244)
- Codex sessions do the same through `.codex/hooks.json`: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop` are command hooks that forward to `/hooks/codex`. Again, Stoa consumes `Stop`; it does not derive it locally. [src/extensions/providers/codex-provider.ts:51-74](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/codex-provider.ts:51) [src/extensions/providers/codex-provider.ts:256-257](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/codex-provider.ts:256)
- OpenCode is similar but event-based instead of hook-name based. The sidecar plugin maps `session.idle` to `agent.turn_completed` and `session.error` to `agent.turn_failed`. So for OpenCode the provider runtime's idle/error event is the effective stop signal. [src/extensions/providers/opencode-provider.ts:38](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/opencode-provider.ts:38) [src/extensions/providers/opencode-provider.ts:61-62](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/opencode-provider.ts:61)
- Once Stoa receives the provider event, the hook adapter maps it into Stoa state. For Claude: `UserPromptSubmit -> agent.turn_started`, `Stop -> agent.turn_completed`, `StopFailure -> agent.turn_failed`. For Codex: `UserPromptSubmit -> agent.turn_started`, `Stop -> agent.turn_completed`. [src/core/hook-event-adapter.ts:157-176](D:/Data/DEV/ultra_simple_panel/src/core/hook-event-adapter.ts:157) [src/core/hook-event-adapter.ts:185-195](D:/Data/DEV/ultra_simple_panel/src/core/hook-event-adapter.ts:185)
- The memory system treats only `Stop` and `StopFailure` as turn-finalizing boundaries. `PostToolUse`, permission requests, and interruptions are intermediate events inside the same turn. [src/main/session-event-bridge.ts:431-453](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:431)

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Provider sidecar is installed before runtime start | `src/core/session-runtime.ts` | [57-73](D:/Data/DEV/ultra_simple_panel/src/core/session-runtime.ts:57) |
| Claude `Stop` / `StopFailure` come from provider-native hooks | `src/extensions/providers/claude-code-provider.ts` | [93-111](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-code-provider.ts:93), [244-245](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-code-provider.ts:244) |
| Codex `Stop` comes from provider-native hooks | `src/extensions/providers/codex-provider.ts` | [51-74](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/codex-provider.ts:51), [256-257](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/codex-provider.ts:256) |
| OpenCode uses provider runtime events like `session.idle` | `src/extensions/providers/opencode-provider.ts` | [38](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/opencode-provider.ts:38), [61-62](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/opencode-provider.ts:61) |
| Stoa only maps provider events into turn states | `src/core/hook-event-adapter.ts` | [157-176](D:/Data/DEV/ultra_simple_panel/src/core/hook-event-adapter.ts:157), [185-195](D:/Data/DEV/ultra_simple_panel/src/core/hook-event-adapter.ts:185) |
| Memory finalization only happens on `Stop` / `StopFailure` | `src/main/session-event-bridge.ts` | [431-453](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:431) |

### Risks / Unknowns
- [!] This repository shows how Stoa receives `Stop`, not the full internal heuristics inside Claude Code or Codex for when they decide to emit it.
- [!] So the strict answer is: not Stoa, but likely the provider runtime/agent loop, which itself may be influenced by LLM decisions plus tool/runtime control flow.
- [!] User interruption is a separate UI/runtime signal and does not itself finalize a memory turn unless a later provider `Stop` or `StopFailure` also arrives.

## Context Handoff: Stop Condition Origin

Start here: `research/2026-04-29-stop-condition-origin.md`

Context only. Use the saved report as the source of truth.
