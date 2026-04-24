# Session State Model Redesign

Date: 2026-04-24

## Problem

The current session status model uses one `SessionStatus` value to represent multiple independent facts:

- Whether Stoa has created and launched the runtime process.
- Whether the PTY/provider process is alive.
- Whether an agent is actively processing a user turn.
- Whether the provider is idle/ready for input.
- Whether the provider is blocked on permission or confirmation.
- What the UI should display in the hierarchy row.

This made `running` ambiguous. `markSessionRunning()` currently means "PTY spawned successfully", but UI users read `Running` as "agent is working". That mismatch caused new sessions to start as `Running`, Claude ready/running/blocked transitions to regress, and renderer presence snapshots to drift from canonical session events.

The correct model is not "find a better single status". The correct model is to separate lifecycle, turn state, and presentation.

## Goals

- A newly launched provider process must not imply the agent is working.
- Claude Code must show `Ready -> Running -> Ready` from real hook events, and `Blocked` from real permission events.
- Shell, Codex, OpenCode, and Claude Code must share one state architecture while allowing provider capability differences.
- UI must consume a single derived presence object, not merge competing truth sources ad hoc.
- Tests must prove behavior at every boundary: provider signal, core state reducer, IPC projection, renderer store, and Electron journey.
- Breaking persistence/schema changes are allowed. No compatibility migration is required.

## Non-Goals

- No attempt to infer rich agent state from arbitrary terminal text.
- No migration for existing prototype state files.
- No terminal top bar or extra status chrome.
- No compatibility layer preserving old `SessionStatus` semantics.

## Current Failure Modes

### Runtime Alive Is Mislabelled as Agent Running

Current flow:

```text
createSession()
  -> status = bootstrapping
startSessionRuntime()
  -> markSessionStarting()
  -> ptyHost.start()
  -> markSessionRunning()
```

`markSessionRunning()` fires immediately after spawn. This is only evidence that the runtime process exists. It is not evidence that Claude/Codex/OpenCode is processing a user request.

### Canonical Status and Presence Drift

Renderer hierarchy rows prefer `SessionPresenceSnapshot`. `SessionStatusEvent` updates `SessionSummary`, but presence can be missing or stale. This creates a second failure mode where the backend already moved from `bootstrapping` to `running` or `turn_complete`, while the row still renders a stale derived `Preparing` presence.

### Provider Signals Have Different Meaning

Claude hooks:

- `UserPromptSubmit` means a user turn has begun.
- `PreToolUse` means the agent is working.
- `Stop` means the current turn is complete.
- `PermissionRequest` means blocked.
- `StopFailure` means turn error.

None of those are equivalent to PTY runtime lifecycle. A state model that treats them all as direct replacements for `SessionStatus` is unstable.

## Proposed Model

Replace the single status truth with three explicit layers.

```ts
type SessionRuntimeState =
  | 'created'
  | 'starting'
  | 'alive'
  | 'exited'
  | 'failed_to_start'

type SessionAgentState =
  | 'unknown'
  | 'idle'
  | 'working'
  | 'blocked'
  | 'error'

type SessionPresencePhase =
  | 'preparing'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'exited'

type SessionStateIntent =
  | 'runtime.created'
  | 'runtime.starting'
  | 'runtime.alive'
  | 'runtime.exited_clean'
  | 'runtime.exited_failed'
  | 'runtime.failed_to_start'
  | 'agent.turn_started'
  | 'agent.tool_started'
  | 'agent.turn_completed'
  | 'agent.permission_requested'
  | 'agent.permission_resolved'
  | 'agent.turn_failed'
  | 'agent.recovered'
```

### Layer Ownership

`SessionRuntimeState` is owned by Stoa runtime lifecycle:

- Session creation sets `created`.
- Before provider command build/spawn sets `starting`.
- PTY spawn success sets `alive`.
- PTY clean exit sets `exited`.
- PTY non-zero/crash exit sets `failed_to_start` if the process never reached `alive`, otherwise records a failed runtime exit while keeping runtime state `exited`.
- install/build/spawn failure sets `failed_to_start`.

