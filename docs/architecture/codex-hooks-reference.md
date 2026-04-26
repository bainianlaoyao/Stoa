# OpenAI Codex CLI Hooks Reference

> Source: https://github.com/openai/codex (`codex-rs/hooks/`) — Fetched April 2026

## 1. Overview

The OpenAI Codex CLI hooks system provides a structured mechanism for injecting external logic at key lifecycle points during a Codex session. Hooks are external commands that Codex invokes at specific events, receiving event data on stdin as JSON and producing output on stdout as JSON.

### Key characteristics

- **Event-driven**: Hooks fire at well-defined lifecycle points — session start, prompt submission, before/after tool use, and session stop.
- **External processes**: Each hook runs an arbitrary shell command. Codex sends JSON on stdin, reads JSON from stdout.
- **Per-workspace configuration**: Hooks are discovered from `.codex/hooks.json` in the workspace root.
- **Rust engine**: The hook engine lives in `codex-rs/hooks/` and is compiled into the Codex binary.
- **Matcher-based routing**: Hooks can be filtered by matcher patterns so they only fire for specific tools or conditions.
- **Permission decisions**: `PreToolUse` hooks can approve, deny, or defer tool execution back to the user.

### Lifecycle flow

```
SessionStart ───────────────────────────────────────────── session begins
    │
    ▼
UserPromptSubmit ──────────────────────────────────────── user sends prompt
    │
    ▼
    ┌─── PreToolUse ──────── tool executes ──── PostToolUse ──┐
    │         (repeat per tool call in the turn)               │
    └──────────────────────────────────────────────────────────┘
    │
    ▼
Stop ──────────────────────────────────────────────────── agent turn ends
    │
    ▼
UserPromptSubmit ──────────────────────────────────────── next prompt
    ...
```

---

## 2. Hook Events

### 2.1 SessionStart

Fires when a Codex session begins. Differentiates between fresh starts, resumes, and clears.

#### When it fires

- On first launch (`source: "startup"`)
- When resuming an existing session (`source: "resume"`)
- When the conversation is cleared (`source: "clear"`)

#### Input schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Current working directory |
| `hook_event_name` | `"SessionStart"` | Yes | Event discriminator |
| `model` | `string` | Yes | Active model identifier |
| `permission_mode` | `string` | Yes | Current permission mode (see enum below) |
| `session_id` | `string` | Yes | Unique session identifier |
| `source` | `string` | Yes | How the session started |
| `transcript_path` | `string \| null` | Yes | Path to the session transcript file (nullable) |

**`source` enum values:**

| Value | Meaning |
|-------|---------|
| `"startup"` | Fresh session launched from CLI |
| `"resume"` | Resuming a previously saved session |
| `"clear"` | Conversation history cleared |

**`permission_mode` enum values:**

| Value | Meaning |
|-------|---------|
| `"default"` | Standard approval flow |
| `"acceptEdits"` | Auto-accept file edits |
| `"plan"` | Plan-only mode, no execution |
| `"dontAsk"` | Skip confirmation prompts |
| `"bypassPermissions"` | Skip all permission checks |

#### Output schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `continue` | `boolean` | `true` | Whether to continue the session |
| `decision` | `string` | — | Decision: `"approve"` or `"block"` |
| `reason` | `string` | — | Human-readable reason for the decision |
| `stopReason` | `string` | — | Reason to stop the session |
| `suppressOutput` | `boolean` | `false` | Suppress hook output from display |
| `systemMessage` | `string` | — | Inject a system message into the conversation |

**Hook-specific output** (nested under `hookSpecificOutput`):

| Field | Type | Description |
|-------|------|-------------|
| `hookEventName` | `string` | Echo of the event name |
| `additionalContext` | `string` | Extra context injected into the conversation |
| `permissionDecision` | `"allow" \| "deny" \| "ask"` | Permission override |
| `permissionDecisionReason` | `string` | Reason for permission decision |
| `updatedInput` | `object` | Modified input for the event |

#### Example input

```json
{
  "cwd": "/home/user/project",
  "hook_event_name": "SessionStart",
  "model": "codex-1",
  "permission_mode": "default",
  "session_id": "sess_abc123",
  "source": "startup",
  "transcript_path": "/home/user/.codex/sessions/sess_abc123.jsonl"
}
```

