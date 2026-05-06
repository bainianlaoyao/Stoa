# Session State Five-Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved five-phase session model end to end so all session state derives from internal runtime/turn facts and the repository quality gate passes.

**Architecture:** Replace the current `agentState`-driven UI contract with a richer shared session core that persists `runtimeState`, `turnState`, `turnEpoch`, `lastTurnOutcome`, `blockingReason`, `failureReason`, and `hasUnseenCompletion`. Reducers own all state transitions; provider ingress normalizes raw hook/plugin events into monotonic local turn events; UI and observability consume only the derived five-phase projection.

**Tech Stack:** TypeScript, Electron main/preload IPC, Vue 3, Pinia, Vitest, Playwright.

---

## Source Spec

- `docs/superpowers/specs/2026-05-06-session-state-five-phase-design.md`
- `research/2026-05-06-session-state-omission-audit.md`

## File Map

- Modify `src/shared/project-session.ts`: define five-phase state contract, remove legacy persisted truth, add turn/failure fields.
- Modify `src/shared/observability.ts`: reduce phase union to `ready | running | blocked | complete | failure`, align snapshots to derived state.
- Modify `src/shared/session-state-reducer.ts`: rewrite reducer and phase derivation around `turnEpoch`, `turnState`, and stale-event guards.
- Modify `src/shared/session-state-reducer.test.ts`: cover interrupted, cancelled, failed, blocked/unblock, runtime exit, and late-event cases.
- Modify `src/core/project-session-manager.ts` and `src/core/state-store.ts`: persist the new session schema and route state writes through reducer patches only.
- Modify `src/core/hook-event-adapter.ts`, `src/core/webhook-server.ts`, `src/extensions/providers/*.ts`: normalize Claude, Codex, and OpenCode ingress to local turn events.
- Modify `src/main/session-runtime-controller.ts`, `src/main/session-input-router.ts`, `src/core/session-runtime.ts`: decouple sendability from UI phase and preserve interruption semantics.
- Modify `src/shared/observability-projection.ts`, renderer stores, and status UI consumers: consume five phases only and keep `ready` visually neutral.
- Modify `tests/e2e/*` and `testing/*`: cover lifecycle, provider ingress, generated journeys, topology, and behavior assets.

### Task 1: Lock Shared Contract with Failing Tests

**Files:**
- Modify: `src/shared/project-session.ts`
- Modify: `src/shared/observability.ts`
- Modify: `src/shared/session-state-reducer.test.ts`

- [ ] **Step 1: Write failing reducer tests for the approved contract**

Add tests for:

```ts
it('derives ready from created starting and clean exited states')
it('derives running only from alive plus running turn state')
it('derives blocked only when blockingReason exists on current running turn')
it('preserves interrupted and failed outcomes against late completion events')
it('requires matching turnEpoch for unblock completion and failure transitions')
it('keeps complete until completion_seen and keeps clean exit folded into ready')
```

Run:

```bash
npx vitest run src/shared/session-state-reducer.test.ts
```

Expected: `FAIL` because the current reducer still exposes `preparing` / `exited` and clears blocked on ordinary tool events.

- [ ] **Step 2: Replace shared session types with the approved five-phase model**

Define these types in `src/shared/project-session.ts`:

```ts
export type SessionPhase = 'ready' | 'running' | 'blocked' | 'complete' | 'failure'
export type TurnState = 'idle' | 'running'
export type TurnOutcome = 'none' | 'completed' | 'interrupted' | 'cancelled' | 'failed'
export type FailureReason =
  | 'rate_limit'
  | 'authentication_failed'
  | 'billing_error'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'permission_denied'
  | 'tool_error'
  | 'provider_error'
  | 'runtime_crash'
  | 'failed_to_start'
  | 'unknown'
```

Add `turnState`, `turnEpoch`, `lastTurnOutcome`, `failureReason`, and `sourceTurnId` fields to the session state payload contracts. Remove persisted `phase` as primary truth.

- [ ] **Step 3: Reduce observability phase union to five phases**

Update `src/shared/observability.ts` so snapshots expose:

```ts
phase: SessionPhase
runtimeState: SessionRuntimeState
turnState: TurnState
turnEpoch: number
lastTurnOutcome: TurnOutcome
blockingReason: BlockingReason | null
failureReason: FailureReason | null
hasUnseenCompletion: boolean
```

- [ ] **Step 4: Run the shared contract tests**

```bash
npx vitest run src/shared/project-session.test.ts src/shared/session-state-reducer.test.ts
```

Expected: `PASS`.

### Task 2: Rewrite the Reducer Around Turn Epochs

**Files:**
- Modify: `src/shared/session-state-reducer.ts`
- Modify: `src/shared/session-state-reducer.test.ts`

- [ ] **Step 1: Keep reducer red with stale-event coverage**

Add explicit red tests for:

```ts
it('ignores late turn_completed after turn_interrupted on the same turnEpoch')
it('ignores late turn_completed after turn_failed on the same turnEpoch')
it('ignores old turn events after a newer turn has started')
it('does not clear blocked on tool_started or tool_completed alone')
it('returns to running on explicit permission_resolved for the same blocked turn')
```

Run:

```bash
npx vitest run src/shared/session-state-reducer.test.ts
```

Expected: `FAIL`.

- [ ] **Step 2: Implement minimal reducer changes**

Reducer rules to implement:

```ts
runtime.starting -> reset turnState idle, turnEpoch 0 preserved or advanced per session boundary, clear block/failure/unseen
agent.turn_started -> open higher turnEpoch, turnState running, clear previous outcome/block/failure/unseen
agent.permission_requested -> keep turnState running, set blockingReason
agent.permission_resolved -> clear blockingReason only when turnEpoch matches current turn and turnState is running
agent.turn_completed -> set turnState idle, lastTurnOutcome completed, hasUnseenCompletion true
agent.turn_interrupted -> set turnState idle, lastTurnOutcome interrupted
agent.turn_cancelled -> set turnState idle, lastTurnOutcome cancelled
agent.turn_failed -> set turnState idle, lastTurnOutcome failed, failureReason populated
```

Phase derivation priority:

```ts
failed_to_start / failed exit / failureReason -> failure
blockingReason + running turn -> blocked
hasUnseenCompletion + completed -> complete
alive + running turn -> running
otherwise -> ready
```

- [ ] **Step 3: Run reducer tests**

```bash
npx vitest run src/shared/session-state-reducer.test.ts
```

Expected: `PASS`.

### Task 3: Persist and Apply the New State in the Backend

**Files:**
- Modify: `src/core/project-session-manager.ts`
- Modify: `src/core/project-session-manager.test.ts`
- Modify: `src/core/state-store.ts`
- Modify: `src/core/state-store.test.ts`
- Modify: `src/main/session-runtime-controller.ts`
- Modify: `src/main/session-runtime-controller.test.ts`
- Modify: `src/core/session-runtime.ts`
- Modify: `src/main/session-input-router.ts`

- [ ] **Step 1: Add failing manager tests for the new fields**

Cover:

```ts
test('createSession initializes five-phase core fields')
test('markRuntimeStarting clears stale turn completion failure and blocking fields')
test('setActiveSession marks complete sessions as seen')
test('phase ready does not imply sendability when runtimeState is exited')
```

Run:

```bash
npx vitest run src/core/project-session-manager.test.ts src/main/session-runtime-controller.test.ts
```

Expected: `FAIL`.

- [ ] **Step 2: Persist the new schema without compatibility migration**

Store only the new fields in persisted sessions:

```ts
runtime_state
turn_state
turn_epoch
last_turn_outcome
blocking_reason
failure_reason
has_unseen_completion
runtime_exit_code
runtime_exit_reason
last_state_sequence
```

Old incompatible project session files must reset to the new empty schema instead of migrating.

- [ ] **Step 3: Update runtime and UI mutation entry points**

Implement or update:

```ts
applySessionStatePatch()
markRuntimeStarting()
markRuntimeAlive()
markRuntimeExited()
markRuntimeFailedToStart()
markCompletionSeen()
markAgentTurnInterrupted()
```

`sendSessionInput` routing must check `runtimeState === 'alive'`, not `phase === 'ready'`.

- [ ] **Step 4: Run backend tests**