`SessionAgentState` is owned by provider evidence:

- Claude `UserPromptSubmit` / `PreToolUse` sets `working`.
- Claude `Stop` sets `idle`.
- Claude `PermissionRequest` sets `blocked`.
- Claude `StopFailure` sets `error`.
- OpenCode `permission.replied` / active events set `working`.
- OpenCode `session.idle` sets `idle`.
- OpenCode `permission.asked` sets `blocked`.
- Codex notify turn-complete sets `idle`; until richer start events exist, Codex remains `unknown` or provider-specific `working` only when a reliable event exists.
- Shell has no agent state; it remains `unknown`.

`SessionPresencePhase` is a pure derived value. It is not persisted as primary truth.

## Derived Presence Rules

Presence derivation must be centralized in one pure function:

```ts
function derivePresencePhase(input: {
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  provider: SessionType
}): SessionPresencePhase
```

Rules, in priority order:

```text
runtimeState = failed_to_start              -> failed
agentState = error                          -> failed
runtimeState = exited + runtimeExit failed  -> failed
runtimeState = exited + runtimeExit clean   -> exited
agentState = blocked                        -> blocked
agentState = working                        -> running
agentState = idle                           -> ready
runtimeState = created|starting             -> preparing
runtimeState = alive + agent unknown        -> ready for agent providers, running for shell
```

The `alive + unknown` rule is intentionally provider-specific:

- `shell`: `running`, because process alive is the useful user-facing state.
- `claude-code`, `opencode`, `codex`: `ready`, because process alive does not mean the agent is working.

## Data Model

Replace the current persisted session shape's single status field with explicit state fields:

```ts
interface SessionSummary {
  id: string
  projectId: string
  type: SessionType
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  lastStateSequence: number
  blockingReason: BlockingReason | null
  title: string
  summary: string
  recoveryMode: SessionRecoveryMode
  externalSessionId: string | null
  createdAt: string
  updatedAt: string
  lastActivatedAt: string | null
  archived: boolean
}
```

Persistence:

```ts
interface PersistedSession {
  session_id: string
  project_id: string
  type: SessionType
  title: string
  runtime_state: SessionRuntimeState
  agent_state: SessionAgentState
  runtime_exit_code: number | null
  runtime_exit_reason: 'clean' | 'failed' | null
  last_state_sequence: number
  blocking_reason: BlockingReason | null
  last_summary: string
  external_session_id: string | null
  created_at: string
  updated_at: string
  last_activated_at: string | null
  recovery_mode: SessionRecoveryMode
  archived: boolean
}
```

Because this is prototype-stage breaking work, persisted state version should be bumped and old state can be rejected or reset rather than migrated.

## Event Contract

Replace `SessionStatusEvent` with a state patch event:

```ts
interface SessionStatePatchEvent {
  sessionId: string
  sequence: number
  occurredAt: string
  intent: SessionStateIntent
  providerEventType: string
  runtimeState?: SessionRuntimeState
  agentState?: SessionAgentState
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  summary: string
  externalSessionId?: string | null
}
```

Canonical provider event payload should likewise become state-specific:

```ts
interface CanonicalSessionEventPayload {
  sequence?: number
  intent: SessionStateIntent
  runtimeState?: SessionRuntimeState
  agentState?: SessionAgentState
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  summary?: string
  externalSessionId?: string | null
  model?: string
  snippet?: string
  toolName?: string
  error?: string
}
```

Provider hooks must never emit `runtimeState` unless the provider evidence actually proves runtime lifecycle. Claude hook events emit only `agentState`.

`intent` is mandatory because `agentState = working` is not enough evidence to decide a legal transition. For example:

- `agent.permission_resolved` may replace `blocked` with `working`.
- `agent.turn_started` may replace `error` with `working` as a new recovery turn.
- A generic stale `agent.tool_started` must not replace `blocked` unless it is known to be the post-permission continuation.

`sequence` is mandatory for Stoa-originated state patches. For provider events that do not supply a sequence, Stoa assigns a monotonic per-session sequence at ingestion time before reducing state.

## Core Reducer

Introduce one reducer in core and make all state writes go through it:

```ts
function reduceSessionState(
  session: SessionSummary,
  patch: SessionStatePatchEvent,
  nowIso: string
): SessionSummary
```

Reducer rules:

- Runtime and agent states are independent fields.
- Ignore any patch with `sequence <= session.lastStateSequence`, except idempotent repeats with the same intent and same state.
- `runtimeState = exited` does not erase `agentState`; failed exits derive `Failed`, clean exits derive `Exited`.
- `agent.turn_started` can replace `idle`, `unknown`, or `error` with `working`.
- `agent.tool_started` can replace `idle`, `unknown`, or `working` with `working`.
- `agent.turn_completed` can replace `working` with `idle`.
- `agent.turn_completed` must not replace `blocked` or `error`.
- `agent.permission_requested` can replace `working` or `idle` with `blocked`.
- `agent.permission_resolved` can replace `blocked` with `working` only when provider payload proves approval/continuation; otherwise it must not set `working`.
- `agent.turn_failed` sets `error`.
- `agent.recovered` can replace `error` only when produced by an explicit retry/resume/new-turn signal.
- Runtime `alive` must not set agent `working`.
- Agent events after `runtimeState = exited` are ignored unless the session has a newer runtime `starting/alive` sequence from a restart/resume.

This reducer replaces ad hoc non-regression sets such as `NON_REGRESSIBLE_RUNNING_STATUSES`.

### Legal Transition Matrix

| Current | Intent | Next | Notes |
|---|---|---|---|
| runtime `created` | `runtime.starting` | runtime `starting` | Before install/build/spawn. |
| runtime `starting` | `runtime.alive` | runtime `alive` | PTY spawned. Agent unchanged. |
| runtime `created/starting` | `runtime.failed_to_start` | runtime `failed_to_start` | Build/install/spawn failure. |
| runtime `alive` | `runtime.exited_clean` | runtime `exited`, clean exit | UI derives `Exited` unless agent error is newer. |
| runtime `alive` | `runtime.exited_failed` | runtime `exited`, failed exit | UI derives `Failed`. |
| runtime `exited/failed_to_start` | `runtime.starting` | runtime `starting` | Explicit restore/retry only. |
| agent `unknown/idle/error` | `agent.turn_started` | agent `working` | New user turn or equivalent recovery. |
| agent `unknown/idle/working` | `agent.tool_started` | agent `working` | Does not unblock by itself. |
| agent `working` | `agent.turn_completed` | agent `idle` | Ready. |
| agent `working/idle` | `agent.permission_requested` | agent `blocked` | Permission block. |
| agent `blocked` | `agent.permission_resolved` approved | agent `working` | Provider must prove approved/continued. |
| agent `blocked` | `agent.permission_resolved` denied | agent `idle` or `error` | Provider-specific payload decides. |
| any agent | `agent.turn_failed` | agent `error` | UI derives `Failed`. |
| agent `error` | stale `agent.turn_completed` | unchanged | Prevents Stop after failure from hiding error. |
| agent `blocked` | stale `agent.turn_completed` | unchanged | Prevents denied/blocked turns from showing Ready. |

## Runtime Controller Changes

Rename behavior to match semantics:

```ts
markSessionStarting(sessionId, summary, externalSessionId)
markRuntimeAlive(sessionId, externalSessionId)
markRuntimeExited(sessionId, summary)
applyProviderStatePatch(event)
```

Start flow becomes:

```text
createSession()
  -> runtimeState = created
  -> agentState = unknown

startSessionRuntime()
  -> markSessionStarting()
  -> installSidecar()
  -> build command
  -> ptyHost.start()
  -> markRuntimeAlive()
```

`markRuntimeAlive()` updates only `runtimeState = alive`; it does not update `agentState`.

For shell only, derived presence maps `alive + unknown -> running`.

## Provider Mapping

### Claude Code

Sidecar registration:

- `UserPromptSubmit`: `agentState = working`, summary `Claude turn started`
- `PreToolUse`: `agentState = working`, intent `agent.tool_started`, summary `Claude using <tool>`
- `Stop`: `agentState = idle`, intent `agent.turn_completed`, summary `Claude ready`
- `PermissionRequest`: `agentState = blocked`, intent `agent.permission_requested`, summary `Claude needs permission`, blocking reason `permission`
- `StopFailure`: `agentState = error`, intent `agent.turn_failed`, summary `Claude turn failed`

`SessionStart` is not registered through HTTP because official Claude Code hooks do not support HTTP for that event.

Claude does not expose a dedicated HTTP permission-accepted event. The first later `PreToolUse` for the same turn is treated as `agent.permission_resolved` followed by `agent.tool_started` only when the current agent state is `blocked` and the event sequence is newer than the blocking event. This is the explicit unblocking proof required by the reducer.

### OpenCode

Plugin mapping:

- `permission.asked`: `agentState = blocked`, intent `agent.permission_requested`
- `permission.replied`: inspect reply payload:
  - approved/continued -> `agentState = working`, intent `agent.permission_resolved`
  - denied/cancelled -> `agentState = idle` or `error`, intent `agent.permission_resolved`, based on provider payload
- `session.idle`: `agentState = idle`
- `session.error`: `agentState = error`
- Active turn/tool events, if available and reliable: `agentState = working`

### Codex

Codex currently has weaker structured working-start evidence. Until an authoritative turn-start signal is implemented:

- Runtime alive derives `ready`, not `running`.
- Turn complete notification sets `agentState = idle`.
- Errors set `agentState = error`.
- Future richer notify/OTel events can set `agentState = working`.

### Shell

Shell has no agent layer:

- `runtimeState = alive`, `agentState = unknown`
- derived presence is `running`

## Observability and UI

`SessionPresenceSnapshot` should store derived fields plus the raw state pair:

```ts
interface SessionPresenceSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  providerLabel: string
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  phase: SessionPresencePhase
  confidence: ObservabilityConfidence
  health: ObservabilityHealth
  blockingReason: BlockingReason | null
  sourceSequence: number
  ...
}
```

Renderer rules:

- Renderer does not decide runtime/agent state semantics.
- Backend `SessionPresenceSnapshot` is the authoritative UI state once available.
- Renderer fallback derivation from `SessionSummary` is allowed only when no backend snapshot exists for that session.
- Renderer must compare `sourceSequence` before applying any presence snapshot or state patch.
- Renderer must never overwrite a higher-sequence backend presence snapshot with lower-sequence fallback derivation.
- Renderer store must not maintain a divergent presence truth. It stores the latest authoritative snapshot by `sessionId`; fallback is a computed read path, not persisted renderer truth.
- Hierarchy rows render `SessionRowViewModel` only.

Active session focus is not an input to `derivePresencePhase`. It may affect unread/attention metadata, never the phase itself.

Label mapping:

```text
preparing -> Preparing
ready     -> Ready
running   -> Running
blocked   -> Blocked
failed    -> Failed
exited    -> Exited
```

## Expected User-Visible Behavior

### Claude Code Fresh Session

```text
create session             -> Preparing
runtime alive              -> Ready
UserPromptSubmit/PreToolUse -> Running
PermissionRequest          -> Blocked
permission accepted        -> Running
Stop                       -> Ready
process exit               -> Exited
```

### OpenCode Fresh Session

```text
create session             -> Preparing
runtime alive              -> Ready
permission.asked           -> Blocked
permission.replied         -> Running
session.idle               -> Ready
process exit               -> Exited
```

### Shell Fresh Session

```text
create session             -> Preparing
runtime alive              -> Running
process exit               -> Exited
```

### Codex Fresh Session

```text
create session             -> Preparing
runtime alive              -> Ready
turn-start evidence        -> Running, once implemented
turn complete notification -> Ready
process exit               -> Exited
```

## Testing Strategy

### Unit Tests

- Reducer tests for every legal transition.
- Reducer tests proving runtime alive does not set agent working.
- Projection tests for every `runtimeState + agentState + provider` combination.
- Claude hook adapter tests mapping hooks to `agentState`.
- OpenCode plugin mapping tests.
- Session runtime tests proving spawn success calls `markRuntimeAlive`, not `agentState = working`.
- Stale/out-of-order reducer tests:
  - blocked then stale idle stays blocked
  - error then stale stop/idle stays error
  - error then new turn-start recovers to working
  - agent event after runtime exit is ignored
  - failed runtime exit derives failed
  - clean runtime exit derives exited