#### Example output

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Project uses Node.js 20 and pnpm. Run tests with: pnpm test"
  }
}
```

---

### 2.2 UserPromptSubmit

Fires when the user submits a prompt. This event explicitly ignores matchers — all registered hooks for this event will run regardless of matcher configuration.

#### When it fires

- Immediately after the user presses Enter on a prompt
- Before the agent begins processing

#### Input schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Current working directory |
| `hook_event_name` | `"UserPromptSubmit"` | Yes | Event discriminator |
| `model` | `string` | Yes | Active model identifier |
| `permission_mode` | `string` | Yes | Current permission mode |
| `prompt` | `string` | Yes | The user's submitted text |
| `session_id` | `string` | Yes | Unique session identifier |
| `transcript_path` | `string \| null` | Yes | Path to the session transcript |
| `turn_id` | `string` | Yes | Codex extension field for internal turn-scoped hooks |

#### Output schema

Same structure as SessionStart output schema (see §2.1 Output schema).

#### Example input

```json
{
  "cwd": "/home/user/project",
  "hook_event_name": "UserPromptSubmit",
  "model": "codex-1",
  "permission_mode": "acceptEdits",
  "prompt": "Refactor the authentication module to use JWT tokens",
  "session_id": "sess_abc123",
  "transcript_path": "/home/user/.codex/sessions/sess_abc123.jsonl",
  "turn_id": "turn_004"
}
```

#### Example output

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Note: The auth module is currently OAuth2-based. JWT migration guide is in docs/migration.md"
  }
}
```

---

### 2.3 PreToolUse

Fires before a tool is executed. Only fires for the `"Bash"` tool (i.e., shell commands). Hooks can approve, deny, or modify the tool invocation.

#### When it fires

- Just before the agent executes a shell command
- The hook can block execution, allow it, or modify the command

#### Input schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Current working directory |
| `hook_event_name` | `"PreToolUse"` | Yes | Event discriminator |
| `model` | `string` | Yes | Active model identifier |
| `permission_mode` | `string` | Yes | Current permission mode |
| `session_id` | `string` | Yes | Unique session identifier |
| `tool_input` | `object` | Yes | Tool-specific input (see below) |
| `tool_name` | `"Bash"` | Yes | Const: always `"Bash"` |
| `tool_use_id` | `string` | Yes | Unique identifier for this tool use |
| `transcript_path` | `string \| null` | Yes | Path to the session transcript |
| `turn_id` | `string` | Yes | Turn-scoped identifier |

**`tool_input` sub-object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | `string` | Yes | The shell command the agent wants to execute |

#### Output schema

In addition to the common output fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `continue` | `boolean` | `true` | Whether to continue with tool execution |
| `decision` | `"approve" \| "block"` | — | Whether to allow or block this tool use |
| `reason` | `string` | — | Reason for the decision |
| `stopReason` | `string` | — | Reason to stop the session |
| `suppressOutput` | `boolean` | `false` | Suppress hook output from display |
| `systemMessage` | `string` | — | Inject a system message |

**Hook-specific output:**

| Field | Type | Description |
|-------|------|-------------|
| `hookEventName` | `"PreToolUse" \| "PostToolUse" \| "SessionStart" \| "UserPromptSubmit" \| "Stop"` | Event echo |
| `additionalContext` | `string` | Extra context for the conversation |
| `permissionDecision` | `"allow" \| "deny" \| "ask"` | Override the permission decision for this tool use |
| `permissionDecisionReason` | `string` | Explanation for the permission override |
| `updatedInput` | `object` | Modified tool input — replaces the original `tool_input` |

#### Permission decision flow

```
Hook returns permissionDecision
    │
    ├── "allow"   → tool executes without prompting the user
    ├── "deny"    → tool execution blocked, reason shown to agent
    └── "ask"     → fall through to the standard user confirmation prompt
```

#### Example input

```json
{
  "cwd": "/home/user/project",
  "hook_event_name": "PreToolUse",
  "model": "codex-1",
  "permission_mode": "default",
  "session_id": "sess_abc123",
  "tool_input": {
    "command": "rm -rf node_modules && npm install"
  },
  "tool_name": "Bash",
  "tool_use_id": "tooluse_007",
  "transcript_path": "/home/user/.codex/sessions/sess_abc123.jsonl",
  "turn_id": "turn_004"
}
```

#### Example output — approve with modified input

```json
{
  "continue": true,
  "decision": "approve",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Package reinstall approved",
    "updatedInput": {
      "command": "rm -rf node_modules && pnpm install"
    }
  }
}
```

#### Example output — block

```json
{
  "continue": true,
  "decision": "block",
  "reason": "Destructive command blocked: rm -rf on project directory",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Command would remove node_modules which takes 10+ minutes to reinstall on this machine"
  }
}
```

---

### 2.4 PostToolUse

Fires after a tool has been executed. Includes the tool's response, allowing hooks to inspect results and inject additional context.

#### When it fires

- Immediately after a tool execution completes
- The hook receives the tool's output

#### Input schema

Same fields as PreToolUse input (§2.3), plus:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool_response` | `string` | Yes | The output/response from the tool execution |

All other fields (`cwd`, `hook_event_name`, `model`, `permission_mode`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`, `turn_id`) are identical to PreToolUse.

#### Output schema

Same as PreToolUse output schema (§2.3 Output schema).

#### Example input

