# Entire + Evolver Memory Self-Evolution Design

日期：2026-04-26

## Purpose

This spec defines the memory self-evolution bridge for Stoa's direct-native Entire + Evolver path.

It answers four concrete questions:

- whether Entire and Evolver can be connected at the data and interface level
- whether Evolver's final output is a single memory file
- whether Evolver already has native publishing support
- how agent CLIs such as Claude Code and Codex should consume evolved memory

This document extends:

- `docs/superpowers/specs/2026-04-25-entire-evolver-direct-integration-design.md`
- `docs/superpowers/specs/2026-04-25-checkpoint-and-review-gated-evolution-design.md`

## Decision

Use the direct-native route with a small framework patch layer.

- Entire remains the checkpoint evidence source.
- Evolver remains the memory, evolution, Gene, Capsule, and GEP asset source.
- Stoa remains the orchestrator, importer, bridge-ref index, isolated worktree manager, and review surface.

Stoa must not invent:

- a checkpoint artifact format
- a memory graph format
- a Gene or Capsule schema
- a local agent-memory schema that competes with Evolver

Stoa may own agent-facing projections, but those projections are generated views over Evolver-native assets, not source-of-truth memory.

## Source Context

- `research/2026-04-26-entire-evolver-bridge-schema-fit.md`
- `research/2026-04-25-entire-evolver-direct-integration-source-research.md`
- `research/2026-04-25-evomap-evolver-research.md`
- `research/2026-04-25-entire-checkpoints-vs-evolver-pipeline.md`
- `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go`
- `research/upstreams/evolver/src/gep/paths.js`
- `research/upstreams/evolver/src/gep/assetStore.js`
- `research/upstreams/evolver/src/gep/skillPublisher.js`
- `research/upstreams/evolver/src/adapters/codex.js`
- `research/upstreams/evolver/src/adapters/claudeCode.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js`
- `research/upstreams/evolver/src/adapters/scripts/evolver-session-end.js`

## Core Model

The self-evolution loop is:

```text
agent session
  -> Entire checkpoint evidence
  -> Stoa bridge ref
  -> isolated git worktree
  -> Evolver run
  -> Evolver-native assets
  -> review gate
  -> memory publisher projection
  -> agent-native context consumption
```

The bridge is reasonable because the two native systems already have compatible anchors:

| Need | Entire side | Evolver side | Bridge stance |
|---|---|---|---|
| Source checkpoint identity | `checkpoint_id` | bridge metadata on run/event/state | patch Evolver to persist source refs |
| Provider session identity | `session_id` | session scope / bridge metadata | use provider-native session ID as external join |
| Provider type | `agent` | run metadata | pass through unchanged |
| Evidence summary | checkpoint summary / metadata | signals, run metadata | attach as source context, do not rewrite |
| Target repo | patch-defined source worktree commit anchor | `EVOLVER_REPO_ROOT` | Entire patch must expose the exact commit Stoa should check out |
| Memory assets | no ownership | `memory/evolution/*`, `assets/gep/*` | import refs only |
| Review state | no ownership | `evolution_solidify_state.json` | delegate approve/reject to Evolver |

## Is Evolver's Final Output a Memory File?

No.

For this design, Evolver's final product is a native asset set, not one memory file.

The important logical outputs are:

- `memory/evolution/memory_graph.jsonl`
- `memory/evolution/evolution_solidify_state.json`
- `assets/gep/genes.json`
- `assets/gep/capsules.json`
- `assets/gep/events.jsonl`
- `assets/gep/failed_capsules.json`
- validation and review artifacts referenced by Evolver state

When `EVOLVER_SESSION_SCOPE` is set, Evolver may place evolution and GEP assets under scoped directories such as `memory/evolution/scopes/<scope>/...` and `assets/gep/scopes/<scope>/...`. Stoa must treat these names as logical asset refs resolved through Evolver path APIs or patched JSON output, not as fixed unscoped paths.

The phrase "memory file" is therefore only valid when referring to a specific projection such as `memory_graph.jsonl`.

It is not valid as the whole output contract.

## Native Evolver Publishing Support

Evolver already has partial publishing and consumption support.

### What Exists

Evolver can convert a Gene into a `SKILL.md` document through `geneToSkillMd`.

It can publish that Skill to EvoMap Hub through `publishSkillToHub`.

