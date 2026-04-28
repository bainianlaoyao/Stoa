# Stoa As Evolver Host Orchestrator Design

Date: 2026-04-28

## Purpose

This design replaces the current run-centric Stoa memory runtime with a thinner host-orchestration model.

The new boundary is explicit:

- `Evolver` is the only memory engine
- `Stoa` is not a second memory system
- `Stoa` only captures host evidence, invokes Evolver at the right lifecycle points, and delivers Evolver output back into host sessions

This is a breaking redesign. Compatibility with the current maintainer/injector/run-record model is out of scope.

## Decision

Adopt a retrieval-first host architecture with these properties:

1. Stoa owns hook ingress, evidence persistence, and provider delivery.
2. Evolver owns memory storage, retrieval, review, distillation, and publish/render semantics.
3. Stoa does not define a parallel memory schema such as `MemoryItem`.
4. Stoa does not decide memory truth via `latest publishable run` or any equivalent run-selection policy.
5. `SessionStart` is only a warm-start injection point.
6. Task-aware memory recall happens after the real user task is known, at `UserPromptSubmit` or an explicit recall surface when host limitations require it.

## Why The Current Model Is Wrong

The current runtime over-rotates around Stoa-owned orchestration artifacts:

- `MemoryRunRecord`
- `PublishedMemoryRecord`
- Stoa-owned summary / review / distill prompting
- session-start injection coupled to a selected run

That design makes Stoa behave like a second memory runtime sitting beside Evolver.

This violates the intended responsibility split:

- Evolver should decide what memory exists and what memory is relevant.
- Stoa should decide only when to observe, when to ask for recall, and how to inject returned context into a concrete host.

## Source Context

- `research/2026-04-28-evolver-memory-model-and-retrieval.md`
- `research/2026-04-28-evolver-native-hooks-and-bridge-necessity.md`
- `research/2026-04-28-real-llm-e2e-and-trigger-timing.md`
- `research/upstreams/evolver/src/adapters/claudeCode.js`
- `research/upstreams/evolver/src/adapters/codex.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js`
- `src/main/session-event-bridge.ts`
- `src/core/hook-event-adapter.ts`
- `src/core/memory/session-evidence-store.ts`
- `src/core/memory/transcript-snapshot.ts`

## Architecture

The final architecture has four first-class Stoa modules:

1. `Hook Gateway`
2. `Evidence Ledger`
3. `Evolver Bridge`
4. `Delivery Adapter`

Everything else is either implementation detail inside those modules or belongs to Evolver.

```text
Host session hooks
  -> Hook Gateway
  -> Evidence Ledger
  -> Evolver Bridge
      -> Evolver internals
  -> Delivery Adapter
  -> Host session context injection
```

## Ownership Boundary

### Stoa Owns

- hook registration and webhook ingress
- provider payload normalization
- raw evidence persistence
- per-session and per-turn orchestration state
- consumer-specific delivery and injection

### Evolver Owns

- memory graph
- genes
- capsules
- reflections
- narrative memory
- retrieval / selection logic
- signal interpretation
- review logic
- distillation logic
- publish and render semantics

### Stoa Explicitly Does Not Own

- a parallel memory object model
- memory ranking policy
- memory source-of-truth storage
- approval logic for whether a memory artifact is real

## Module Design

### 1. Hook Gateway

Responsibilities:

- accept provider-native hook payloads
- validate and normalize them into a Stoa event shape
- split events into:
  - `observe` events
  - `inject` events
- route observe events into the Evidence Ledger
- route inject events into the Evolver Bridge plus Delivery Adapter

Hook Gateway is the only place that understands provider-specific hook naming.

### 2. Evidence Ledger

Responsibilities:

- persist raw evidence under Stoa-controlled storage
- index evidence by project, session, provider session, and turn
- store transcript snapshots or turn slices as immutable facts
- expose evidence references back to the orchestrator

Evidence Ledger stores facts, not interpretations.

Its stored unit is a Stoa evidence envelope, not a memory artifact.

### 3. Evolver Bridge

Responsibilities:

- translate Stoa lifecycle calls into direct Evolver invocations
- hand evidence references to Evolver
- request warm-start content
- request task-aware recall content
- notify Evolver about write-phase observations
- trigger post-turn Evolver maintenance

Evolver Bridge is intentionally thin. It must not recreate summary, review, distill, or publish policies in Stoa.

### 4. Delivery Adapter

Responsibilities:

- map Evolver output to concrete host-consumable output
- return command-hook payloads when host hooks support inline injection
- stage files only when a given host integration requires sidecar material
- keep host-specific formatting outside the Bridge

Delivery Adapter owns delivery mechanics, not memory semantics.

## Stoa Data Model

Stoa keeps only three persistent concepts.

### ObservedEvent

```ts
type ObservedEvent = {
  provider: 'claude-code' | 'codex' | 'opencode' | 'generic'
  eventName: 'SessionStart' | 'UserPromptSubmit' | 'PostToolUse' | 'Stop' | string
  projectId: string
  stoaSessionId: string
  providerSessionId?: string
  turnId?: string
  timestamp: string
  promptText?: string
  assistantText?: string
  toolName?: string
  toolUseId?: string
  transcriptPath?: string
  cwd?: string
  rawPayload: Record<string, unknown>
}
```

### EvidenceRef

```ts
type EvidenceRef = {
  evidenceId: string
  projectId: string
  stoaSessionId: string
  turnId?: string
  kind: 'hook-payload' | 'transcript' | 'turn-slice' | 'diff' | 'prompt'
  path: string
  createdAt: string
}
```

### RuntimeState

```ts
type RuntimeState = {
  sealedTurns: Array<{
    sessionKey: string
    turnId: string
    evidenceIds: string[]
    sealedAt: string
  }>
  jobs: Array<{
    jobId: string
    sessionKey: string
    turnId: string
    state: 'queued' | 'running' | 'done' | 'failed'
    error?: string
    updatedAt: string
  }>
}
```

There is no Stoa-owned `MemoryItem`, `MemoryRunRecord`, or `PublishedMemoryRecord`.

## Evolver Bridge Contract

The Stoa-facing contract should be reduced to four calls:

```ts
type Consumer = 'claude-code' | 'codex' | 'opencode' | 'generic'

type DeliveryEnvelope = {
  content: string
  sourceRefs: Array<{ ref: string; reason: string; score?: number }>
  selectionPolicy: string
}

interface EvolverBridge {
  warmStart(input: {
    projectRoot: string
    consumer: Consumer
    stoaSessionId: string
    providerSessionId?: string
  }): Promise<DeliveryEnvelope | null>

  recall(input: {
    projectRoot: string
    consumer: Consumer
    stoaSessionId: string
    providerSessionId?: string
    taskText: string
  }): Promise<DeliveryEnvelope | null>

  observeWrite(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId?: string
    evidenceRefs: string[]
  }): Promise<void>

  processTurn(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    evidenceRefs: string[]
  }): Promise<{ jobId: string }>
}
```

Review, distill, publish, render, and memory writes are internal Evolver concerns behind this contract.

## Lifecycle

### SessionStart

Flow:

1. Hook Gateway receives `SessionStart`.
2. Hook Gateway asks Evolver Bridge for `warmStart(...)`.
3. Delivery Adapter returns the result to the host session.

Meaning:

- coarse recent-memory warm start
- not task-aware recall

### UserPromptSubmit

Flow:

1. Hook Gateway persists the raw prompt evidence.
2. Hook Gateway asks Evolver Bridge for `recall(taskText)`.
3. Delivery Adapter injects the returned context when the host supports inline response.
4. If the host cannot inject on this event, Stoa exposes an explicit recall surface instead.

Meaning:

- this is the main task-aware memory read path

### PostToolUse(Write)

Flow:

1. Hook Gateway persists write-related evidence.
2. Hook Gateway calls `observeWrite(...)`.

Meaning:

- lightweight observation only
- no Stoa-owned signal reasoning
- no synchronous distillation

### Stop

Flow:

1. Hook Gateway seals the turn.
2. Evidence Ledger resolves evidence references for that turn.
3. Hook Gateway queues `processTurn(...)`.
4. Evolver performs its own downstream memory-maintenance work asynchronously.

Meaning:

- turn maintenance trigger
- not an injection point

## Provider Strategy

### Claude Code

Claude should use a split hook strategy:

- `command hooks` for injection-capable events
  - `SessionStart`
  - `UserPromptSubmit` if inline response is supported reliably
- `http hooks` for observation events
  - `PostToolUse(Write)`
  - `Stop`
  - `PermissionRequest`
  - other telemetry-only events

If Claude cannot inject usefully at `UserPromptSubmit`, Stoa must keep `SessionStart` warm start and add an explicit recall surface.

### Codex

Codex should follow the same conceptual lifecycle:

- warm start at `SessionStart`
- recall after prompt submission
- observe during write/tool phases
- process after stop

The exact delivery mechanics can differ, but the lifecycle should match.

### Generic Consumers

All future consumers should attach to the same conceptual lifecycle.

What varies per consumer:

- how evidence arrives
- whether inline injection is supported
- whether a sidecar or explicit tool is required

What does not vary:

- Evolver remains the memory authority

## File-Level Direction

### Keep And Rewrite Responsibilities

- `src/main/session-event-bridge.ts`
  - becomes Hook Gateway orchestration rather than memory-runtime dispatch
- `src/core/hook-event-adapter.ts`
  - keeps normalization responsibility only
- `src/core/memory/session-evidence-store.ts`
  - becomes the long-term Evidence Ledger
- `src/core/memory/transcript-snapshot.ts`
  - remains the transcript or turn-slice capture helper
- `src/extensions/providers/claude-code-provider.ts`
  - installs lifecycle-accurate Claude hooks
- `src/extensions/providers/codex-provider.ts`
  - aligns Codex hook lifecycle with the same model
- `src/core/memory/evolver-client.ts`
  - is replaced conceptually by an Evolver Bridge facade

### Delete

- `src/core/memory/evolver-maintainer.ts`
- `src/core/memory/claude-code-injector.ts`
- `src/core/memory/runtime.ts`
- `src/core/memory/runtime-state-store.ts`
- `src/core/memory/cli-ai-provider.ts`
- `src/core/memory/api-ai-provider.ts`
- Stoa-owned run, review, and publish orchestration records in shared contracts

### Rewrite Shared Contracts

`src/shared/memory-runtime.ts` must be reduced to Stoa orchestration contracts only.

Delete from shared contracts:

- `MemoryRunRecord`
- `PublishedMemoryRecord`
- `SemanticSessionSummary`
- `ReviewDecision`
- `DistillationResponse`

Retain or add only:

- event/evidence envelopes
- delivery envelope
- orchestration job state
- minimal consumer identifiers

## Non-Goals

- preserving the current `runRecord` / `publishedRecord` state model
- compatibility with current Stoa memory runtime state files
- supporting old injection semantics based on precomputed latest runs
- keeping Stoa-owned AI prompting for review or distillation

## Testing Strategy

The rewrite should prove four things:

1. Hook Gateway correctly routes provider hook events into observe versus inject flows.
2. Evidence Ledger persists immutable provider evidence and resolves evidence refs by turn.
3. Evolver Bridge receives the right lifecycle calls with the right evidence refs.
4. Delivery Adapter returns consumer-correct outputs for SessionStart and task-aware recall.

Minimum test layers:

- unit tests for hook normalization and routing
- unit tests for Evidence Ledger indexing and sealing
- integration tests for Bridge invocation timing
- provider integration tests for real generated hook config
- E2E tests proving:
  - warm-start delivery
  - prompt-time recall delivery
  - write observation
  - stop-triggered post-turn processing

## Final Shape

After this rewrite, Stoa should read as:

- a host hook and evidence system
- a thin Evolver invocation layer
- a consumer delivery layer

It should not read as:

- a second memory engine
- a run-centric memory approval system
- a shadow implementation of Evolver's internal logic