```json
{
  "cwd": "/home/user/project",
  "hook_event_name": "PostToolUse",
  "model": "codex-1",
  "permission_mode": "default",
  "session_id": "sess_abc123",
  "tool_input": {
    "command": "npm test"
  },
  "tool_name": "Bash",
  "tool_response": "Tests: 42 passed, 3 failed\nTotal time: 12.4s",
  "tool_use_id": "tooluse_007",
  "transcript_path": "/home/user/.codex/sessions/sess_abc123.jsonl",
  "turn_id": "turn_004"
}
```

#### Example output

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "3 tests failed. Check src/auth/login.test.ts — the JWT expiry test is flaky."
  }
}
```

---

### 2.5 Stop

Fires when the agent's turn ends. Can block the stop to keep the agent running (e.g., to enforce a task checklist).

This event explicitly ignores matchers — all registered hooks for this event will run.

#### When it fires

- After the agent decides it has finished its turn
- Before the turn is finalized
- `stop_hook_active` indicates whether another stop hook has already requested continuation

#### Input schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | `string` | Yes | Current working directory |
| `hook_event_name` | `"Stop"` | Yes | Event discriminator |
| `last_assistant_message` | `string \| null` | Yes | The agent's final message (nullable) |
| `model` | `string` | Yes | Active model identifier |
| `permission_mode` | `string` | Yes | Current permission mode |
| `session_id` | `string` | Yes | Unique session identifier |
| `stop_hook_active` | `boolean` | Yes | Whether a stop hook is already active (prevents infinite loops) |
| `transcript_path` | `string \| null` | Yes | Path to the session transcript |
| `turn_id` | `string` | Yes | Turn-scoped identifier |

#### Output schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `continue` | `boolean` | `true` | If `false`, prevents the agent from stopping |
| `decision` | `"block"` | — | Only `"block"` is valid for Stop events |
| `reason` | `string` | — | **Required when `decision` is `"block"`**. Human-readable reason |
| `stopReason` | `string` | — | Reason for stopping |
| `suppressOutput` | `boolean` | `false` | Suppress hook output |
| `systemMessage` | `string` | — | Inject a system message |

#### Blocking the stop

When a Stop hook returns `decision: "block"` with `continue: false`, the agent continues processing instead of stopping. This is useful for:

- Enforcing task completion checklists
- Ensuring the agent runs tests after code changes
- Preventing premature termination

**Important**: The `stop_hook_active` field prevents infinite loops. If it's already `true`, hooks should not block again.

#### Example input

```json
{
  "cwd": "/home/user/project",
  "hook_event_name": "Stop",
  "last_assistant_message": "I've refactored the auth module to use JWT tokens. All existing tests pass.",
  "model": "codex-1",
  "permission_mode": "acceptEdits",
  "session_id": "sess_abc123",
  "stop_hook_active": false,
  "transcript_path": "/home/user/.codex/sessions/sess_abc123.jsonl",
  "turn_id": "turn_004"
}
```

#### Example output — block to force test run

```json
{
  "continue": false,
  "decision": "block",
  "reason": "You must run the full test suite after refactoring. Run: npm test",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "systemMessage": "The stop was blocked because tests have not been run. Please run npm test and verify all tests pass before finishing."
  }
}
```

#### Example output — allow stop

```json
{
  "continue": true
}
```

---

## 3. Configuration

### 3.1 File location

Hooks are configured per-workspace in:

```
<workspace-root>/.codex/hooks.json
```

The hook discovery module (`engine/discovery.rs`) scans for this file when a session starts.

### 3.2 Configuration format

```json
{
  "hooks": [
    {
      "matcher": "npm test",
      "hooks": [
        {
          "type": "PreToolUse",
          "command": "echo '{\"decision\":\"approve\"}'"
        }
      ]
    },
    {
      "matcher": "rm -rf",
      "hooks": [
        {
          "type": "PreToolUse",
          "command": "/usr/local/bin/block-destructive.sh"
        }
      ]
    },
    {
      "hooks": [
        {
          "type": "SessionStart",
          "command": "/usr/local/bin/on-session-start.sh"
        },
        {
          "type": "Stop",
          "command": "/usr/local/bin/enforce-checklist.sh"
        }
      ]
    }
  ]
}
```

### 3.3 Hook entry fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `matcher` | `string` | No | Regex pattern. The hook only fires when the tool input matches. Omit to match unconditionally. |
| `hooks` | `array` | Yes | Array of hook handlers to invoke |

### 3.4 Hook handler fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Event name: `"SessionStart"`, `"UserPromptSubmit"`, `"PreToolUse"`, `"PostToolUse"`, or `"Stop"` |
| `command` | `string` | Yes | Shell command to execute. Receives JSON on stdin, must output JSON on stdout. |

### 3.5 Matcher behavior

- **Matcher present**: The hook fires only when the event's tool input (specifically the `command` field) matches the regex.
- **Matcher omitted**: The hook fires unconditionally for the declared event type.
- **Invalid regex**: Produces a warning and the entire matcher group is skipped (no hooks in that group run).
- **Events that ignore matchers**: `UserPromptSubmit` and `Stop` events ignore matcher patterns entirely — all registered hooks for these events always run.

### 3.6 Global configuration

The global Codex configuration lives at `~/.codex/config.toml`:

```toml
[notify]
# Agent turn completion notifications

