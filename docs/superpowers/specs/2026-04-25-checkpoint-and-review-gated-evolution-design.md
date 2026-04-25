# Checkpoint And Review-Gated Evolution Design

日期：2026-04-25

## Purpose

Design a safe path for bringing Entire-style checkpointing and Evolver-style automated improvement into Stoa without violating the current repo's state, recovery, renderer, and test architecture.

This design is intentionally phased.

It does **not** attempt to ship full automatic evolution in one step.

## Decisions Already Made

- The design is **checkpoint-first**, not inline self-mutation.
- The first deliverable is a **durable execution/checkpoint foundation**, not a mutation engine.
- Automatic evolution must be **review-gated**.
- Failed attempts must be **retained**, not discarded.
- The design must support both **git** and **non-git** workspaces.
- The visual implementation must follow `docs/engineering/design-language.md`.
- This repository is in prototype phase. Breaking change is acceptable. No compatibility layer is required.

## Source Context

- `research/2026-04-25-entire-library-research.md`
- `research/2026-04-25-evomap-evolver-research.md`
- `research/2026-04-25-entire-checkpoints-vs-evolver-pipeline.md`
- `research/2026-04-25-checkpoint-v2-review.md`
- `docs/superpowers/specs/2026-04-24-session-observability-architecture-design.md`
- `docs/architecture/hook-signal-chain.md`
- `docs/architecture/extension-model.md`
- `docs/architecture/state-event-contract.md`
- `docs/engineering/design-language.md`
- `AGENTS.md`

## Problem

The current repo has strong session lifecycle and observability scaffolding, but it does **not** yet have:

- a durable append-only execution ledger
- a cross-store durable write boundary
- runtime-instance identity that survives restart safely
- immutable checkpoint artifacts for later review
- mounted review surfaces for queue/blast-radius workflows
- typed renderer contracts for checkpoint review

Without those foundations, adding "Entire + Evolver" directly would create drift between:

- runtime state
- persisted session state
- checkpoint history
- mutation attempts
- renderer review state

That drift is unacceptable.

## Non-Goals

This design does not do the following in Phase 0 or Phase 1:

- no direct inline mutation of the active workspace
- no hidden auto-apply of generated fixes
- no requirement that a workspace is a git repo
- no provider-specific custom product flow outside the shared main-process architecture
- no separate web platform in the first shipping slice
- no reuse of `ObservationEvent.payload: Record<string, unknown>` as the checkpoint/review domain model
- no dependence on `TerminalMetaBar` as a primary integration surface

## Design Principles

### 1. Durable Evidence Before Automation

If the system cannot durably answer:

- what happened
- what inputs caused it
- what files changed
- what was reviewed
- what failed

then it is not allowed to automate mutation.

### 2. One Durable Write Boundary

Global app state, per-project session state, and checkpoint/evolution ledger writes must go through one coordinator.

No side channel may independently mutate durable checkpoint state.

### 3. Runtime Instance Identity Must Be Explicit

Session identity is not enough.

Every launched runtime gets a `runtimeEpochId`. Ingress from old epochs must be rejected.

### 4. Review Requires Immutable Artifacts

A checkpoint that depends on the live mutable workspace is not a checkpoint.

Diffs, attribution, and blast radius must be backed by immutable stored artifacts.

### 5. Product Surfaces Must Be Real

Inbox and Context Tree are not theoretical future modules in this design.

Before checkpoint review ships, those surfaces must be mounted and wired into the real app shell.

## Core Architecture

The architecture has five layers:

1. **Ingress Capture Layer**
   Provider webhook events, adapter output, runtime callbacks, and selected terminal spool segments are captured at the boundary before reduction.

2. **Persistence Coordinator**
   The only durable write boundary for:
   - global app state
   - per-project session state
   - execution/checkpoint ledger
   - transaction journal

3. **Execution Ledger**
   Append-only durable records for ingress evidence, checkpoints, review items, and later candidate attempts.

4. **Projection Layer**
   Builds typed read models for queue, checkpoint detail, blast radius, attribution, and lightweight session review summaries.

5. **Renderer Layer**
   Uses dedicated typed contracts for review features. Observability remains a separate projection system.

## App-Managed Data Root