### Store and View Model Tests

- Renderer store applies `SessionStatePatchEvent` to both state fields.
- Renderer row shows Claude `alive + unknown` as `Ready`.
- Renderer row shows shell `alive + unknown` as `Running`.
- Renderer row updates `Ready -> Running -> Blocked -> Ready` from state patch events.
- Renderer tests for both arrival orders:
  - presence before session patch
  - session patch before presence
  - lower-sequence fallback never overwrites higher-sequence backend presence

### E2E Tests

- New Claude session must not show `Running` immediately after runtime alive.
- Simulated Claude `UserPromptSubmit` or `PreToolUse` moves row to `Running`.
- Simulated Claude `Stop` moves row to `Ready`.
- Simulated Claude `PermissionRequest` moves row to `Blocked`.
- Shell session still shows `Running` after spawn.
- Existing generated journeys should be updated to assert the new semantics.

## Implementation Plan Outline

1. Add shared state types and pure projection function.
2. Add core reducer and reducer tests, including sequence and stale-event cases.
3. Replace persisted status fields with `runtime_state`, `agent_state`, runtime exit metadata, blocking reason, and `last_state_sequence`.
4. Replace manager methods with runtime-specific and provider-specific state patch methods.
5. Update provider adapters to emit intentful agent patches.
6. Update observability service/projection to include raw state pair, sequence, and derived phase.
7. Update renderer store/view models to use backend presence as authoritative and fallback only when no snapshot exists.
8. Update UI tests and E2E journeys.
9. Remove old `SessionStatus` and old non-regression status code.

## Implementation Phases

Phase 1: Shared State and Projection

- Add new types.
- Add `derivePresencePhase`.
- Test provider-specific `alive + unknown` behavior.

Phase 2: Core Reducer and Persistence Break

- Add reducer with intent and sequence.
- Replace persistence schema.
- Remove old single-status reducer paths.

Phase 3: Runtime Lifecycle Wiring

- Rename runtime manager methods.
- Ensure spawn success only sets `runtimeState = alive`.
- Capture runtime exit code/reason.

Phase 4: Provider Adapter Wiring

- Claude hooks emit agent intents.
- OpenCode plugin emits approved/denied permission resolution when available.
- Codex emits only evidence it can prove.

Phase 5: Observability and IPC

- Backend emits authoritative `SessionPresenceSnapshot`.
- IPC sends state patch and/or presence snapshot with sequence.

Phase 6: Renderer Consumption

- Store applies snapshots by sequence.
- Fallback derivation is computed only.
- Hierarchy uses view models derived from authoritative snapshot or fallback.

Phase 7: Journey and Behavior Assets

- Update generated journeys and behavior coverage.
- Add user-visible transition E2E tests.

## Open Questions

- Should Codex remain `Ready` after runtime alive until a reliable turn-start event exists, or should Codex be labelled `Unknown`? Recommendation: show `Ready` because it is less misleading than `Running`.
- Should `failed_to_start` and `error` share the same UI label? Recommendation: both show `Failed`, but details should distinguish runtime start failure from provider turn error.
- Should `blocked` preserve previous working/idle state? Recommendation: preserve in event payload/history, not in primary state. Primary `agentState = blocked` is enough for presence.
- Should the UI phase enum use `running` or keep the existing `working` name? Recommendation: rename to `running` only if every old `working` usage is removed in the same breaking change; otherwise keep `working` internally and render label `Running`. The implementation plan must choose one and eliminate the other.

## Acceptance Criteria

- No provider except shell displays `Running` solely because PTY spawned.
- Claude status is driven by real hook events after runtime launch.
- The renderer has no stale `Preparing` state after a session state patch arrives.
- State names are semantically unambiguous in code.
- Tests fail if `markRuntimeAlive` or equivalent ever changes agent state to `working`.
