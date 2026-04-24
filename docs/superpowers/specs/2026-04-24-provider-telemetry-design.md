---
date: 2026-04-24
topic: non-shell provider telemetry - turn completion and input request capture
status: interface-review-required
---

# Provider Telemetry Design

## Problem

Non-shell sessions (OpenCode, Claude Code, Codex) do not currently expose a stable, structured way to tell the app that:

1. the agent finished a turn and is waiting for the user
2. the agent is blocked on a permission / confirmation step

OpenCode emits a limited event stream today, but Claude Code and Codex do not integrate with the existing event pipeline. The current design also needs to support multiple concurrent sessions in the same project without relying on per-session config files or single-session project locks.

## Design

### 0. Interface Confidence Levels

This spec intentionally separates what is verified from what is still a provider-interface assumption.

#### Verified from official docs

- Claude Code HTTP hooks exist and support custom `headers`
- Claude Code header values support env interpolation via `allowedEnvVars`
- Codex supports project-level `.codex/config.toml`
- Codex supports `notify = ["..."]`
- OpenCode supports project-level plugins in `.opencode/plugins/`
- OpenCode documents the event names used in this design: `session.idle`, `session.error`, `permission.asked`, `permission.replied`

#### High-confidence engineering assumptions

- Codex notify subprocess inherits the launched Codex process environment
- OpenCode plugin runtime can read process environment passed to the launched OpenCode process

#### Must spike before implementation is considered valid

- capture a real Codex `notify` payload and verify the actual schema for turn-complete detection
- verify Codex `notify` subprocess sees `STOA_*` environment variables
- verify OpenCode plugin runtime sees `STOA_*` environment variables

If either env-visibility spike fails, the shared dispatcher model for that provider must be revised before implementation proceeds.

### 1. New `turn_complete` Status

Add `turn_complete` to `SessionStatus` in `src/shared/project-session.ts`:

```ts
export type SessionStatus =
  | 'bootstrapping'
  | 'starting'
  | 'running'
  | 'turn_complete'
  | 'awaiting_input'
  | 'degraded'
  | 'error'
  | 'exited'
  | 'needs_confirmation'
```

Semantics:

- `turn_complete`: the provider finished responding for the current turn and is now waiting for the next user message
- `awaiting_input`: shell/TUI runtime is idle in a generic input-ready state
- `needs_confirmation`: provider is blocked on an explicit permission / confirmation gate

Add `turn_complete` to `NON_REGRESSIBLE_RUNNING_STATUSES` in `src/core/project-session-manager.ts`.

### 2. Shared Dispatcher Model

All three providers use a shared dispatcher model:

- disk artifacts are project-scoped and session-agnostic
- runtime identity is session-scoped and injected via process environment
- the webhook server never infers session ownership from overwritten files

This avoids both rejected options:

- no "one active session per project" restriction
- no "one config file per session" requirement

The generated sidecar/config files are stable templates:

- Claude Code: `.claude/settings.local.json`
- Codex: `.codex/config.toml`, `.codex/notify-stoa.mjs`
- OpenCode: `.opencode/plugins/stoa-status.ts`

These files may be rewritten on startup, but they must not contain baked-in session-specific IDs or secrets.

### 3. Runtime Identity Contract

Each launched non-shell provider process receives session-scoped environment variables:

- `STOA_SESSION_ID`
- `STOA_PROJECT_ID`
- `STOA_SESSION_SECRET`
- `STOA_WEBHOOK_PORT`

Provider integrations should use these runtime values when the provider runtime exposes them to sidecars / hooks.

Rules:

- the internal Stoa `session_id` is the source of truth for event routing
- provider-native external session IDs are metadata, not primary routing keys
- no `sessionIdMap` is used for Codex or OpenCode event delivery if env visibility is confirmed by spike
- Claude Code raw hook payloads may still include provider-native `session_id`, but that field is not used as the primary lookup key

### 4. Webhook Ingestion Paths

Two webhook paths are used:

#### `POST /events`

Accepts `CanonicalSessionEvent` directly.

Target use:

- Codex shared notify script
- OpenCode shared plugin