[mcp_servers.example]
command = "node"
args = ["server.js"]
default_tools_approval_mode = "allow"  # "allow" | "deny" | "ask"

[mcp_servers.example.tools.my_tool]
approval_mode = "deny"
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `CODEX_HOME` | Override the Codex home directory (default: `~/.codex`) |
| `CODEX_SQLITE_HOME` | Override the SQLite database location |
| `CODEX_CA_CERTIFICATE` | Path to custom CA certificate |
| `SSL_CERT_FILE` | Alternative CA certificate path |

---

## 4. Hook Engine Architecture

### 4.1 Module map

```
codex-rs/hooks/
├── BUILD.bazel
├── Cargo.toml
├── schema/
│   └── generated/
│       ├── session_start_input.json
│       ├── session_start_output.json
│       ├── user_prompt_submit_input.json
│       ├── user_prompt_submit_output.json
│       ├── pre_tool_use_input.json
│       ├── pre_tool_use_output.json
│       ├── post_tool_use_input.json
│       ├── post_tool_use_output.json
│       ├── stop_input.json
│       └── stop_output.json
└── src/
    ├── engine/
    │   ├── command_runner.rs    — Executes hook commands as subprocesses
    │   ├── config.rs            — Parses hook configuration from hooks.json
    │   ├── discovery.rs         — Discovers .codex/hooks.json in workspace
    │   ├── dispatcher.rs        — Dispatches events to matching hooks
    │   ├── output_parser.rs     — Parses hook stdout as JSON
    │   └── schema_loader.rs     — Loads and validates JSON schemas
    ├── events/
    │   ├── common.rs            — Shared event logic (field construction, validation)
    │   ├── post_tool_use.rs     — PostToolUse event handling
    │   ├── pre_tool_use.rs      — PreToolUse event handling
    │   ├── session_start.rs     — SessionStart event handling
    │   ├── stop.rs              — Stop event handling
    │   └── user_prompt_submit.rs — UserPromptSubmit event handling
    ├── legacy_notify.rs         — Legacy notification system (deprecated)
    ├── registry.rs              — Hook registry (stores configured hooks)
    ├── types.rs                 — Shared types (NullableString, enums, structs)
    └── user_notification.rs     — User-facing notification delivery
```

### 4.2 Engine modules

#### `engine/discovery.rs`

Responsible for locating `.codex/hooks.json` relative to the current workspace. Searches upward from `cwd` until the file is found or the filesystem root is reached.

#### `engine/config.rs`

Parses the `hooks.json` file into a structured `HooksConfig`. Validates:
- Required fields (`type`, `command`)
- Valid event type names
- Matcher regex validity (invalid patterns produce warnings, skip the group)

#### `engine/dispatcher.rs`

The core dispatch loop:

1. Receives an event (e.g., PreToolUse with tool input `{command: "npm test"}`)
2. Iterates over all registered hooks for the matching event type
3. For each hook, checks the matcher (if present) against the relevant input field
4. If the matcher matches (or is absent), invokes the hook command
5. Collects all hook outputs
6. Aggregates decisions (deny takes precedence over allow)

**Matcher evaluation for `UserPromptSubmit` and `Stop`**: These events skip matcher checks entirely. All hooks registered for these events always execute.

#### `engine/command_runner.rs`

Executes hook commands as subprocesses:

1. Spawns the command with the event JSON on stdin
2. Reads stdout (expected to be JSON)
3. Reads stderr (for error reporting)
4. Captures the exit code
5. Exit code 0 = success, non-zero = error (hook output ignored on error)

#### `engine/output_parser.rs`

Parses the raw stdout string into the structured output type:

1. Attempts JSON deserialization
2. Validates against the output schema
3. Falls back to empty/default output on parse failure
4. Logs warnings for malformed output

#### `engine/schema_loader.rs`

Loads the JSON schema files from `schema/generated/` at engine initialization. Used for:
- Input validation before sending to hooks
- Output validation after receiving hook results
- Schema version tracking for forward compatibility

### 4.3 Event modules

Each event module (`events/*.rs`) is responsible for:

1. **Constructing the input JSON** from the current session state
2. **Invoking the dispatcher** with the correct event type
3. **Processing hook outputs** and applying decisions

