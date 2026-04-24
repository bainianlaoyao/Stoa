# Session Observability Architecture Design

## Purpose

Design the long-term session observability architecture for Stoa. The design is not limited to the current minimal UI need. It creates a stable foundation for richer provider observability, session presence, project/app attention routing, timelines, diagnostics, metrics, and future detail modules.

## Decisions Already Made

- The architecture is **observability-first**.
- The data model is **dual-layer**: facts and read models are both first-class.
- The main UI should **moderately expose provider differences**: universal state first, provider/model/evidence second.
- Event retention is **tiered**: critical, operational, and ephemeral.
- Scope includes **session, project, and app/global** observability from the start.
- The visual implementation must follow `docs/engineering/design-language.md`.
- This is prototype-phase work. No compatibility migration layer is required; breaking changes are acceptable.

## Source Context

- `docs/architecture/provider-observable-information.md`
- `research/2026-04-24-session-entry-overflow.md`
- `research/2026-04-24-session-presence-and-ui.md`
- `docs/architecture/state-event-contract.md`
- `docs/architecture/provider-capability-contract.md`
- `docs/architecture/workspace-identity-and-state-machine.md`

## Core Architecture

The architecture has four layers:

1. **Canonical Observation Event Layer**
   Provider hooks, sidecars, runtime lifecycle, recovery, and system health are normalized into versioned observation events.

2. **Observation Store**
   Stores observation facts with explicit retention policy. Critical and operational events are persisted; ephemeral events are kept in runtime cache by default.

3. **Projection and Snapshot Layer**
   Projections fold events into read models:
   - `SessionRuntimeSnapshot`
   - `SessionPresenceSnapshot`
   - `ProjectObservabilitySnapshot`
   - `AppObservabilitySnapshot`

4. **Renderer View Model Layer**
   Renderer components consume view models derived from snapshots:
   - `SessionRowViewModel`
   - `ActiveSessionViewModel`
   - `ProjectAttentionViewModel`
   - `AppAttentionViewModel`

Renderer code must not interpret provider raw payloads or raw observation events for primary UI state.

## Domain Model

### Session

The smallest observable runtime unit. A session can start, resume, exit, receive provider events, and produce user-facing presence state.

### Project

Aggregates sessions. Project observability answers:

- Is this project healthy?
- Does this project need attention?
- Which session is the most important to inspect next?

### App

Aggregates projects. App observability answers:

- Are there blocked or failed projects?
- Are there unread turns?
- Are provider channels degraded globally?
- Which projects should the user inspect first?

### ObservationEvent

Facts about what happened. Events are not the same as current status.

```ts
export interface ObservationEvent {
  eventId: string
  eventVersion: 1
  occurredAt: string
  ingestedAt: string
  scope: 'session' | 'project' | 'app'
  projectId: string | null
  sessionId: string | null
  providerId: string | null
  category: 'lifecycle' | 'presence' | 'evidence' | 'activity' | 'system'
  type: string
  severity: 'info' | 'attention' | 'warning' | 'error'
  retention: 'critical' | 'operational' | 'ephemeral'
  source: 'hook-sidecar' | 'provider-adapter' | 'system-recovery' | 'runtime-controller'
  correlationId: string | null
  dedupeKey: string | null
  payload: Record<string, unknown>
}
```

### Snapshot

Current interpretation of facts. Snapshots are product interfaces, not raw logs.

## Event Taxonomy

Events use category plus typed names.

### Lifecycle

Examples:

- `lifecycle.session_started`
- `lifecycle.session_resumed`
- `lifecycle.session_exited`
- `lifecycle.recovery_failed`

### Presence

Examples:

- `presence.running`
- `presence.turn_complete`
- `presence.awaiting_input`
- `presence.needs_confirmation`
- `presence.degraded`
- `presence.error`

### Evidence

Examples:

- `evidence.model_observed`
- `evidence.assistant_message_observed`
- `evidence.permission_request_observed`
- `evidence.error_details_observed`
- `evidence.recovery_pointer_observed`

### Activity

Examples:

- `activity.tool_started`
- `activity.tool_finished`
- `activity.message_updated`
- `activity.subagent_started`
- `activity.subagent_finished`