Authentication remains session-scoped via `x-stoa-secret`, resolved from the internal `session_id` already present in the canonical payload.

This direct-canonical path is blocked on the Codex / OpenCode env visibility spikes above.

#### `POST /hooks/claude-code`

Accepts raw Claude Code HTTP hook payloads and adapts them to `CanonicalSessionEvent`.

Authentication and routing come from request headers populated from runtime env:

- `x-stoa-session-id`
- `x-stoa-project-id`
- `x-stoa-secret`

This route does not use `sessionIdMap`.

### 5. Hook Adapter

`src/core/hook-event-adapter.ts` remains the normalization layer for raw provider payloads, but in this design it is only required for Claude Code hooks.

```ts
export function adaptClaudeCodeHook(
  body: Record<string, unknown>,
  context: {
    sessionId: string
    projectId: string
  }
): CanonicalSessionEvent | null
```

Behavior:

- `Stop` -> `turn_complete`
- `PermissionRequest` -> `needs_confirmation`
- all other Claude hook events -> ignored (`null`)

The adapter must synthesize the canonical event using the internal `sessionId` / `projectId` from request headers, not from provider-side session lookup.

### 6. Provider-Specific Implementations

#### 6a. Claude Code - Shared HTTP Hooks

`installSidecar()` writes a shared `.claude/settings.local.json` template.

The template configures HTTP hooks for:

- `Stop`
- `PermissionRequest`

Hooks post to a literal URL written at sidecar-install time:

```text
http://127.0.0.1:<runtime-webhook-port>/hooks/claude-code
```

Required headers:

- `content-type: application/json`
- `x-stoa-session-id: ${STOA_SESSION_ID}`
- `x-stoa-project-id: ${STOA_PROJECT_ID}`
- `x-stoa-secret: ${STOA_SESSION_SECRET}`

The generated hook config must include `allowedEnvVars` for:

- `STOA_SESSION_ID`
- `STOA_PROJECT_ID`
- `STOA_SESSION_SECRET`

Provider command env must include the `STOA_*` values for both fresh start and resume.

`supportsStructuredEvents()` changes from `false` to `true`.

No session-specific hook config file is generated.

#### 6b. Codex - Shared Notify Script

`installSidecar()` writes:

1. shared `.codex/config.toml`
2. shared `.codex/notify-stoa.mjs`

`config.toml` points to the shared notify script:

```toml
notify = ["node", ".codex/notify-stoa.mjs"]
```

Target design: the notify script reads `STOA_SESSION_ID`, `STOA_PROJECT_ID`, `STOA_SESSION_SECRET`, and `STOA_WEBHOOK_PORT` from process env and posts a `CanonicalSessionEvent` directly to `POST /events`.

Verified:

- project-level `.codex/config.toml` is supported
- `notify` is an official config field

Not yet verified:

- the exact notify payload schema for turn-complete events
- env inheritance into the notify subprocess

Provisional mapping target:

- a notify payload corresponding to agent turn completion -> `turn_complete`
- all other notify payload types -> ignored

This removes the previous race condition from external-session discovery if the env-based transport is confirmed by spike. Codex telemetry should not depend on `sessionIdMap`.

`supportsStructuredEvents()` changes from `false` to `true`.

#### 6c. OpenCode - Shared Plugin

`installSidecar()` writes a shared `.opencode/plugins/stoa-status.ts`.

Target design: the plugin reads the same `STOA_*` runtime env and posts `CanonicalSessionEvent` directly to `POST /events`.

Verified:

- plugin loading from `.opencode/plugins/`
- event names used below

Not yet verified:

- plugin access to per-process runtime environment variables

It only emits explicit state-changing events:

| OpenCode Event | SessionStatus |
|---|---|
| `session.idle` | `turn_complete` |
| `permission.asked` | `needs_confirmation` |
| `permission.replied` | `running` |
| `session.error` | `error` |

All other OpenCode events are ignored.

Important:

- the plugin must not emit `status: 'running'` for generic background events
- `isProvisional` must not be used as a substitute for state-transition logic
- only explicit state transitions may carry `payload.status`

