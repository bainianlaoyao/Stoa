# Session State Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded `SessionStatus` pipeline with the finalized three-layer session model: runtime lifecycle, agent turn state, and derived UI presence.

**Architecture:** State writes flow through one reducer that owns runtime/agent/unseen transitions. Provider hooks and runtime callbacks emit intentful `SessionStatePatchEvent`s; UI consumes `SessionPresenceSnapshot` and `SessionRowViewModel` derived from shared projection functions. This is a breaking prototype change: no old `SessionStatus` compatibility layer and no persisted-state migration.

**Tech Stack:** TypeScript, Electron main/preload IPC, Pinia, Vue 3, Vitest, Electron Playwright generated journeys.

---

## Source Spec

- `docs/superpowers/specs/2026-04-24-session-state-model-redesign.md`
- `docs/engineering/design-language.md`

## File Map

- Create `src/shared/session-state-reducer.ts`: reducer, `derivePresencePhase()`, state patch helpers, sequence guard.
- Create `src/shared/session-state-reducer.test.ts`: full runtime/agent/UI transition matrix.
- Modify `src/shared/project-session.ts`: replace `SessionStatus` in session contracts with runtime/agent/unseen fields; update persisted schema as breaking v5 project sessions.
- Modify `src/shared/observability.ts`: replace old phase union with `preparing | ready | running | complete | blocked | failed | exited`; add runtime/agent fields to snapshots.
- Modify `src/shared/observability-projection.ts` and tests: remove status-based projection, use reducer-derived presence and new tone rules.
- Modify `src/core/project-session-manager.ts` and tests: route all state mutations through reducer; implement `applySessionStatePatch()`, `markRuntimeStarting()`, `markRuntimeAlive()`, `markRuntimeExited()`, `markCompletionSeen()`.
- Modify `src/core/hook-event-adapter.ts` and tests: emit intentful patch-compatible payloads for Claude hooks.
- Modify `src/core/observability-service.ts` and tests: stop mutating status; build authoritative `SessionPresenceSnapshot` from session state.
- Modify `src/main/session-runtime-controller.ts` and tests: rename runtime methods and push snapshots after patch application.
- Modify `src/main/observability-sync.ts` if it still maps old session status events.
- Modify `src/renderer/stores/workspaces.ts` and tests: backend presence snapshot is authoritative; fallback uses shared projection and cannot overwrite newer snapshot.
- Modify `src/renderer/stores/observability-view-models.ts` and tests: labels/tone for `running`, `complete`, `failed`, calm `ready`.
- Modify `src/renderer/components/command/WorkspaceHierarchyPanel.vue` and tests: no terminal top bar; status dot/row classes reflect new view model only.
- Modify behavior/journey/topology assets under `testing/` for visible status behavior and generated journeys.

---

### Task 1: Add Shared Types, Reducer, and Presence Derivation Without Flipping Consumers

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/shared/observability.ts`
- Create: `src/shared/session-state-reducer.ts`
- Create: `src/shared/session-state-reducer.test.ts`
- Modify: `src/shared/project-session.test.ts`

- [ ] **Step 1: Add shared session state types alongside the old status field**

In `src/shared/project-session.ts`, keep the existing `SessionStatus` type for this task so the repository remains compilable while consumers migrate. Add:

```ts
export type SessionRuntimeState = 'created' | 'starting' | 'alive' | 'exited' | 'failed_to_start'
export type SessionAgentState = 'unknown' | 'idle' | 'working' | 'blocked' | 'error'
export type SessionStateSource = 'runtime' | 'provider' | 'ui'
export type SessionStateIntent =
  | 'runtime.created'
  | 'runtime.starting'
  | 'runtime.alive'
  | 'runtime.exited_clean'
  | 'runtime.exited_failed'
  | 'runtime.failed_to_start'
  | 'agent.turn_started'
  | 'agent.tool_started'
  | 'agent.turn_completed'
  | 'agent.completion_seen'
  | 'agent.permission_requested'
  | 'agent.permission_resolved'
  | 'agent.turn_failed'
  | 'agent.recovered'

