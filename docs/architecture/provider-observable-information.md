---
title: Provider Observable Information — Complete Inventory
status: living document
---

# Provider Observable Information — Complete Inventory

## Purpose

100% complete reference of what information Stoa can obtain from each provider (claude-code, opencode, codex), through every channel: command-line, environment variables, hooks/sidecars, webhook payloads, PTY output, file system reads, SQLite databases, and OTel telemetry.

## Summary

Three providers each use a combination of command-line flags, environment variables, file-system sidecars, and webhook events to exchange information with Stoa. All three provide session lifecycle status and external session IDs. **Additionally, each provider has significant untapped observability** — Claude Code exposes 30+ hook events, OpenCode stores everything in SQLite and offers 29 plugin events, and Codex provides a 5-event lifecycle hook system (same ecological niche as Claude Code) plus OTel metrics with token usage. **Codex's notify hook is legacy** — replaced by the `ClaudeHooksEngine` with `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` events that directly compete with Claude Code's hooks. Stoa currently uses a small fraction of each provider's capabilities.

---

## Part 0: Shared Infrastructure

### CanonicalSessionEvent

`src/shared/project-session.ts:180-190`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_version` | `1` | yes | Literal 1 |
| `event_id` | `string` | yes | UUID |
| `event_type` | `string` | yes | e.g. `"claude-code.Stop"`, `"session.idle"` |
| `timestamp` | `string` | yes | ISO 8601 |
| `session_id` | `string` | yes | Stoa internal session ID (`session_<uuid>`) |
| `project_id` | `string` | yes | Stoa internal project ID (`project_<uuid>`) |
| `correlation_id` | `string` | no | Message-level correlation (opencode only) |
| `source` | `'hook-sidecar' \| 'provider-adapter' \| 'system-recovery'` | yes | Origin of the event |
| `payload` | `SessionEventPayload` | yes | Status + optional external ID |

### SessionEventPayload

`src/shared/project-session.ts:173-178`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `SessionStatus` | no | Defaults to `'running'` in bridge |
| `summary` | `string` | no | Defaults to `event_type` in bridge |
| `isProvisional` | `boolean` | no | Unused in current logic |
| `externalSessionId` | `string \| null` | no | External provider's session ID |

### SessionStatus (all possible values)

`src/shared/project-session.ts:5-14`

```
'bootstrapping' | 'starting' | 'running' | 'turn_complete'
| 'awaiting_input' | 'degraded' | 'error' | 'exited'
| 'needs_confirmation'
```

### Webhook Server Endpoints

`src/core/webhook-server.ts`

| Endpoint | Purpose | Auth | Validation |
|----------|---------|------|------------|
| `GET /health` | Liveness check | none | none |
| `POST /events` | Canonical events from sidecars | `x-stoa-secret` header | `isCanonicalSessionEvent()` |
| `POST /hooks/claude-code` | Claude Code hook payloads | `x-stoa-secret` + `x-stoa-session-id` + `x-stoa-project-id` headers | Body must be object; adapter processes `hook_event_name` |

### Event Flow (all providers)

```
Provider CLI process
  → Sidecar/Hook fires
  → HTTP POST to webhook server (127.0.0.1:<port>)
  → webhook-server.ts validates + authenticates
  → SessionEventBridge.onEvent() extracts status, summary, externalSessionId
  → SessionRuntimeController.applySessionEvent()
  → ProjectSessionManager.applySessionEvent() — persists to disk
  → IPC push to renderer (IPC_CHANNELS.sessionEvent)
```

### Environment Variables (injected into ALL providers)

`src/extensions/providers/claude-code-provider.ts:11-19`, `opencode-provider.ts:11-19`, `codex-provider.ts:21-29`

| Variable | Value | Used by |
|----------|-------|---------|
| `STOA_SESSION_ID` | `target.session_id` (Stoa internal) | All providers — hooks/sidecars reference this |
| `STOA_PROJECT_ID` | `target.project_id` (Stoa internal) | All providers |
| `STOA_SESSION_SECRET` | `stoa-<uuid>` token | All providers — webhook auth |
| `STOA_WEBHOOK_PORT` | Ephemeral port number | All providers — sidecar URL construction |
| `STOA_PROVIDER_PORT` | `webhookPort + 1` | All providers — currently unused by any sidecar |

### PTY Output Handling (all providers)

`src/core/session-runtime.ts:107-109`, `src/main/session-runtime-controller.ts:64-96`

- Raw text, no structured parsing
- In-memory backlog per session, capped at 250,000 characters
- Forwarded to renderer via `IPC_CHANNELS.terminalData`
- No regex matching, no ANSI stripping, no JSON extraction

### Terminal Input (all providers)

`src/main/session-runtime-controller.ts:73-76` (inferred from `sendSessionInput` in RendererApi)

- Default behavior: raw keystrokes are forwarded to PTY
- Provider-specific exception: for Codex on Windows, Stoa normalizes plain-text multi-character input before PTY write
- Codex control sequences containing `ESC` remain raw and are not split
- This Codex handling is an ingress workaround only; it does not infer state from terminal text
- Hook/state correctness still depends on provider-emitted events, not renderer-side parsing

---

## Part 1: Claude-Code Provider

### 1.1 Provider Descriptor

`src/shared/provider-descriptors.ts:49-59`

| Property | Value |
|----------|-------|
| `providerId` | `'claude-code'` |
| `executableName` | `'claude'` |
| `supportsResume` | `true` |
| `supportsStructuredEvents` | `true` |
| `seedsExternalSessionId` | `true` |
| `prefersShellWrap` | `false` |

### 1.2 Command-Line Flags

`src/extensions/providers/claude-code-provider.ts:22-31, 85-106`

| Scenario | Command |
|----------|---------|
| Fresh start | `claude --session-id <uuid>` |
| Resume | `claude --resume <uuid>` |
| With skip-permissions | either command + `--dangerously-skip-permissions` |

`--setting-sources user,project,local` was useful for isolated headless diagnostics, but it is not part of Stoa's production Claude provider command contract.

**Binary resolution**: `context.providerPath` if set and non-empty, else `'claude'` (line 6-9)

### 1.3 File System Writes

`src/extensions/providers/claude-code-provider.ts:33-83`

| File | Content |
|------|---------|
| `<project>/.claude/settings.local.json` | Claude hooks config (overwritten on every session start) |

### 1.4 File System Reads

**None.** The provider does not read any files from `~/.claude/` or the project directory.

### 1.5 Hooks Registered

`src/extensions/providers/claude-code-provider.ts:33-83`

| Hook Event | Matcher | Target URL |
|------------|---------|------------|
| `UserPromptSubmit` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `PreToolUse` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `Stop` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `StopFailure` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |
| `PermissionRequest` | `*` | `POST http://127.0.0.1:<port>/hooks/claude-code` |

**Headers injected by Claude CLI hook runtime** (from env vars via `allowedEnvVars`):

| Header | Env Var Source |
|--------|---------------|
| `x-stoa-session-id` | `${STOA_SESSION_ID}` |
| `x-stoa-project-id` | `${STOA_PROJECT_ID}` |
| `x-stoa-secret` | `${STOA_SESSION_SECRET}` |

### 1.6 Webhook Payload — What the Adapter Extracts

`src/core/hook-event-adapter.ts:4-40`

The adapter reads exactly **one field** from the Claude Code hook POST body:

| Body Field | Used As | Example |
|------------|---------|---------|
| `hook_event_name` | Event type discriminator + status mapping | `"Stop"`, `"PermissionRequest"` |

**Mapping table:**

| `hook_event_name` | Status Produced | event_type |
|-------------------|----------------|------------|
| `"SessionStart"` | `running` | `"claude-code.SessionStart"` |
| `"UserPromptSubmit"` | `running` | `"claude-code.UserPromptSubmit"` |
| `"PreToolUse"` | `running` | `"claude-code.PreToolUse"` |
| `"Stop"` | `turn_complete` | `"claude-code.Stop"` |
| `"StopFailure"` | `error` | `"claude-code.StopFailure"` |
| `"PermissionRequest"` | `needs_confirmation` | `"claude-code.PermissionRequest"` |
| anything else | (ignored, returns null) | — |

### 1.6a Claude Code Hooks — Complete Internal State Capabilities (Official Docs Research)

**Source**: [Hooks Reference — Claude Code Docs](https://code.claude.com/docs/en/hooks)

> This section documents what Claude Code hooks **can** expose, far beyond what the Stoa adapter currently uses. It serves as a reference for future enhancement.

#### A. Hook Data Delivery Mechanism

All hooks receive JSON via **stdin** (command hooks) or **HTTP POST body** (http hooks). Five hook types exist:

| Type | Mechanism | Response |
|------|-----------|----------|
| `command` | Shell command, stdin JSON | stdout JSON + exit code |
| `http` | HTTP POST to URL | Response body JSON |
| `mcp_tool` | Calls MCP server tool | Tool text output |
| `prompt` | Single-turn LLM evaluation | `{ok: true/false}` |
| `agent` | Subagent with tool access (up to 50 turns) | `{ok: true/false}` |

#### B. Common Input Fields (ALL hooks receive these)

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse"
}
```

Subagent hooks additionally receive `agent_id` and `agent_type`.

#### C. Key Field: `transcript_path` — Full Conversation Access

The `transcript_path` field points to a JSONL file containing the **entire conversation history**. A hook script can read this file to obtain:

- All user messages
- All assistant responses
- All tool calls and their parameters
- All tool results
- Timestamps for each entry
- The full session state at any point

Example of reading transcript:
```bash
TRANSCRIPT_PATH=$(jq -r '.transcript_path')
# Extract all assistant messages
jq -c 'select(.type == "assistant") | .message.content' "$TRANSCRIPT_PATH"
# Extract all tool calls
jq -c 'select(.type == "tool_use") | {name, input}' "$TRANSCRIPT_PATH"
```

#### D. All Hook Events and Their Data Fields

##### D.1 Session-Level Events

| Event | Trigger | Extra Fields | Stoa Currently Uses? |
|-------|---------|-------------|---------------------|
| `SessionStart` | Session begins/resumes | `source` (`startup`/`resume`/`clear`/`compact`), `model` (**model identifier**), `agent_type` | **no** |
| `SessionEnd` | Session terminates | `reason` (`clear`/`resume`/`logout`/`prompt_input_exit`/`bypass_permissions_disabled`/`other`) | **no** |
| `InstructionsLoaded` | CLAUDE.md or rules file loaded | `file_path`, `memory_type` (`User`/`Project`/`Local`/`Managed`), `load_reason`, `globs`, `trigger_file_path`, `parent_file_path` | **no** |
| `PreCompact` | Before context compaction | `trigger` (`manual`/`auto`), `custom_instructions` | **no** |
| `PostCompact` | After context compaction | `trigger`, `compact_summary` (**full conversation summary**) | **no** |

##### D.2 Turn-Level Events

| Event | Trigger | Extra Fields | Stoa Currently Uses? |
|-------|---------|-------------|---------------------|
| `UserPromptSubmit` | User submits a prompt | `prompt` (**full user input text**) | **no** |
| `UserPromptExpansion` | Slash command expands | `expansion_type`, `command_name`, `command_args`, `command_source`, `prompt` | **no** |
| `Stop` | Claude finishes responding | `stop_hook_active`, `last_assistant_message` (**Claude's final reply**) | **yes** |
| `StopFailure` | API error stops turn | `error` (type), `error_details`, `last_assistant_message` | **no** |

##### D.3 Tool-Level Events (Agentic Loop)

| Event | Trigger | Extra Fields | Stoa Currently Uses? |
|-------|---------|-------------|---------------------|
| `PreToolUse` | Before tool execution | `tool_name`, `tool_input` (**full parameters**), `tool_use_id` | **no** |
| `PostToolUse` | After tool succeeds | `tool_name`, `tool_input`, `tool_response` (**tool result**), `tool_use_id` | **no** |
| `PostToolUseFailure` | After tool fails | `tool_name`, `tool_input`, `error`, `is_interrupt`, `tool_use_id` | **no** |
| `PostToolBatch` | Parallel tools complete | `tool_calls` (**array of all calls + responses**) | **no** |
| `PermissionRequest` | Permission dialog shown | `tool_name`, `tool_input`, `permission_suggestions` | **yes** |
| `PermissionDenied` | Auto-mode denies | `tool_name`, `tool_input`, `reason`, `tool_use_id` | **no** |

##### D.4 Subagent Events

| Event | Trigger | Extra Fields | Stoa Currently Uses? |
|-------|---------|-------------|---------------------|
| `SubagentStart` | Subagent spawned | `agent_id`, `agent_type` | **no** |
| `SubagentStop` | Subagent finishes | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active` | **no** |