### System

Examples:

- `system.heartbeat_reported`
- `system.provider_channel_lost`
- `system.snapshot_rebuilt`
- `system.runtime_attached`
- `system.runtime_detached`

## Retention Model

### Critical

Persist long-term. Used for diagnostics, recovery confidence, and audit-like history.

Examples:

- session start/resume/exit
- recovery failure
- permission blocker
- error details
- model identity
- recovery pointer updates

### Operational

Persist with TTL or count limit. Used for recent timeline, explanation, and debugging.

Examples:

- turn complete
- assistant message snippet
- tool summary
- degraded state
- permission request summary

### Ephemeral

Keep in runtime cache by default. Used for live UI only.

Examples:

- heartbeat
- streaming progress
- in-flight tool activity
- high-frequency message update fragments

Ephemeral facts can be promoted to operational if they prove product-relevant.

## Snapshot Model

### SessionRuntimeSnapshot

Controls runtime and recovery behavior.

```ts
export interface SessionRuntimeSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  canonicalStatus: SessionStatus
  runtimeAttached: boolean
  externalSessionId: string | null
  recoveryPointerState: 'trusted' | 'suspect' | 'missing'
  lastEventAt: string | null
  updatedAt: string
}
```

### SessionPresenceSnapshot

Feeds UI presence and attention.

```ts
export interface SessionPresenceSnapshot {
  sessionId: string
  projectId: string
  providerId: string
  providerLabel: string
  modelLabel: string | null
  phase: 'preparing' | 'working' | 'ready' | 'blocked' | 'degraded' | 'failed' | 'exited'
  canonicalStatus: SessionStatus
  confidence: 'authoritative' | 'provisional' | 'stale'
  health: 'healthy' | 'degraded' | 'lost'
  blockingReason: 'permission' | 'elicitation' | 'resume-confirmation' | 'provider-error' | null
  lastAssistantSnippet: string | null
  lastEventAt: string | null
  lastEvidenceType: string | null
  hasUnreadTurn: boolean
  recoveryPointerState: 'trusted' | 'suspect' | 'missing'
  updatedAt: string
}
```

### ProjectObservabilitySnapshot

Feeds project-level attention and health.

```ts
export interface ProjectObservabilitySnapshot {
  projectId: string
  overallHealth: 'healthy' | 'degraded' | 'blocked' | 'failed'
  activeSessionCount: number
  blockedSessionCount: number
  degradedSessionCount: number
  failedSessionCount: number
  unreadTurnCount: number
  latestAttentionSessionId: string | null
  latestAttentionReason: 'blocked' | 'failed' | 'unread' | 'degraded' | null
  lastEventAt: string | null
  updatedAt: string
}
```

### AppObservabilitySnapshot

Feeds global attention routing.

```ts
export interface AppObservabilitySnapshot {
  blockedProjectCount: number
  failedProjectCount: number
  degradedProjectCount: number
  totalUnreadTurns: number
  projectsNeedingAttention: string[]
  providerHealthSummary: Record<string, 'healthy' | 'degraded' | 'lost'>
  lastGlobalEventAt: string | null
  updatedAt: string
}
```

## Projection Rules

### Session Presence Phase Priority

When multiple facts apply, phase priority is:

1. `failed`
2. `blocked`
3. `degraded`
4. `working`
5. `ready`
6. `preparing`
7. `exited`

Status mapping:

| Canonical status | Phase | Meaning |
|---|---|---|
| `bootstrapping` | `preparing` | Restoring or initializing |
| `starting` | `preparing` | Runtime/provider is starting |
| `running` | `working` | Provider is active |
| `turn_complete` | `ready` | Agent finished the current turn |
| `awaiting_input` | `ready` | Runtime is waiting for input |
| `needs_confirmation` | `blocked` | User or provider approval is needed |
| `degraded` | `degraded` | State channel or runtime is partially unreliable |
| `error` | `failed` | Explicit error occurred |
| `exited` | `exited` | Runtime exited |

### Confidence

Confidence is system-derived, not provider-reported.

- `authoritative`: recent trusted structured event and healthy channel.
- `provisional`: startup/recovery state or persisted previous state.
- `stale`: runtime is expected to exist, but structured evidence is old or incomplete.

