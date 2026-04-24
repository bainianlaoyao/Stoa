---
date: 2026-04-24
topic: non-shell session telemetry — task completion & input request capture
status: completed
mode: context-gathering
sources: 8
---

## Context Report: Non-Shell Session Telemetry

### Why This Was Gathered
Assess whether the current event pipeline can effectively capture two key events for non-shell (opencode/codex/claude-code) sessions: **task completion** and **input request**.

### Summary
The system has a well-structured webhook-based event pipeline (`CanonicalSessionEvent`), but currently **only OpenCode supports structured events**, and it only emits a single event type (`session.idle`) that maps to `awaiting_input`. There is **no task-completion event** at all. Claude Code and Codex providers declare `supportsStructuredEvents() = false` and emit zero events.

### Key Findings

#### 1. Event Pipeline Architecture (works, but underutilized)

The pipeline is:
1. Provider sidecar/hook sends `POST /events` to local webhook server
2. `webhook-server.ts` validates event shape + authenticates via `x-stoa-secret`
3. `session-event-bridge.ts` routes to `SessionRuntimeController.applySessionEvent()`
4. Controller updates persisted state + pushes IPC to renderer

The pipeline itself is solid — extensible, authenticated, validated.

#### 2. "Input Request" Capture — PARTIAL (OpenCode only)

- **OpenCode** (`opencode-provider.ts:38`): The generated sidecar plugin emits events on every OpenCode event. It maps `session.idle` → `awaiting_input` and everything else → `running`.
- **Claude Code** (`claude-code-provider.ts:34`): `supportsStructuredEvents() = false`. No sidecar, no events emitted. Status is inferred only from process spawn/exit.
- **Codex** (`codex-provider.ts:139`): `supportsStructuredEvents() = false`. Same situation.

So **only OpenCode can signal "awaiting input"**, and even then it's a binary `running`/`awaiting_input` — no metadata about *what kind* of input (confirmation, file choice, free text, etc.).

#### 3. "Task Completion" Capture — NONE

There is **no event type, status, or payload field** for task completion in the current schema:
- `SessionStatus` enum: `bootstrapping | starting | running | awaiting_input | degraded | error | exited | needs_confirmation`
- `CanonicalSessionEvent.event_type`: free-form string, but only `session.idle` and `session.status_changed` are used in practice
- `SessionEventPayload`: only `{ status?, summary?, isProvisional?, externalSessionId? }` — no task metadata

A session transitions from `running` → `awaiting_input` → `running` in a loop, but there's no "task completed" or "turn finished" signal. The only terminal event is `exited` (process died).

#### 4. Provider Support Matrix

| Provider | Structured Events | Input Request | Task Complete | Notes |
|----------|------------------|---------------|---------------|-------|
| OpenCode | Yes (sidecar plugin) | `session.idle` → `awaiting_input` | No | Only maps idle vs running |
| Claude Code | No | No | No | Status from process lifecycle only |
| Codex | No | No | No | Status from process lifecycle only |
| Local Shell | No | N/A | N/A | Not a non-shell session |

### Evidence Chain

| Finding | Source | Location |
|---------|--------|----------|
| SessionStatus enum (no task_complete) | `src/shared/project-session.ts` | :3-11 |
| CanonicalSessionEvent schema | `src/shared/project-session.ts` | :164-174 |
| SessionEventPayload (no task fields) | `src/shared/project-session.ts` | :157-162 |
| Webhook server validates events | `src/core/webhook-server.ts` | :18-59 |
| Bridge routes events to controller | `src/main/session-event-bridge.ts` | :35-42 |
| Controller applies & pushes IPC | `src/main/session-runtime-controller.ts` | :49-57 |
| OpenCode sidecar only emits idle/running | `src/extensions/providers/opencode-provider.ts` | :38 |
| Claude Code: no structured events | `src/extensions/providers/claude-code-provider.ts` | :34 |
| Codex: no structured events | `src/extensions/providers/codex-provider.ts` | :139 |
| ProviderDefinition interface | `src/extensions/providers/index.ts` | :16-36 |

### Risks / Unknowns

- [!] Adding task-completion events requires changes to the `SessionStatus` enum, which is shared between main/renderer — all consumers need updating
- [!] Claude Code has no hook/sidecar mechanism — capturing its internal state requires either parsing stdout or using its `--output-format json` flag if available
- [?] OpenCode's event system may support more event types than just `session.idle` — the sidecar plugin only hooks `event` but the event types OpenCode emits are not documented here
- [?] Whether `needs_confirmation` status is ever set in practice — it exists in the enum but no provider currently emits it

### What Would Be Needed

To capture both events effectively:

**Task Completion:**
1. Add a status (e.g. `task_complete` or `turn_finished`) to `SessionStatus`
2. Providers need to detect task boundaries — for OpenCode this could be a new event type; for Claude Code this requires stdout parsing or API hooks
3. Frontend needs to handle the new status

**Input Request (full):**
1. Enrich `awaiting_input` with metadata (input type, prompt text, choices)
2. Add `needs_confirmation` emission for permission/confirmation dialogs
3. Claude Code and Codex need sidecar/hook mechanisms or stdout parsing
