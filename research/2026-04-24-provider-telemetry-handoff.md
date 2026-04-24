---
date: 2026-04-24
topic: provider telemetry — handoff context for implementation
status: active
mode: handoff
---

## Provider Telemetry Handoff

### Approved Design Spec

`docs/superpowers/specs/2026-04-24-provider-telemetry-design.md`

### Research Reports

| Report | Purpose |
|---|---|
| `research/2026-04-24-non-shell-session-telemetry.md` | Gap analysis: current pipeline, what's missing, provider support matrix |
| `research/2026-04-24-provider-telemetry-plans.md` | Per-provider approaches (Claude Code HTTP hooks, Codex notify, OpenCode plugin expansion) |

### Key Decisions

1. **`turn_complete` status** — new `SessionStatus` value meaning "agent finished a turn, waiting for user." Uniformly used across all three providers. Not a true "task done" signal (no provider offers that).
2. **Unified adapter pattern** — `src/core/hook-event-adapter.ts` converts Claude Code/Codex raw payloads to `CanonicalSessionEvent`. OpenCode plugin already sends `CanonicalSessionEvent` directly.
3. **`/hooks/:source` endpoint** — new webhook routes for Claude Code (`/hooks/claude-code`) and Codex (`/hooks/codex`) that accept raw provider payloads, distinct from existing `/events` for `CanonicalSessionEvent`.
4. **Provider specifics**:
   - **Claude Code**: HTTP hooks → `settings.local.json` (zero code change to Claude Code itself)
   - **Codex**: Node.js notify script + `config.toml` (hooks disabled on Windows, notify is the only option)
   - **OpenCode**: Expand existing sidecar plugin (add `permission.asked`, `session.error`, remap `session.idle` → `turn_complete`)

### Event Mapping (Final)

| Provider | Hook/Event | → SessionStatus |
|---|---|---|
| Claude Code | `Stop` | `turn_complete` |
| Claude Code | `PermissionRequest` | `needs_confirmation` |
| Codex | `agent-turn-complete` | `turn_complete` |
| OpenCode | `session.idle` | `turn_complete` |
| OpenCode | `permission.asked` | `needs_confirmation` |
| OpenCode | `session.error` | `error` |

### Files to Change

| File | Change |
|---|---|
| `src/shared/project-session.ts` | Add `turn_complete` to `SessionStatus` enum |
| `src/core/project-session-manager.ts` | Add `turn_complete` to `NON_REGRESSIBLE_RUNNING_STATUSES` |
| `src/core/hook-event-adapter.ts` | **New** — adapt Claude Code / Codex hook payloads to `CanonicalSessionEvent` |
| `src/core/webhook-server.ts` | Add `POST /hooks/:source` routes |
| `src/main/session-event-bridge.ts` | Provide `sessionIdMap` to adapter |
| `src/extensions/providers/claude-code-provider.ts` | Implement `installSidecar()` (HTTP hooks config); `supportsStructuredEvents()` → `true` |
| `src/extensions/providers/codex-provider.ts` | Implement `installSidecar()` (notify script + config.toml); `supportsStructuredEvents()` → `true` |
| `src/extensions/providers/opencode-provider.ts` | Expand sidecar plugin template |
| Renderer components | Handle `turn_complete` status display |

### Data Flow

```
Claude Code HTTP hooks → POST /hooks/claude-code ─┐
Codex notify script   → POST /hooks/codex        ─┤─ HookEventAdapter → CanonicalSessionEvent
OpenCode plugin       → POST /events (already CanonicalSessionEvent) ──────────────────────────┘
         ↓
  webhook-server.ts (validate + authenticate)
         ↓
  session-event-bridge.ts (route to controller)
         ↓
  session-runtime-controller.ts (update state + IPC push)
         ↓
  Renderer
```

### Remaining Steps

1. **Implementation plan** — invoke `superpowers:writing-plans` skill, review loop
2. **Implementation** — worktree + subagent-driven development (`superpowers:subagent-driven-development`)
3. **Code review** — `superpowers:requesting-code-review`, then merge to main

### Constraints

- All three providers implemented simultaneously
- Minimal-invasive: no source modification to Claude Code / Codex / OpenCode themselves
- Windows-compatible: Codex hooks are disabled on Windows, so `notify` is the only viable Codex approach
- `settings.local.json` and notify scripts are auto-generated at session startup, gitignored