### Health

Health describes observability channel condition, not business state.

- `healthy`: structured events or runtime evidence are current.
- `degraded`: provider supports only partial structured events, or evidence is delayed.
- `lost`: runtime/channel previously existed but is now missing.

### Unread Turns

Set `hasUnreadTurn = true` when an assistant-turn evidence event arrives for an inactive session. Clear it when the user activates that session or opens its detail surface.

### Recovery Pointer

`externalSessionId` is metadata for recovery, not primary identity.

- `trusted`: recently provider-observed and no switch risk detected.
- `suspect`: present but stale or provider may have internally switched conversation.
- `missing`: unavailable.

## Provider Adapter Rules

Provider-specific parsing is confined to adapters.

Adapters output `ObservationEvent` values. They do not update snapshots directly and do not send provider raw payloads to renderer code.

Priority provider evidence:

- Claude Code:
  - `SessionStart.model` -> `evidence.model_observed`
  - `Stop.last_assistant_message` -> `evidence.assistant_message_observed`
  - `StopFailure.error/error_details` -> `evidence.error_details_observed`
  - `PermissionRequest` -> `evidence.permission_request_observed` and `presence.needs_confirmation`

- OpenCode:
  - `session.idle` -> `presence.turn_complete`
  - `permission.asked` -> `presence.needs_confirmation`
  - `permission.replied` -> `presence.running`
  - `session.error` -> `presence.error`
  - `message.updated` -> `activity.message_updated`

- Codex:
  - notify turn completion -> `presence.turn_complete`
  - notify last assistant message -> `evidence.assistant_message_observed`
  - notify thread identity -> `evidence.recovery_pointer_observed`

## Storage Design

### Event Store

Append observation events with dedupe by `eventId` and optional `dedupeKey`.

The store must support:

- append event
- list events by session/project/category
- prune operational events by TTL/count
- ignore duplicate event IDs

### Snapshot Store

Store current snapshots by key:

- session runtime by `sessionId`
- session presence by `sessionId`
- project observability by `projectId`
- singleton app observability

### Runtime Cache

Keep ephemeral data that may be dropped on restart:

- recent ephemeral events
- in-flight activities
- heartbeat windows

## Main Process Interfaces

Internal boundaries:

1. `ProviderAdapter`
   Raw provider payload -> observation events.

2. `ObservationIngestor`
   Validate, dedupe, classify retention, store event.

3. `ProjectionRunner`
   Update snapshots from accepted events.

4. `ObservabilityQueryService`
   Expose snapshots and bounded history queries to IPC.

Renderer-facing APIs should expose:

```ts
getSessionPresence(sessionId: string): Promise<SessionPresenceSnapshot | null>
getProjectObservability(projectId: string): Promise<ProjectObservabilitySnapshot | null>
getAppObservability(): Promise<AppObservabilitySnapshot>
listSessionObservationEvents(
  sessionId: string,
  options: { limit: number; cursor?: string; categories?: ObservationEvent['category'][] }
): Promise<{ events: ObservationEvent[]; nextCursor: string | null }>
onSessionPresenceChanged(callback: (snapshot: SessionPresenceSnapshot) => void): () => void
onProjectObservabilityChanged(callback: (snapshot: ProjectObservabilitySnapshot) => void): () => void
onAppObservabilityChanged(callback: (snapshot: AppObservabilitySnapshot) => void): () => void
```

Renderer code must not subscribe to raw webhook events or raw provider payloads.

## Frontend Architecture

Frontend surfaces consume snapshots through view models.

### Hierarchy Surface

Purpose: scan and attention routing.

Consumes `SessionRowViewModel`.

Shows:

- title
- primary status label
- provider/model compact label
- attention marker
- optional relative recency

Does not show:

- full path
- internal session ID
- external provider session ID
- raw provider event name
- long assistant messages

### Focus Surface

Purpose: explain the active session.

Consumes `ActiveSessionViewModel`.

Shows:

- provider/model chip
- primary phase lozenge
- confidence hint
- last update time
- one-line assistant snippet or blocker/error summary

### Detail Surface

Purpose: explain why the snapshot looks the way it does.

