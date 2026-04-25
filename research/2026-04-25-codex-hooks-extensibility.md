---
date: 2026-04-25
topic: OpenAI Codex CLI Hook/Extensibility System
status: completed
mode: context-gathering
sources: 8
---

## Context Handoff: OpenAI Codex CLI Hook System

Start here: esearch/2026-04-25-codex-hooks-extensibility.md

## Summary

OpenAI Codex CLI has a **5-event lifecycle hook system** that is architecturally comparable to Claude Code's hook system, but with different emphases. Both support pre-tool and post-tool hooks, but Codex adds explicit SessionStart and Stop events, while Claude Code has a Notification hook that Codex lacks. The extension mechanism is fundamentally different — Codex hooks are external shell commands driven by a config file (hooks.json), not in-process JS callbacks.

---

## Context Report: OpenAI Codex CLI Hook/Extensibility System

### Why This Was Gathered

Compare Codex's extensibility against Claude Code's 9-hook system for product/architecture decision.

### Summary

OpenAI Codex CLI has a **5-event lifecycle hook system** architecturally comparable to Claude Code's but with different emphases. Both support pre/post-tool hooks; Codex adds explicit SessionStart and Stop events. Claude Code has a Notification hook Codex lacks. Extension mechanism differs fundamentally — Codex hooks are external shell commands driven by hooks.json config, not in-process callbacks.

### Key Findings

**Five Lifecycle Events (Codex)**

| Event | Scope | Matcher Input | Primary Outcome |
|-------|-------|---------------|-----------------|
| SessionStart | Thread | source (startup, esume, clear) | dditional_contexts, should_stop |
| UserPromptSubmit | Turn | *(none)* | dditional_contexts, should_stop |
| PreToolUse | Turn | tool_name | should_block, lock_reason |
| PostToolUse | Turn | tool_name | dditional_contexts, eedback_message, should_stop |
| Stop | Turn | *(none)* | should_stop, should_block, continuation_fragments |

**Hook Handler Type**: Only command is currently operational. Prompt and Agent handler types are defined in schema but generate warnings and are skipped.

**Configuration Discovery**: Hooks are discovered from hooks.json files in Codex's layered config stack (project + system). Handlers run as external shell subprocesses with JSON I/O over stdin/stdout.

**Legacy AfterAgent notify hook**: Codex maintains a backward-compatible AfterAgent notification hook via legacy_notify_argv in HooksConfig. This fires when agent finishes a turn and serializes a UserNotification::AgentTurnComplete JSON payload as a command argument.

**MCP Integration**: Codex supports MCP servers as first-class tool providers. MCP tool approvals are configurable per-server and per-tool via ~/.codex/config.toml. MCP tools can be marked supports_parallel_tool_calls.

**Plugin System**: codex-plugin crate provides loadable packages with MCP servers, custom instructions, and app integrations. Plugins are namespaced, discoverable via marketplace registries, and referenced via @ sigil in prompts.

**Skills System**: codex-skills provides lightweight instructional packages (structured prompt templates with optional MCP server dependencies), loaded from configured directories and injected via <skills_instructions> tags.

**Security Sandbox Layer**: Codex has defense-in-depth with execution policy rules engine, OS-level sandboxing (Landlock/Seatbelt/Bubblewrap), out-of-process exec server, and network proxy.

### Comparison with Claude Code Hooks