It can fetch a Hub Skill through:

```bash
evolver fetch --skill <skill_id>
```

It can install hooks for agent runtimes through:

```bash
evolver setup-hooks --platform=codex
evolver setup-hooks --platform=claude-code
```

The Codex adapter writes hook config and injects a static Evolver section into `AGENTS.md`.

The Claude Code adapter writes hook config and injects a static Evolver section into `CLAUDE.md`.

The session-start hook reads recent `memory_graph.jsonl` entries and emits `agent_message` / `additionalContext`.

### What Is Missing

Evolver does not currently expose the exact local publisher Stoa needs.

The missing capability is a deterministic local command that:

- selects relevant Genes, Capsules, events, and failed memories for a given repo/session/checkpoint/task scope
- emits a bounded agent-facing context pack
- supports provider-specific targets such as Codex and Claude Code
- can output both JSON and Markdown
- carries source refs back to Entire checkpoint evidence
- avoids depending on Hub
- avoids requiring Stoa to parse Evolver internals directly

Therefore, Stoa should not build this logic by reading `genes.json` and `capsules.json` itself.

The correct bridge is a small Evolver patch that adds a local publisher command.

## Framework Patch Layer

The patch layer exists to expose stable machine interfaces from pinned upstream checkouts.

It is not a compatibility layer.

This project is in prototype phase, so the patch layer may introduce breaking command contracts and refuse unsupported versions.

### Entire Patch

Add read-only JSON commands:

```bash
entire stoa checkpoints --json
entire stoa checkpoint export <checkpoint_id> --json
```

`entire stoa checkpoints --json` returns compact checkpoint refs.

Required fields include native Entire identity fields plus patch-defined commit anchors.

The commit anchors are not existing proven `CommittedMetadata` fields in the inspected Entire source. The Entire patch must define them explicitly:

- `checkpoint_metadata_commit_sha`: commit that stores or identifies the Entire checkpoint metadata record.
- `source_worktree_commit_sha`: commit that Stoa should use as the checkout base for the isolated Evolver worktree.

Required JSON shape:

```ts
interface EntireStoaCheckpointRef {
  checkpoint_id: string
  checkpoint_format_version: 'v1'
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
  session_ids: string[]
  latest_session_id: string | null
  agent: 'claude-code' | 'codex' | 'opencode' | string
  model: string | null
  summary: string | null
  created_at: string | null
  updated_at: string | null
}
```

`entire stoa checkpoint export <checkpoint_id> --json` returns the full bridge payload.

Required JSON shape:

```ts
interface EntireStoaCheckpointExport {
  checkpoint_id: string
  checkpoint_format_version: 'v1'
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
  root_metadata_ref: string
  sessions: EntireStoaSessionExport[]
  token_usage: unknown
  combined_attribution: unknown
}

interface EntireStoaSessionExport {
  session_id: string
  agent: string
  model: string | null
  turn_id: string | null
  metadata_ref: string
  transcript_ref: string | null
  prompt_ref: string | null
  summary: string | null
  initial_attribution: unknown
}
```

Rules:

- refuse non-v1 checkpoint formats
- define and test both commit-anchor semantics in the Entire patch before Stoa treats either field as a worktree checkout source
- do not emit human text in `--json` mode
- include file refs, not copied file contents, unless the export command explicitly documents inline payload mode
- keep Entire's native names where they already exist

### Evolver Patch

Add JSON mode to existing lifecycle commands:

```bash
evolver run --json
evolver review --json
evolver review --approve --json
evolver review --reject --json
```

Add a local publisher command:

```bash
evolver publish-context --target=codex --format=markdown --json
evolver publish-context --target=claude-code --format=markdown --json
evolver publish-context --target=generic --format=json
```

Accept bridge metadata through environment variables:

```bash
STOA_PROJECT_ID=<project_id>
STOA_SESSION_ID=<local_session_id>
STOA_PROVIDER_SESSION_ID=<provider_session_id>
STOA_SOURCE_CHECKPOINT_ID=<checkpoint_id>
STOA_CHECKPOINT_METADATA_COMMIT_SHA=<checkpoint_metadata_commit_sha>
STOA_SOURCE_WORKTREE_COMMIT_SHA=<source_worktree_commit_sha>
```

Persist those refs into Evolver-native run, event, review, and publisher metadata.

