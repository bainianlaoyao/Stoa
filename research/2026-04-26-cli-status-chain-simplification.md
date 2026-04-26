---
date: 2026-04-26
topic: cli status chain simplification
status: completed
mode: context-gathering
sources: 24
---

## Context Report: CLI Status Chain Simplification

### Why This Was Gathered

The current CLI status acquisition, propagation, and display chain feels too complex. This report identifies the exact hot path and the points where the architecture has accumulated redundant state or transport layers.

### Summary

The intended architecture is already clear: provider hooks/plugins produce structured events, `SessionSummary` stores authoritative runtime/agent state, and UI presence should be derived from that state. The current implementation is more complex because it maintains two parallel renderer-facing push paths: legacy `onSessionEvent` for `SessionSummary` plus observability presence snapshots, with renderer-side fallback projection and stale-snapshot ordering. The simplification target should be to collapse UI status display onto one backend-pushed `SessionPresenceSnapshot` path while keeping raw CLI events and evidence extraction behind provider adapters.

### Current Hot Path

```text
CLI hook/plugin/notify
  -> sidecar or direct HTTP
  -> webhook-server adapter
  -> CanonicalSessionEvent
  -> SessionEventBridge
  -> SessionStatePatchEvent
  -> SessionRuntimeController
  -> ProjectSessionManager
  -> reduceSessionState()
  -> SessionSummary persisted
  -> ObservabilityService sync/rebuild
  -> SessionPresenceSnapshot
  -> IPC presence push
  -> Pinia sessionPresenceById
  -> SessionRowViewModel / ActiveSessionViewModel
  -> WorkspaceHierarchyPanel / TerminalMetaBar
```

In parallel, `SessionRuntimeController` also pushes `SessionSummaryEvent` over `onSessionEvent`, and the renderer updates `sessions` from that legacy path.

### Key Findings