export interface SessionStatePatchEvent {
  sessionId: string
  sequence: number
  occurredAt: string
  intent: SessionStateIntent
  source: SessionStateSource
  sourceEventType?: string
  runtimeState?: SessionRuntimeState
  agentState?: SessionAgentState
  hasUnseenCompletion?: boolean
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  summary: string
  externalSessionId?: string | null
}
```

Import `BlockingReason` from `@shared/observability` with `import type`.

- [ ] **Step 2: Add new fields to `SessionSummary` and `PersistedSession`**

In `src/shared/project-session.ts`, add these fields to `SessionSummary`. Keep `status` temporarily until Task 8 removes it:

```ts
runtimeState: SessionRuntimeState
agentState: SessionAgentState
hasUnseenCompletion: boolean
runtimeExitCode: number | null
runtimeExitReason: 'clean' | 'failed' | null
lastStateSequence: number
blockingReason: BlockingReason | null
```

For `PersistedSession`, add these snake_case fields. Keep `last_known_status` temporarily until Task 8 removes it:

```ts
runtime_state: SessionRuntimeState
agent_state: SessionAgentState
has_unseen_completion: boolean
runtime_exit_code: number | null
runtime_exit_reason: 'clean' | 'failed' | null
last_state_sequence: number
blocking_reason: BlockingReason | null
```

Do not change `PersistedProjectSessions.version` in this task. Version flip happens in Task 2 when persistence mapping is implemented.

- [ ] **Step 3: Update observability types**

In `src/shared/observability.ts`, change the session phase union to:

```ts
export type SessionPresencePhase = 'preparing' | 'ready' | 'running' | 'complete' | 'blocked' | 'failed' | 'exited'
```

Do not keep `degraded` as a session phase. Keep `ObservabilityTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'` until Task 6 verifies all non-session uses of `accent`; session `ready` must not map to `accent`.

Add to `SessionPresenceSnapshot`:

```ts
runtimeState: SessionRuntimeState
agentState: SessionAgentState
hasUnseenCompletion: boolean
runtimeExitCode: number | null
runtimeExitReason: 'clean' | 'failed' | null
```

Remove `canonicalStatus`.

- [ ] **Step 4: Write reducer tests first**

Create `src/shared/session-state-reducer.test.ts` with tests named:

```ts
it('derives preparing for created and starting before stale agent state')
it('derives failed before blocked complete running and ready')
it('derives complete from idle plus unseen completion before clean exited')
it('derives shell alive unknown as running')
it('derives agent provider alive unknown as ready')
it('runtime alive never changes agent state to working')
it('runtime starting resets agent unseen blocking and exit metadata')
it('turn completed sets agent idle and unseen completion')
it('completion seen clears unseen completion without changing agent idle')
it('blocked cannot be cleared by ordinary stale tool started')
it('permission resolved can move blocked to working')
it('stale sequence patches are ignored')
it('duplicate same-sequence patches do not mutate state twice')
```

Run:

```bash
npx vitest run src/shared/session-state-reducer.test.ts
```

Expected: FAIL because `session-state-reducer.ts` does not exist.

- [ ] **Step 5: Implement `src/shared/session-state-reducer.ts`**

Export:

```ts
export function derivePresencePhase(input: {
  runtimeState: SessionRuntimeState
  agentState: SessionAgentState
  hasUnseenCompletion: boolean
  runtimeExitCode: number | null
  runtimeExitReason: 'clean' | 'failed' | null
  provider: SessionType
}): SessionPresencePhase

export function reduceSessionState(
  session: SessionSummary,
  patch: SessionStatePatchEvent,
  nowIso: string
): SessionSummary
```

Implement priority exactly:

```ts
failed_to_start -> failed
exited + failed -> failed
agent error -> failed
created/starting -> preparing
blocked -> blocked
idle + hasUnseenCompletion -> complete
exited + clean -> exited
working -> running
idle -> ready
alive + unknown + shell -> running
alive + unknown + agent provider -> ready
```

Reducer rules:

```ts
runtime.starting resets agentState unknown, hasUnseenCompletion false, blockingReason null, runtimeExitCode null, runtimeExitReason null
runtime.alive changes only runtime fields and externalSessionId
runtime.exited_clean sets runtimeState exited, runtimeExitReason clean
runtime.exited_failed sets runtimeState exited, runtimeExitReason failed
agent.turn_completed sets agentState idle and hasUnseenCompletion true from unknown or working; ignore it from blocked and error
agent.completion_seen clears hasUnseenCompletion without changing agentState
agent.permission_requested sets blocked and blockingReason
agent.permission_resolved can clear blocked only when current agentState is blocked
ordinary agent.tool_started cannot clear blocked unless sourceEventType marks post-permission continuation
```

- [ ] **Step 6: Update shared contract tests**

In `src/shared/project-session.test.ts`, replace the old `turn_complete` status test with tests asserting:

```ts
const runtimeState: SessionRuntimeState = 'alive'
const agentState: SessionAgentState = 'idle'
expect(runtimeState).toBe('alive')
expect(agentState).toBe('idle')
```

Update the persisted fixture to include the new snake_case session fields while keeping version `4` and `last_known_status` for this staging task. Task 2 flips persistence to version `5`; Task 8 deletes the legacy status assertion.

- [ ] **Step 7: Run shared tests**

Run:

```bash
npx vitest run src/shared/project-session.test.ts src/shared/session-state-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/project-session.ts src/shared/observability.ts src/shared/session-state-reducer.ts src/shared/session-state-reducer.test.ts src/shared/project-session.test.ts
git commit -m "feat: add session state reducer"
```

---

### Task 2: Project Session Manager Persistence and State Application

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `src/core/state-store.ts`
- Modify: `src/core/state-store.test.ts`

- [ ] **Step 1: Write manager tests for new state fields**

In `src/core/project-session-manager.test.ts`, add tests:

```ts
test('createSession initializes runtime created agent unknown and no unseen completion')
test('markRuntimeStarting resets stale agent state and unseen completion')
test('markRuntimeAlive does not set agent working')
test('applySessionStatePatch turns Claude completion into idle plus unseen completion')
test('setActiveSession marks complete sessions as seen')
test('persists project session schema v5 without legacy status')
```

Run:

```bash
npx vitest run src/core/project-session-manager.test.ts
```

Expected: FAIL on missing fields/methods.

- [ ] **Step 2: Update persistence mapping**

In `src/core/project-session-manager.ts`, update `toPersistedSession()` and `toSessionSummary()` to map the new fields only. Do not read `last_known_status`.

`toSessionSummary()` for invalid old records must not fabricate compatibility. Exact breaking behavior: if a project session file is not version `5`, `readProjectSessions()` returns `{ version: 5, project_id, sessions: [] }` and the next persist rewrites the file as v5. Add a state-store test named:

```ts
test('readProjectSessions ignores old v4 project session files as a breaking schema reset')
```

- [ ] **Step 3: Add state patch methods**

Replace old status mutators with:

```ts
async applySessionStatePatch(patch: SessionStatePatchEvent): Promise<void>
async markRuntimeStarting(sessionId: string, summary: string, externalSessionId: string | null): Promise<void>
async markRuntimeAlive(sessionId: string, externalSessionId: string | null): Promise<void>
async markRuntimeExited(sessionId: string, exitCode: number | null, summary: string): Promise<void>
async markRuntimeFailedToStart(sessionId: string, summary: string): Promise<void>
async markCompletionSeen(sessionId: string): Promise<void>
```

Use `reduceSessionState()` for every method. Generate sequences in manager with per-session `lastStateSequence + 1`.

- [ ] **Step 4: Update create session defaults**

New sessions must initialize:

```ts
runtimeState: 'created'
agentState: 'unknown'
hasUnseenCompletion: false
runtimeExitCode: null
runtimeExitReason: null
lastStateSequence: 0
blockingReason: null
summary: 'Waiting for session to start'
```

- [ ] **Step 5: Completion seen on activation**

In `setActiveSession(sessionId)`, after active ids are updated, if the target session has `agentState === 'idle' && hasUnseenCompletion`, call the same reducer path with `intent: 'agent.completion_seen'`, `source: 'ui'`, and summary `Completion seen`.