The current repo splits durable data across:

- app global state under home/userData
- per-project session state under `<project>/.stoa/sessions.json`

This design adds a third durable domain: execution/checkpoint ledger.

That ledger must live under an **app-managed data root**, not under project-local `.stoa`.

### Rule

The app-managed data root must be first-class and injectable in all run modes:

- development
- Electron E2E
- packaged smoke
- normal desktop run

### Requirement

Main process startup must resolve a single app-managed root from:

1. explicit test/dev override
2. packaged override when applicable
3. Electron `app.getPath('userData')`

and use it for:

- global state
- transaction journal
- execution/checkpoint ledger

The authoritative override contract is:

- `STOA_APP_DATA_ROOT` for normal development and explicit local override
- test harnesses may derive `STOA_APP_DATA_ROOT` from existing E2E state-dir setup

The root must contain at least:

- `<appDataRoot>/global.json`
- `<appDataRoot>/transactions/`
- `<appDataRoot>/execution-ledger/`

Per-project `.stoa/sessions.json` remains project-local for now, but all writes to it must be coordinated by `PersistenceCoordinator`.

## Persistence Coordinator

### Responsibility

`PersistenceCoordinator` is the only component allowed to durably commit:

- global state
- per-project session state
- execution ledger appends
- transaction journal entries

### Model

Each logical commit writes through a journaled transaction:

```ts
interface PersistenceTransaction {
  transactionId: string
  createdAt: string
  kind:
    | 'session-state-patch'
    | 'runtime-lifecycle'
    | 'ingress-capture'
    | 'checkpoint-finalize'
    | 'review-state-update'
  status: 'pending' | 'committed' | 'aborted'
  writes: Array<
    | { target: 'global-state'; path: string }
    | { target: 'project-sessions'; projectId: string; path: string }
    | { target: 'execution-ledger'; stream: string }
  >
}
```

### Startup Reconciliation

On startup, before any webhook bridge is opened:

1. reconcile incomplete transactions
2. mark stale runtime epochs invalid
3. rebuild active runtime epoch registry as empty
4. only then start accepting provider ingress

This removes the restart race where old provider events could land before the new runtime exists.

## Runtime Epoch

### Purpose

Prevent stale events from old runtimes from mutating the current session after:

- restart
- duplicate launch
- delayed sidecar delivery
- process crash/restart

### Contract

Each runtime launch issues a new:

```ts
type RuntimeEpochId = string
```

It must be persisted into session state and propagated through the full stack:

- provider launch context
- webhook headers/body adaptation
- canonical session event
- session state patch
- runtime controller methods
- terminal chunk association
- ingress evidence record

### Acceptance Rule

Ingress is accepted only when:

- `sessionId` is valid
- secret matches
- `runtimeEpochId` matches the session's active epoch

Cold start rule:

- a restored session has **no active ingress epoch** until a new runtime launch registers one
- old epochs are invalid before the webhook bridge opens

## Ingress Capture Layer

### Requirement

Raw provider payload must be durably capturable before it is reduced by adapter logic.

The current observability path is not enough because it compresses the source evidence.

### Evidence Types

```ts
interface IngressEvidenceRecord {
  evidenceId: string
  sessionId: string
  projectId: string
  runtimeEpochId: string
  occurredAt: string
  source:
    | 'webhook.raw.claude-code'
    | 'webhook.raw.codex'
    | 'webhook.raw.events'
    | 'runtime.callback'
    | 'terminal.spool'
  payloadRef: string
  summary: string
}
```

### Terminal Rule

Terminal data remains live-streamed as today, but selected spool segments needed for durable review must be snapshotted into the ledger at checkpoint boundaries.

The live terminal backlog is not a durable source of truth.

## Execution Ledger

### Purpose

A new append-only durable store for:

- ingress evidence
- checkpoint records
- review queue items
- immutable checkpoint artifacts
- later candidate attempts

### Storage

Stored under the app-managed data root, not project-local `.stoa`.

The execution ledger must be rooted at `<appDataRoot>/execution-ledger/`.

Its internal file topology may be sharded by stream or record type, but it must support:

- append-only event/record writes
- typed lookup by session/project/checkpoint
- restart-safe replay
- bounded query APIs for renderer use