Uses modules:

- `IdentityModule`
- `PresenceModule`
- `TimelineModule`
- `BlockingModule`
- `DiagnosticsModule`
- `MetricsModule`

Current implementation can start with identity, presence, and timeline.

### Global Attention Surface

Purpose: cross-project attention routing.

Shows:

- blocked project count
- failed project count
- unread turn count
- degraded provider/channel count
- top projects needing attention

## View Models

```ts
export interface SessionRowViewModel {
  sessionId: string
  title: string
  primaryLabel: string
  secondaryLabel: string
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  hasUnreadTurn: boolean
  needsAttention: boolean
  attentionReason: 'blocked' | 'failed' | 'degraded' | 'unread' | null
  updatedAgoLabel: string | null
}

export interface ActiveSessionViewModel {
  sessionId: string
  title: string
  providerLabel: string
  modelLabel: string | null
  phaseLabel: string
  confidenceLabel: string
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  lastUpdatedLabel: string | null
  snippet: string | null
  explanation: string | null
}

export interface ProjectAttentionViewModel {
  projectId: string
  label: string
  overallHealth: 'healthy' | 'degraded' | 'blocked' | 'failed'
  unreadTurnCount: number
  blockedSessionCount: number
  failedSessionCount: number
  topAttentionReason: string | null
}
```

## Visual Rules

The UI must follow `docs/engineering/design-language.md`.

Specific constraints:

- Use tokens, not hardcoded colors.
- Do not rely on color alone for status.
- Use mono only for paths, IDs, timestamps, and code-like values.
- Keep hierarchy rows to two lines.
- Keep provider-specific details compact in the hierarchy.
- Put long paths, IDs, raw details, and timelines in detail surfaces.
- `turn_complete` and `awaiting_input` are ready states, not warning states.
- `needs_confirmation`, `degraded`, and `error` must remain visually distinct.

## Future Capability Slots

Future rich features attach to these extension points:

- `Evidence Adapter`: provider-specific extraction into observation events.
- `Projection Plugin`: event-to-snapshot rules.
- `Snapshot Field`: stable read model expansion.
- `Detail Surface Module`: richer explanation without bloating hierarchy rows.

Examples:

- tool timeline -> `activity` events + `TimelineProjection` + `TimelineModule`
- token/cost -> `evidence`/`activity` events + `MetricsProjection` + `MetricsModule`
- approval workflow -> blocker context + `BlockingModule`
- provider diagnostics -> system events + `DiagnosticsModule`

## Breaking Change Policy

No compatibility migration layer is required for prototype development.

Allowed breaking changes:

- Replace `onSessionEvent` semantics with presence snapshot push semantics.
- Add new persisted observability files.
- Change renderer components to consume view models instead of raw session status.
- Replace status-dot-only UI with labeled presence UI.

Required discipline:

- Do not delete tests to pass the suite.
- Do not hand-edit generated tests under `tests/generated/`.
- Run the repository quality gate before declaring implementation complete.

## Implementation Scope

The implementation should land in phases:

1. Add shared observability types and pure projection functions.
2. Add in-memory/persisted observation event and snapshot stores.
3. Wire canonical session events into observation ingestion.
4. Add renderer query/push APIs for snapshots.
5. Update hierarchy and active session UI to consume view models.
6. Add detail surface history/identity/presence modules.
7. Add project/app observability aggregation.
8. Enrich provider adapters with high-value evidence fields.

## Acceptance Criteria

- Current session status UI is derived from `SessionPresenceSnapshot`.
- `turn_complete` renders as ready/available, not warning.
- `needs_confirmation`, `degraded`, and `error` are distinct.
- Session row secondary text is state-first and provider/model-aware.
- Active session focus surface shows status, confidence, provider/model, and optional snippet/explanation.
- Detail surface can show bounded observation history.
- Project and app observability snapshots aggregate session snapshots.
- Provider raw payloads do not reach renderer code.
- Event retention is represented explicitly in the event model.
- Test pipeline passes:
  - `npm run test:generate`
  - `npm run typecheck`
  - `npx vitest run`
  - `npm run test:e2e`
  - `npm run test:behavior-coverage`