Task 3 must verify this path pushes an updated `SessionPresenceSnapshot`, so the renderer leaves `Complete` immediately after backend acknowledgement.

- [ ] **Step 6: Update state-store version guards**

In `src/core/state-store.ts`, change project sessions version validation to `5`. Tests must assert old v4 project sessions are ignored and surfaced as an empty v5 session list.

- [ ] **Step 7: Run manager and state tests**

```bash
npx vitest run src/core/project-session-manager.test.ts src/core/state-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/project-session-manager.ts src/core/project-session-manager.test.ts src/core/state-store.ts src/core/state-store.test.ts
git commit -m "feat: persist layered session state"
```

---

### Task 3: Runtime Controller and IPC Event Contract

**Files:**
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/main/session-runtime-controller.test.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/core/session-runtime-callbacks.test.ts`
- Modify: `src/shared/project-session.ts`
- Modify: `src/main/preload-path.test.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`

- [ ] **Step 1: Write runtime controller tests**

In `src/main/session-runtime-controller.test.ts`, add tests:

```ts
test('markRuntimeAlive pushes presence without setting agent working')
test('markRuntimeExited clean preserves complete presence when unseen completion exists')
test('applyProviderStatePatch forwards intentful patches and pushes observability snapshots')
test('setActiveSession on a complete session pushes a ready presence snapshot after completion_seen')
```

Run:

```bash
npx vitest run src/main/session-runtime-controller.test.ts
```

Expected: FAIL until controller API changes.

- [ ] **Step 2: Rename controller methods**

In `src/main/session-runtime-controller.ts`, replace:

```ts
markSessionStarting
markSessionRunning
markSessionExited
applySessionEvent
```

with:

```ts
markRuntimeStarting
markRuntimeAlive
markRuntimeExited
markRuntimeFailedToStart
applyProviderStatePatch
```

Each method calls the corresponding `ProjectSessionManager` method and then pushes observability snapshots.

- [ ] **Step 3: Replace old session event IPC semantics**

Remove `pushSessionEvent(sessionId, status, summary)` and stop using `IPC_CHANNELS.sessionEvent` as a status event. Keep the channel name only as a temporary transport for full `SessionSummary` patches if changing preload channel names causes unrelated churn in this task. The payload must be:

```ts
type SessionSummaryEvent = {
  session: SessionSummary
}
```

Renderer code must treat this as a data patch only. UI phase still comes from `SessionPresenceSnapshot`, with fallback projection only when no snapshot exists.

- [ ] **Step 4: Update runtime callbacks**

In `src/core/session-runtime.ts`, update callback names so spawn success calls `markRuntimeAlive()` and exit calls `markRuntimeExited(sessionId, exitCode, summary)`.

- [ ] **Step 5: Run runtime tests**

```bash
npx vitest run src/main/session-runtime-controller.test.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/session-runtime-controller.ts src/main/session-runtime-controller.test.ts src/core/session-runtime.ts src/core/session-runtime.test.ts src/core/session-runtime-callbacks.test.ts src/shared/project-session.ts
git commit -m "feat: route runtime lifecycle through session reducer"
```

---

### Task 4: Provider Hook Adapters Emit Intentful State Patches

**Files:**
- Modify: `src/core/hook-event-adapter.ts`
- Modify: `src/core/hook-event-adapter.test.ts`
- Modify: `src/core/webhook-server.ts`
- Modify: `src/core/webhook-server.test.ts`
- Modify: `src/core/webhook-server-validation.test.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.test.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] **Step 1: Write adapter tests for intentful patches**

Update `src/core/hook-event-adapter.test.ts` so Claude hook expectations are:

```ts
UserPromptSubmit -> intent agent.turn_started, agentState working
PreToolUse -> intent agent.tool_started, agentState working
PermissionRequest -> intent agent.permission_requested, agentState blocked, blockingReason permission
Stop -> intent agent.turn_completed, agentState idle, hasUnseenCompletion true
StopFailure -> intent agent.turn_failed, agentState error
```

Run:

```bash
npx vitest run src/core/hook-event-adapter.test.ts
```

Expected: FAIL until adapter returns `SessionStatePatchEvent`.