##### D.5 Other Events

| Event | Trigger | Extra Fields | Stoa Currently Uses? |
|-------|---------|-------------|---------------------|
| `Notification` | Notification sent | `message`, `title`, `notification_type` | **no** |
| `ConfigChange` | Config file changes | `source`, `file_path` | **no** |
| `CwdChanged` | Working directory changes | `old_cwd`, `new_cwd` | **no** |
| `FileChanged` | Watched file changes | `file_path`, `event` (`change`/`add`/`unlink`) | **no** |
| `TaskCreated` | Task created | `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name` | **no** |
| `TaskCompleted` | Task completed | Same as TaskCreated | **no** |
| `TeammateIdle` | Teammate about to idle | `teammate_name`, `team_name` | **no** |
| `WorktreeCreate` | Git worktree created | `name` | **no** |
| `WorktreeRemove` | Git worktree removed | `worktree_path` | **no** |
| `Elicitation` | MCP server requests input | `mcp_server_name`, `message`, `mode`, `url`, `elicitation_id`, `requested_schema` | **no** |
| `ElicitationResult` | User responded to MCP | `mcp_server_name`, `action`, `content`, `mode`, `elicitation_id` | **no** |

#### E. PreToolUse — Detailed `tool_input` Schemas by Tool

| Tool | `tool_input` Fields |
|------|-------------------|
| **Bash** | `command` (string), `description` (string), `timeout` (number), `run_in_background` (boolean) |
| **Write** | `file_path` (string), `content` (string — full file content) |
| **Edit** | `file_path` (string), `old_string` (string), `new_string` (string), `replace_all` (boolean) |
| **Read** | `file_path` (string), `offset` (number), `limit` (number) |
| **Glob** | `pattern` (string), `path` (string) |
| **Grep** | `pattern` (string), `path` (string), `glob` (string), `output_mode` (string), `-i` (boolean), `multiline` (boolean) |
| **WebFetch** | `url` (string), `prompt` (string) |
| **WebSearch** | `query` (string), `allowed_domains` (array), `blocked_domains` (array) |
| **Agent** | `prompt` (string), `description` (string), `subagent_type` (string), `model` (string) |
| **AskUserQuestion** | `questions` (array), `answers` (object) |
| MCP tools | `mcp__<server>__<tool>` with tool-specific input |

#### F. Hook Output — Controlling Claude Behavior

Hooks return decisions via **exit code** and **stdout JSON**:

| Exit Code | Effect |
|-----------|--------|
| `0` | Success, parse stdout JSON |
| `2` | Block action (stderr → Claude as error) |
| Other | Non-blocking error, continue |

**PreToolUse output** (most powerful):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask|defer",
    "permissionDecisionReason": "...",
    "updatedInput": { "command": "modified command" },
    "additionalContext": "injected context for Claude"
  }
}
```

**Stop / SubagentStop output**:
```json
{ "decision": "block", "reason": "Tests not passing, continue working" }
```

**Universal output** (all events):
```json
{
  "continue": false,
  "stopReason": "Stop message for user",
  "systemMessage": "Warning for user",
  "suppressOutput": true
}
```

#### G. Environment Variables Available to Hooks

| Variable | Description |
|----------|-------------|
| `CLAUDE_PROJECT_DIR` | Project root directory |
| `CLAUDE_ENV_FILE` | File path to persist env vars for subsequent Bash commands |
| `CLAUDE_CODE_REMOTE` | `"true"` in remote web environments |
| `CLAUDE_PLUGIN_ROOT` | Plugin installation directory |
| `CLAUDE_PLUGIN_DATA` | Plugin persistent data directory |

#### H. Matcher Patterns

| Pattern | Evaluation | Example |
|---------|-----------|---------|
| `"*"`, `""`, or omitted | Match all | fires on every occurrence |
| Letters/digits/`_`/`|` only | Exact string match | `Bash` or `Edit|Write` |
| Contains other characters | JavaScript regex | `^Notebook`, `mcp__memory__.*` |

Tool events additionally support `if` field with permission rule syntax: `"Bash(git *)"`, `"Edit(*.ts)"`.

#### I. Hook Configuration Locations

| Location | Scope | Shareable |
|----------|-------|-----------|
| `~/.claude/settings.json` | All projects | No (local machine) |
| `.claude/settings.json` | Single project | Yes (committable) |
| `.claude/settings.local.json` | Single project | No (gitignored) |
| Managed policy settings | Organization | Yes (admin-controlled) |
| Plugin `hooks/hooks.json` | When plugin enabled | Yes (bundled) |
| Skill/agent frontmatter | While component active | Yes |

#### J. What This Means for Stoa — Currently Untapped Hook Events

The Stoa adapter currently only registers hooks for `Stop` and `PermissionRequest`. The following events could provide **significant additional observability** if registered:

| Untapped Event | New Observability | Business Value |
|----------------|-------------------|----------------|
| `SessionStart` | Model identity (`model` field) | Show which model is running in UI |
| `UserPromptSubmit` | Full user prompt text | Input validation, prompt history |
| `PreToolUse` (Bash) | Every command before execution | Security auditing, command logging |
| `PreToolUse` (Write/Edit) | Files being modified | Real-time file change tracking |
| `PostToolUse` | Tool results | Output monitoring, error detection |
| `StopFailure` | API error type + details | Better error handling UI |
| `SubagentStart/Stop` | Subagent lifecycle | Progress tracking for team tasks |
| `PostCompact` | Conversation summary after compaction | Context preservation |
| `Notification` | Notification content | Alert forwarding to UI |
| `CwdChanged` | Directory changes | Project context tracking |

**Highest-value additions** (in order of impact):
1. **`SessionStart`** — gives `model` field, enabling model identity display (currently listed as "unobtainable")
2. **`PreToolUse`** (Bash matcher) — gives `tool_input.command`, enabling command auditing
3. **`StopFailure`** — gives `error` type + details, enabling meaningful error display
4. **`PostToolUse`** (Write/Edit matcher) — gives `tool_input.file_path`, enabling file change tracking

### 1.7 External Session ID Lifecycle

| Phase | Mechanism | Source |
|-------|-----------|--------|
| **Creation** | `randomUUID()` seeded by app | `project-session-manager.ts:107-115` |
| **First start** | Passed as `--session-id <uuid>` | `claude-code-provider.ts:103` |
| **Resume** | Passed as `--resume <uuid>` | `claude-code-provider.ts:106` |
| **Discovery** | No-op (returns pre-seeded value) | `claude-code-provider.ts:114-116` |
| **Update from events** | Possible via `payload.externalSessionId` in webhooks, but claude-code hooks never populate this | — |

### 1.8 Complete List of Observable Information

> Legend: "yes (used)" = currently wired to Stoa adapter; "yes (available)" = exposed by hooks but NOT currently registered/read by Stoa

| Information | Obtainable? | Channel | Location |
|-------------|-------------|---------|----------|
| Session status (starting/running/turn_complete/needs_confirmation/exited) | yes (used) | hooks → webhook → adapter | `hook-event-adapter.ts:16-21` |
| External session ID | yes (used, pre-seeded) | app internal | `project-session-manager.ts:112-114` |
| Turn completion | yes (used) | `Stop` hook | `hook-event-adapter.ts:17-18` |
| Permission request | yes (used) | `PermissionRequest` hook | `hook-event-adapter.ts:19-20` |
| Process exit code | yes (used) | PTY `onExit` callback | `session-runtime.ts:111-113` |
| Raw terminal output | yes (used, opaque text) | PTY `onData` | `session-runtime.ts:107-109` |
| **Model identity** | **yes (available)** | `SessionStart` hook → `model` field | Currently not registered |
| **Full user prompt text** | **yes (available)** | `UserPromptSubmit` hook → `prompt` field | Currently not registered |
| **Last assistant message** | **yes (available)** | `Stop` hook → `last_assistant_message` field | Hook registered but field not extracted |
| **Tool calls (name + input)** | **yes (available)** | `PreToolUse` hook → `tool_name`, `tool_input` | Currently not registered |
| **Tool results** | **yes (available)** | `PostToolUse` hook → `tool_response` | Currently not registered |
| **Tool failures + error** | **yes (available)** | `PostToolUseFailure` hook → `error`, `is_interrupt` | Currently not registered |
| **Bash commands before execution** | **yes (available)** | `PreToolUse` (Bash) → `tool_input.command` | Currently not registered |
| **Files being written** | **yes (available)** | `PreToolUse` (Write/Edit) → `tool_input.file_path`, `tool_input.content` | Currently not registered |
| **API error type + details** | **yes (available)** | `StopFailure` hook → `error`, `error_details` | Currently not registered |
| **Full conversation history** | **yes (available)** | Any hook → `transcript_path` → read JSONL file | Not used |
| **Compaction summary** | **yes (available)** | `PostCompact` hook → `compact_summary` | Currently not registered |
| **Subagent lifecycle** | **yes (available)** | `SubagentStart`/`SubagentStop` hooks → `agent_type`, `last_assistant_message` | Currently not registered |
| **Session end reason** | **yes (available)** | `SessionEnd` hook → `reason` | Currently not registered |
| **Permission denial reason** | **yes (available)** | `PermissionDenied` hook → `reason` | Currently not registered |
| **Working directory changes** | **yes (available)** | `CwdChanged` hook → `old_cwd`, `new_cwd` | Currently not registered |
| **Notification content** | **yes (available)** | `Notification` hook → `message`, `title` | Currently not registered |
| **File changes on disk** | **yes (available)** | `FileChanged` hook → `file_path`, `event` | Currently not registered |
| Token usage / cost | **no** | Not exposed by any hook event | — |
| Internal conversation switch | **no** | No event type for `/resume`, `/new`, `/clear` | — |
| Claude Code version | **no** | Not exposed by any hook event | — |
| Agent reasoning / thinking | **no** | Not exposed | — |

---

## Part 2: OpenCode Provider

### 2.1 Provider Descriptor

`src/shared/provider-descriptors.ts:28-37`

| Property | Value |
|----------|-------|
| `providerId` | `'opencode'` |
| `executableName` | `'opencode'` |
| `supportsResume` | `true` |
| `supportsStructuredEvents` | `true` |
| `seedsExternalSessionId` | `false` |
| `prefersShellWrap` | `true` |

### 2.2 Command-Line Flags

`src/extensions/providers/opencode-provider.ts:22-29, 52-57`

| Scenario | Command |
|----------|---------|
| Fresh start | `opencode` (no args) |
| Resume | `opencode --session <externalSessionId>` |
| Fallback resume | **not implemented** (falls through to fresh start) |

**Binary resolution**: `context.providerPath` if set and non-empty, else `'opencode'` (line 6-9)

**Shell wrapping**: Command is wrapped in user's configured shell (`prefersShellWrap: true`).

### 2.3 File System Writes

`src/extensions/providers/opencode-provider.ts:31-41`

| File | Content |
|------|---------|
| `<project>/.opencode/plugins/stoa-status.ts` | TypeScript sidecar plugin (overwritten on every session start) |

### 2.4 File System Reads

**None.**

### 2.5 Sidecar Plugin Event Handling

`src/extensions/providers/opencode-provider.ts:31-41` (template string)

The plugin registers as an opencode event handler and captures **4 event types**:

| Opencode Event | Status Produced | Semantic |
|----------------|----------------|----------|
| `session.idle` | `turn_complete` | Agent finished a turn |
| `permission.asked` | `needs_confirmation` | Agent needs permission |
| `permission.replied` | `running` | User responded to permission |
| `session.error` | `error` | Session error |
| all others | (ignored, early return) | — |

### 2.6 Data Fields Extracted from Opencode Events

`src/extensions/providers/opencode-provider.ts:34-41` (inside template string)

| Event Property | Extracted As | Maps to CanonicalEvent Field |
|----------------|-------------|------------------------------|
| `event.id` | Event ID (fallback: `crypto.randomUUID()`) | `event_id` |
| `event.type` | Event type + status mapping | `event_type`, `payload.summary` |
| `event.properties?.messageID` | Correlation ID | `correlation_id` |
| `event.properties?.sessionID` | External session ID | `payload.externalSessionId` |

### 2.7 Webhook POST Payload Structure

`src/extensions/providers/opencode-provider.ts:34-41`

```json
{
  "event_version": 1,
  "event_id": "<event.id or UUID>",
  "event_type": "<event.type>",
  "timestamp": "<ISO 8601>",
  "session_id": "<STOA_SESSION_ID>",
  "project_id": "<STOA_PROJECT_ID>",
  "correlation_id": "<event.properties?.messageID>",
  "source": "hook-sidecar",
  "payload": {
    "status": "<turn_complete|needs_confirmation|running|error>",
    "summary": "<event.type>",
    "isProvisional": false,
    "externalSessionId": "<event.properties?.sessionID>"
  }
}
```

POSTed to `http://127.0.0.1:<STOA_WEBHOOK_PORT>/events` with headers `content-type: application/json` and `x-stoa-secret: <STOA_SESSION_SECRET>`.

