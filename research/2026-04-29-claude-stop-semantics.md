---
date: 2026-04-29
topic: claude stop semantics
status: completed
mode: context-gathering
sources: 6
---

## Context Report: Claude Stop Semantics

### Why This Was Gathered
Answer how Claude Code decides when to fire `Stop`, and explain why the UI can appear "done" before `Stop` arrives.

### Summary
Anthropic's public docs do not expose an internal hidden heuristic for `Stop`. The documented external rule is: Claude Code keeps running its agent loop until Claude produces a response with no tool calls; then the main agent is considered finished and the `Stop` hook runs.

This means `Stop` is not triggered by Stoa and not by simple text matching. A visible assistant message can still be mid-loop if the same Claude response also requested tools, if a stop hook blocks stopping, if the main agent is waiting on subagent completion, or if the turn ends in user interrupt / API failure instead of normal completion.

### Key Findings
- Official agent-loop docs say Claude repeats tool-use turns until it "produces a response with no tool calls." Only then does the loop end and return the final result. Source: [How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- The same docs explicitly say Claude may respond with text, tool calls, or both in one step. So seeing user-visible text does not prove the loop is finished. Source: [How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- Official hooks docs define `Stop` as: "Runs when the main Claude Code agent has finished responding." They also clarify it does **not** run on user interrupt, and API errors fire `StopFailure` instead. Source: [Hooks reference](https://code.claude.com/docs/en/hooks)
- `Stop` can itself be blocked by a hook. Official docs say `decision: "block"` prevents Claude from stopping and continues the conversation; `stop_hook_active` becomes `true` when Claude is already continuing because of a stop hook. Source: [Hooks reference](https://code.claude.com/docs/en/hooks)
- `SubagentStop` is distinct from `Stop`. Official docs say subagents use `SubagentStop`; that means a subagent finishing does not imply the main agent has reached `Stop` yet. Source: [Hooks reference](https://code.claude.com/docs/en/hooks)
- In Stoa's current Claude integration, we register `Stop` and `StopFailure` as provider-native hooks and simply accept them; Stoa does not block Claude from stopping. Our webhook returns `202 accepted` when `onEvent` returns `null`, and the `SessionEventBridge` only returns hook output for `SessionStart` and `UserPromptSubmit`, not for `Stop`. [src/extensions/providers/claude-code-provider.ts:93-111](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-code-provider.ts:93) [src/core/webhook-server.ts:268-271](D:/Data/DEV/ultra_simple_panel/src/core/webhook-server.ts:268) [src/main/session-event-bridge.ts:646-657](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:646)

### Practical Interpretation
- If Claude prints text and then asks for tools in the same assistant turn, you can see "answer-like" text before `Stop`.
- If a custom `Stop` hook returns `decision: "block"`, Claude keeps working and `stop_hook_active` flips on. This is an official Claude feature, not a Stoa behavior.
- If the visible work was done by a subagent, the event is `SubagentStop`; the main agent can still continue synthesizing or performing follow-up actions.
- If the user interrupts manually, there is no `Stop`.
- If the turn dies on API failure, there is `StopFailure`, not `Stop`.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Loop ends only when response has no tool calls | Claude Code Docs | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| Claude may emit text and tool calls together | Claude Code Docs | https://code.claude.com/docs/en/agent-sdk/agent-loop |
| `Stop` runs when main agent finished responding; no `Stop` on user interrupt; API errors use `StopFailure` | Claude Code Docs | https://code.claude.com/docs/en/hooks |
| `Stop` hooks can block stopping and set `stop_hook_active` | Claude Code Docs | https://code.claude.com/docs/en/hooks |
| Subagents use `SubagentStop` | Claude Code Docs | https://code.claude.com/docs/en/hooks |
| Stoa registers Claude `Stop` / `StopFailure` hooks but does not block them | `src/extensions/providers/claude-code-provider.ts`, `src/core/webhook-server.ts`, `src/main/session-event-bridge.ts` | [93-111](D:/Data/DEV/ultra_simple_panel/src/extensions/providers/claude-code-provider.ts:93), [268-271](D:/Data/DEV/ultra_simple_panel/src/core/webhook-server.ts:268), [646-657](D:/Data/DEV/ultra_simple_panel/src/main/session-event-bridge.ts:646) |

### Risks / Unknowns
- [!] Anthropic does not publicly document the exact internal decision heuristic beyond the agent-loop rule, so anything lower-level than "final response with no tool calls" would be inference.
- [!] If users report "Claude looked done but no Stop", the most likely causes are mixed text+tool-call turns, subagent completion rather than main-agent completion, manual interrupts, API failures, or a stop hook that blocks completion.

## Context Handoff: Claude Stop Semantics

Start here: `research/2026-04-29-claude-stop-semantics.md`

Context only. Use the saved report as the source of truth.