- [ ] **Step 2: Add a dedicated canonical state patch payload**

In `src/shared/project-session.ts`, add a dedicated payload type instead of using `Omit<SessionStatePatchEvent>`, because canonical events use snake_case identity fields while reducer patches use camelCase:

```ts
export interface SessionStatePatchPayload {
  intent: SessionStateIntent
  agentState?: SessionAgentState
  runtimeState?: SessionRuntimeState
  hasUnseenCompletion?: boolean
  runtimeExitCode?: number | null
  runtimeExitReason?: 'clean' | 'failed' | null
  blockingReason?: BlockingReason | null
  summary: string
  externalSessionId?: string | null
  model?: string
  snippet?: string
  toolName?: string
  error?: string
}
```

Then redefine `CanonicalSessionEvent.payload` as `SessionStatePatchPayload`. Webhook ingestion constructs the full `SessionStatePatchEvent` by adding `sessionId`, `sequence`, `occurredAt`, `source`, and `sourceEventType`.

- [ ] **Step 3: Implement Claude adapter mapping**

In `src/core/hook-event-adapter.ts`, return patch-compatible events. Do not map `SessionStart` to running; Claude HTTP hooks in this product path use `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop`, and `StopFailure`.

- [ ] **Step 4: Update webhook server bridge**

In `src/core/webhook-server.ts`, ensure accepted provider events are forwarded to runtime controller as `applyProviderStatePatch()`. Assign per-session monotonic sequence if the provider event lacks one.

- [ ] **Step 5: Update OpenCode and Codex mappings**

OpenCode:

```ts
permission.asked -> agent.permission_requested
permission.replied approve/continued -> agent.permission_resolved + working
permission.replied denied/cancelled -> agent.permission_resolved + idle or error based on payload
session.idle -> agent.turn_completed + idle + hasUnseenCompletion true
session.error -> agent.turn_failed + error
```

Codex:

```ts
turn complete notify -> agent.turn_completed + idle + hasUnseenCompletion true
error notify -> agent.turn_failed + error
do not set working until a reliable turn-start event exists
```

- [ ] **Step 6: Run provider/webhook tests**

```bash
npx vitest run src/core/hook-event-adapter.test.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts src/extensions/providers/opencode-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/hook-event-adapter.ts src/core/hook-event-adapter.test.ts src/core/webhook-server.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts src/extensions/providers/opencode-provider.ts src/extensions/providers/opencode-provider.test.ts src/extensions/providers/codex-provider.ts tests/e2e/provider-integration.test.ts src/shared/project-session.ts
git commit -m "feat: map provider events to session state intents"
```

---

### Task 5: Observability Projection and Authoritative Snapshots

**Files:**
- Modify: `src/shared/observability-projection.ts`
- Modify: `src/shared/observability-projection.test.ts`
- Modify: `src/core/observability-service.ts`
- Modify: `src/core/observability-service.test.ts`
- Modify: `src/main/observability-sync.ts`

- [ ] **Step 1: Write projection tests**

In `src/shared/observability-projection.test.ts`, replace old status tests with:

```ts
it('labels working agent phase as Running')
it('labels idle unseen completion as Complete')
it('uses danger tone for failed before complete and blocked')
it('uses warning tone for complete and blocked')
it('uses neutral tone for ready')
it('builds project attention with failed first then complete and blocked')
```

Run:

```bash
npx vitest run src/shared/observability-projection.test.ts
```

Expected: FAIL until projection is rewritten.

- [ ] **Step 2: Rewrite projection**

In `src/shared/observability-projection.ts`:

- Delete `mapStatusToPresencePhase()`.
- Add `buildSessionPresenceSnapshot()` using `derivePresencePhase(session)`.
- Change `phaseLabel('running')` to `Running` and add `Complete`.
- Change `mapPhaseToTone()`:

```ts
failed -> danger
complete -> warning
blocked -> warning
running -> success
ready/preparing/exited -> neutral
```

Ready must not return `accent`.

- [ ] **Step 3: Update observability service**

In `src/core/observability-service.ts`, stop applying old `PRESENCE_STATUS_BY_TYPE`. Observability should track evidence only and rebuild snapshots from `SessionSummary` state. `sourceSequence` must be the max of `session.lastStateSequence` and evidence sequence.