## Checkpoint Domain Model

### Checkpoint Summary

```ts
interface CheckpointSummary {
  checkpointId: string
  projectId: string
  sessionId: string
  runtimeEpochId: string
  parentCheckpointId: string | null
  trigger:
    | 'runtime-start'
    | 'turn-complete'
    | 'turn-failed'
    | 'permission-blocked'
    | 'runtime-exit'
    | 'manual-review'
  status: 'capturing' | 'ready' | 'failed'
  baseRevision:
    | { kind: 'git'; headSha: string }
    | { kind: 'workspace'; fingerprint: string }
    | null
  artifactBundleId: string | null
  createdAt: string
  summary: string
}
```

### Immutable Artifact Bundle

Phase 1 checkpoints must persist an immutable artifact bundle.

This is mandatory.

```ts
interface CheckpointArtifactBundle {
  artifactBundleId: string
  checkpointId: string
  changedFiles: Array<{
    path: string
    beforeHash: string | null
    afterHash: string | null
    status: 'added' | 'modified' | 'deleted'
  }>
  patchText: string
  fileArtifacts: Array<{
    path: string
    beforeContentRef: string | null
    afterContentRef: string | null
  }>
  capturedAt: string
}
```

This bundle is the source of truth for later:

- read-only diff
- blast radius
- line attribution
- review detail

### Why This Is Required

Without immutable artifacts, any later review view would silently depend on the mutated live workspace and become non-reproducible.

## Review Domain Model

Checkpoint review must not reuse observability payload blobs.

It needs dedicated typed contracts.

### Review Queue Item

```ts
interface ReviewQueueItem {
  itemId: string
  kind: 'checkpoint' | 'failed-attempt' | 'candidate'
  projectId: string
  sessionId: string
  checkpointId: string | null
  title: string
  reason:
    | 'manual-review'
    | 'failed-attempt'
    | 'blocked-change'
    | 'candidate-ready'
  status: 'queued' | 'seen' | 'accepted' | 'rejected'
  createdAt: string
}
```

### Review Queue Snapshot

```ts
interface ReviewQueueSnapshot {
  sourceSequence: number
  totalQueued: number
  items: ReviewQueueItem[]
  updatedAt: string
}
```

### Blast Radius Snapshot

```ts
interface BlastRadiusSnapshot {
  checkpointId: string
  fileCount: number
  changedFiles: Array<{
    path: string
    status: 'added' | 'modified' | 'deleted'
    additions: number
    deletions: number
  }>
}
```

### Line Attribution

Phase 1 attribution may start with heuristic calculation, but it must operate on immutable stored artifacts, not on current workspace state.

```ts
interface LineAttributionSnapshot {
  checkpointId: string
  method: 'heuristic-v1'
  agentAdded: number
  humanAdded: number
  humanModified: number
  humanRemoved: number
  totalCommitted: number
}
```

### Checkpoint Detail

```ts
interface CheckpointDetail {
  summary: CheckpointSummary
  artifactBundle: CheckpointArtifactBundle | null
  blastRadius: BlastRadiusSnapshot | null
  attribution: LineAttributionSnapshot | null
  evidenceIds: string[]
  reviewItem: ReviewQueueItem | null
}
```

## Evolution Domain Boundary

Evolution is explicitly deferred behind the foundation and checkpoint product.

### Phase 2 Only

The following are not allowed before Phase 2:

- isolated worktrees
- candidate mutation execution
- validation orchestration
- automatic promotion logic
- gene/capsule extraction

### Candidate Attempt Model

Defined early so the architecture has a stable future slot, but implemented in Phase 2:

```ts
interface CandidateAttempt {
  attemptId: string
  sourceCheckpointId: string
  projectId: string
  sessionId: string
  status: 'queued' | 'running' | 'validated' | 'failed' | 'accepted' | 'rejected'
  createdAt: string
}
```

## UI Architecture

### App Shell

`InboxQueueSurface` and `ContextTreeSurface` must become real mounted surfaces in `AppShell`.

They cannot remain disconnected placeholders.

### Command Surface

`CommandSurface` remains:

- hierarchy
- active terminal

This design does not overload it with deep review UI.

### Terminal Meta

