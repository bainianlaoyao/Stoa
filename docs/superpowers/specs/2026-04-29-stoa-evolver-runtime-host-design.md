# Stoa x Evolver Runtime Host Design

Date: 2026-04-29

## Purpose

This spec defines the breaking-change target architecture for Stoa's memory integration.

It replaces the current Stoa-owned memory runtime direction with a stricter boundary:

- `Stoa` is the runtime host.
- `Evolver` is the memory engine.
- `Stoa` does not own memory assets, memory selection policy, or memory truth.
- `Evolver` does not own session hosting, provider hooks, or consumer delivery mechanics.

This document is the target model. It is not a description of the current implementation.

## Status

Current implementation still reflects the older Stoa-heavy pipeline described in [docs/engineering/evolver-data-flow.md](/abs/path/D:/Data/DEV/ultra_simple_panel/docs/engineering/evolver-data-flow.md:1).

This spec supersedes that direction for the next rewrite.

## Decision

Adopt a host-capability architecture with these rules:

1. `Stoa` captures provider events, stores raw evidence, and invokes Evolver at well-defined lifecycle points.
2. `Evolver` owns genes, capsules, memory graph, retrieval, review policy, distill policy, and solidify policy.
3. `Stoa` asks Evolver for memory recall only after task intent is known.
4. `Stoa` may warm-start a session at `SessionStart`, but task-aware injection happens at `UserPromptSubmit`.
5. `Stoa` supplies capabilities to Evolver for inference and execution instead of re-implementing Evolver workflows.
6. `Stoa` may visualize Evolver state through read-only introspection APIs, but it may not become a second memory database.

## Why This Boundary

The previous design drifted into Stoa-owned memory semantics:

- Stoa-selected "latest publishable run"
- Stoa-owned `MemoryRunRecord`
- Stoa-owned publish and inject policy
- Stoa-owned review and distill prompting

That makes Stoa a shadow memory system beside Evolver.

The corrected model is:

- `Stoa` owns runtime facts and orchestration.
- `Evolver` owns memory meaning and memory decisions.

## Upstream Alignment

This design follows the upstream Evolver split between memory logic and host execution:

- Standard upstream flow is `run -> review -> solidify -> optional distill`.
- `review` and `distill` are separate upstream workflows.
- `solidify` belongs to review approval, not to distill completion.
- `distill` is an external-LLM workflow, not an internal memory database operation.
- `solidify` depends on command execution, not on an LLM.
- recall should happen when the current task is known, not blindly at process boot.

Reference material:

- [research/2026-04-29-evolver-official-standard-flow.md](/abs/path/D:/Data/DEV/ultra_simple_panel/research/2026-04-29-evolver-official-standard-flow.md:1)
- [research/2026-04-29-evolver-distill-validation-dependencies.md](/abs/path/D:/Data/DEV/ultra_simple_panel/research/2026-04-29-evolver-distill-validation-dependencies.md:1)
- [research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js](/abs/path/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js:1)
- [research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js](/abs/path/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/adapters/scripts/evolver-signal-detect.js:1)
- [research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js](/abs/path/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js:1)

## Alternatives Considered

### Recommended: Stoa runtime host, Evolver memory engine

Pros:

- matches upstream ownership
- keeps one memory authority
- lets every session type become a memory consumer
- keeps provider-specific delivery outside memory semantics

Cons:

- requires a breaking rewrite of the current Stoa memory runtime
- requires explicit host capabilities for inference and execution

### Rejected: Stoa owns the full memory pipeline, Evolver is a helper library

Pros:

- easy to adapt from the current implementation
- more short-term local control

Cons:

- duplicates Evolver concepts in Stoa
- makes recall, publish, review, and distill drift from upstream
- forces Stoa to care about internal memory policy it should not own

### Rejected: Pure session-start injection only

Pros:

- mechanically simple
- easy to wire to hook bootstraps

Cons:

- task is unknown at session boot
- encourages low-relevance injection
- fails to use Evolver's task-conditioned retrieval model

## System Boundary

```text
provider hooks / session runtime
  -> Stoa hook gateway
  -> Stoa evidence ledger
  -> Stoa lifecycle orchestrator
  -> Evolver gateway
      -> Evolver memory graph / genes / capsules / policies
      -> host-supplied inference capability
      -> host-supplied execution capability
  -> Stoa delivery adapter
  -> consumer session
```

The center of gravity moves from "Stoa stores memory and publishes it" to "Stoa hosts runtime events and asks Evolver what to do."

## Ownership Matrix

### Stoa Owns

- provider process lifecycle
- provider hook installation and ingress
- canonical runtime events
- raw evidence capture and persistence
- transcript slices and evidence references
- turn sealing and async job scheduling
- inference capability routing
- execution capability routing
- consumer-specific delivery and injection
- read-only visualization surfaces over Evolver state

### Evolver Owns

- genes
- capsules
- events
- memory graph
- retrieval and ranking logic
- warm-start policy
- review policy
- solidify policy
- distill policy
- validation interpretation
- recall explanations and trace semantics