Required JSON output for `evolver run --json`:

```ts
interface EvolverStoaRunResult {
  ok: boolean
  run_id: string
  repo_root: string
  memory_dir: string
  evolution_dir: string
  gep_assets_dir: string
  selected_gene_id: string | null
  signals: string[]
  mutation_id: string | null
  review_state_ref: string | null
  assets: EvolverAssetRefs
  bridge: EvolverBridgeRefs
  error: string | null
}
```

Required JSON output for `evolver review --json`:

```ts
interface EvolverStoaReviewState {
  ok: boolean
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'failed'
  run_id: string | null
  selected_gene_id: string | null
  signals: string[]
  mutation_id: string | null
  review_state_ref: string
  diff_ref: string | null
  validation_report_ref: string | null
  bridge: EvolverBridgeRefs | null
  error: string | null
}
```

Required JSON output for `evolver publish-context --json`:

```ts
interface EvolverPublishedContext {
  ok: boolean
  target: 'codex' | 'claude-code' | 'generic'
  format: 'markdown' | 'json'
  run_id: string | null
  source_checkpoint_id: string | null
  selected_assets: EvolverPublishedAssetRef[]
  content: string | object
  metadata: {
    generated_at: string
    token_budget: number | null
    selection_policy: string
  }
  bridge: EvolverBridgeRefs | null
  error: string | null
}
```

Shared bridge refs:

```ts
interface EvolverBridgeRefs {
  project_id: string
  stoa_session_id: string
  provider_session_id: string
  source_checkpoint_id: string
  checkpoint_metadata_commit_sha: string
  source_worktree_commit_sha: string | null
}

interface EvolverAssetRefs {
  genes_ref: string
  capsules_ref: string
  events_ref: string
  failed_capsules_ref: string
  memory_graph_ref: string | null
}

interface EvolverPublishedAssetRef {
  kind: 'gene' | 'capsule' | 'event' | 'failed_capsule' | 'memory_graph_entry'
  id: string
  ref: string
  score: number | null
  reason: string
}
```

Rules:

- `publish-context` reads Evolver-native assets and emits a projection
- `publish-context` does not rewrite Genes, Capsules, or events into a new canonical schema
- `--json` output is machine-only and stable
- Markdown output is for agent consumption, not for Stoa persistence
- if no relevant memory exists, return `ok: true` with empty selected assets and a short empty-context payload

## Stoa Bridge Responsibilities

Stoa owns a thin join index.

```ts
interface MemoryEvolutionBridgeRef {
  projectId: string
  stoaSessionId: string
  providerSessionId: string
  providerType: 'claude-code' | 'codex' | 'opencode'
  repoRoot: string

  entireCheckpointId: string
  entireCheckpointMetadataCommitSha: string
  entireSourceWorktreeCommitSha: string | null

  evolverRunId: string | null
  evolverWorktreePath: string | null
  evolverMemoryDir: string | null
  evolverEvolutionDir: string | null
  evolverGepAssetsDir: string | null
  evolverReviewStateRef: string | null

  lastPublishedContextTarget: 'codex' | 'claude-code' | 'generic' | null
  lastPublishedContextHash: string | null
  createdAt: string
  updatedAt: string
}
```

This is not a memory schema.

It is an index over native refs.

Stoa may persist:

- project/session/provider joins
- checkpoint refs
- Evolver run refs
- worktree paths
- import cursors
- last published context hash
- UI annotations keyed by native refs

Stoa must not persist:

- copied checkpoint transcripts as a canonical store
- copied Genes as Stoa-owned Genes
- copied Capsules as Stoa-owned Capsules
- a second memory graph
- a Stoa-native skill marketplace object

## Agent Consumption Model

Agents should consume a published context projection.

They should not consume Evolver's raw asset set directly.

Raw assets are too broad and provider-agnostic:

- `genes.json` is source memory, not prompt-ready context
- `capsules.json` is experience evidence, not always task-relevant instruction
- `events.jsonl` is chronological history, not a bounded working set
- `failed_capsules.json` is useful but must be selected carefully to avoid drowning current task context

The publisher decides what to include for the current scope.

### Codex Consumption

Preferred direct-mode path:

```text
Stoa
  -> evolver publish-context --target=codex --format=markdown --json
  -> write Codex-scoped generated context
  -> Codex reads it through an AGENTS.md reference or a patched hook path
```