| Module | Event | Key behavior |
|--------|-------|-------------|
| `session_start.rs` | SessionStart | Injects `additionalContext` into conversation on startup/resume |
| `user_prompt_submit.rs` | UserPromptSubmit | Can inject context before the agent processes the prompt; ignores matchers |
| `pre_tool_use.rs` | PreToolUse | Can approve/deny/modify tool calls; `updatedInput` replaces original input |
| `post_tool_use.rs` | PostToolUse | Inspects tool output; can inject additional context |
| `stop.rs` | Stop | Can block the stop to keep the agent running; `stop_hook_active` prevents loops |

### 4.4 Supporting modules

#### `registry.rs`

Stores the parsed hook configuration. Provides lookup by event type, returning the list of applicable hooks (with their matchers and commands).

#### `types.rs`

Shared type definitions:

- `NullableString` — A string that may be null (used for `transcript_path`, `last_assistant_message`)
- Permission mode enum
- Event name enum
- Hook input/output structs
- Matcher pattern type

#### `legacy_notify.rs`

Backward-compatible notification system. Sends notifications when an agent turn completes. Being phased out in favor of the hooks system.

#### `user_notification.rs`

Delivers user-facing notifications (OS-level notifications, terminal bells, etc.) based on hook outputs and configuration.

---

## 5. Notify System

Codex has two mechanisms for external notification: the **legacy notify** system and the **hook-based notification** system. The legacy system is simpler but deprecated; hooks are the recommended replacement.

### 5.1 Legacy Notify

The legacy notify system (`legacy_notify.rs`) is a fire-and-forget mechanism that runs a user-specified command every time an agent turn completes. The notification payload is appended as the **final argv argument** (not stdin) to the configured command.

#### Configuration

In `~/.codex/config.toml`:

```toml
[notify]
# Command to run when an agent turn completes.
# The JSON payload is appended as the last argument.
command = ["notify-send", "Codex"]
```

When a turn completes, Codex executes:

```bash
notify-send "Codex" '{"type":"agent-turn-complete",...}'
```

#### Notification Payload (`agent-turn-complete`)

The legacy notify system emits exactly one event type: `agent-turn-complete`. The payload is tagged JSON (`serde` tag = `"type"`):

```json
{
  "type": "agent-turn-complete",
  "thread-id": "b5f6c1c2-1111-2222-3333-444455556666",
  "turn-id": "12345",
  "cwd": "/Users/example/project",
  "client": "codex-tui",
  "input-messages": [
    "Rename `foo` to `bar` and update the callsites."
  ],
  "last-assistant-message": "Rename complete and verified `cargo build` succeeds."
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"agent-turn-complete"` | Discriminator tag (always this value) |
| `thread-id` | `string` | Session thread UUID |
| `turn-id` | `string` | Identifier for the completed turn |
| `cwd` | `string` | Working directory at the time of the event |
| `client` | `string?` | Originating client: `"codex-tui"` for the terminal UI, or the `clientInfo.name` from the app server's `initialize` request. Omitted if unknown |
| `input-messages` | `string[]` | The user messages that initiated this agent turn |
| `last-assistant-message` | `string?` | The last message the assistant sent in this turn. `null` if the turn produced no assistant output |

#### Execution Model

- **Fire-and-forget**: stdin, stdout, and stderr are all set to `Stdio::null()`. The process is spawned and immediately detached — Codex does not wait for it or read its output.
- **argv-based**: The JSON payload is passed as the final command-line argument, not piped to stdin. This is the key difference from the hooks system which uses stdin.
- **No matcher**: Legacy notify fires on every `after_agent` event. There is no matcher/filtering.
- **Only `after_agent`**: Legacy notify only supports the `AfterAgent` hook event. `AfterToolUse` events produce an error if passed to `legacy_notify_json()`.

#### How It Registers

In the `Hooks` struct (`registry.rs`), legacy notify argv is parsed during construction:

```rust
let after_agent = config
    .legacy_notify_argv
    .filter(|argv| !argv.is_empty() && !argv[0].is_empty())
    .map(crate::notify_hook)
    .into_iter()
    .collect();
```

The `notify_hook()` function wraps the argv into a `Hook` that appends the JSON payload as an arg and spawns the process.

### 5.2 Hook-Based Notifications (Recommended)

The hooks system supersedes legacy notify. Use the `Stop` event in `.codex/hooks.json` to implement custom notification logic with full control:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'Codex' 'Agent turn completed'"
          }
        ]
      }
    ]
  }
}
```

Advantages over legacy notify:
- Can read full event context from stdin (including `last_assistant_message`, `model`, etc.)
- Can return decisions (block, allow) to control Codex behavior
- Supports matchers and multiple handlers
- Can use `systemMessage` output to inject context back into the conversation
- Works with all hook types (command, prompt, agent) — not limited to argv-based commands

### 5.3 Client Field

Both notify mechanisms include a `client` field identifying the calling context:

| Client Value | Source |
|---|---|
| `"codex-tui"` | Terminal UI (the default interactive interface) |
| *(value from `clientInfo.name`)* | App server connections (IDE extensions, SDK clients) |
| `null` / absent | Unknown or internal caller |

This allows hooks to behave differently depending on how Codex is invoked (e.g., send OS notifications only for TUI sessions, send webhooks for IDE sessions).

### 5.4 Internal Hook Events (`types.rs`)

Beyond the 5 public hook events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`), the internal types system defines two additional event types used by the notify system and internal dispatch:

#### `AfterAgent`

Fires after a complete agent turn finishes. This is the event that triggers legacy notify.

```json
{
  "session_id": "thread-uuid",
  "cwd": "/path/to/project",
  "client": "codex-tui",
  "triggered_at": "2025-01-01T00:00:00Z",
  "hook_event": {
    "event_type": "after_agent",
    "thread_id": "thread-uuid",
    "turn_id": "turn-1",
    "input_messages": ["user prompt text"],
    "last_assistant_message": "assistant response text"
  }
}
```

#### `AfterToolUse`

Fires after a single tool execution completes. Contains detailed execution metadata:

```json
{
  "session_id": "thread-uuid",
  "cwd": "/path/to/project",
  "triggered_at": "2025-01-01T00:00:00Z",
  "hook_event": {
    "event_type": "after_tool_use",
    "turn_id": "turn-2",
    "call_id": "call-1",
    "tool_name": "local_shell",
    "tool_kind": "local_shell",
    "tool_input": {
      "input_type": "local_shell",
      "params": {
        "command": ["cargo", "fmt"],
        "workdir": "codex-rs",
        "timeout_ms": 60000,
        "sandbox_permissions": "use_default",
        "justification": null,
        "prefix_rule": null
      }
    },
    "executed": true,
    "success": true,
    "duration_ms": 42,
    "mutating": true,
    "sandbox": "none",
    "sandbox_policy": "danger-full-access",
    "output_preview": "ok"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `turn_id` | `string` | Parent turn identifier |
| `call_id` | `string` | Unique tool call identifier |
| `tool_name` | `string` | Name of the tool (e.g., `"local_shell"`) |
| `tool_kind` | `enum` | `"function"`, `"custom"`, `"local_shell"`, or `"mcp"` |
| `tool_input` | `object` | Tool-specific input (tagged union by `input_type`) |
| `executed` | `bool` | Whether the tool actually ran (vs. being skipped/blocked) |
| `success` | `bool` | Whether execution succeeded |
| `duration_ms` | `u64` | Execution time in milliseconds |
| `mutating` | `bool` | Whether the tool made changes to the filesystem |
| `sandbox` | `string` | Sandbox type used (e.g., `"none"`, `"seatbelt"`) |
| `sandbox_policy` | `string` | Sandbox policy (e.g., `"danger-full-access"`) |
| `output_preview` | `string` | Truncated preview of tool output |

#### Tool Input Variants (`HookToolInput`)

The `tool_input` field is a tagged union (`input_type`):

| `input_type` | Fields | Used For |
|---|---|---|
| `function` | `arguments` (JSON string) | Built-in function tool calls |
| `custom` | `input` (string) | Custom/user-defined tools |
| `local_shell` | `params` (see below) | Shell command execution |
| `mcp` | `server`, `tool`, `arguments` | MCP server tool calls |

**`local_shell` params:**

| Field | Type | Description |
|---|---|---|
| `command` | `string[]` | Command and arguments (e.g., `["cargo", "fmt"]`) |
| `workdir` | `string?` | Working directory override |
| `timeout_ms` | `u64?` | Timeout in milliseconds |
| `sandbox_permissions` | `enum?` | Sandbox permission level |
| `prefix_rule` | `string[]?` | Allowed command prefix patterns |
| `justification` | `string?` | Reason for the command (user-provided) |

### 5.5 Hook Result Types

Hooks return one of three results (`HookResult` in `types.rs`):

| Result | Effect |
|---|---|
| `Success` | Hook completed normally. Continue to next hook. |
| `FailedContinue(error)` | Hook failed, but execution continues (other hooks still run). |
| `FailedAbort(error)` | Hook failed critically. No further hooks run, operation is aborted. |

The `Hooks::dispatch()` method iterates registered hooks and stops early on `FailedAbort`:

```rust
for hook in hooks {
    let outcome = hook.execute(&hook_payload).await;
    if outcome.result.should_abort_operation() {
        break;
    }
}
```

---

## 6. JSON Schemas

### 6.1 SessionStart Input

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SessionStartInput",
  "type": "object",
  "required": [
    "cwd",
    "hook_event_name",
    "model",
    "permission_mode",
    "session_id",
    "source",
    "transcript_path"
  ],
  "properties": {
    "cwd": {
      "type": "string",
      "description": "Current working directory"
    },
    "hook_event_name": {
      "type": "string",
      "const": "SessionStart"
    },
    "model": {
      "type": "string",
      "description": "Active model identifier"
    },
    "permission_mode": {
      "type": "string",
      "enum": ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]
    },
    "session_id": {
      "type": "string",
      "description": "Unique session identifier"
    },
    "source": {
      "type": "string",
      "enum": ["startup", "resume", "clear"],
      "description": "How the session was initiated"
    },
    "transcript_path": {
      "type": ["string", "null"],
      "description": "Path to session transcript file"
    }
  },
  "additionalProperties": false
}
```