### Stoa Explicitly Must Not Own

- `MemoryItem`
- `MemoryRunRecord`
- `PublishedMemoryRecord`
- "latest publishable run" selection policy
- Stoa-native memory graph
- Stoa-native review schema
- Stoa-native distill schema
- direct parsing and recomposition of Evolver asset files into a second source of truth

## Lifecycle

### `SessionStart`

Goal:

- optional warm start
- not task-aware recall

Flow:

1. Stoa receives `SessionStart`.
2. Stoa may ask Evolver for `warmStart(...)`.
3. Stoa injects only coarse session bootstrap context if returned.

Rules:

- warm start is best-effort
- empty result is valid
- no forced search for "latest run"

### `UserPromptSubmit`

Goal:

- primary task-aware recall point

Flow:

1. Stoa captures the user prompt as evidence.
2. Stoa asks Evolver for `recall(...)` with the real task text and consumer type.
3. Evolver searches its own memory store and returns a bounded recall result plus traceable reasons.
4. Stoa injects that recall into the live consumer path.

Rules:

- this is the default memory read path
- all session types should be able to become consumers through this same contract
- consumer differences change delivery shape, not memory logic

### `PostToolUse(Write)`

Goal:

- observe write signals as task evidence

Flow:

1. Stoa captures tool-use evidence.
2. If the tool is a write-class tool, Stoa forwards the event to Evolver as `observeWrite(...)`.
3. Evolver may update internal signals or task context, but Stoa does not try to infer memory meaning itself.

Rules:

- this is lightweight observation, not synchronous distillation
- Stoa does not reproduce `evolver-signal-detect.js` with parallel memory logic

### `Stop` / `turn_completed`

Goal:

- seal the turn and trigger post-turn maintenance

Flow:

1. Stoa seals the turn from canonical runtime evidence.
2. Stoa resolves evidence refs for that turn.
3. Stoa queues `processTurn(...)`.
4. Evolver performs its own downstream review, solidify preparation, and optional distill preparation using host capabilities as needed.

Rules:

- this is the main maintenance trigger
- injection does not happen here
- Stoa should prefer the canonical end-of-turn signal over archive-button semantics

## Capability Model

Consumer provider and backend capability provider are separate concerns.

- consumer provider: where memory is injected for the agent to consume
- inference capability provider: who executes LLM work for `distill` or optional `llmReview`
- execution capability provider: who executes validation commands for `solidify`

Stoa owns routing for those capabilities. Evolver owns when and why to use them.

### Inference Capability

```ts
interface InferenceCapability {
  invoke(input: {
    purpose: 'distill' | 'llm-review'
    prompt: string
    responseFormat: 'text' | 'json'
    projectRoot: string
    timeoutMs?: number
    modelHint?: string
  }): Promise<{
    content: string
    model?: string
    provider?: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }>
}
```

Rules:

- Stoa may satisfy this with Claude Code, Codex, API models, or another host adapter.
- Evolver must not care which concrete provider fulfilled the request.

### Execution Capability

```ts
interface ExecutionCapability {
  run(input: {
    commands: string[]
    projectRoot: string
    timeoutMs?: number
  }): Promise<{
    ok: boolean
    exitCode: number
    stdout: string
    stderr: string
    commandResults: Array<{
      command: string
      exitCode: number
      stdout: string
      stderr: string
    }>
  }>
}
```

Rules:

- Stoa may satisfy this with local shell execution, isolated worktree execution, or another controlled runtime.
- Evolver owns the meaning of validation success or failure.

## Minimal Host Contract

Stoa should talk to Evolver through a narrow gateway.

```ts
type ConsumerType = 'claude-code' | 'codex' | 'opencode' | 'generic'

type RecallEnvelope = {
  content: string
  selectedRefs: Array<{
    ref: string
    kind: 'gene' | 'capsule' | 'event' | 'memory-graph-entry'
    reason: string
    score?: number
  }>
  selectionPolicy: string
}

type TurnJob = {
  jobId: string
  state: 'queued' | 'running' | 'done' | 'failed'
}

interface EvolverGateway {
  warmStart(input: {
    projectRoot: string
    consumer: ConsumerType
    stoaSessionId: string
    providerSessionId?: string
  }): Promise<RecallEnvelope | null>

  recall(input: {
    projectRoot: string
    consumer: ConsumerType
    stoaSessionId: string
    providerSessionId?: string
    taskText: string
  }): Promise<RecallEnvelope | null>

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
    inference?: InferenceCapability
    execution?: ExecutionCapability
  }): Promise<TurnJob>

  prepareDistill(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
  }): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null>

  completeDistill(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    response: string
  }): Promise<void>

  prepareReview(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
  }): Promise<{ prompt: string; responseFormat: 'text' | 'json' } | null>

  completeReview(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    response: string
  }): Promise<void>

  prepareSolidify(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
  }): Promise<{ commands: string[] } | null>

  completeSolidify(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
    result: Awaited<ReturnType<ExecutionCapability['run']>>
  }): Promise<void>

  getStateSummary(input: {
    projectRoot: string
    stoaSessionId?: string
    providerSessionId?: string
  }): Promise<Record<string, unknown>>

  traceTurn(input: {
    projectRoot: string
    stoaSessionId: string
    providerSessionId?: string
    turnId: string
  }): Promise<Record<string, unknown>>

  explainRecall(input: {
    projectRoot: string
    consumer: ConsumerType
    stoaSessionId: string
    providerSessionId?: string
    taskText: string
  }): Promise<Record<string, unknown>>

  getAsset(input: {
    ref: string
  }): Promise<Record<string, unknown> | null>
}
```