### 2.8 External Session ID Lifecycle

| Phase | Mechanism | Source |
|-------|-----------|--------|
| **Creation** | `null` (not seeded) | `project-session-manager.ts:107-115` |
| **Discovery** | Not implemented (`discoverExternalSessionIdAfterStart` not defined) | — |
| **Arrival** | Via sidecar webhook: `event.properties?.sessionID` → `payload.externalSessionId` | `opencode-provider.ts:38` |
| **Resume** | Uses discovered ID: `opencode --session <id>` | `opencode-provider.ts:55-57` |
| **Update from events** | Every sidecar event may carry a new `externalSessionId` via `event.properties?.sessionID` | — |

### 2.9 Complete List of Observable Information

> Legend: "yes (used)" = currently wired to Stoa sidecar; "yes (available)" = exposed by plugin events or file system but NOT currently extracted by Stoa

| Information | Obtainable? | Channel | Location |
|-------------|-------------|---------|----------|
| Session status (starting/running/turn_complete/needs_confirmation/error/exited) | yes (used) | sidecar → webhook | `opencode-provider.ts:34-41` |
| External session ID | yes (used, discovered async) | `event.properties?.sessionID` | `opencode-provider.ts:38` |
| Turn completion | yes (used) | `session.idle` event | `opencode-provider.ts` template |
| Permission request | yes (used) | `permission.asked` event | `opencode-provider.ts` template |
| Permission response | yes (used) | `permission.replied` event → `running` | `opencode-provider.ts` template |
| Session error | yes (used) | `session.error` event | `opencode-provider.ts` template |
| Message correlation ID | yes (used) | `event.properties?.messageID` → `correlation_id` | `opencode-provider.ts:38` |
| Process exit code | yes (used) | PTY `onExit` callback | `session-runtime.ts:111-113` |
| Raw terminal output | yes (used, opaque text) | PTY `onData` | `session-runtime.ts:107-109` |
| **Model identity** | **yes (available)** | Plugin `message.updated` → message `model` field | Currently not extracted |
| **Token usage + cost** | **yes (available)** | SQLite `sessions` table → `prompt_tokens`, `completion_tokens`, `cost` | Currently not read |
| **Tool calls (name + input)** | **yes (available)** | Plugin `tool.execute.before` → `input.tool`, `output.args` | Currently not subscribed |
| **Tool results** | **yes (available)** | Plugin `tool.execute.after` → output payload | Currently not subscribed |
| **Message content (streaming)** | **yes (available)** | Plugin `message.updated` → parts array (text, tool_call, tool_result, reasoning) | Currently not subscribed |
| **Conversation history** | **yes (available)** | SQLite `messages` table → role, parts (JSON), model | Currently not read |
| **Session title** | **yes (available)** | SQLite `sessions` table → `title` | Currently not read |
| **File edits** | **yes (available)** | Plugin `file.edited` event | Currently not subscribed |
| **Session creation/deletion** | **yes (available)** | Plugin `session.created`, `session.deleted` events | Currently not subscribed |
| **Session compaction** | **yes (available)** | Plugin `session.compacted` event | Currently not subscribed |
| **Permission details** | **yes (available)** | Plugin `permission.asked` → `toolName`, `description`, `action`, `params`, `path` | Currently not extracted |
| **Reasoning/thinking content** | **yes (available)** | Plugin `message.updated` → `reasoning` content part | Currently not subscribed |
| Error details | **no** (only status `error`) | — | — |
| Internal conversation switch | **no** | — | — |
| Opencode version | **no** | — | — |

### 2.9a OpenCode CLI — Complete Internal State Capabilities (Official Docs & Source Research)

