# Memory Plugin Architecture Design

日期：2026-04-27

## Purpose

This spec defines a pluggable memory architecture for Stoa.

It answers one concrete product question:

- can Stoa keep one session model while allowing different memory maintenance and memory injection strategies to be plugged in

It also fixes the first implementation boundary:

- the first slice only needs to split the current Entire + Evolver chain into two plugin slots

This spec extends and partially refactors the direction established in:

- `docs/superpowers/specs/2026-04-25-entire-evolver-direct-integration-design.md`
- `docs/superpowers/specs/2026-04-26-entire-evolver-memory-self-evolution-design.md`

## Decision

Adopt a two-slot plugin architecture:

- `memory-maintainer`
- `memory-injector`

Stoa owns:

- plugin lifecycle
- hook dispatch
- plugin config binding
- plugin execution boundary
- permission boundary
- manifest envelope
- run status, refs, logs, and hashes

Plugins own:

- what they read
- how they derive memory
- how they publish or inject memory
- any plugin-specific internal data model

Stoa does not define one canonical memory schema.

The stable contract is not memory content.

The stable contract is:

- plugin role
- hook lifecycle
- run context
- manifest envelope
- allowed output surfaces

## User Decisions Captured In This Spec

The design below treats the following choices as fixed:

- Entire is a default implementation only, not the universal memory base.
- plugin input is open; plugins can read whatever they need.
- the system has two plugin roles, not one monolithic memory plugin.
- injectors may read both maintainer outputs and raw evidence directly.
- config binding is `project default + session override`.
- permissions are restricted:
  - maintainers may write only their own state/output areas
  - injectors may write only provider injection outputs and Stoa-declared output slots
- both roles may declare multiple hooks
- hooks are role-defaulted, with extra hooks gated by a Stoa allowlist
- maintainer output sharing uses `manifest + arbitrary artifact files/directories`
- plugin execution supports both in-process built-ins and subprocess-based external plugins
- Stoa understands only a generic wrapper config:
  - `plugin id`
  - `enabled`
  - `hook bindings`
  - opaque config payload
- the first release target is only the current Entire + Evolver chain

## Why This Architecture

### Why Entire Is Not The Base

Entire is a good checkpoint and evidence source.

It is not a good universal base for every memory strategy because it does not naturally own:

- memory maintenance policy
- memory selection policy
- memory injection policy
- provider-facing context delivery semantics

If Entire became the base, every future strategy would inherit a checkpoint-first worldview even when that strategy does not need it.

Therefore:

- Entire should be expressible as one maintainer implementation input source
- it should not define the framework boundary

### Why Two Slots Instead Of One Or Many

One monolithic plugin is simpler initially but couples maintenance and injection too tightly.

Multiple concurrent plugins per role are more flexible but immediately require:

- ordering rules
- conflict resolution
- output merging
- token-budget arbitration
- failure isolation across peers

The two-slot model is the smallest model that remains genuinely composable.

## Scope

### In Scope

- two memory plugin roles
- plugin registry and config binding
- hook-based plugin execution
- manifest-based handoff from maintainer to injector
- role-specific permissions
- in-process built-in plugins
- subprocess external plugins
- project default plus session override binding
- adapting the current Entire + Evolver path into these slots

### Out of Scope

- multi-maintainer fan-in
- multi-injector fan-in
- Stoa-owned canonical memory graph
- Stoa-owned canonical skill schema
- generic workflow-graph orchestration
- backward compatibility for the current direct-memory API shape
- migration shims for old memory contracts

This is a breaking architectural change and should be implemented as one.

## Core Model

The stable Stoa-side model is:

```text
session/project config
  -> resolve active maintainer and injector
  -> dispatch hook
  -> execute maintainer if bound to hook
  -> persist maintainer run record
  -> execute injector if bound to hook
  -> persist injector run record
  -> expose generated provider-facing outputs
```

The maintainer and injector are related, but not symmetrical.

### Maintainer Role

The maintainer is responsible for producing memory-maintenance artifacts.

Examples:

- importing checkpoint evidence
- updating scoped memory assets
- running an evolution engine
- summarizing transcripts
- building retrieval indexes

The maintainer must emit a Stoa-readable manifest.

Stoa does not inspect the maintainer's inner data model beyond that manifest.

### Injector Role

The injector is responsible for producing provider-facing memory delivery outputs.

Examples:

- generated Markdown include files
- generated JSON sidecar payloads
- prompt-prefix payloads
- provider hook inputs

The injector may read:

- the latest successful maintainer manifest
- arbitrary maintainer artifacts declared by that manifest
- raw session inputs, raw evidence, checkpoint refs, or repo files directly

The injector is not forced to depend only on maintainer outputs.

If no successful maintainer manifest exists yet, the injector must handle that state explicitly.

Acceptable first-run behaviors are:

- emit an empty/minimal context output
- fall back to raw input processing only
- mark the run as skipped with a clear reason

## Binding Model

Memory plugins are resolved in two layers:

- project default binding
- session override binding

Resolution rule:

1. start from the project default plugin binding
2. if the session declares an override for that role, replace the project binding for that session only
3. evaluate enablement and hook binding on the resolved plugin config

This applies independently to:

- maintainer
- injector

Project/session bindings are Stoa-owned orchestration state, not plugin-owned state.

## Hook Model

### Default Role Hooks

Stoa defines default hook families:

For `memory-maintainer`:

- `session.turn_completed`
- `session.manual_refresh`
- `session.archived`

For `memory-injector`:

- `session.before_start`
- `session.before_resume`
- `session.manual_refresh`

These are defaults, not exclusivity claims.

### Extra Hooks

Plugins may declare extra hooks, but only through a Stoa allowlist.

Examples of allowlist-worthy hooks:

- `session.created`
- `session.restored`
- `session.presence_changed`
- `checkpoint.imported`

Rules:

- role-default hooks require no extra approval
- any non-default hook must be explicitly allowed by Stoa
- Stoa may reject plugin startup if an unapproved hook is requested

This preserves flexibility without turning both roles into arbitrary event subscribers.

## Execution Model

### Dual Mode

Stoa supports two execution modes:

- built-in plugin: in-process TypeScript module
- external plugin: subprocess or CLI

This dual model is required.

Reasons:

- built-ins keep the first-party path simple and testable
- subprocess plugins keep third-party extensions isolated and cheaper to integrate

### Role-Neutral Runtime Contract

Every plugin execution receives:

- role
- plugin id
- hook id
- project/session identity
- repo path context
- provider/session metadata
- opaque plugin config
- Stoa-assigned writable directories
- Stoa-readable references to prior successful runs

The plugin returns:

- success/failure status
- manifest path or inline manifest
- declared outputs
- logs and diagnostics refs

## Permission Model

### Maintainer Permissions

Maintainers may:

- read any path made available by the run context
- write only to their Stoa-assigned state/output directories
- emit refs to external read-only evidence

Maintainers may not:

- write provider instruction files directly
- modify provider configuration directly
- mutate arbitrary workspace files unless that capability is explicitly introduced in a future role

### Injector Permissions

Injectors may:

- read maintainer manifests and artifacts
- read raw evidence and session context
- write only to Stoa-declared provider injection output slots

Injectors may not:

- write to maintainer state directories
- mutate arbitrary workspace files
- overwrite provider configs outside allowed output slots

This split is deliberate.

It ensures that:

- memory maintenance remains storage-oriented
- memory injection remains delivery-oriented

## State And Filesystem Layout

Stoa owns the filesystem envelope for plugin runs.

Recommended layout:

```text
.stoa/
  memory/
    plugins/
      runs/
        <session-id>/
          <role>/
            <plugin-id>/
              <run-id>/
                manifest.json
                logs/
                outputs/
      state/
        <project-id>/
          <role>/
            <plugin-id>/
```

Rules:

- `runs/` is immutable run evidence
- `state/` is mutable plugin-private state
- plugins do not choose their own root outside the Stoa envelope
- provider-facing generated outputs are separate from plugin-private state

Recommended provider output layout:

```text
.stoa/
  generated/
    memory-context/
      <session-id>/
        <provider-type>/
          codex.md
          claude-code.md
          generic.json
```

The exact filenames are Stoa-owned delivery details, not maintainer-owned details.

## Manifest Contract

Stoa does not require a canonical memory schema.

It does require a canonical envelope.

### Maintainer Manifest

The maintainer must emit a manifest with a stable Stoa-readable shape.

Required shape:

```ts
interface MemoryMaintainerManifest {
  version: 1
  role: 'memory-maintainer'
  pluginId: string
  runId: string
  hook: string
  projectId: string
  stoaSessionId: string
  providerSessionId: string | null
  providerType: string
  repoRoot: string
  createdAt: string
  artifacts: MaintainerArtifactRef[]
  summary?: {
    text?: string
    status?: 'ok' | 'empty' | 'partial' | 'failed'
  }
  metadata?: Record<string, unknown>
}

interface MaintainerArtifactRef {
  key: string
  kind: string
  path: string
  mediaType?: string
  mutable: boolean
  description?: string
}
```