If plugin env access cannot be proven in spike, OpenCode transport must be redesigned before implementation starts.

### 7. State Transition Rules

The telemetry layer must follow these rules:

- explicit turn-end events may move a session to `turn_complete`
- explicit permission events may move a session to `needs_confirmation`
- explicit resume / permission-resolved events may move a session back to `running`
- generic provider chatter must not overwrite `turn_complete` or `needs_confirmation`

This keeps `turn_complete` stable until:

- the user sends the next message
- the provider explicitly resumes
- the runtime exits or errors

### 8. Renderer Behavior

Renderer updates are required, not optional.

#### Live terminal behavior

`turn_complete` must be treated as a live-terminal state in `src/renderer/components/TerminalViewport.vue`, alongside `running` and `awaiting_input`.

Reason:

- the session is still alive
- the terminal should remain interactive / visible
- switching to the static overlay would be a regression

#### Status visuals

Renderer status consumers must explicitly support `turn_complete`, including:

- status text display
- route/status-dot styling
- any status-class tests

Recommended visual treatment:

- `turn_complete` should render as a non-error, attention state close to `awaiting_input`
- existing design tokens must be reused; no hardcoded conflicting visual language

### 9. Data Flow

```text
Claude Code shared hooks
  -> POST /hooks/claude-code
  -> HookEventAdapter
  -> CanonicalSessionEvent
  -> session-event-bridge.ts
  -> session-runtime-controller.ts
  -> IPC
  -> Renderer

Codex shared notify script
  -> POST /events
  -> CanonicalSessionEvent
  -> session-event-bridge.ts
  -> session-runtime-controller.ts
  -> IPC
  -> Renderer

OpenCode shared plugin
  -> POST /events
  -> CanonicalSessionEvent
  -> session-event-bridge.ts
  -> session-runtime-controller.ts
  -> IPC
  -> Renderer
```

### 10. Files Changed Summary

Implementation must cover at least the following once the interface spikes pass:

#### Core / shared

- `src/shared/project-session.ts`
- `src/core/project-session-manager.ts`
- `src/core/hook-event-adapter.ts`
- `src/core/webhook-server.ts`

#### Providers

- `src/extensions/providers/claude-code-provider.ts`
- `src/extensions/providers/codex-provider.ts`
- `src/extensions/providers/opencode-provider.ts`

#### Renderer

- `src/renderer/components/TerminalViewport.vue`
- `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- any other renderer status consumer that switches on `SessionStatus`

#### Tests

- `src/core/webhook-server.test.ts`
- `src/core/webhook-server-validation.test.ts`
- `src/extensions/providers/claude-code-provider.test.ts`
- `src/extensions/providers/opencode-provider.test.ts`
- new adapter tests under `src/core/`
- `tests/e2e/provider-integration.test.ts`
- `tests/e2e/webhook-runtime-integration.test.ts`
- renderer/component tests that assert live-terminal and status styling behavior

#### Behavior assets

- `testing/behavior/`
- `testing/topology/`
- `testing/journeys/`
- regenerate `tests/generated/` via `npm run test:generate`

### 11. Testing Requirements

Because this introduces a new user-visible session status and a new raw-hook ingestion path, implementation is not complete until all required gates pass:

1. `npm run test:generate`
2. `npm run typecheck`
3. `npx vitest run`
4. `npm run test:e2e`
5. `npm run test:behavior-coverage`

Key cases that must be covered:

- Claude hook requests authenticate and route using `x-stoa-session-id` / `x-stoa-secret`
- Codex notify payload schema is captured and asserted from a real fixture
- Codex notify emits canonical events without external-session discovery
- Codex notify subprocess env visibility is verified
- shared sidecar files are stable and do not contain session-baked secrets/IDs
- multiple sessions in one project do not overwrite each other's runtime identity
- OpenCode generic events do not regress `turn_complete` / `needs_confirmation`
- OpenCode plugin env visibility is verified
- `turn_complete` stays in the live terminal surface

### 12. Out of Scope

- true task-complete semantics beyond turn completion
- token accounting / duration metrics
- streaming progress indicators
- Codex JSONL stdout parsing
- per-turn analytics dashboards
