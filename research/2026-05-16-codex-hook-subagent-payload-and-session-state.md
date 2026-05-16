---
date: 2026-05-16
topic: codex hook subagent payload and session state handling
status: completed
mode: context-gathering
sources: 10
---

## Context Report: Codex hook subagent payload and session state handling

### Why This Was Gathered
This research supports a bugfix decision for two symptoms in Stoa's Codex integration:

- subagent `Stop`/completion may be reduced as the main session's completion, pushing the UI to `ready`/`complete` while the root agent is still running
- user interrupts may later be overwritten so an interrupted Codex session appears `running` again

The user explicitly required upstream- and network-backed evidence about real Codex hook payloads before any fix.

### Summary
Current public Codex hooks do not expose explicit root/subagent relationship fields in hook input payloads. Official docs and generated JSON Schemas show a closed field set, and open upstream issues request exactly this missing metadata. The strongest available discriminator today is `session_id`: upstream reports state that parent and subagent sessions have distinct `session_id` and `turn_id` values.

In this repo, Codex hook adaptation already preserves provider `session_id` as `externalSessionId`, but the bridge does not enforce provider-session identity before reducing events into a Stoa session. That makes cross-session Codex events a plausible root cause for both premature completion and interrupted-session reactivation.

### Key Findings
- Official Codex hook docs describe only common fields plus per-event extras; no root/subagent discriminator is documented.
- `SessionStart` does expose an explicit launch source: `startup`, `resume`, or `clear`.
- The generated upstream hook schemas are closed with `additionalProperties: false`, so current hook payloads are not expected to include undocumented hierarchy fields.
- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` schemas include `session_id`, and turn-scoped events include `turn_id`.
- Upstream Codex users have filed open issues requesting root/subagent metadata because hook payloads currently cannot distinguish them.
- One upstream issue explicitly states that parent and subagent sessions have distinct `session_id` and `turn_id` values.
- In Stoa, `adaptCodexHook()` maps provider `session_id` into `payload.externalSessionId` and `evidence.providerSessionId`.
- In Stoa, `SessionEventBridge` reduces incoming events into session state using the Stoa `session_id` from request context, while `externalSessionId` is only forwarded, not enforced as an identity guard.
- Stoa's reducer already protects against stale completion for the same turn, but those protections do not solve cross-provider-session events being attached to the wrong Stoa session.
- The terminal interrupt path exists locally: xterm `Ctrl+C` is recognized, routed to `markAgentTurnInterrupted()`, and reduced to `lastTurnOutcome='interrupted'`.
- Therefore the more likely interrupt bug is not interrupt detection failure itself, but later provider events for a different Codex provider session re-opening or completing the Stoa session.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Codex hook docs define common fields and per-event extras; no subagent/root field documented | OpenAI Codex hooks docs | https://developers.openai.com/codex/hooks |
| `SessionStart` explicitly carries `source` with enum `startup`, `resume`, `clear` | Upstream generated schema | https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/session-start.command.input.schema.json |
| `UserPromptSubmit` docs list only `turn_id` and `prompt` beyond common fields | OpenAI Codex hooks docs | https://developers.openai.com/codex/hooks |
| `Stop` docs list only `turn_id`, `stop_hook_active`, `last_assistant_message` beyond common fields | OpenAI Codex hooks docs | https://developers.openai.com/codex/hooks |
| `session-start.command.input` schema is closed and requires `session_id` but no hierarchy field | Upstream generated schema | https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/session-start.command.input.schema.json |
| `user-prompt-submit.command.input` schema is closed and requires `session_id`, `turn_id`, `prompt` | Upstream generated schema | https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json |
| `pre-tool-use.command.input` schema is closed and requires `session_id`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input` | Upstream generated schema | https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/pre-tool-use.command.input.schema.json |
| `post-tool-use.command.input` schema is closed and requires `session_id`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response` | Upstream generated schema | https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json |
| `stop.command.input` schema is closed and requires `session_id`, `turn_id`, `last_assistant_message`, `stop_hook_active` | Upstream generated schema | https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/stop.command.input.schema.json |
| Upstream issue says all hook events fire for both main agent and subagent, and JSON contains no distinguishing field | `openai/codex` issue #16226 | https://github.com/openai/codex/issues/16226 |
| Upstream issue says parent and subagent have distinct `session_id` and `turn_id`, but no root/subagent indicator in payload | `openai/codex` issue #20675 | https://github.com/openai/codex/issues/20675 |
| Stoa's Codex hook adapter maps provider `session_id` into `externalSessionId` | Local code | [src/core/hook-event-adapter.ts](/D:/Data/DEV/ultra_simple_panel/src/core/hook-event-adapter.ts:60) |
| Stoa bridge converts every canonical event into a patch keyed by Stoa `session_id`; `externalSessionId` is forwarded but not used as an identity gate | Local code | [src/main/session-event-bridge.ts](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:268) |
| Bridge resolves turn epochs from `sourceTurnId` or synthetic heuristics, allowing same-session ambiguous events to allocate/open turns | Local code | [src/main/session-event-bridge.ts](/D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:297) |
| Reducer applies `agent.turn_completed` / `agent.turn_interrupted` based on turn epoch and runtime state only | Local code | [src/shared/session-state-reducer.ts](/D:/Data/DEV/ultra_simple_panel/src/shared/session-state-reducer.ts:146) |
| Runtime-generated agent patches inherit current `session.turnEpoch`, so UI interrupt patches are not missing turnEpoch by construction | Local code | [src/core/project-session-manager.ts](/D:/Data/DEV/ultra_simple_panel/src/core/project-session-manager.ts:628) |
| Input router recognizes `Ctrl+C` for agent sessions and triggers interrupt handling | Local code | [src/main/session-input-router.ts](/D:/Data/DEV/ultra_simple_panel/src/main/session-input-router.ts:29) |

### Local Probe Notes
- A real `codex exec` run on this machine succeeded on 2026-05-16 with `OpenAI Codex v0.130.0`.
- A real `spawn_agent` run also succeeded, confirming that local Codex supports subagents in this environment.
- I attempted two direct capture probes for raw hook stdin using a temporary workspace and project hooks.
- Those probes did not capture hook stdin, which indicates the probe wiring was incomplete or the temporary hook command was not executed as expected.
- That failed probe does not weaken the schema/issue evidence above because the upstream generated schemas are already explicit and closed.

### Risks / Unknowns
- [!] I did not obtain a successful raw stdin dump from a real subagent hook on this machine, so I do not have a local packet proving the observed child `session_id` values firsthand.
- [!] The docs page warns that `main` branch schemas may include hook fields not yet shipped in the current release. However, the release docs page and the open upstream issues both point in the same direction: no root/subagent metadata is currently exposed.
- [?] Codex may expose root/subagent metadata somewhere outside hooks, but no such source was identified in the bounded research for this task.

### Recommendation
The best evidence-backed fix is to harden Codex event/session correlation around provider `session_id` (`externalSessionId`) instead of trying to parse nonexistent root/subagent fields from hook payloads.

Recommended behavior:

- treat a Codex provider event as authoritative for a Stoa session only when its provider `session_id` matches the session's current `externalSessionId`
- allow the first authoritative bind on `SessionStart` / `runtime.alive`
- allow explicit resume rebinding when the runtime itself changes the session's `externalSessionId`
- reject or quarantine later Codex hook events whose `providerSessionId` disagrees with the bound `externalSessionId`

This is a precise fix under the current upstream payload contract. It uses the only stable discriminator Codex exposes today, rather than synthetic turn heuristics or hand-wavy subagent guessing.

## Context Handoff: Codex hook subagent payload and session state handling

Start here: `research/2026-05-16-codex-hook-subagent-payload-and-session-state.md`

Context only. Use the saved report as the source of truth.