`TerminalMetaBar` is out of scope for this feature set.

The reviewed design explicitly avoids depending on it because it is not currently part of the integrated product flow.

### Hierarchy

Hierarchy review indicators are deferred until a typed summary model exists:

```ts
interface SessionReviewSummary {
  sessionId: string
  pendingReviewCount: number
  latestCheckpointStatus: 'none' | 'ready' | 'failed'
}
```

Before that contract exists, the hierarchy remains review-neutral.

## Renderer Contracts

Renderer APIs must be dedicated and typed.

Examples:

```ts
listReviewQueue(options: { limit: number; cursor?: string }): Promise<{
  items: ReviewQueueItem[]
  nextCursor: string | null
}>

getCheckpointSummary(checkpointId: string): Promise<CheckpointSummary | null>
getCheckpointDetail(checkpointId: string): Promise<CheckpointDetail | null>
getBlastRadiusSnapshot(checkpointId: string): Promise<BlastRadiusSnapshot | null>
getLineAttributionSnapshot(checkpointId: string): Promise<LineAttributionSnapshot | null>
onReviewQueueChanged(callback: (snapshot: ReviewQueueSnapshot) => void): () => void
```

Checkpoint/review IPC must not piggyback on `ObservationEvent.payload`.

## Phase Plan

### Phase 0: Foundation

Deliverables:

- `PersistenceCoordinator`
- transaction journal and startup reconciliation
- app-managed data root override contract
- `runtimeEpochId` full-stack propagation and validation
- `ExecutionLedgerStore`
- raw ingress evidence capture
- mounted Inbox and Context Tree surfaces
- typed renderer IPC/query contracts for review/checkpoint data

No mutation engine.

### Phase 1: Checkpoint Product

Deliverables:

- durable checkpoint summaries
- immutable artifact bundles
- failed-attempt retention
- review queue skeleton
- read-only checkpoint detail
- read-only blast radius
- heuristic line attribution from immutable artifacts

No worktrees.
No candidate mutation execution.

### Phase 2: Review-Gated Evolution

Deliverables:

- isolated worktree execution
- candidate attempt lifecycle
- validation pipeline
- review-driven accept/reject flow
- accepted-candidate extraction into later reusable knowledge assets

## Testing Requirements

The repo quality gate is mandatory.

### New Unit Coverage

- `PersistenceCoordinator` transaction success/failure/reconciliation
- runtime epoch validation and stale-event rejection
- ledger append/read behavior
- immutable artifact bundle creation
- non-git `baseRevision` capture
- git `baseRevision` capture

### New E2E Coverage

- restart with incomplete transaction journal
- restart invalidates old runtime epoch before ingress opens
- raw old-epoch webhook is rejected after restart
- mounted Inbox/Context surfaces are reachable in live app shell
- review queue skeleton hydrates from typed IPC
- checkpoint detail survives workspace mutation after capture

### New Behavior/Topology/Journey Assets

- inbox surface topology
- context tree review topology
- checkpoint review behavior
- failed-attempt retention behavior
- restart reconciliation journey

### Mandatory Verification

Implementation is not complete until all of these pass:

- `npm run test:generate`
- `npm run typecheck`
- `npx vitest run`
- `npm run test:e2e`
- `npm run test:behavior-coverage`

## Acceptance Criteria

- Startup reconciliation and runtime-epoch invalidation finish before provider ingress is accepted.
- Old runtime ingress is rejected after restart or duplicate launch.
- Checkpoint ledger is durable and app-managed, not project-local.
- Phase 1 checkpoint review remains reproducible after the live workspace changes.
- Non-git workspaces can still produce valid checkpoints.
- Inbox and Context Tree are mounted product surfaces, not disconnected placeholders.
- Review/checkpoint renderer data uses typed IPC contracts, not generic observability payload maps.
- Phase 1 ships checkpoint review only; mutation execution remains Phase 2.
- Test pipeline passes with new behavior/topology/journey coverage.

## Out Of Scope

- inline self-mutation of the active workspace
- hidden auto-apply behavior
- separate web dashboard in the first shipping slice
- line-perfect attribution beyond heuristic v1
- gene/capsule sharing network
- cross-machine synchronization