### 6.2 SessionStart Output

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SessionStartOutput",
  "type": "object",
  "properties": {
    "continue": {
      "type": "boolean",
      "default": true
    },
    "decision": {
      "type": "string",
      "enum": ["approve", "block"]
    },
    "reason": {
      "type": "string"
    },
    "stopReason": {
      "type": "string"
    },
    "suppressOutput": {
      "type": "boolean",
      "default": false
    },
    "systemMessage": {
      "type": "string"
    },
    "hookSpecificOutput": {
      "type": "object",
      "properties": {
        "hookEventName": {
          "type": "string",
          "enum": ["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "Stop"]
        },
        "additionalContext": {
          "type": "string"
        },
        "permissionDecision": {
          "type": "string",
          "enum": ["allow", "deny", "ask"]
        },
        "permissionDecisionReason": {
          "type": "string"
        },
        "updatedInput": {
          "type": "object"
        }
      }
    }
  }
}
```

### 6.3 UserPromptSubmit Input

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "UserPromptSubmitInput",
  "type": "object",
  "required": [
    "cwd",
    "hook_event_name",
    "model",
    "permission_mode",
    "prompt",
    "session_id",
    "transcript_path",
    "turn_id"
  ],
  "properties": {
    "cwd": {
      "type": "string"
    },
    "hook_event_name": {
      "type": "string",
      "const": "UserPromptSubmit"
    },
    "model": {
      "type": "string"
    },
    "permission_mode": {
      "type": "string",
      "enum": ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]
    },
    "prompt": {
      "type": "string",
      "description": "The user's submitted prompt text"
    },
    "session_id": {
      "type": "string"
    },
    "transcript_path": {
      "type": ["string", "null"]
    },
    "turn_id": {
      "type": "string",
      "description": "Codex extension field for internal turn-scoped hooks"
    }
  },
  "additionalProperties": false
}
```

### 6.4 PreToolUse Input

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PreToolUseInput",
  "type": "object",
  "required": [
    "cwd",
    "hook_event_name",
    "model",
    "permission_mode",
    "session_id",
    "tool_input",
    "tool_name",
    "tool_use_id",
    "transcript_path",
    "turn_id"
  ],
  "properties": {
    "cwd": {
      "type": "string"
    },
    "hook_event_name": {
      "type": "string",
      "const": "PreToolUse"
    },
    "model": {
      "type": "string"
    },
    "permission_mode": {
      "type": "string",
      "enum": ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]
    },
    "session_id": {
      "type": "string"
    },
    "tool_input": {
      "type": "object",
      "required": ["command"],
      "properties": {
        "command": {
          "type": "string",
          "description": "The shell command to be executed"
        }
      }
    },
    "tool_name": {
      "type": "string",
      "const": "Bash"
    },
    "tool_use_id": {
      "type": "string",
      "description": "Unique identifier for this tool invocation"
    },
    "transcript_path": {
      "type": ["string", "null"]
    },
    "turn_id": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### 6.5 PreToolUse Output

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PreToolUseOutput",
  "type": "object",
  "properties": {
    "continue": {
      "type": "boolean",
      "default": true
    },
    "decision": {
      "type": "string",
      "enum": ["approve", "block"]
    },
    "reason": {
      "type": "string"
    },
    "stopReason": {
      "type": "string"
    },
    "suppressOutput": {
      "type": "boolean",
      "default": false
    },
    "systemMessage": {
      "type": "string"
    },
    "hookSpecificOutput": {
      "type": "object",
      "properties": {
        "hookEventName": {
          "type": "string",
          "enum": ["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "Stop"]
        },
        "additionalContext": {
          "type": "string"
        },
        "permissionDecision": {
          "type": "string",
          "enum": ["allow", "deny", "ask"]
        },
        "permissionDecisionReason": {
          "type": "string"
        },
        "updatedInput": {
          "type": "object",
          "description": "Replaces the original tool_input when provided",
          "properties": {
            "command": {
              "type": "string"
            }
          }
        }
      }
    }
  }
}
```

### 6.6 PostToolUse Input

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PostToolUseInput",
  "type": "object",
  "required": [
    "cwd",
    "hook_event_name",
    "model",
    "permission_mode",
    "session_id",
    "tool_input",
    "tool_name",
    "tool_response",
    "tool_use_id",
    "transcript_path",
    "turn_id"
  ],
  "properties": {
    "cwd": {
      "type": "string"
    },
    "hook_event_name": {
      "type": "string",
      "const": "PostToolUse"
    },
    "model": {
      "type": "string"
    },
    "permission_mode": {
      "type": "string",
      "enum": ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]
    },
    "session_id": {
      "type": "string"
    },
    "tool_input": {
      "type": "object",
      "required": ["command"],
      "properties": {
        "command": {
          "type": "string"
        }
      }
    },
    "tool_name": {
      "type": "string",
      "const": "Bash"
    },
    "tool_response": {
      "type": "string",
      "description": "The output from the executed tool"
    },
    "tool_use_id": {
      "type": "string"
    },
    "transcript_path": {
      "type": ["string", "null"]
    },
    "turn_id": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### 6.7 Stop Input

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StopInput",
  "type": "object",
  "required": [
    "cwd",
    "hook_event_name",
    "last_assistant_message",
    "model",
    "permission_mode",
    "session_id",
    "stop_hook_active",
    "transcript_path",
    "turn_id"
  ],
  "properties": {
    "cwd": {
      "type": "string"
    },
    "hook_event_name": {
      "type": "string",
      "const": "Stop"
    },
    "last_assistant_message": {
      "type": ["string", "null"],
      "description": "The agent's final message before stopping"
    },
    "model": {
      "type": "string"
    },
    "permission_mode": {
      "type": "string",
      "enum": ["default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"]
    },
    "session_id": {
      "type": "string"
    },
    "stop_hook_active": {
      "type": "boolean",
      "description": "Whether a stop hook is already active (prevents infinite loops)"
    },
    "transcript_path": {
      "type": ["string", "null"]
    },
    "turn_id": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

### 6.8 Stop Output

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StopOutput",
  "type": "object",
  "properties": {
    "continue": {
      "type": "boolean",
      "default": true,
      "description": "If false, prevents the agent from stopping"
    },
    "decision": {
      "type": "string",
      "enum": ["block"],
      "description": "Only 'block' is valid for Stop events"
    },
    "reason": {
      "type": "string",
      "description": "Required when decision is 'block'. Human-readable reason."
    },
    "stopReason": {
      "type": "string"
    },
    "suppressOutput": {
      "type": "boolean",
      "default": false
    },
    "systemMessage": {
      "type": "string"
    }
  }
}
```

