# Evolver Runtime Host Data Flow

This document describes the current memory architecture after the runtime-host redesign.

The boundary is strict:

- `Stoa` owns session runtime integration, evidence capture, hook timing, and context injection.
- `Evolver` owns memory assets, recall logic, review state, distillation state, and its internal search/storage model.

Stoa does not maintain its own memory database, run-selection layer, or publish-compatibility layer anymore.

## 1. Runtime roles

### Stoa

Stoa is the runtime host around agent sessions.

It is responsible for:

- receiving provider-native hook events
- normalizing them into canonical session events
- persisting turn evidence under the project workspace
- deciding when to call Evolver
- injecting returned memory text back into the provider conversation path
- exposing read-only memory introspection APIs to the renderer

### Evolver

Evolver is the memory engine.

It is responsible for:

- storing genes, capsules, failed capsules, and memory-graph events
- retrieving relevant memory for warm start and task recall
- recording observed signals from real session evidence
- preparing review and distill work
- deciding what validation commands should run for approved genes

In this design, Evolver is not treated as a single file or a single memory blob. It behaves like a searchable memory store with multiple asset classes.

## 2. Lifecycle

The approved lifecycle is provider-driven and hook-timed.

### Claude Code

- `SessionStart`
  - provider executes a local command wrapper
  - Stoa calls `EvolverClient.warmStart(...)`
  - returned content is emitted back through the hook response
- `UserPromptSubmit`
  - provider sends the raw hook to Stoa over HTTP
  - Stoa calls `EvolverClient.recall(...)` with the current task text
  - returned content is emitted back through the hook response
- `PostToolUse` with matcher `Write`
  - provider sends evidence to Stoa over HTTP
  - Stoa persists evidence and calls `EvolverClient.observeWrite(...)`
- `Stop` / `StopFailure`
  - provider sends the terminal hook to Stoa over HTTP
  - Stoa seals the turn and queues turn maintenance

### Codex

Codex still uses command-based hooks, but the semantic lifecycle is the same:

- session start or prompt submit can trigger delivery
- write events can trigger observation
- stop triggers turn maintenance

## 3. Evidence pipeline

`SessionEventBridge` is the entry point for normalized provider events.

For each event:

1. persist evidence if present
2. ingest observability
3. apply the session state patch
4. run the lifecycle branch for warm start, recall, observation, or turn sealing

Key files:

- `src/main/session-event-bridge.ts`
- `src/core/webhook-server.ts`
- `src/core/hook-event-adapter.ts`
- `src/core/memory/session-evidence-store.ts`

Evidence is stored under:

```text
.stoa/memory/evidence/{stoaSessionId}/{eventId}/
  metadata.json
  transcript.jsonl | turn-slice.json
```

Each `metadata.json` keeps:

- project/session identity
- provider session identity when available
- canonical payload summary
- normalized evidence fields
- snapshot information

`SessionEvidenceStore.listEvidenceRefsForTurn(...)` is the durable boundary between Stoa runtime capture and Evolver processing.

## 4. Delivery path

There are now only two delivery shapes:

- `warmStart(projectRoot, consumer, stoaSessionId, providerSessionId?)`
- `recall(projectRoot, consumer, stoaSessionId, providerSessionId?, taskText)`

Both return a `DeliveryEnvelope`:

```ts
{
  content: string
  sourceRefs: Array<{ ref: string; reason: string; score?: number | null }>
  selectionPolicy: string
}
```

Stoa writes no separate publish-state object before injection. It simply takes `delivery.content` and maps it into the provider-specific hook response.

For consumers that need a generated file path, Stoa uses:

- `src/core/memory/delivery-paths.ts`

This currently resolves to:

```text
.stoa/generated/evolver-context/{consumer}.jsonl
```

That path is a host-side delivery artifact, not a second memory database.

## 5. Turn maintenance

Turn maintenance begins only after Stoa seals a turn on `Stop` or `StopFailure`.

The queue boundary is:

- `SessionEventBridge.finalizeTurn(...)`
- `TurnMaintenanceRunner.run(...)`

The flow is:

1. `processTurn`
2. optional `prepareReview`
3. optional `completeReview`
4. optional `prepareSolidify`
5. optional `completeSolidify`
6. optional `prepareDistill`
7. optional `completeDistill`

This sequence is intentionally split into separate host calls so Stoa can provide external capabilities without owning Evolver state.

## 6. Who provides LLM and execution dependencies

Stoa provides capabilities. Evolver provides prompts and state transitions.

### Inference

Stoa resolves the inference provider through `InferenceRouter`.

Current contract:

- provider choice comes from Stoa settings
- Stoa passes an `InferenceCapability` into `TurnMaintenanceRunner`
- Evolver produces review/distill prompts
- Stoa executes the real LLM call
- Stoa passes the response back through `completeReview(...)` or `completeDistill(...)`

This means:

- distill depends on an LLM provided by Stoa
- review depends on an LLM provided by Stoa
- Evolver does not directly choose or instantiate the runtime provider in the Stoa-hosted path

### Execution / validation

Stoa resolves the execution capability through `ExecutionRouter`.

Current contract:

- Evolver decides whether solidification is needed
- Evolver returns validation commands from the approved gene
- Stoa executes those commands in the workspace shell
- Stoa returns structured execution results through `completeSolidify(...)`

So validation is also host-provided, not self-executed inside Evolver.

## 7. Upstream ownership

Review and distill are separate upstream concepts, and Stoa keeps them separate.

- review answers: should this mutation be accepted?
- solidify answers: if accepted, do validation commands pass?
- distill answers: what durable memory artifact should be written back?

The custom host bridge added in `research/upstreams/evolver/src/stoa/hostBridge.js` preserves those boundaries instead of collapsing them into one opaque `run`.

## 8. Introspection and visualization

Stoa exposes read-only inspection APIs so the renderer can visualize Evolver internals without taking ownership of them.

Renderer-facing API surface:

- `getMemoryStateSummary`
- `traceMemoryTurn`
- `explainMemoryRecall`
- `getMemoryAsset`

These calls proxy to Evolver host-bridge actions such as:

- `state-summary`
- `trace-turn`
- `explain-recall`
- `get-asset`

This keeps the separation clean:

- Evolver owns the underlying state
- Stoa owns presentation and transport

## 9. Current implementation files

Primary Stoa-side runtime files:

- `src/main/session-event-bridge.ts`
- `src/core/memory/evolver-client.ts`
- `src/core/memory/inference-router.ts`
- `src/core/memory/execution-router.ts`
- `src/core/memory/turn-maintenance-runner.ts`
- `src/core/memory/session-evidence-store.ts`
- `src/core/memory/delivery-paths.ts`

Primary Evolver-side bridge files:

- `research/upstreams/evolver/index.js`
- `research/upstreams/evolver/src/stoa/hostBridge.js`

## 10. Non-goals of this architecture

This design explicitly does not do the following:

- no Stoa-owned memory item schema
- no Stoa-run selection layer before every injection
- no Stoa-managed publish-context compatibility workflow as the main path
- no compatibility shim for legacy injector architecture
- no migration code for old direct-memory pipelines

The intended mental model is simple:

```text
provider hooks
  -> Stoa captures evidence
  -> Stoa asks Evolver for memory when timing requires it
  -> Evolver reads/writes its own memory assets
  -> Stoa injects returned content back into the live session
```