| Aspect | OpenAI Codex CLI | Claude Code |
|--------|-----------------|-------------|
| PreToolUse | ✅ | ✅ |
| PostToolUse | ✅ | ✅ |
| SessionStart | ✅ (explicit event) | ❌ (no explicit equivalent) |
| Stop | ✅ (can stop + inject continuation) | ❌ (Stop is a notification, not control) |
| UserPromptSubmit | ✅ | ❌ (no direct equivalent) |
| Notification | ❌ (legacy AfterAgent notify only) | ✅ (OnNotification) |
| ConfigChange | ❌ | ✅ |
| Entrypoint | ❌ | ✅ |
| Subagent | ❌ | ✅ |
| Handler type | Shell command (external) | In-process JS callback |
| Config location | hooks.json in config layers | CLAUDE.md hooks section or .claude/settings.json |
| Matcher support | PreToolUse, PostToolUse, SessionStart | All 9 hooks use tool name matchers |
| Blocking behavior | ✅ (block_reason via JSON or exit code 2) | ✅ (block via hook return) |
| Continuation injection | ✅ (continuation_fragments via Stop event) | ❌ |
| Prompt/Agent handler types | Defined but non-operational | N/A (JS-based) |

### Ecological Niche Assessment

**Same ecological niche**: Both Codex and Claude Code provide lifecycle hooks that let external scripts observe and influence agent behavior — logging, security scanning, context enrichment, blocking dangerous operations.

**Different mechanism**: Claude Code uses in-process JS callbacks registered in CLAUDE.md or settings — simpler for small hooks but requires the hook code to run in the same process. Codex uses external shell commands discovered from config files — more overhead per hook but full process isolation and language-agnostic.

**Unique Codex capabilities**:
- SessionStart hook for initialization scripts
- Stop hook with continuation fragment injection
- legacy_notify for simple turn-complete notifications
- Prompt and Agent handler types are reserved future extensibility

**Unique Claude Code capabilities**:
- Notification hook for arbitrary event observation
- Entrypoint/Subagent hooks for complex orchestration
- In-process JS callbacks for lower latency

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| 5 lifecycle events with registry | codex-rs/hooks/src/registry.rs | lines 30-35, 61-65 |
| SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop event names | codex-rs/hooks/src/engine/dispatcher.rs | lines 110-118 |
| HookEvent enum with AfterAgent and AfterToolUse variants | codex-rs/hooks/src/types.rs | lines 103-111 |
| legacy_notify_argv for backward-compatible AfterAgent hook | codex-rs/hooks/src/registry.rs | lines 44-50 |
| legacy_notify.rs wraps notify argv as a Hook | codex-rs/hooks/src/legacy_notify.rs | full file |
| HooksConfig with notify argv, feature flag, config layer stack | codex-rs/hooks/src/registry.rs | lines 19-28 |
| Command execution protocol with stdin JSON, stdout JSON, timeout | codex-rs/hooks/src/engine/command_runner.rs | lines 24-101 |
| PreToolUseOutcome with should_block + block_reason | codex-rs/hooks/src/events/pre_tool_use.rs | lines 185-199 |
| StopOutcome with continuation_fragments | codex-rs/hooks/src/events/stop.rs | lines 34-43, 173-181 |
| Prompt and Agent handler types defined but not yet operational | codex-rs/hooks/src/engine/discovery.rs | lines 164-173 |
| Hook discovery from layered config files | codex-rs/hooks/src/engine/discovery.rs | lines 20-106 |
| Config schema with hooks.json structure | codex-rs/hooks/src/engine/config.rs | lines 3-48 |
| MCP server configuration and approval modes | docs/config.md | lines 9-30 |
| Plugin system (codex-plugin crate) | Architecture Overview (zread) | codex-rs/plugin/src |
| Skills system (codex-skills crate) | docs/skills.md | lines 1-5 |
| Sandbox documentation reference | docs/sandbox.md | lines 1-5 |
| Matcher system with regex support | codex-rs/hooks/src/events/common.rs | lines 98-129 |
| HookResult::FailedAbort for early abort | codex-rs/hooks/src/types.rs | lines 19-23 |
| Hooks::dispatch() iterates sequentially with early abort | codex-rs/hooks/src/registry.rs | lines 77-89 |
| Concurrent execution via join_all for engine dispatch | codex-rs/hooks/src/engine/dispatcher.rs | lines 72-77 |