Rules:

- `artifacts` may point to files or directories
- `kind` is plugin-defined, not Stoa-standardized
- `key` must be stable within the plugin
- `mutable` tells downstream readers whether the artifact may change after run completion
- Stoa stores and surfaces the manifest but does not parse plugin-specific artifact content

### Injector Result

The injector must emit a Stoa-readable delivery result.

Required shape:

```ts
interface MemoryInjectorResult {
  version: 1
  role: 'memory-injector'
  pluginId: string
  runId: string
  hook: string
  projectId: string
  stoaSessionId: string
  providerSessionId: string | null
  providerType: string
  createdAt: string
  outputs: InjectorOutputRef[]
  metadata?: Record<string, unknown>
}

interface InjectorOutputRef {
  slot: string
  path: string
  mediaType: string
  hash: string | null
  description?: string
}
```

Rules:

- `slot` is a Stoa-known delivery slot such as `provider-context-markdown`
- injector output content remains opaque to Stoa except for hashing and file delivery
- Stoa may hash outputs for change detection and UI status

## Config Contract

Stoa understands only a generic wrapper config.

Recommended persisted shape:

```ts
interface MemoryPluginBinding {
  pluginId: string
  enabled: boolean
  hooks?: string[]
  config?: Record<string, unknown>
}

interface MemoryPluginBindings {
  maintainer: MemoryPluginBinding | null
  injector: MemoryPluginBinding | null
}
```

Rules:

- `config` is opaque to Stoa
- Stoa validates only top-level wrapper fields
- plugin-specific validation belongs to the plugin runtime
- no standardized first-class fields such as `tokenBudget` or `scope` are added at the Stoa config layer in v1

## Registry Model

Stoa needs a registry describing installed plugins.

Recommended shape:

```ts
interface RegisteredMemoryPlugin {
  id: string
  role: 'memory-maintainer' | 'memory-injector'
  execution: 'builtin' | 'subprocess'
  entry: string
  defaultHooks: string[]
  allowedExtraHooks: string[]
}
```

Rules:

- registry metadata is Stoa-owned
- plugin code does not self-register at runtime without Stoa visibility
- Stoa refuses duplicate `(role, id)` registrations

## Stoa-Owned Runtime Records

Stoa must persist runtime records for observability and orchestration.

Recommended shape:

```ts
interface MemoryPluginRunRecord {
  runId: string
  role: 'memory-maintainer' | 'memory-injector'
  pluginId: string
  hook: string
  projectId: string
  stoaSessionId: string
  providerSessionId: string | null
  status: 'running' | 'succeeded' | 'failed' | 'skipped'
  manifestPath: string | null
  outputPaths: string[]
  logPaths: string[]
  startedAt: string
  finishedAt: string | null
  error: string | null
}
```

This is orchestration state only.

It is not a canonical memory model.

## First Slice: Mapping The Current Entire + Evolver Chain

The first implementation only needs one real pair:

- maintainer: `entire-evolver-maintainer`
- injector: `evolver-published-context-injector`

### Maintainer Mapping

`entire-evolver-maintainer` owns:

- finding or selecting the relevant Entire checkpoint
- exporting checkpoint evidence from Entire
- provisioning isolated worktrees when required
- running Evolver maintenance/evolution work
- persisting native refs to the resulting assets
- emitting a manifest that points at:
  - Entire checkpoint refs
  - Evolver run refs
  - Evolver asset refs
  - plugin-private logs

This means the maintainer may internally use both Entire and Evolver.

That is acceptable because plugin internals are open.

What matters is the role boundary:

- it produces maintained memory artifacts
- it does not write provider-facing injection files directly

### Injector Mapping

`evolver-published-context-injector` owns:

- reading the latest successful maintainer manifest
- optionally reading raw Entire checkpoint refs or Evolver assets directly
- invoking Evolver's `publish-context` path or equivalent publisher logic
- writing provider-facing generated outputs into Stoa-owned output slots
- returning output hashes and refs

This plugin may still depend on Evolver internals or CLI commands.

That is allowed.

The split is by role, not by vendor.

### Why This First Slice Is Correct

This preserves the current product semantics while moving the architecture to plugin slots:

- current checkpoint/evolution logic stays intact
- current provider-facing context generation stays intact
- Stoa gains swappable slots without first inventing a universal memory schema

## Migration Of Current Direct-Memory Code

The current direct-memory implementation should be decomposed, not wrapped forever.

### Keep