Current Evolver hooks prove only generic recent-memory injection: `evolver-session-start.js` reads `MEMORY_GRAPH_PATH` when set, otherwise it reads a fixed Evolver-root `memory/evolution/memory_graph.jsonl`, and then emits `agent_message` / `additionalContext`.

They do not yet prove scoped `publish-context` delivery.

Therefore, the first implementation should prefer a generated reference file. Hook-provided scoped context becomes valid only after one of these is implemented:

- Stoa sets `MEMORY_GRAPH_PATH` to the intended published/scoped memory graph input for that session.
- Evolver's hook is patched to call `publish-context` directly and return its content as `additionalContext`.

If file-based consumption is used, write a generated file under a Stoa-managed path and reference it from the provider-owned instruction surface.

Acceptable file shape:

```text
.stoa/generated/evolver-context/codex.md
```

The generated file is disposable projection output.

It is not source memory.

### Claude Code Consumption

Preferred path:

```text
Stoa
  -> evolver publish-context --target=claude-code --format=markdown --json
  -> write Claude-scoped generated context
  -> Claude Code reads it through a CLAUDE.md reference or a patched hook path
```

If file-based consumption is used:

```text
.stoa/generated/evolver-context/claude-code.md
```

Claude's root `CLAUDE.md` should not become a large regenerated memory dump.

It should contain a stable instruction or include/reference strategy when the provider supports one.

### Generic CLI Consumption

For providers without native hook or instruction-file integration, Stoa can pass the published context as:

- a prompt prefix for the launched session
- a provider-specific sidecar message
- a local file path shown to the agent runtime

The generic contract comes from:

```bash
evolver publish-context --target=generic --format=json
```

## Data Flow

### 1. Capture

Stoa launches an agent session with direct mode enabled.

Entire records native checkpoint evidence for the provider session.

Stoa imports checkpoint refs through:

```bash
entire stoa checkpoints --json
entire stoa checkpoint export <checkpoint_id> --json
```

### 2. Evolve

Stoa creates an isolated git worktree from `source_worktree_commit_sha`, the patch-defined checkout anchor exported by Entire.

Stoa launches Evolver with explicit path controls:

```bash
EVOLVER_REPO_ROOT=<isolated_worktree>
MEMORY_DIR=<stoa_managed_run_memory_dir>
EVOLUTION_DIR=<stoa_managed_run_evolution_dir>
GEP_ASSETS_DIR=<stoa_managed_run_assets_dir>
EVOLVER_SESSION_SCOPE=<provider_session_id>
STOA_PROJECT_ID=<project_id>
STOA_SESSION_ID=<local_session_id>
STOA_PROVIDER_SESSION_ID=<provider_session_id>
STOA_SOURCE_CHECKPOINT_ID=<checkpoint_id>
STOA_CHECKPOINT_METADATA_COMMIT_SHA=<checkpoint_metadata_commit_sha>
STOA_SOURCE_WORKTREE_COMMIT_SHA=<source_worktree_commit_sha>
evolver run --json
```

### 3. Review

Stoa reads pending review state:

```bash
evolver review --json
```

Approve delegates to:

```bash
evolver review --approve --json
```

Reject delegates to:

```bash
evolver review --reject --json
```

Stoa imports resulting refs and statuses.

It does not implement a replacement rollback or solidify path.

### 4. Publish

After a successful run or approved review, Stoa asks Evolver to publish a provider-specific context projection:

```bash
evolver publish-context --target=codex --format=markdown --json
```

Stoa stores the content hash and delivery status.

Stoa does not store the published Markdown as source memory.

### 5. Consume

Agent runtime receives the published projection through its native surface:

- Codex: generated context file referenced from `AGENTS.md`, or hook `additionalContext` after the hook is patched/configured for scoped publisher output
- Claude Code: generated context file referenced from `CLAUDE.md`, or hook `additionalContext` after the hook is patched/configured for scoped publisher output
- generic: prompt prefix, sidecar context, or generated file path

## Interface Semantics

### Source of Truth