- [ ] **Step 4: Update app/project aggregation**

Project attention priority:

```ts
failed = 5
complete = 4
blocked = 4
running = 1
ready/preparing/exited = 0
```

Remove degraded counters if the phase no longer exists.

- [ ] **Step 5: Run observability tests**

```bash
npx vitest run src/shared/observability-projection.test.ts src/core/observability-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/observability-projection.ts src/shared/observability-projection.test.ts src/core/observability-service.ts src/core/observability-service.test.ts src/main/observability-sync.ts
git commit -m "feat: derive authoritative session presence"
```

---

### Task 6: Renderer Store and UI Status Presentation

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/stores/workspaces.test.ts`
- Modify: `src/renderer/stores/observability-view-models.ts`
- Modify: `src/renderer/stores/observability-view-models.test.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
- Read: `docs/engineering/design-language.md`

- [ ] **Step 1: Read design language**

Before touching CSS, read `docs/engineering/design-language.md`. Use existing design tokens. Do not add a terminal top bar.

- [ ] **Step 2: Write renderer store tests**

In `src/renderer/stores/workspaces.test.ts`, add tests:

```ts
it('uses backend presence snapshot as authoritative over fallback')
it('does not let lower sourceSequence fallback overwrite newer snapshot')
it('updates active complete session to ready after backend completion_seen patch')
it('keeps Claude alive unknown ready instead of running')
```

Run:

```bash
npx vitest run src/renderer/stores/workspaces.test.ts
```

Expected: FAIL until store is updated.

- [ ] **Step 3: Update store projection logic**

In `src/renderer/stores/workspaces.ts`:

- `syncSessionPresenceFromSummary()` must only create fallback when no backend snapshot exists.
- If backend snapshot exists, compare `sourceSequence`; never overwrite newer backend snapshot with fallback.
- Session updates must carry new runtime/agent fields, not `status`.
- `setActiveSession()` only changes active ids locally; completion seen is committed by backend snapshot/patch.

- [ ] **Step 4: Update view model helper tests**

In `src/renderer/stores/observability-view-models.test.ts`, assert:

```ts
ready -> neutral
running -> success
complete -> warning and needsAttention true
blocked -> warning and needsAttention true
failed -> danger and attention before complete/blocked
```

- [ ] **Step 5: Update hierarchy panel styles**

Before editing styles, inspect the existing status selectors in `src/renderer/components/command/WorkspaceHierarchyPanel.vue`:

```bash
rg -n "status|phase|tone|dot|route-time|session-status|data-testid" src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
```

Then keep the existing layout and update only status dot/class bindings:

- ready: neutral/subtle token, no vivid blue, no accent glow.
- running: medium activity token.
- complete: high non-error attention marker.
- blocked: warning marker.
- failed: danger marker.

Add component assertions in `WorkspaceHierarchyPanel.test.ts`:

```ts
it('renders ready session with neutral status tone and no accent class')
it('renders running session with medium active tone')
it('renders complete session with non-error attention tone')
it('renders failed session with danger tone before other attention states')
```

The ready test must assert the rendered row/dot does not include an accent/blue class or token. Use the actual class names found by the `rg` command above.

Do not add any terminal top/status bar.

- [ ] **Step 6: Run renderer tests**

```bash
npx vitest run src/renderer/stores/workspaces.test.ts src/renderer/stores/observability-view-models.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/stores/workspaces.ts src/renderer/stores/workspaces.test.ts src/renderer/stores/observability-view-models.ts src/renderer/stores/observability-view-models.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.vue src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
git commit -m "feat: render layered session presence"
```

---

### Task 7: E2E, Behavior Assets, and Generated Journeys