- command runners
- Entire client
- Evolver client
- bridge-store-like persistent ref helpers
- worktree provisioning
- delivery hashing helpers

### Refactor

- `DirectMemoryCompletionService`
  - becomes a role-aware hook dispatcher and run coordinator
- `DirectMemoryOrchestrator`
  - stops being the permanent top-level architecture
  - becomes internal logic of the first built-in maintainer, or is split across maintainer and injector helpers
- current direct-memory types
  - should be reduced to first-party plugin-specific contracts where appropriate
  - generic plugin runtime contracts should move to a plugin-neutral location

### Remove

- any assumption that one fixed `evolveAndPublish()` pipeline is the only memory path
- any naming that treats direct-memory as synonymous with memory architecture itself

## Data Flow

### Generic Flow

```text
Stoa hook dispatcher
  -> resolve active maintainer binding
  -> execute maintainer
  -> persist manifest and run record
  -> resolve active injector binding
  -> execute injector with maintainer manifest + raw context
  -> persist output refs, hashes, and run record
```

### Entire + Evolver First-Slice Flow

```text
session.turn_completed
  -> entire-evolver-maintainer
  -> Entire checkpoint lookup/export
  -> isolated worktree if required
  -> Evolver run
  -> maintainer manifest with native refs

session.before_start / session.before_resume
  -> evolver-published-context-injector
  -> read latest successful maintainer manifest
  -> Evolver publish-context
  -> write provider-facing output
  -> session starts/resumes with generated memory context available
```

## Failure Semantics

If a maintainer fails:

- its run record is marked failed
- the previous successful maintainer manifest remains the latest consumable result
- injector execution for hooks that strictly require maintainer freshness may be skipped

If an injector fails:

- maintainer outputs remain valid
- provider-facing context delivery is marked failed
- the previous successful injector output may remain available until replaced

If an injector runs before any maintainer has ever succeeded:

- Stoa still invokes it when the hook binding requires it
- the missing-manifest condition is not treated as a Stoa runtime error by itself
- the plugin must resolve that condition through one of the allowed first-run behaviors defined above

If a plugin requests unapproved hooks:

- plugin binding resolution fails fast
- Stoa does not silently downgrade the hook list

If a plugin writes outside its allowed outputs:

- the run is failed
- Stoa treats this as a plugin boundary violation

## Testing Requirements

The architecture is not complete until it is verified through repository gates.

Minimum new coverage expected from this design:

- plugin binding resolution at project and session layers
- role-default hook dispatch
- allowlisted extra hook validation
- maintainer manifest persistence and retrieval
- injector access to maintainer manifest plus raw context
- permission boundary enforcement for both roles
- built-in and subprocess plugin execution paths
- first-party Entire + Evolver pair smoke tests

All repository quality gates still apply:

- `npm run test:generate`
- `npm run typecheck`
- `npx vitest run`
- `npm run test:e2e`
- `npm run test:behavior-coverage`

## Acceptance Criteria

- Stoa supports exactly two v1 memory plugin roles:
  - `memory-maintainer`
  - `memory-injector`
- Entire is expressible as a default implementation input source, not a framework base requirement.
- Injectors may read both maintainer outputs and raw context directly.
- Plugin binding supports `project default + session override`.
- Stoa config understanding remains wrapper-only and does not impose a canonical plugin config schema.
- Maintainers and injectors run under distinct write boundaries.
- Hooks are role-defaulted, and extra hooks are allowlisted.
- Maintainers hand off to injectors through `manifest + artifact refs`.
- Stoa supports both built-in and subprocess plugins.
- The first built-in pair reproduces the current Entire + Evolver chain across the two slots.
- No compatibility layer is added to preserve the old one-pipeline direct-memory architecture as the permanent model.

## Risks

- If the manifest envelope is too weak, injector interoperability will be poor.
- If the manifest envelope is too strong, Stoa will accidentally recreate a canonical memory schema.
- The first built-in pair may tempt the codebase to keep Entire/Evolver assumptions in generic runtime layers.
- Codex and Claude provider output surfaces can still become configuration ownership hotspots if injector slots are not kept narrow.

## Recommendation

Proceed with a thin plugin kernel and a thin first-party migration.

The correct initial architecture is:

```text
Stoa owns lifecycle, binding, runtime, envelope, and permissions.
Plugins own maintenance logic and injection logic.
Entire is one default evidence source.
Evolver is one default maintenance and publishing engine.
The first slice is just the current chain split into two plugin roles.
```

This is the smallest architecture that is both swappable and still implementable without overbuilding.