```bash
npx vitest run src/core/project-session-manager.test.ts src/core/state-store.test.ts src/main/session-runtime-controller.test.ts src/core/session-runtime.test.ts
```

Expected: `PASS`.

### Task 4: Normalize Provider Ingress to Local Turn Events

**Files:**
- Modify: `src/core/hook-event-adapter.ts`
- Modify: `src/core/hook-event-adapter.test.ts`
- Modify: `src/core/webhook-server.ts`
- Modify: `src/core/webhook-server.test.ts`
- Modify: `src/core/webhook-server-validation.test.ts`
- Modify: `src/extensions/providers/claude-hook-sidecar.ts`
- Modify: `src/extensions/providers/codex-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.ts`
- Modify: `src/extensions/providers/opencode-provider.test.ts`
- Modify: `tests/e2e/provider-integration.test.ts`

- [ ] **Step 1: Write failing ingress tests first**

Cover:

```ts
test('Claude StopFailure maps to agent.turn_failed with typed failureReason')
test('Claude PermissionDenied stays out of session core state')
test('Claude Elicitation maps to blocked elicitation and ElicitationResult only unblocks')
test('Codex turn_id is normalized to a stable local turnEpoch')
test('OpenCode denied permission clears blocked but stays running until later terminal evidence')
```

Run:

```bash
npx vitest run src/core/hook-event-adapter.test.ts src/extensions/providers/opencode-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected: `FAIL`.

- [ ] **Step 2: Implement ingestion normalization**

Rules:

```ts
runtime.* patches may omit turnEpoch
agent.* patches must carry local turnEpoch
provider source turn ids map to monotonic local turnEpoch per session
Claude PermissionDenied becomes observability evidence only
OpenCode permission.replied denied/cancelled clears block and returns to running pending later terminal evidence
ordinary tool activity never clears blocked without explicit unblock intent
```

- [ ] **Step 3: Run provider and webhook tests**

```bash
npx vitest run src/core/hook-event-adapter.test.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts src/extensions/providers/opencode-provider.test.ts tests/e2e/provider-integration.test.ts
```

Expected: `PASS`.

### Task 5: Project the Five Phases Through Observability, Renderer, and E2E

**Files:**
- Modify: `src/shared/observability-projection.ts`
- Modify: `src/shared/observability-projection.test.ts`
- Modify: `src/core/observability-service.ts`
- Modify: `src/core/observability-service.test.ts`
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/stores/workspaces.test.ts`
- Modify: `src/renderer/stores/observability-view-models.ts`
- Modify: `src/renderer/stores/observability-view-models.test.ts`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.vue`
- Modify: `src/renderer/components/command/WorkspaceHierarchyPanel.test.ts`
- Modify: `tests/e2e/backend-lifecycle.test.ts`
- Modify: `tests/e2e/frontend-store-projection.test.ts`
- Modify: `tests/e2e/ipc-bridge.test.ts`
- Modify: `testing/behavior/session.behavior.ts`
- Modify: `testing/topology/session-status.topology.ts`
- Modify: `testing/journeys/session-telemetry.journey.ts`

- [ ] **Step 1: Read the design language before styling changes**

Read:

```bash
Get-Content -Raw docs/engineering/design-language.md
```

- [ ] **Step 2: Make view-model tests fail on old phase names**

Cover:

```ts
it('ready is neutral')
it('running is active')
it('complete is attention without failure')
it('blocked is warning')
it('failure is highest priority')
```

Run:

```bash
npx vitest run src/shared/observability-projection.test.ts src/renderer/stores/workspaces.test.ts src/renderer/stores/observability-view-models.test.ts src/renderer/components/command/WorkspaceHierarchyPanel.test.ts
```

Expected: `FAIL`.

- [ ] **Step 3: Implement the five-phase projection**

Rules:

```ts
UI consumes ready | running | blocked | complete | failure only
renderer fallback must use the same shared derivation
ready must not use accent styling
complete remains until completion_seen from backend
```

- [ ] **Step 4: Update behavior assets and regenerate generated journeys**

Run:

```bash
npm run test:generate
```

Expected: exit `0`.

- [ ] **Step 5: Run repository quality gates**

```bash
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected: all commands exit `0`.