---

## 7. Comparison with Claude Code Hooks

### 7.1 Shared concepts

Both Codex CLI and Claude Code implement hooks with the same fundamental design:

- JSON on stdin, JSON on stdout
- Exit code 0 = success, non-zero = error
- Matcher-based routing
- Same five event types: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop
- Hook discovery from a workspace-local config file

### 7.2 Key differences

| Aspect | OpenAI Codex CLI | Claude Code |
|--------|-----------------|-------------|
| **Implementation language** | Rust (`codex-rs`) | TypeScript |
| **Config file** | `.codex/hooks.json` | `.claude/hooks.json` or `.claude/settings.json` |
| **Tool scope** | Only `Bash` tool | Multiple tools (Bash, Read, Write, Edit, etc.) |
| **`tool_name` field** | Const `"Bash"` | Varies by tool |
| **Permission modes** | 5 modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions` | 3 modes: `default`, `acceptEdits`, `bypassPermissions` |
| **SessionStart `source`** | `"startup"`, `"resume"`, `"clear"` | `"startup"`, `"resume"` |
| **Stop output `decision`** | Only `"block"` allowed | May support `"approve"` |
| **`turn_id` field** | Present on UserPromptSubmit, PreToolUse, PostToolUse, Stop | Not present |
| **`stop_hook_active`** | Explicit boolean in Stop input | Implicit handling |
| **`updatedInput`** | Can modify tool_input in PreToolUse | Similar capability |
| **Schema validation** | Formal JSON Schema files in `schema/generated/` | Inline validation |
| **Schema loader** | Dedicated `schema_loader.rs` module | No equivalent |
| **Legacy notify** | `legacy_notify.rs` (being phased out) | Built-in notification system |
| **Client field** | `client` field in notify system | No equivalent |

### 7.3 Schema differences detail

**Codex-specific fields not in Claude Code:**

- `turn_id` — Internal turn-scoped identifier on UserPromptSubmit, PreToolUse, PostToolUse, and Stop events
- `stop_hook_active` — Boolean guard on Stop events
- `source: "clear"` — Additional SessionStart source variant
- `permission_mode: "plan"` and `permission_mode: "dontAsk"` — Additional permission modes
- Formal `hookSpecificOutput` wrapper with structured `permissionDecision`, `permissionDecisionReason`, `updatedInput`

**Claude Code fields not in Codex:**

- Multi-tool `tool_name` support (Read, Write, Edit, MCP tools)
- `tool_input` schemas vary by tool type
- `session_id` may not be present on all events