**Source**: [OpenCode GitHub Repository](https://github.com/opencode-ai/opencode), [Plugin Documentation](https://opencode.ai/docs/plugins), [CLI Reference](https://opencode.ai/docs/cli)

> This section documents what OpenCode **can** expose through its plugin system, SQLite database, CLI commands, and file system artifacts. It serves as a reference for future enhancement.

#### A. Plugin System — The Primary Observability Mechanism

OpenCode has a full **JavaScript/TypeScript plugin system** that is the richest way to observe internal state. Plugins are loaded from:
- `.opencode/plugins/` (project-level)
- `~/.config/opencode/plugins/` (global)
- npm packages specified in config (`"plugin": ["package-name"]`)

**Plugin TypeScript type**:
```typescript
import type { Plugin } from "@opencode-ai/plugin"
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return { /* hooks */ }
}
```

**Plugin context parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `project` | object | Current project information |
| `directory` | string | Current working directory |
| `worktree` | string | Git worktree path |
| `client` | SDK client | OpenCode SDK for API calls, structured logging |
| `$` | Bun Shell | Shell API for executing commands |

#### B. All Plugin Events (29 Total)

> Stoa currently subscribes to **4 of 29** available events.

##### B.1 Session Events (8)

| Event | Trigger | Data Available | Stoa Uses? |
|-------|---------|----------------|------------|
| `session.created` | New session created | Session ID, title | **no** |
| `session.idle` | Agent finished a turn | Session ID | **yes** |
| `session.error` | Session error occurred | Session ID, error | **yes** |
| `session.updated` | Session metadata changed | Session ID, changes | **no** |
| `session.deleted` | Session deleted | Session ID | **no** |
| `session.compacted` | Context compaction completed | Session ID, summary | **no** |
| `session.diff` | Session diff generated | Session ID, diff content | **no** |
| `session.status` | Session status changed | Session ID, status | **no** |

##### B.2 Message Events (4)

| Event | Trigger | Data Available | Stoa Uses? |
|-------|---------|----------------|------------|
| `message.updated` | Message content updated (streaming) | Message ID, role, **parts** (text/tool_call/tool_result/reasoning), **model** | **no** |
| `message.removed` | Message deleted | Message ID | **no** |
| `message.part.updated` | Content part updated | Part data | **no** |
| `message.part.removed` | Content part removed | Part data | **no** |

##### B.3 Tool Events (2)

| Event | Trigger | Data Available | Stoa Uses? |
|-------|---------|----------------|------------|
| `tool.execute.before` | Before tool execution | `input.tool` (name), `output.args` (parameters, **mutable**) | **no** |
| `tool.execute.after` | After tool execution | `input.tool` (name), `output.args`, **tool result** | **no** |

##### B.4 Permission Events (2)

| Event | Trigger | Data Available | Stoa Uses? |
|-------|---------|----------------|------------|
| `permission.asked` | Permission dialog shown | `toolName`, `description`, `action`, `params`, `path` | **yes** (status only) |
| `permission.replied` | User responded to permission | Same as above | **yes** (status only) |

##### B.5 Other Events (13)

| Event | Trigger | Data Available |
|-------|---------|----------------|
| `file.edited` | File modified on disk | File path, content |
| `file.watcher.updated` | File watcher event | File path, event type |
| `command.executed` | Slash command executed | Command name, args |
| `installation.updated` | App updated | Version info |
| `lsp.client.diagnostics` | LSP diagnostics | Diagnostic data |
| `lsp.updated` | LSP state changed | LSP state |
| `server.connected` | Server connection | Connection info |
| `todo.updated` | Todo item changed | Todo data |
| `shell.env` | Shell environment | `output.env` (mutable) |
| `tui.prompt.append` | TUI prompt text | Prompt content |
| `tui.command.execute` | TUI command | Command |
| `tui.toast.show` | Toast notification | Message |

#### C. SQLite Database — Direct Data Access

**Location**: `.opencode/opencode.db`

**`sessions` table** — per-session aggregate data:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Session UUID |
| `parent_session_id` | TEXT | Parent session (for sub-tasks) |
| `title` | TEXT | Auto-generated session title |
| `message_count` | INTEGER | Total messages |
| `prompt_tokens` | INTEGER | Input tokens (incl. cache creation) |
| `completion_tokens` | INTEGER | Output tokens (incl. cache read) |
| `cost` | REAL | Calculated cost (USD) |
| `summary_message_id` | TEXT | Compaction summary reference |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |

**`messages` table** — per-message content:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Message UUID |
| `session_id` | TEXT FK | Session reference |
| `role` | TEXT | `user`, `assistant`, `system`, `tool` |
| `parts` | TEXT | JSON array of typed content parts |
| `model` | TEXT | **Model identifier** (e.g. `claude-4-sonnet`) |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |
| `finished_at` | INTEGER | Completion timestamp |

**Content part types** (polymorphic JSON in `parts` column):

| Part Type | Fields | Description |
|-----------|--------|-------------|
| `text` | `text` | Text content |
| `reasoning` | `thinking` | **Agent reasoning/thinking content** |
| `tool_call` | `id`, `name`, `input`, `type`, `finished` | Tool invocation |
| `tool_result` | `tool_call_id`, `name`, `content`, `metadata`, `is_error` | Tool output |
| `finish` | `reason`, `time` | Turn completion (`end_turn`, `max_tokens`, `tool_use`, `canceled`, `error`, `permission_denied`) |
| `image_url` | `url`, `detail` | Image content |
| `binary` | `path`, `mimeType`, `data` | Binary content |

**`files` table** — file snapshots per session:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | File UUID |
| `session_id` | TEXT FK | Session reference |
| `path` | TEXT | File path |
| `content` | TEXT | File content |
| `version` | TEXT | Version identifier |

#### D. Token Usage & Cost Tracking

OpenCode tracks token usage at the **session level** in the SQLite database:

```go
type TokenUsage struct {
    InputTokens          int64
    OutputTokens         int64
    CacheCreationTokens  int64
    CacheReadTokens      int64
}
```

Cost calculation (from source):
```
cost = (CacheCreationTokens × CostPer1MInCached / 1e6) +
       (CacheReadTokens × CostPer1MOutCached / 1e6) +
       (InputTokens × CostPer1MIn / 1e6) +
       (OutputTokens × CostPer1MOut / 1e6)
```

Session fields updated: `PromptTokens = InputTokens + CacheCreationTokens`, `CompletionTokens = OutputTokens + CacheReadTokens`

**`opencode stats` command** aggregates this data:
```
opencode stats [--days N] [--tools N] [--models N] [--project FILTER]
```

#### E. CLI Modes for Structured Access

**`opencode run --format json`** — non-interactive JSON event streaming:
```
opencode run "prompt" --format json
```

**`opencode export <sessionID>`** — full session export to JSON:
```
opencode export abc123
```

**`opencode session list --format json`** — list sessions:
```
opencode session list --format json
```

**`opencode serve`** — headless HTTP API server:
```
opencode serve --port 4096
```
With optional HTTP Basic Auth via `OPENCODE_SERVER_PASSWORD`.

#### F. Debug Message Logs (when `OPENCODE_DEV_DEBUG=true`)

**Location**: `.opencode/messages/<session-prefix>/`

| File | Content |
|------|---------|
| `{seqId}_request.json` | Full LLM request message |
| `{seqId}_response_stream.log` | Streaming response chunks |
| `{seqId}_response.json` | Complete response |
| `{seqId}_tool_results.json` | Tool execution results |

Also: `.opencode/debug.log` — general debug log

#### G. What This Means for Stoa — Currently Untapped OpenCode Capabilities

| Untapped Channel | New Observability | Implementation Effort |
|------------------|-------------------|-----------------------|
| SQLite `sessions` table | **Token usage** (`prompt_tokens`, `completion_tokens`), **cost**, session title | Low — read `.opencode/opencode.db` |
| SQLite `messages` table | **Conversation history**, **model identity** per message, **reasoning content** | Low — read `.opencode/opencode.db` |
| Plugin `message.updated` | **Streaming message content** (text, tool calls, tool results, reasoning) | Medium — enhance sidecar plugin |
| Plugin `tool.execute.before/after` | **Tool call name + params**, **tool results** | Medium — enhance sidecar plugin |
| Plugin `session.created` | Session creation event | Low — add event handler |
| Plugin `session.compacted` | Compaction summary | Low — add event handler |
| Plugin `file.edited` | Real-time file change tracking | Low — add event handler |
| `opencode export` | Full session JSON export (on-demand) | Medium — shell command wrapper |
| Debug logs (`OPENCODE_DEV_DEBUG=true`) | Full request/response JSON | High — requires env var, performance impact |

**Highest-value additions** (in order of impact):
1. **SQLite `sessions` table** — gives token usage + cost for free (just read the DB file)
2. **SQLite `messages` table** — gives conversation content + model identity (just read the DB file)
3. **Plugin `message.updated`** — streaming message content with model field
4. **Plugin `tool.execute.before/after`** — tool call observability
5. **Plugin `file.edited`** — real-time file change tracking

**Key advantage over Claude Code and Codex**: OpenCode stores **everything** in a local SQLite database. Even without enhancing the sidecar plugin, Stoa can read `.opencode/opencode.db` to obtain token usage, cost, model identity, full conversation history, and file snapshots — all with zero changes to the plugin.

---

## Part 3: Codex Provider

### 3.1 Provider Descriptor

`src/shared/provider-descriptors.ts:38-48`

| Property | Value |
|----------|-------|
| `providerId` | `'codex'` |
| `executableName` | `'codex'` |
| `supportsResume` | `true` |
| `supportsStructuredEvents` | `false` (descriptor) / `true` (provider instance) |
| `seedsExternalSessionId` | `false` |
| `prefersShellWrap` | `true` |

### 3.2 Command-Line Flags

`src/extensions/providers/codex-provider.ts:16-18, 32-38, 205-213`

| Scenario | Command |
|----------|---------|
| Fresh start | `codex` (no args) |
| Resume (known ID) | `codex resume <externalSessionId>` |
| Resume (unknown ID) | `codex resume --last` |
| Fallback resume | **yes** — `buildFallbackResumeCommand` defined (unique to codex) |

**Binary resolution**: `context.providerPath` if set and non-empty, else `'codex'` (line 16-18)

**Shell wrapping**: Command is wrapped in user's configured shell (`prefersShellWrap: true`).

### 3.3 File System Writes

`src/extensions/providers/codex-provider.ts:41-90`

| File | Content |
|------|---------|
| `<project>/.codex/config.toml` | `notify = ["node", ".codex/notify-stoa.mjs"]` |
| `<project>/.codex/notify-stoa.mjs` | Node.js notify sidecar script (~35 lines) |

### 3.4 File System Reads

`src/extensions/providers/codex-provider.ts:114-238`

| Path | Purpose |
|------|---------|
| `<CODEX_HOME>/sessions/**/*.jsonl` | Post-start discovery of external session ID |
| Only first line of each JSONL file | Checks `type === "session_meta"` |

**`CODEX_HOME` resolution**: `$CODEX_HOME` env var, defaults to `~/.codex` (lines 97-101)

### 3.5 Sidecar Script (notify-stoa.mjs)

`src/extensions/providers/codex-provider.ts:52-88`

The script is invoked by Codex after each agent turn, receiving the event payload as `process.argv[2]`.

**Event filter**: Only `parsed.type === 'agent-turn-complete'` is processed. All other event types are silently discarded.

**Data extracted from the Codex event payload:**

| Codex Payload Field | Extracted As | Maps to CanonicalEvent Field |
|---------------------|-------------|------------------------------|
| `parsed['turn-id']` or `parsed['turn_id']` | Event ID (fallback: `crypto.randomUUID()`) | `event_id` |
| `parsed.type` | Event type string | `event_type`, `payload.summary` |

### 3.6 Webhook POST Payload Structure

`src/extensions/providers/codex-provider.ts:68-87`

```json
{
  "event_version": 1,
  "event_id": "<turn-id or UUID>",
  "event_type": "agent-turn-complete",
  "timestamp": "<ISO 8601>",
  "session_id": "<STOA_SESSION_ID>",
  "project_id": "<STOA_PROJECT_ID>",
  "source": "provider-adapter",
  "payload": {
    "status": "turn_complete",
    "summary": "agent-turn-complete"
  }
}
```

Note: `payload.externalSessionId` is **never populated** by the codex sidecar. The `correlation_id` field is also absent.

POSTed to `http://127.0.0.1:<STOA_WEBHOOK_PORT>/events` with headers `content-type: application/json` and `x-stoa-secret: <STOA_SESSION_SECRET>`.

### 3.7 Discovery Mechanism — File Polling

`src/extensions/providers/codex-provider.ts:9-14, 114-238`

**Constants:**

| Constant | Value |
|----------|-------|
| `DISCOVERY_ATTEMPTS` | 20 |
| `DISCOVERY_DELAY_MS` | 500ms |
| `DISCOVERY_WINDOW_MS` | 60,000ms (60s) |
| `DISCOVERY_CLOCK_SKEW_MS` | 2,000ms (2s) |
| `MAX_SESSION_FILES` | 40 |
| `FULL_RESCAN_INTERVAL` | 4 |

**Algorithm:**

1. Scan `<CODEX_HOME>/sessions/` recursively for `.jsonl` files
2. Sort by `mtimeMs` descending, keep top 40
3. For each file in the window (`startedAt - 2s` to `startedAt + 60s`):
   - Read first line only
   - Parse as JSON
   - Check `type === "session_meta"`
   - Match `payload.cwd` (resolved, normalized) against target project path
   - Return `payload.id` on match
4. Repeat up to 20 times with 500ms sleep; full rescan every 4th attempt

**Session file first-line format:**

```json
{"type": "session_meta", "payload": {"id": "<uuid>", "cwd": "<absolute-path>"}}
```

### 3.8 External Session ID Lifecycle

| Phase | Mechanism | Source |
|-------|-----------|--------|
| **Creation** | `null` (not seeded) | `project-session-manager.ts:107-115` |
| **Discovery** | File polling (up to ~10s) | `codex-provider.ts:220-238` |
| **Arrival** | Via `markSessionRunning` with discovered ID | `session-runtime.ts:119-130` |
| **Resume** | `codex resume <id>` or `codex resume --last` | `codex-provider.ts:208-213` |
| **Update from events** | Never (sidecar doesn't populate `payload.externalSessionId`) | — |

### 3.9 Complete List of Observable Information

> Legend: "yes (used)" = currently wired to Stoa adapter; "yes (available)" = exposed by hooks/notify/OTel but NOT currently used by Stoa; "yes (non-interactive)" = only available via `codex exec --json` non-interactive mode

| Information | Obtainable? | Channel | Location |
|-------------|-------------|---------|----------|
| Session status (starting/running/turn_complete/exited) | yes (used) | notify sidecar → webhook | `codex-provider.ts:52-88` |
| External session ID | yes (used, discovered via file poll) | `~/.codex/sessions/*.jsonl` first line | `codex-provider.ts:220-238` |
| Turn completion | yes (used) | `agent-turn-complete` event | `codex-provider.ts:64` |
| Turn ID | yes (used) | `parsed['turn-id']` or `parsed['turn_id']` | `codex-provider.ts` template |
| Process exit code | yes (used) | PTY `onExit` callback | `session-runtime.ts:111-113` |
| Raw terminal output | yes (used, opaque text) | PTY `onData` | `session-runtime.ts:107-109` |
| **Last assistant message** | **yes (available)** | notify payload → `last-assistant-message` | Currently not extracted |
| **Full user prompt text** | **yes (available)** | Hooks → `UserPromptSubmit` → `prompt` field | Currently not registered |
| **Model identity** | **yes (available)** | Hooks → `SessionStart` → `model` field (slug) | Currently not registered |
| **Bash commands before execution** | **yes (available)** | Hooks → `PreToolUse` → `tool_input.command`, `tool_input.description` | Currently not registered |
| **Tool results (Bash output)** | **yes (available)** | Hooks → `PostToolUse` → `tool_response` | Currently not registered |
| **Permission request details** | **yes (available)** | Hooks → `PermissionRequest` → `tool_input.command`, `tool_input.description` | Currently not registered |
| **Token usage** | **yes (available via OTel)** | OTel metrics → `turn.token_usage` histogram (input, output, cached, reasoning) | Requires OTel collector setup |
| **Token usage (non-interactive)** | **yes (non-interactive)** | `codex exec --json` → `turn.completed.usage` | Only in non-interactive mode |
| **Tool call metrics** | **yes (available via OTel)** | OTel metrics → `tool.call` counter (tool name, success) | Requires OTel collector setup |
| **Hook execution metrics** | **yes (available via OTel)** | OTel metrics → `hooks.run` (hook_name, source, status) | Requires OTel collector setup |
| Conversation content | **yes (available)** | notify payload → `input-messages` field | Currently not extracted |
| Full conversation history | **yes (available)** | Hooks → `transcript_path` → JSONL file | Not used |
| Session error details | **no** | — | — |
| Internal conversation switch | **no** | — | — |
| Codex version | **no** | — | — |

### 3.9a Codex CLI — Complete Internal State Capabilities (Official Docs Research)

**Source**: [Codex Hooks Documentation](https://openai.github.io/codex/docs/hooks), [Codex CLI Reference](https://openai.github.io/codex/docs/cli-reference), [Codex Telemetry Reference](https://openai.github.io/codex/docs/telemetry)

> This section documents what Codex CLI **can** expose through its various channels. It serves as a reference for future enhancement.

#### A. Codex Hooks System (ClaudeHooksEngine)

> **Source**: Direct source-code analysis of `openai/codex` repository (`codex-rs/hooks/` crate). This section supersedes earlier documentation based on external blog posts.

**Architecture**: Codex hooks are implemented as the `ClaudeHooksEngine` in `codex-rs/hooks/src/engine/`. The engine discovers hook configurations from `hooks.json` files in a layered config stack, dispatches matching handlers as external processes, and parses their JSON output to influence agent behavior.

**Feature flag**: Codex hooks require `codex_hooks = true` in `config.toml` `[features]` section, or `--enable codex_hooks` CLI flag. The feature is `Stage::UnderDevelopment` with `default_enabled: false` (source: `codex-rs/features/src/lib.rs` → `Feature::CodexHooks` → `FeatureSpec`). **This is a feature flag, not a platform gate** — there are zero `cfg!(windows)` checks in the entire hooks crate or `hook_runtime.rs`. Stoa's `installSidecar()` can automatically write the feature flag to `.codex/config.toml`.

> **Historical note**: Before 2026-04-09, hooks were gated on Windows via `cfg!(windows)` in `codex-rs/hooks/src/engine/mod.rs` (returning empty handlers with a warning). **PR #17268** ("remove windows gate that disables hooks — they work!") removed this gate. Windows now uses `cmd.exe /C` (via `%COMSPEC%`) for hook command execution (`codex-rs/hooks/src/engine/command_runner.rs`). User-confirmed working as of 2026-04-12.

**⚠️ UnderDevelopment caveat**: Hooks are in active development. The core architecture is complete (5 events, command handlers, JSON I/O, blocking), but `prompt` and `agent` handler types are not yet operational, and behavior may change between releases. Known open bug: hook payloads with large file contents can exceed OS command-line limits on Windows/Linux (issue #18067).

**Handler types** (defined in schema, 3 total):

| Type | Status | Mechanism |
|------|--------|-----------|
| `command` | ✅ **Operational** | External shell process; receives event JSON on **stdin**, emits response JSON on **stdout** |
| `prompt` | ❌ Not yet operational | Planned: single-turn LLM evaluation (similar to Claude Code's prompt hooks) |
| `agent` | ❌ Not yet operational | Planned: sub-agent with tool access |

**Data delivery**: Hook commands receive event data as **JSON on stdin** (same as Claude Code). The handler processes it and returns JSON on stdout. This is a key similarity with Claude Code's command hooks.

**Available hook events** (5 lifecycle events):

| Event | Trigger | Matcher | Can Block? | Unique Capability | Stoa Currently Uses? |
|-------|---------|---------|------------|-------------------|---------------------|
| `SessionStart` | Session begins/resumes | `source` (`startup`/`resume`/`clear`) | yes (via `continue: false`) | Distinguishes first-start vs resume vs clear | **no** |
| `UserPromptSubmit` | User submits a prompt | *(none — fires for all)* | yes (via `continue: false`) | — | **no** |
| `PreToolUse` | Before tool execution | `tool_name` (regex) | **yes** (`permissionDecision: "deny"` or exit code 2) | Block tool execution with reason | **no** |
| `PostToolUse` | After tool execution | `tool_name` (regex) | yes (via `continue: false`) | Inject `additionalContext`, `feedback_message` | **no** |
| `Stop` | Agent finishes responding | *(none — fires for all)* | yes (via `decision: "block"`) | Inject `continuation_fragments` — structured prompt that forces agent to continue | **no** |

**Common input fields** (ALL hooks receive on stdin):

```json
{
  "session_id": "abc123",
  "turn_id": "turn-uuid",
  "transcript_path": "/home/user/.codex/sessions/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "hook_event_name": "PreToolUse",
  "model": "o4-mini",
  "permission_mode": "default",
  "tool_name": "Bash",
  "tool_use_id": "call-uuid",
  "tool_input": { "command": "cargo fmt" }
}
```

**Hook output — controlling agent behavior**:

Hooks return JSON on stdout to influence the agent loop:

**PreToolUse output** (can block tool execution):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Command not allowed by policy"
  }
}
```
Exit code 2 + stderr message is a shorthand alternative (no JSON needed).

**PostToolUse output** (can inject context + stop):
```json
{
  "continue": false,
  "stopReason": "halt after bash output",
  "reason": "post-tool hook says stop",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Remember the bash cleanup note."
  }
}
```

**Stop output — continuation fragments** (unique to Codex):
```json
{
  "decision": "block",
  "reason": "Tests not passing, continue working",
  "continuation_fragments": [
    { "content": "You have not verified the tests pass. Run them now." }
  ]
}
```
This `continuation_fragments` mechanism is **unique to Codex** — no equivalent exists in Claude Code or OpenCode. It allows an external script to force the agent to continue working by injecting structured prompt content back into the conversation.

**Configuration discovery**: Hook configs loaded from `hooks.json` files in a layered config stack (`codex-rs/hooks/src/engine/discovery.rs`). Matchers are regex patterns validated at discovery time; invalid regex causes the entire matcher group to be skipped with a warning.

**Execution model**: Matching handlers execute as external processes. Results are aggregated — any single `deny` or `block` prevails (similar to Claude Code's precedence: `deny` > `defer` > `ask` > `allow`).

**Internal `HookEvent` enum** (from `codex-rs/hooks/src/types.rs`):

In addition to the 5 lifecycle events above, the internal hook system defines two lower-level events used by the legacy notify path:

| Internal Event | Trigger | Usage |
|---------------|---------|-------|
| `AfterAgent` | Agent turn complete | Used by `legacy_notify` to fire the configured notify command |
| `AfterToolUse` | Tool execution complete | Internal payload type carrying tool_name, tool_kind, executed, success, duration_ms, sandbox info |

**Ecological niche comparison with Claude Code hooks**:

Codex hooks and Claude Code hooks occupy **the same ecological niche** — lifecycle event hooks that allow external scripts to observe and influence agent behavior. They are direct competitors with 1:1 event type correspondence:

| Hook Event | Claude Code | Codex | Capability Parity |
|-----------|-------------|-------|-------------------|
| SessionStart | ✅ | ✅ | **Equivalent** — both provide model, cwd, session_id |
| UserPromptSubmit | ✅ | ✅ | **Equivalent** — both provide full prompt text |
| PreToolUse | ✅ (allow/deny/modify input) | ✅ (deny + reason) | **Claude Code stronger** — can modify tool_input |
| PostToolUse | ✅ | ✅ (feedback + additionalContext + stop) | **Codex stronger** — can inject additionalContext + stop execution |
| Stop | ✅ (approve/block) | ✅ (approve/block + continuation_fragments) | **Codex stronger** — continuation_fragments unique |
| SubagentStop | ✅ | ❌ | **Claude Code only** |
| PreCompact | ✅ | ❌ | **Claude Code only** |
| Notification | ✅ | ❌ (legacy notify only) | **Claude Code only** |
| PermissionRequest | ✅ (standalone event) | ❌ (merged into PreToolUse) | **Design difference**, functionally equivalent |
| Handler types | command/http/mcp_tool/prompt/agent | command only (prompt/agent planned) | **Claude Code far richer** |

**Key architectural differences**:
- **Codex**: External process per hook invocation (Rust-spawned), JSON over stdin/stdout, language-agnostic
- **Claude Code**: In-process JS callbacks OR external commands, richer handler type ecosystem (HTTP, MCP tool, prompt, agent)
- **Codex unique**: `continuation_fragments` in Stop hook, `additionalContext` in PostToolUse
- **Claude Code unique**: 5 handler types, tool input modification, subagent lifecycle hooks, 30+ total event types

#### B. Codex Notify System (Legacy — Replaced by Hooks)

> **Source**: `codex-rs/hooks/src/legacy_notify.rs` — direct source-code analysis.

**Status**: The notify system is Codex's **original, now-legacy** mechanism for external event notification. It has been superseded by the 5-event `ClaudeHooksEngine` (Section 3.9a-A above). The notify hook remains functional for backward compatibility but only supports `AfterAgent` events.

**How it works internally**: The `legacy_notify` function (`legacy_notify.rs`) wraps a configured argv command. When an `AfterAgent` event fires, it serializes the payload as `UserNotification::AgentTurnComplete` and passes it as the final command-line argument to the configured process. The process stdin/stdout/stderr are all set to null — it's fire-and-forget.

**Relationship to hooks**: The `Hooks::dispatch()` method in `registry.rs` handles the legacy notify path separately from the new `ClaudeHooksEngine` dispatch. Both coexist: legacy notify fires `AfterAgent` events, while the new engine handles `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop`.

**Configuration** (in `.codex/config.toml`):
```toml
notify = ["node", ".codex/notify-stoa.mjs"]
```

**Event type**: Only `agent-turn-complete` fires. This is equivalent to the new hooks system's `Stop` event but with a different payload shape.

**Full payload** (all fields, including ones Stoa currently ignores):

```json
{
  "type": "agent-turn-complete",
  "thread-id": "session-uuid",
  "turn-id": "turn-uuid",
  "cwd": "/home/user/my-project",
  "client": "codex-tui",
  "input-messages": [
    "Rename `foo` to `bar` and update the callsites."
  ],
  "last-assistant-message": "Rename complete and verified `cargo build` succeeds."
}
```

**Note**: `input-messages` is an array of strings (not objects with role/content). This differs from Claude Code's transcript format.

| Payload Field | Stoa Currently Extracts? | Value |
|---------------|--------------------------|-------|
| `type` | yes | Used for event_type mapping (`"agent-turn-complete"`) |
| `turn-id` / `turn_id` | yes | Used as event_id |
| `thread-id` | **no** | Could serve as externalSessionId (replaces file polling) |
| `cwd` | **no** | Working directory |
| `client` | **no** | Client identifier (e.g. `"codex-tui"`) |
| `input-messages` | **no** | **Array of user input strings** (full conversation prompts) |
| `last-assistant-message` | **no** | **Last assistant response text** |

**Highest-value extraction opportunities from existing notify**:
1. `last-assistant-message` — no new registration needed, just read the field
2. `thread-id` — could supplement or replace file-polling discovery
3. `input-messages` — gives full conversation input history

#### C. Codex Non-Interactive Mode (`codex exec --json`)

When running Codex in non-interactive mode (`codex exec --json`), a structured JSONL stream is produced:

**Stream event types**:

| Event | Trigger | Key Fields |
|-------|---------|------------|
| `thread.started` | Conversation begins | `id` (thread/session ID) |
| `turn.started` | Turn begins | `id` (turn ID) |
| `turn.completed` | Turn finishes | `id`, **`usage`** (token counts), `model` |
| `turn.failed` | Turn errors | `id`, `error` |
| `item.started` | Item (message/tool) begins | `type` (`agent_message`, `command_execution`, etc.) |
| `item.completed` | Item finishes | `type`, content |

**`turn.completed.usage` object**:

```json
{
  "input_tokens": 1234,
  "cached_input_tokens": 800,
  "output_tokens": 567
}
```

**Applicability to Stoa**: Non-interactive mode requires no user interaction, making it unsuitable for Stoa's primary use case (interactive sessions). However, it could be used for:
- Background batch tasks
- Structured output extraction
- Token usage tracking in automated workflows

#### D. Codex OTel Telemetry (Production Metrics)

Codex emits OpenTelemetry metrics when configured. This provides **the richest operational data** of any provider channel.

**Configuration** (environment variables):

| Variable | Purpose |
|----------|---------|
| `CODEX_OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint URL |
| `CODEX_OTEL_EXPORTER_OTLP_HEADERS` | Authentication headers |

**Available metrics**:

| Metric | Type | Key Attributes | Description |
|--------|------|----------------|-------------|
| `codex.conversation_starts` | counter | model, source | New conversations |
| `codex.api_request` | counter | model, status, streaming | API requests to model |
| `codex.sse_event` | counter | event_type | SSE streaming events |
| `codex.user_prompt` | counter | source | User prompts |
| `codex.tool_decision` | counter | tool_name, decision (allow/deny/ask) | Tool permission decisions |
| `codex.tool_result` | counter | tool_name, success (true/false) | Tool execution results |
| `codex.turn.token_usage` | histogram | token_type (total/input/cached_input/output/reasoning_output) | **Token usage per turn** |
| `codex.hooks.run` | counter | hook_name, source, status | Hook execution tracking |

**Token usage detail** — `codex.turn.token_usage` breaks down into:
- `total` — all tokens
- `input` — input tokens
- `cached_input` — cached input tokens (cost savings)
- `output` — output tokens
- `reasoning_output` — reasoning/thinking tokens

**Applicability to Stoa**: Requires running an OTel collector alongside Stoa, but provides:
- **Token usage** (the one thing no other provider exposes via hooks)
- **Tool call success/failure rates**
- **Model identity** via `model` attribute on most metrics
- **API request latency and error rates**

This is the **only channel across all three providers** that provides token usage data.

#### E. Codex `transcript_path` — Full Conversation Access

Like Claude Code, Codex hooks expose `transcript_path` pointing to a JSONL file containing the **entire conversation history**:

- All user messages
- All assistant responses
- All tool calls and parameters
- All tool results
- Session metadata

This is available via both hooks and the file-system discovery path already used by Stoa.

#### F. What This Means for Stoa — Currently Untapped Codex Capabilities

| Untapped Channel | New Observability | Implementation Effort |
|------------------|-------------------|-----------------------|
| notify `last-assistant-message` | Last response text | **Minimal** — read existing payload field |
| notify `thread-id` | External session ID from event (supplement file polling) | **Minimal** — read existing payload field |
| notify `input-messages` | Full conversation history | Low — read existing payload field |
| Hooks `SessionStart` | Model identity (`model` slug), source (`startup`/`resume`/`clear`) | Medium — requires `[features] codex_hooks = true` + hooks.json config |
| Hooks `UserPromptSubmit` | Full user prompt text | Medium — requires feature flag + hooks.json |
| Hooks `PreToolUse` (regex matcher) | Bash commands before execution, can **block** execution | Medium — requires feature flag + hooks.json |
| Hooks `PostToolUse` (regex matcher) | Tool output, can inject **additionalContext** to model, can **stop** execution | Medium — requires feature flag + hooks.json |
| Hooks `Stop` with `continuation_fragments` | Can force agent to continue working by injecting structured prompts (**unique to Codex**) | Medium — requires feature flag + hooks.json |
| OTel metrics | Token usage, tool metrics, API metrics | High — requires OTel collector infrastructure |

**Enabling requirement**: Codex hooks require the `codex_hooks` feature flag (default: off, `Stage::UnderDevelopment`). Stoa can automatically set this via `installSidecar()` writing to `.codex/config.toml`. **Not a platform limitation** — source code has zero `cfg!(windows)` checks; hooks work on all platforms when the flag is enabled.

**Highest-value additions** (in order of impact):
1. **notify `last-assistant-message`** — extract from existing payload, zero new infrastructure
2. **notify `thread-id`** — could simplify/replace file polling discovery
3. **Hooks `SessionStart`** — gives `model` field + `source` (startup/resume/clear) (requires `codex_hooks = true`)
4. **Hooks `PostToolUse`** — gives `additionalContext` injection + execution stop capability (requires `codex_hooks = true`)
5. **Hooks `Stop` with `continuation_fragments`** — unique Codex capability to force agent continuation (requires `codex_hooks = true`)
6. **OTel token usage** — unique capability across all providers, but requires infrastructure

---

## Part 4: Cross-Provider Comparison Matrix

### 4.1 Information Channels

| Channel | claude-code | opencode | codex |
|---------|-------------|----------|-------|
| CLI flags to provider | `--session-id`, `--resume`, `--dangerously-skip-permissions` | (none) or `--session` | (none) or `resume <id>` / `resume --last` |
| Sidecar type | Claude hooks (`.claude/settings.local.json`) | TS plugin (`.opencode/plugins/stoa-status.ts`) | JS notify script (`.codex/notify-stoa.mjs`) + config.toml **(legacy)**; hooks.json **(new, same niche as Claude Code)** |
| Webhook endpoint | `POST /hooks/claude-code` | `POST /events` | `POST /events` |
| File-system discovery | none | none | poll `~/.codex/sessions/*.jsonl` |
| **SQLite database** | none | **`.opencode/opencode.db`** (sessions, messages, files tables) | none |
| **Non-interactive JSON** | none | `opencode run --format json` | `codex exec --json` (JSONL stream) |
| **HTTP API server** | none | `opencode serve` (headless API) | none |
| **OTel telemetry** | none | none | yes (rich metrics including token usage) |
| Fallback resume | no | no | yes (`codex resume --last`) |

### 4.2 Observable Status Transitions

| Status | claude-code | opencode | codex |
|--------|-------------|----------|-------|
| `starting` | PTY spawn | PTY spawn | PTY spawn |
| `running` | — | `permission.replied` event | — |
| `turn_complete` | `Stop` hook | `session.idle` event | `agent-turn-complete` notify |
| `needs_confirmation` | `PermissionRequest` hook | `permission.asked` event | — |
| `error` | — | `session.error` event | — |
| `exited` | PTY exit | PTY exit | PTY exit |

### 4.3 External Session ID Acquisition

| Aspect | claude-code | opencode | codex |
|--------|-------------|----------|-------|
| Seeded at creation | yes (`randomUUID()`) | no (`null`) | no (`null`) |
| Discovery mechanism | none (returns pre-seeded) | none (not implemented) | File polling (20 × 500ms) |
| Webhook-based update | no (hooks don't carry it) | yes (`event.properties?.sessionID`) | no (notify doesn't carry it) |
| Max time to acquire | immediate | on first sidecar event | up to ~10 seconds |

### 4.4 What NO Provider Can Observe

| Information | Why |
|-------------|-----|
| Internal conversation switches (`.resume`, `/new`, `/clear`) | No event type for this; `resolveSessionId` returns null for all |
| Provider version | Not queried or reported by any provider |

> **Update**: Token usage/cost was previously listed here. Codex OTel telemetry (`codex.turn.token_usage`) and OpenCode SQLite database (`sessions.prompt_tokens`/`completion_tokens`/`cost`) now provide this data.
>
> Agent reasoning/thinking was also previously listed here. OpenCode stores `reasoning` content parts in the `messages` table, and Claude Code could theoretically expose thinking via `transcript_path` or `PostCompact.compact_summary`.

### 4.5 What Claude Code CAN Observe (But Stoa Doesn't Use Yet)

> Revised assessment based on official hooks documentation research.

| Information | Hook Event | Field | Stoa Status |
|-------------|-----------|-------|-------------|
| Model identity | `SessionStart` | `model` | **Not registered** |
| User prompt text | `UserPromptSubmit` | `prompt` | **Not registered** |
| Tool call name + params | `PreToolUse` | `tool_name`, `tool_input` | **Not registered** |
| Tool results | `PostToolUse` | `tool_response` | **Not registered** |
| Tool failure details | `PostToolUseFailure` | `error`, `is_interrupt` | **Not registered** |
| Last assistant message | `Stop` | `last_assistant_message` | **Registered but not extracted** |
| API error type + details | `StopFailure` | `error`, `error_details` | **Not registered** |
| Full conversation history | Any hook | `transcript_path` → JSONL file | **Not used** |
| Compaction summary | `PostCompact` | `compact_summary` | **Not registered** |
| Subagent lifecycle | `SubagentStart`/`SubagentStop` | `agent_type`, `last_assistant_message` | **Not registered** |
| Session end reason | `SessionEnd` | `reason` | **Not registered** |
| Permission denial reason | `PermissionDenied` | `reason` | **Not registered** |
| Bash command before exec | `PreToolUse` (Bash) | `tool_input.command` | **Not registered** |
| File write content | `PreToolUse` (Write) | `tool_input.content` | **Not registered** |
| Working directory changes | `CwdChanged` | `old_cwd`, `new_cwd` | **Not registered** |
| Notification content | `Notification` | `message`, `title` | **Not registered** |

### 4.6 All Providers — Observability Gap (Updated)

| Information | claude-code (actual) | claude-code (Stoa) | opencode (actual) | opencode (Stoa) | codex (actual) | codex (Stoa) |
|-------------|------|------|------|------|-------|-------|
| Model identity | **yes** (`SessionStart.model`) | no | **yes** (SQLite `messages.model`, plugin events) | no | **yes** (hooks `SessionStart.model`, OTel attrs) | no |
| User prompt | **yes** (`UserPromptSubmit.prompt`) | no | **yes** (plugin `tui.prompt.append`) | no | **yes** (hooks `UserPromptSubmit.prompt`) | no |
| Tool calls | **yes** (`PreToolUse.tool_name/input`) | no | **yes** (`tool.execute.before`, SQLite `tool_call` parts) | no | **yes** (hooks `PreToolUse`, Bash only) | no |
| Tool results | **yes** (`PostToolUse.tool_response`) | no | **yes** (`tool.execute.after`, SQLite `tool_result` parts) | no | **yes** (hooks `PostToolUse.tool_response`, Bash only) | no |
| Error details | **yes** (`StopFailure.error/details`) | no | partial (plugin `session.error`) | status only | partial (notify, no error details) | no |
| Last message | **yes** (`Stop.last_assistant_message`) | no (field not read) | **yes** (SQLite `messages` table, plugin `message.updated`) | no | **yes** (notify `last-assistant-message`) | no |
| Full history | **yes** (`transcript_path`) | no | **yes** (SQLite `messages` table) | no | **yes** (`transcript_path`, notify `input-messages`) | no |
| Token usage | no | no | **yes** (SQLite `sessions.prompt_tokens/completion_tokens/cost`) | no | **yes** (OTel `turn.token_usage`) | no |
| Reasoning | no | no | **yes** (SQLite `reasoning` content part) | no | no | no |
| Session lifecycle | **yes** (30+ events) | 2 events | **yes** (29 plugin events) | 4 events | **yes** (5 hooks + 1 legacy notify) | 1 event (legacy notify only) |
| Windows support | **yes** | yes | **yes** | yes | **yes** (feature-flag gated, `codex_hooks = true`) | notify only (hooks not yet enabled) |
| **Easiest data access** | hooks (HTTP POST) | — | **SQLite (just read DB)** | — | hooks + notify | — |

### 4.7 Per-Provider Data Access Strategies

| Provider | Easiest Path to Token Usage | Easiest Path to Model Identity | Easiest Path to Conversation History |
|----------|----------------------------|-------------------------------|--------------------------------------|
| Claude Code | Not available | Register `SessionStart` hook | Read `transcript_path` from any hook |
| OpenCode | **Read `.opencode/opencode.db` SQLite** | **Read `.opencode/opencode.db` SQLite** | **Read `.opencode/opencode.db` SQLite** |
| Codex | OTel collector (high effort) | Register `SessionStart` hook (requires `codex_hooks = true` feature flag) | Read `transcript_path` or extract notify `input-messages` |

---

## Part 5: Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| CanonicalSessionEvent type definition | `project-session.ts` | lines 180-190 |
| SessionEventPayload type definition | `project-session.ts` | lines 173-178 |
| SessionStatus type | `project-session.ts` | lines 5-14 |
| ProviderCommand type | `project-session.ts` | lines 201-206 |
| ProviderCommandContext type | `project-session.ts` | lines 192-199 |
| ProviderDefinition interface | `index.ts` | lines 16-36 |
| ProviderRuntimeTarget interface | `index.ts` | lines 7-14 |
| Claude-code descriptor | `provider-descriptors.ts` | lines 49-59 |
| Opencode descriptor | `provider-descriptors.ts` | lines 28-37 |
| Codex descriptor | `provider-descriptors.ts` | lines 38-48 |
| Claude-code command construction | `claude-code-provider.ts` | lines 22-31, 85-106 |
| Claude-code hooks registration | `claude-code-provider.ts` | lines 33-83 |
| Claude-code env vars | `claude-code-provider.ts` | lines 11-19 |
| Claude-code discovery (no-op) | `claude-code-provider.ts` | lines 114-116 |
| Hook event adapter | `hook-event-adapter.ts` | lines 4-40 |
| Opencode sidecar plugin | `opencode-provider.ts` | lines 31-41 |
| Opencode command construction | `opencode-provider.ts` | lines 22-29, 52-57 |
| Opencode env vars | `opencode-provider.ts` | lines 11-19 |
| Opencode resolveSessionId | `opencode-provider.ts` | lines 58-60 |
| Codex notify sidecar | `codex-provider.ts` | lines 41-90 |
| Codex command construction | `codex-provider.ts` | lines 32-38, 205-213 |
| Codex fallback resume | `codex-provider.ts` | lines 208-210 |
| Codex file polling discovery | `codex-provider.ts` | lines 9-14, 114-238 |
| Codex env vars | `codex-provider.ts` | lines 21-29 |
| Codex session file format | `codex-provider.ts` | lines 133-165 |
| Webhook server endpoints | `webhook-server.ts` | lines 19-95 |
| Event validation | `webhook-server.ts` | lines 19-34 |
| Session event bridge | `session-event-bridge.ts` | lines 15-68 |
| Session runtime start/resume logic | `session-runtime.ts` | lines 54-133 |
| Session runtime controller | `session-runtime-controller.ts` | lines 1-98 |
| UUID seeding in session creation | `project-session-manager.ts` | lines 107-115, 346 |
| applySessionEvent externalId update | `project-session-manager.ts` | lines 249-265 |
| markSessionRunning non-regressible | `project-session-manager.ts` | lines 117-124, 271-285 |
| Terminal data handling (250k cap) | `session-runtime-controller.ts` | lines 64-96 |

---

## Risks / Unknowns

- [!] **Stale externalSessionId**: None of the three providers detect internal conversation switches. If a user runs `.resume`, `/new`, or `/clear` inside any provider CLI, the stored ID becomes stale.

- [!] **Opencode no fallback resume**: If the sidecar never delivers `sessionID`, the session has no `externalSessionId` and recovery always starts fresh.

- [!] **Codex discovery timing**: The ~10s polling window may miss slow-starting sessions. If discovery fails, `codex resume --last` may resume the wrong session.

- [!] **Claude-code hooks overwrite `.claude/settings.local.json`**: This file is rewritten on every session start, potentially overwriting user customizations. If additional hooks are registered, they must be merged with existing user hooks or risk data loss.

- [x] ~~**Claude-code hook body fields**: Unknown whether Claude CLI includes additional fields in hook POST bodies beyond `hook_event_name`.~~ **RESOLVED**: Claude Code hooks expose extensive fields per event type — see Section 1.6a. The adapter currently only reads `hook_event_name`, discarding all other data.

- [!] **Massive untapped observability in Claude Code**: The Stoa adapter uses only 2 of 30+ available hook events and extracts only 1 field from each. Registering additional hooks (especially `SessionStart`, `PreToolUse`, `PostToolUse`, `StopFailure`) could provide model identity, tool call tracking, file change monitoring, and error details — all currently listed as "unobtainable" in the original assessment.

- [!] **Hook registration scaling**: Adding more hooks to `.claude/settings.local.json` increases the data sent to the webhook server on every matching event. The adapter and webhook server need to handle higher event volume and richer payloads.

- [!] **`last_assistant_message` not extracted from Stop hook**: The `Stop` hook already receives `last_assistant_message` but the Stoa adapter ignores it. This is the lowest-effort, highest-value enhancement — no new hook registration needed, just read the field.

- [!] **`transcript_path` privacy concerns**: The `transcript_path` field gives access to the full conversation history. If Stoa reads this, it must handle potentially sensitive user data and code content carefully.

- [?] **Opencode `sessionID` update cadence**: Unknown whether `event.properties?.sessionID` changes when user starts a new conversation in the same opencode process.

- [x] ~~**Codex `agent-turn-complete` payload fields**: Unknown whether the full payload from Codex contains additional useful fields beyond `type` and `turn-id`.~~ **RESOLVED**: The notify payload includes `thread-id`, `cwd`, `input-messages` (full conversation), and `last-assistant-message` (last response). Stoa currently extracts only `type` and `turn-id`, discarding all other fields. See Section 3.9a-B.

- [x] ~~**Codex `supportsStructuredEvents` discrepancy**: Descriptor says `false`, provider instance says `true`. Impact unclear — descriptor value may control UI logic while provider value controls runtime.~~ **RESOLVED**: Source-code analysis confirms Codex has a full 5-event lifecycle hooks system (`ClaudeHooksEngine`). The descriptor `false` may reflect that hooks are behind a feature flag / not yet enabled on Windows. The provider instance correctly reports `true` since the engine is implemented. When hooks become available on all platforms, the descriptor should be updated to `true`.

- [?] **Claude Code hook reliability**: Community reports indicate `PreToolUse` and `PostToolUse` hooks sometimes don't fire (GitHub issues anthropics/claude-code#6403, #34573). `SessionStart`, `SessionEnd`, and `Stop` hooks are generally reliable.

- [!] **Codex hooks require feature flag**: Codex hooks are gated by `codex_hooks = true` in `config.toml` `[features]` (`Feature::CodexHooks`, `default_enabled: false`, `Stage::UnderDevelopment`). **This is NOT a platform limitation** — source-code analysis of `codex-rs/hooks/`, `codex-rs/core/src/hook_runtime.rs`, and `codex-rs/features/src/lib.rs` confirms zero `cfg!(windows)` platform checks. All 5 hook events work on all platforms when the flag is enabled. Stoa can automatically write `[features]\ncodex_hooks = true` to `.codex/config.toml` via `installSidecar()`. Historical: Windows was gated until PR #17268 (2026-04-09) removed the gate; user-confirmed working 2026-04-12.

- [!] **Codex hooks large-payload bug on Windows/Linux**: Hook payloads containing full file content (e.g. `PreToolUse` for Write/Edit) are passed via command-line arguments on Windows/Linux, which can exceed OS limits (`ENAMETOOLONG` on Windows ~32KB, `E2BIG` on Linux ~128KB). macOS uses stdin pipe and is unaffected. This is an open bug (issue #18067), not a design limitation. For Stoa's use case (small JSON payloads to webhook server), this is unlikely to be triggered.

- [!] **Codex hooks are same ecological niche as Claude Code hooks**: Source-code analysis confirms Codex's `ClaudeHooksEngine` (`codex-rs/hooks/`) is a 1:1 architectural competitor to Claude Code's hook system — both provide lifecycle event hooks with pre/post tool interception, blocking, and structured JSON I/O. The 5 Codex events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) directly correspond to Claude Code events of the same names. Key differentiators: Codex has `continuation_fragments` (unique), Claude Code has `prompt`/`agent`/`http`/`mcp_tool` handler types and 30+ total event types.

- [!] **Codex `continuation_fragments` — unique and powerful**: The Codex `Stop` hook can inject `continuation_fragments` — structured prompt content that forces the agent to keep working. This enables guard-rail patterns where external validation prevents premature session conclusion. No equivalent exists in Claude Code or OpenCode. **Immediately available** once `codex_hooks = true` is set in config.

- [!] **Codex hooks data delivery is stdin, not argv**: Earlier documentation (based on external blogs) stated Codex hooks receive data as command-line arguments. Source-code analysis of `codex-rs/hooks/src/engine/command_runner.rs` confirms hooks receive event JSON on **stdin** (same as Claude Code command hooks), not argv. The legacy notify system uses argv, which may have caused the confusion.

- [!] **Codex `PermissionRequest` is not a separate hook event**: Unlike Claude Code which has a standalone `PermissionRequest` event, Codex handles permission decisions within `PreToolUse` via `permissionDecision: "deny"`. This is a design difference, not a capability gap.

- [!] **Massive untapped observability in Codex notify**: The existing `agent-turn-complete` notify payload contains `last-assistant-message`, `thread-id`, `cwd`, and `input-messages` — none of which are currently extracted by the Stoa sidecar script. These are available **today** with zero new infrastructure.

- [!] **OTel token usage — no longer unique**: Codex OTel was previously the only token usage source. OpenCode SQLite database also provides token usage (`prompt_tokens`, `completion_tokens`, `cost` per session) with zero infrastructure — just read `.opencode/opencode.db`.

- [!] **OpenCode SQLite — the easiest untapped observability**: OpenCode stores **everything** in `.opencode/opencode.db` — token usage, cost, model identity, full conversation content, reasoning, tool calls, file snapshots. Stoa currently reads zero of this. Unlike Claude Code hooks or Codex OTel, this requires **zero new infrastructure** — just open the SQLite file and query. The plugin system (29 events) is also largely untapped (Stoa uses 4 of 29).

- [?] **OpenCode SQLite concurrent access**: SQLite supports concurrent reads but only one writer. If Stoa reads the DB while opencode is writing, there could be locking issues. WAL mode may mitigate this. Needs testing.

- [!] **OpenCode plugin `message.updated` provides streaming content**: This event fires with typed content parts including `text`, `tool_call`, `tool_result`, `reasoning`, and `finish`. Subscribing to this single event would give Stoa streaming message content, model identity, tool observability, and reasoning — the most impactful single enhancement for the opencode provider.

---

## Part 6: Claude Code Hooks — Technical Reference Summary

> Condensed from official documentation at https://code.claude.com/docs/en/hooks

### 6.1 Hook Lifecycle Pipeline

```
User request
  → Claude picks tool(s)
  → PreToolUse hook fires (can block/modify)
  → Tool executes
  → PostToolUse hook fires (can react)
  → PostToolBatch hook fires (full batch results)
  → Claude processes results
  → Stop hook fires (can force continue)
  → User sees response
```

### 6.2 Exit Code Semantics

| Exit Code | Effect |
|-----------|--------|
| `0` | Success → parse stdout JSON |
| `2` | Block → stderr fed back to Claude as error |
| Other | Non-blocking error → continue execution |

### 6.3 PreToolUse Decision Control (Most Powerful)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask | defer",
    "permissionDecisionReason": "explanation",
    "updatedInput": { ... },
    "additionalContext": "context injected before tool runs"
  }
}
```

Precedence for multiple hooks: `deny` > `defer` > `ask` > `allow`.

### 6.4 Hook Types Comparison

| Feature | command | http | mcp_tool | prompt | agent |
|---------|---------|------|----------|--------|-------|
| Input | stdin JSON | POST body | MCP tool args | LLM prompt | LLM prompt |
| Output | stdout JSON + exit code | Response body JSON | Tool text | `{ok, reason}` | `{ok, reason}` |
| Can block | yes | yes (2xx + decision) | yes | yes | yes |
| Async support | yes | no | no | no | no |
| Default timeout | 600s | 600s | 600s | 30s | 60s |
| Tool access | no | no | yes (one tool) | no | yes (up to 50 turns) |

### 6.5 Recommended Hook Additions for Stoa (Priority Order)

| Priority | Hook Event | Matcher | Value | Implementation Effort |
|----------|-----------|---------|-------|-----------------------|
| P0 | `Stop` (enhanced) | `*` | Extract `last_assistant_message` | **Minimal** — field already available |
| P1 | `SessionStart` | `*` | Extract `model` for model identity display | Low — add hook + adapter field |
| P2 | `StopFailure` | `*` | Extract `error` + `error_details` | Low — add hook + adapter field |
| P3 | `PreToolUse` | `Bash` | Extract `tool_input.command` for command auditing | Medium — new hook registration |
| P4 | `PreToolUse` | `Write\|Edit` | Extract `tool_input.file_path` for file change tracking | Medium |
| P5 | `PostToolBatch` | (no matcher) | Extract `tool_calls` array | Medium — larger payload |
| P6 | `SubagentStart`/`SubagentStop` | `*` | Track subagent lifecycle | Medium |
| P7 | `PostCompact` | `*` | Preserve `compact_summary` for context | Low |

### 6.6 Sources

**Claude Code:**
- [Hooks Reference — Claude Code Official Docs](https://code.claude.com/docs/en/hooks)
- [Claude Code Hooks: 12 Production Configs](https://www.heyuan110.com/posts/ai/2026-02-28-claude-code-hooks-guide/)
- [Claude Code Hooks: Complete Guide to All 12 Lifecycle Events](https://claudefa.st/blog/tools/hooks/hooks-guide)
- [Hook System Overview — Everything Claude Code](https://www.mintlify.com/affaan-m/everything-claude-code/hooks/overview)
- [PostToolUse Hooks Not Executing — GitHub Issue #6403](https://github.com/anthropics/claude-code/issues/6403)
- [Plugin hooks.json Command Hooks Silently Dropped — GitHub Issue #34573](https://github.com/anthropics/claude-code/issues/34573)

**Codex:**
- [Codex Hooks — Official Docs](https://openai.github.io/codex/docs/hooks)
- [Codex CLI Reference (exec --json, notify)](https://openai.github.io/codex/docs/cli-reference)
- [Codex Telemetry Reference (OTel metrics)](https://openai.github.io/codex/docs/telemetry)
- [Codex Configuration Reference (config.toml)](https://openai.github.io/codex/docs/configuration)
- **Source-code analysis** (`openai/codex` repository, 2026-04-25):
  - `codex-rs/hooks/src/lib.rs` — public API: 5 event types + legacy_notify
  - `codex-rs/hooks/src/types.rs` — `HookEvent` enum (`AfterAgent`, `AfterToolUse`), `HookPayload`, `HookResult` (`Success`/`FailedContinue`/`FailedAbort`)
  - `codex-rs/hooks/src/events/pre_tool_use.rs` — PreToolUse: deny blocking via JSON or exit code 2
  - `codex-rs/hooks/src/events/post_tool_use.rs` — PostToolUse: additionalContext injection, continue:false stop
  - `codex-rs/hooks/src/events/stop.rs` — Stop: `continuation_fragments` for forced agent continuation
  - `codex-rs/hooks/src/events/session_start.rs` — SessionStart: source discrimination (startup/resume/clear)
  - `codex-rs/hooks/src/legacy_notify.rs` — Legacy `notify` hook: AfterAgent only, argv-based, fire-and-forget
  - `codex-rs/hooks/src/engine/discovery.rs` — hooks.json config discovery, prompt/agent handler types (not yet operational)
  - `codex-rs/hooks/src/engine/config.rs` — ConfiguredHandler struct with matcher regex support
  - `codex-rs/hooks/src/engine/command_runner.rs` — Windows: `cmd.exe /C` via `%COMSPEC%`; Unix: `$SHELL -lc`
  - `codex-rs/hooks/src/engine/mod.rs` — Windows gate removed by PR #17268 (2026-04-09)
  - `codex-rs/features/src/lib.rs` — `Feature::CodexHooks` → `key: "codex_hooks"`, `stage: UnderDevelopment`, `default_enabled: false`
  - `codex-rs/core/src/hook_runtime.rs` — Zero platform checks; hooks dispatch via `Hooks` struct from `codex-hooks` crate
- **PR #17268** — "remove windows gate that disables hooks — they work!" (merged 2026-04-09) — removed `cfg!(windows)` check from `codex-rs/hooks/src/engine/mod.rs`
- **Issue #17478** — "Enable hooks on Windows" (closed 2026-04-15) — user-confirmed working with `codex_hooks = true` on 2026-04-12
- **Issue #18067** — Hooks fail silently on Windows/Linux with large file payloads (open bug, not platform gate)

**OpenCode:**
- [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins)
- [OpenCode CLI Reference](https://opencode.ai/docs/cli)
- [OpenCode GitHub Repository](https://github.com/opencode-ai/opencode) — source code for SQLite schema, pubsub system, plugin types