- Provider integrations already converge on structured events. Codex uses hooks/notify, Claude Code uses HTTP hooks, OpenCode uses a plugin, and all are intended to reach a shared downstream state path after producing `CanonicalSessionEvent`.
- The domain split is correct: `runtimeState` describes PTY/provider process lifecycle, `agentState` describes agent turn state, and `SessionPresencePhase` is pure UI derivation.
- The over-complexity is not in `derivePresencePhase()`. That pure function is small and central. The complexity is in having both `SessionSummary` and `SessionPresenceSnapshot` travel to the renderer as live update channels.
- `ObservabilityService` is partly acting as a read-model builder and partly as evidence cache. That is acceptable for future observability, but it should not be required for basic status propagation when status is already reducible from `SessionSummary`.
- Renderer-side fallback exists in two places: store-level `syncSessionPresenceFromSummary()` and component-level `CommandSurface` fallback. This makes authority harder to reason about.
- `WorkspaceList.vue` still derives status directly from `SessionSummary`, bypassing the view-model/presence path. Even if it is legacy or unused, it is another competing interpretation point.
- The existing design docs already permit breaking changes and explicitly allow replacing `onSessionEvent` semantics with presence snapshot push semantics.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Shared downstream path starts after providers produce `CanonicalSessionEvent`. | `docs/architecture/hook-signal-chain.md` | lines 7-33 |
| State path is authoritative for phase, evidence path is supplemental. | `docs/architecture/hook-signal-chain.md` | lines 17-22, 191-223 |
| Evidence path enriches metadata but should not determine phase. | `docs/architecture/hook-signal-chain.md` | lines 225-249 |
| Renderer fallback derives from `SessionSummary` only when backend snapshot is missing. | `docs/architecture/hook-signal-chain.md` | lines 250-253 |
| State event contract says UI/recovery fields must come from structured events, not character stream inference. | `docs/architecture/state-event-contract.md` | lines 3-6 |
| Runtime, agent, and UI presence were intentionally split to avoid semantic confusion. | `docs/superpowers/specs/2026-04-24-session-state-model-redesign.md` | lines 18-23 |
| UI presence must be pure derivation, not persisted truth. | `docs/superpowers/specs/2026-04-24-session-state-model-redesign.md` | lines 97-100 |
| Frontend rule says backend `SessionPresenceSnapshot` is authoritative once present. | `docs/superpowers/specs/2026-04-24-session-state-model-redesign.md` | lines 452-482 |
| Design allows replacing legacy `onSessionEvent` with presence push semantics. | `docs/superpowers/specs/2026-04-24-session-observability-architecture-design.md` | lines 562-570 |
| Provider adapters should hide provider-specific parsing and not expose raw payloads to renderer. | `docs/superpowers/specs/2026-04-24-session-observability-architecture-design.md` | lines 336-341, 423-424 |
| Codex hook lifecycle contains SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop. | `docs/architecture/codex-hooks-reference.md` | lines 21-32 |
| Codex Stop carries `last_assistant_message`; notify emits `agent-turn-complete`. | `docs/architecture/codex-hooks-reference.md` | lines 360-378, 707-727 |
| Claude Code hooks fire per session, turn, and tool call; UserPromptSubmit/PreToolUse/Stop/StopFailure are available. | `docs/architecture/claude-code-hooks-reference.md` | lines 4-7 |
| Claude Code HTTP hooks support headers with allowed env interpolation. | `docs/architecture/claude-code-hooks-reference.md` | lines 145-152 |
| OpenCode project-level plugins and relevant events exist. | `docs/architecture/opencode-plugin-reference.md` | lines 72-81, 387-411 |
| `SessionSummary` stores runtime/agent state and `CanonicalSessionEvent` carries `SessionStatePatchPayload`. | `src/shared/project-session.ts` | lines 10-46, 73-92, 247-257 |
| `derivePresencePhase()` is the central pure phase reducer. | `src/shared/session-state-reducer.ts` | lines 19-65 |
| Provider hook adapters map raw provider hooks to intentful canonical events. | `src/core/hook-event-adapter.ts` | lines 4-89, 91-130 |
| Webhook server accepts direct canonical events and provider-specific hook endpoints. | `src/core/webhook-server.ts` | lines 136-149, 152-183, 186-249 |
| `SessionEventBridge` converts canonical events to both observation events and state patches. | `src/main/session-event-bridge.ts` | lines 57-67, 86-134 |
| Runtime controller pushes both `SessionSummaryEvent` and observability snapshots. | `src/main/session-runtime-controller.ts` | lines 60-64, 86-104, 106-134 |
| Project manager persists reduced session state after patches. | `src/core/project-session-manager.ts` | lines 309-335, 509-534 |
| Observability service rebuilds snapshots from sessions plus evidence. | `src/core/observability-service.ts` | lines 41-80, 91-113, 127-157 |
| Renderer store subscribes to observability snapshots, but also maintains local fallback snapshots. | `src/renderer/stores/workspaces.ts` | lines 97-171, 193-216, 253-285 |
| App also subscribes to legacy `onSessionEvent` and updates raw sessions. | `src/renderer/app/App.vue` | lines 94-109 |
| Command surface has another component-level fallback to `buildSessionPresenceSnapshot()`. | `src/renderer/components/command/CommandSurface.vue` | lines 31-43 |
| Workspace hierarchy consumes row view models and renders phase/tone labels. | `src/renderer/components/command/WorkspaceHierarchyPanel.vue` | lines 92-119, 310-320 |
| Terminal meta bar consumes active view model, but has raw session fallback. | `src/renderer/components/command/TerminalMetaBar.vue` | lines 16-44 |
| Preload exposes both legacy session event and observability push APIs. | `src/preload/index.ts` | lines 84-118 |

### Risks / Unknowns

- `ObservabilityService.ingest()` currently maps provider event payload to observation payload with only `summary` and `externalSessionId`, so model/snippet evidence fields from adapters are not actually propagated into evidence snapshots yet.
- Removing `onSessionEvent` entirely may affect terminal lifecycle code and tests that still depend on raw `SessionSummary` updates. This is a breaking change, but allowed by repository policy.
- If snapshot push becomes the only renderer status channel, session list data still needs a non-status update path for create/archive/title metadata.
- Codex interactive PTY submit remains a separate upstream reliability problem. Simplifying state propagation will not make Codex emit hooks if the TUI never accepts the prompt as a real submit.

## Context Handoff: CLI Status Chain Simplification

Start here: `research/2026-04-26-cli-status-chain-simplification.md`

Context only. Use the saved report as the source of truth.