| Domain | Source of truth | Stoa role |
|---|---|---|
| Checkpoint transcript | Entire | import ref |
| Checkpoint metadata | Entire | import ref |
| Attribution | Entire | render projection |
| Token usage | Entire | render projection |
| Evolution run | Evolver | import ref |
| Gene | Evolver | import ref |
| Capsule | Evolver | import ref |
| Event | Evolver | import ref |
| Failed memory | Evolver | import ref |
| Review state | Evolver | import ref and delegate commands |
| Published agent context | Evolver publisher | deliver projection |
| Project/session/worktree join | Stoa | own |
| Local UI annotations | Stoa | own |

### Identity

Direct mode uses provider-native session ID as the external join.

Stoa local session ID remains local:

- runtime routing
- PTY ownership
- local state lookup
- webhook auth

Provider session ID joins:

- Entire checkpoint metadata
- Evolver session scope
- Stoa bridge refs
- published context metadata

### Failure Semantics

If Entire export fails:

- Stoa marks the bridge ref as checkpoint-import failed
- no Evolver run starts

If Evolver run fails:

- Stoa imports failure refs when available
- failed capsules remain Evolver-native memory
- Stoa does not discard failed attempts

If publish-context fails:

- Stoa keeps the Evolver run/review refs
- agent context delivery is marked failed
- source memory is not modified by Stoa

If no relevant memory is selected:

- publisher returns success with an empty or minimal context projection
- Stoa records delivery as successful with zero selected assets

## Non-Goals

- no Stoa-native checkpoint format
- no Stoa-native memory graph
- no Stoa-native Gene or Capsule schema
- no Stoa parsing of Evolver obfuscated internals
- no Hub dependency for local agent consumption
- no automatic mutation of the active workspace
- no direct approve/reject implementation inside Stoa
- no compatibility path for older bridge contracts

## Implementation Phases

### Phase 0: Pin and Patch Contracts

Deliverables:

- pin Entire fork/checkouts for checkpoint v1
- pin Evolver fork/checkouts
- add Entire `stoa` JSON export commands
- add Evolver JSON lifecycle output
- add Evolver bridge metadata persistence
- add Evolver `publish-context`
- add contract tests around JSON shape in the patched upstreams

### Phase 1: Stoa Backend Bridge

Deliverables:

- direct-mode bridge ref persistence
- Entire checkpoint import command runner
- isolated worktree provisioning
- Evolver command runner
- native asset ref import
- publish-context command runner
- no renderer changes yet

### Phase 2: Agent Context Delivery

Deliverables:

- Codex context delivery through generated reference file first; hook delivery only after scoped publisher integration is patched/configured
- Claude Code context delivery through generated reference file first; hook delivery only after scoped publisher integration is patched/configured
- generic context delivery path
- delivery status stored by hash and target

### Phase 3: Review Surface

Deliverables:

- render checkpoint source refs
- render Evolver run/review refs
- render selected published assets and reasons
- approve/reject buttons delegate to Evolver commands

UI work in this phase must follow `docs/engineering/design-language.md`.

## Acceptance Criteria

- Entire is the only checkpoint evidence source.
- Evolver is the only memory and GEP asset source.
- Stoa persists refs, joins, cursors, delivery hashes, and annotations only.
- Evolver output is treated as an asset set, not a single memory file.
- Agent-facing memory is a projection generated by Evolver's publisher.
- Codex and Claude Code consume generated context through their native instruction or hook surfaces.
- `publish-context` works offline and does not require EvoMap Hub.
- JSON command output is machine-only and stable.
- Unsupported checkpoint or bridge versions are refused.
- Evolver approve/reject remains delegated to Evolver.
- Evolver runs occur only in isolated git worktrees.

## Risks

- Entire's checkpoint v2 work may change export boundaries; direct mode must pin or refuse unsupported formats.
- Codex has provider-config ownership risk because Stoa, Entire, and Evolver can all want `.codex/hooks.json`.
- Evolver's current publisher is Hub/Skill oriented, so local context publishing requires an upstream/fork patch.
- Selecting too much memory can degrade agent performance; publisher selection needs a token budget and reason field.
- Failed memory can be useful but harmful if injected without scope; failed capsules must be selected by relevance.

## Recommendation

Proceed with a patched-native publisher, not a Stoa-owned memory compiler.

The clean contract is:

```text
Entire exports checkpoint evidence refs.
Stoa joins refs and runs isolated orchestration.
Evolver evolves and publishes scoped context.
Agent CLIs consume provider-native projections.
```

This keeps data format and interface semantics aligned with the systems that already own the domain logic.