This contract is intentionally narrow:

- Stoa passes evidence and capabilities in.
- Evolver returns recall, state, and explanations out.
- Stoa never becomes the memory model owner.

## Stoa Persistent Model

Stoa persists facts and orchestration state only.

```ts
type ObservedEvent = {
  provider: string
  eventName: 'SessionStart' | 'UserPromptSubmit' | 'PostToolUse' | 'Stop' | string
  projectId: string
  stoaSessionId: string
  providerSessionId?: string
  turnId?: string
  timestamp: string
  promptText?: string
  toolName?: string
  toolUseId?: string
  rawPayload: Record<string, unknown>
}

type EvidenceRef = {
  evidenceId: string
  projectId: string
  stoaSessionId: string
  providerSessionId?: string
  turnId?: string
  kind: 'hook-payload' | 'prompt' | 'transcript' | 'turn-slice' | 'diff'
  path: string
  createdAt: string
}

type RuntimeJobState = {
  jobId: string
  projectId: string
  stoaSessionId: string
  providerSessionId?: string
  turnId: string
  state: 'queued' | 'running' | 'done' | 'failed'
  error?: string
  updatedAt: string
}
```

No Stoa-persisted memory entities beyond this layer are allowed.

## Visualization And Introspection

The UI still needs visibility into Evolver. That does not require Stoa to own Evolver state.

Allowed read-only surfaces:

- state summary
- recall explanation
- per-turn trace
- asset lookup by ref
- review status
- solidify status
- distill status

The rule is simple:

- visualize through Evolver-read APIs
- never reconstruct a second database in Stoa to make the UI easier

## Provider Model

Every session type can become a memory consumer.

Claude Code is only the first consumer, not a special semantic path.

What varies per consumer:

- hook names
- inline injection support
- sidecar file strategy
- resume/session identity extraction

What must stay invariant:

- evidence enters Stoa as canonical events
- recall comes from Evolver
- injection happens at the right lifecycle point for that consumer

## Module Map

### Stoa Modules

- `HookGateway`
  - provider-specific ingress
  - canonical event normalization
- `EvidenceLedger`
  - raw evidence persistence
  - evidence ref resolution
- `TurnLedger`
  - turn sealing
  - async job scheduling
- `LifecycleOrchestrator`
  - maps events to Evolver gateway calls
- `InferenceRouter`
  - resolves an `InferenceCapability`
- `ExecutionRouter`
  - resolves an `ExecutionCapability`
- `DeliveryAdapter`
  - injects recall into provider-specific consumer paths
- `VisualizationGateway`
  - exposes read-only Evolver state for UI

### Evolver Modules

- memory graph and asset store
- retrieval/ranking logic
- write-signal interpretation
- review workflow
- solidify workflow
- distill workflow
- recall explanation and trace

## Forbidden Couplings

The rewrite must reject these patterns:

1. Stoa reading Evolver asset files and building a second canonical memory schema.
2. Stoa deciding which run is "latest", "publishable", or "best" for injection.
3. Stoa embedding fixed prompt templates for review or distill policy.
4. Consumer-specific code directly reaching into Evolver internals without going through the gateway.
5. UI state storage becoming a cache of Evolver memory semantics.
6. Session-start-only injection being treated as the primary recall mechanism.

## Testing Implications

The rewrite is correct only if these behaviors are provable:

1. `SessionStart` performs optional warm start only.
2. `UserPromptSubmit` performs task-aware recall.
3. `PostToolUse(Write)` forwards observation without triggering Stoa-owned memory interpretation.
4. `Stop` or canonical `turn_completed` seals evidence and queues Evolver maintenance.
5. distill uses `InferenceCapability`.
6. solidify uses `ExecutionCapability`.
7. the same memory engine can serve more than one consumer type.

## Acceptance Criteria

- Stoa can host multiple consumer session types without owning memory assets.
- Evolver remains the single authority for recall, review, solidify, and distill semantics.
- Stoa can inject memory after the actual user task is known.
- UI can inspect Evolver state through read-only APIs.
- provider choice for inference or validation can change without changing Evolver memory policy.
- no compatibility layer is retained for Stoa-owned run/publish memory state.

## Recommendation

Proceed with a breaking rewrite toward this contract and treat the current Stoa-owned memory runtime as disposable scaffolding.

The shortest correct sentence for the architecture is:

`Stoa hosts sessions and capabilities. Evolver owns memory and memory decisions.`