**Files:**
- Modify: `tests/e2e/frontend-store-projection.test.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `tests/e2e/session-runtime-lifecycle.test.ts`
- Modify: `testing/behavior/session.behavior.ts`
- Modify: `testing/topology/session-status.topology.ts`
- Modify: `testing/journeys/session-telemetry.journey.ts`
- Generated by command: `tests/generated/playwright/*.generated.spec.ts`

- [ ] **Step 1: Update E2E expectations**

Add or update tests asserting:

```ts
new Claude session runtime alive -> Ready
Claude UserPromptSubmit/PreToolUse -> Running
Claude PermissionRequest -> Blocked
Claude Stop -> Complete
active/visited complete session -> Ready
Shell runtime alive -> Running
runtime starting after restore -> Preparing even with stale old agent state
failed exit -> Failed before complete/blocked
```

- [ ] **Step 2: Update behavior asset**

In `testing/behavior/session.behavior.ts`, declare user-visible behavior for:

```ts
ready is calm and non-accent
running is active but medium priority
complete is unread completion
blocked requires user intervention
failed is highest priority
```

- [ ] **Step 3: Update topology**

In `testing/topology/session-status.topology.ts`, ensure stable selectors cover row status label/dot for:

```ts
session-status-ready
session-status-running
session-status-complete
session-status-blocked
session-status-failed
session-status-exited
```

- [ ] **Step 4: Update journeys**

In `testing/journeys/session-telemetry.journey.ts`, map the Claude status lifecycle:

```text
Ready -> Running -> Blocked -> Running -> Complete -> Ready
```

- [ ] **Step 5: Regenerate generated tests**

```bash
npm run test:generate
```

Expected: exits `0` and updates only deterministic generated files.

- [ ] **Step 6: Run E2E-related Vitest suites**

```bash
npx vitest run tests/e2e/frontend-store-projection.test.ts tests/e2e/backend-lifecycle.test.ts tests/e2e/ipc-bridge.test.ts tests/e2e/session-runtime-lifecycle.test.ts testing/behavior/session.behavior.test.ts testing/topology/session-status.topology.test.ts testing/journeys/session-telemetry.journey.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/frontend-store-projection.test.ts tests/e2e/backend-lifecycle.test.ts tests/e2e/ipc-bridge.test.ts tests/e2e/session-runtime-lifecycle.test.ts testing/behavior/session.behavior.ts testing/topology/session-status.topology.ts testing/journeys/session-telemetry.journey.ts tests/generated
git commit -m "test: cover layered session presence journeys"
```

---

### Task 8: Remove Legacy Status Surface and Run Full Verification

**Files:**
- Modify any remaining files found by `rg "SessionStatus|last_known_status|markSessionRunning|turn_complete|needs_confirmation|mapStatusToPresencePhase|phase === 'working'|degraded"`

- [ ] **Step 1: Remove old status references**

Run:

```bash
rg -n "SessionStatus|last_known_status|markSessionRunning|turn_complete|needs_confirmation|mapStatusToPresencePhase|phase === 'working'|degraded" src tests testing
```

Expected before cleanup: matches may remain.

Remove or rewrite every match. Do not keep compatibility aliases.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full Vitest**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Run Electron Playwright journeys**

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 5: Run behavior coverage**

```bash
npm run test:behavior-coverage
```

Expected: PASS.

- [ ] **Step 6: One-shot verification**

If the prior commands passed but generated files may have changed, run:

```bash
npm run test:all
```

Expected: PASS.

- [ ] **Step 7: Final diff review**

```bash
git status --short
git diff --stat
rg -n "SessionStatus|last_known_status|markSessionRunning|turn_complete|needs_confirmation|mapStatusToPresencePhase|phase === 'working'|degraded" src tests testing
```

Expected: only unrelated pre-existing untracked files remain; no legacy state references in `src`, `tests`, or `testing`.

- [ ] **Step 8: Commit cleanup**

```bash
git add src tests testing
git commit -m "refactor: remove legacy session status model"
```

---

## Self-Review Checklist

- The plan implements all three layers from the spec: runtime, agent, UI presence.
- `complete` exists only in UI presence and is derived from `idle + hasUnseenCompletion`.
- `failed` is highest phase and visual priority.
- `runtime.starting` is a new launch boundary and clears stale agent/unseen/blocking/exit metadata.
- `runtime.alive` never means agent `working`.
- Ready is neutral/subtle and never accent blue.
- No terminal top bar is introduced.
- No compatibility migration is planned.
- Required verification commands are included.
