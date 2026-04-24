# Observability Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make correct provider hook input produce deterministic session observability state, ordered renderer updates, and recoverable UI state after missed pushes.

**Architecture:** Observation events become ordered facts with a per-session sequence assigned at ingestion. Snapshots carry the sequence of the fact that produced them, renderer stores accept only newer snapshots, and renderer hydration can backfill missed events by cursor. Provider hook parsing is fixture-driven and maps known Claude hooks into canonical status plus evidence payloads before projection.

**Tech Stack:** TypeScript, Vue 3 Composition API, Pinia, Electron IPC, Vitest, Playwright.

---

## File Structure

- `src/shared/observability.ts`: Add `sequence` to `ObservationEvent` and `sourceSequence` to snapshots.
- `src/core/observation-store.ts`: Assign monotonic sequence on append, dedupe by event id and dedupe key, support sequence cursor listing.
- `src/core/observability-service.ts`: Preserve event order by sequence and expose snapshots carrying source sequence.
- `src/core/hook-event-adapter.ts`: Parse known Claude hook fixture shapes into canonical events with status/evidence.
- `src/core/hook-event-adapter.test.ts`: Fixture matrix for Stop, PermissionRequest, StopFailure, SessionStart and unsupported hooks.
- `src/renderer/stores/workspaces.ts`: Apply pushed/hydrated snapshots only when `sourceSequence` is newer and backfill missed session events after subscribing.
- `src/renderer/stores/workspaces.test.ts`: Regression coverage for stale push rejection, missed-event backfill, and hydration ordering.
- `src/preload/index.ts`, `src/shared/project-session.ts`, `src/core/ipc-channels.ts`, `tests/e2e/ipc-bridge.test.ts`: IPC contract updates if new bridge methods or option fields are needed.

## Task 1: Ordered Observation Events

**Files:**
- Modify: `src/shared/observability.ts`
- Modify: `src/core/observation-store.ts`
- Modify: `src/core/observation-store.test.ts`

- [ ] **Step 1: Add failing store tests**

Add tests that appended events receive increasing `sequence`, duplicate `eventId` is rejected, duplicate non-null `dedupeKey` is rejected, and listing with cursor returns events after a sequence cursor.

Run: `npx vitest run src/core/observation-store.test.ts`

Expected: FAIL because `sequence` is not assigned and cursor is index-based.

- [ ] **Step 2: Implement sequencing**

Add `sequence: number` to `ObservationEvent`. Make `InMemoryObservationStore.append(event)` assign `sequence` if missing or `0`, reject duplicate `eventId`, reject duplicate non-null `dedupeKey`, and store events sorted by sequence insertion order.

- [ ] **Step 3: Implement sequence cursor listing**

Interpret `options.cursor` as the last seen sequence string. Return events with `sequence > cursorSequence`, limited by `limit`, with `nextCursor` equal to the last returned event sequence when more events remain.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/core/observation-store.test.ts`

Expected: PASS.

## Task 2: Snapshot Source Sequence

**Files:**
- Modify: `src/shared/observability.ts`
- Modify: `src/shared/observability-projection.ts`
- Modify: `src/core/observability-service.ts`
- Modify: relevant tests in `src/shared/observability-projection.test.ts` and `src/core/observability-service.test.ts`

- [ ] **Step 1: Add failing snapshot tests**

Assert a session snapshot has `sourceSequence` equal to the latest accepted event sequence, and stale older events do not move the visible status backward.

Run: `npx vitest run src/core/observability-service.test.ts src/shared/observability-projection.test.ts`

Expected: FAIL because snapshots do not carry `sourceSequence`.

- [ ] **Step 2: Add snapshot field**

Add `sourceSequence: number` to `SessionPresenceSnapshot`, `ProjectObservabilitySnapshot`, and `AppObservabilitySnapshot`.

- [ ] **Step 3: Propagate source sequence**

`buildSessionPresenceSnapshot` accepts `sourceSequence`, project/app builders use max child sequence. `ObservabilityService` tracks latest accepted sequence per session and ignores presence events with lower or equal sequence than current state.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/core/observability-service.test.ts src/shared/observability-projection.test.ts`

Expected: PASS.

## Task 3: Claude Hook Fixture Matrix

**Files:**
- Modify: `src/core/hook-event-adapter.ts`
- Modify: `src/core/hook-event-adapter.test.ts`

- [ ] **Step 1: Add failing fixture tests**

Add tests for:
- `SessionStart` with `model` -> evidence event payload includes model and status running.
- `Stop` with `last_assistant_message` -> status `turn_complete` and snippet payload.
- `PermissionRequest` with `tool_name` -> status `needs_confirmation`, blocking reason payload.
- `StopFailure` with `error` or `error_details` -> status `error`, severity `error`.
- unsupported hook -> null.

Run: `npx vitest run src/core/hook-event-adapter.test.ts`

Expected: FAIL for unsupported mappings.

- [ ] **Step 2: Implement parser**

Keep output as `CanonicalSessionEvent` for webhook compatibility. Normalize known fields into `payload.status`, `payload.summary`, `payload.model`, `payload.snippet`, `payload.error`, `payload.toolName`, and `payload.blockingReason`.

- [ ] **Step 3: Verify**

Run: `npx vitest run src/core/hook-event-adapter.test.ts src/core/webhook-server.test.ts src/core/webhook-server-validation.test.ts`

Expected: PASS.

## Task 4: Renderer Ordering and Backfill

**Files:**
- Modify: `src/renderer/stores/workspaces.ts`
- Modify: `src/renderer/stores/workspaces.test.ts`

- [ ] **Step 1: Add failing store tests**

Add tests that:
- a stale pushed snapshot with lower `sourceSequence` cannot overwrite a newer snapshot.
- initial hydrate response with lower sequence cannot overwrite a push that arrived first.
- after subscribing, store calls `listSessionObservationEvents(sessionId, { cursor: lastKnownSequence })` and refetches `getSessionPresence(sessionId)` when events are returned.

Run: `npx vitest run src/renderer/stores/workspaces.test.ts`

Expected: FAIL because store only checks key presence and does not backfill.

- [ ] **Step 2: Implement apply helpers**

Add `applySessionPresenceSnapshot`, `applyProjectObservabilitySnapshot`, and `applyAppObservabilitySnapshot` that compare `sourceSequence`.

- [ ] **Step 3: Implement backfill**

After subscription setup and initial snapshot requests, list observation events for each session using current `sourceSequence` as cursor. If events are returned, call `getSessionPresence`, `getProjectObservability`, and `getAppObservability` to converge snapshots.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/renderer/stores/workspaces.test.ts`

Expected: PASS.

## Task 5: IPC and Full Verification

**Files:**
- Modify as required by type failures.
- Do not hand edit `tests/generated/`.

- [ ] **Step 1: IPC bridge tests**

Run: `npx vitest run tests/e2e/ipc-bridge.test.ts tests/e2e/main-config-guard.test.ts`

Expected: PASS.

- [ ] **Step 2: Full mandatory gate**

Run:

```bash
npm run test:generate
npm run typecheck
npx vitest run
npm run test:e2e
npm run test:behavior-coverage
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

Commit message:

```bash
git commit -m "fix: harden session observability delivery"
```

## Self-Review Checklist

- Spec coverage: hook fixture parsing, event ordering, renderer stale rejection, missed event backfill, IPC verification.
- Placeholder scan: no task relies on TBD or vague future work.
- Type consistency: sequence naming is `sequence` for events and `sourceSequence` for snapshots.
