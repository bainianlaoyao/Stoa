# Entire + Evolver Direct Integration Design

Date: 2026-04-25

## Purpose

This addendum defines the direct framework integration path for Stoa.

It answers the user's explicit constraint:

- use Entire and Evolver directly
- allow thin bridge code
- do not write large amounts of Stoa-owned replacement logic
- cloning and small upstream modifications are acceptable

This document is an addendum to `docs/superpowers/specs/2026-04-25-checkpoint-and-review-gated-evolution-design.md`.

That earlier spec describes a Stoa-native substrate. This document narrows the preferred path for option 3: direct framework integration.

## Decision

For direct mode:

- Entire remains the primary checkpoint engine.
- Evolver remains the primary evolution engine.
- Stoa is a thin orchestrator, importer, reviewer, and approver.

Stoa must not become a second Entire or a second Evolver.

## Source Context

- `research/2026-04-25-entire-evolver-direct-integration-source-research.md`
- `research/2026-04-25-entire-library-research.md`
- `research/2026-04-25-evomap-evolver-research.md`
- `research/2026-04-25-entire-checkpoints-vs-evolver-pipeline.md`
- `docs/superpowers/specs/2026-04-25-checkpoint-and-review-gated-evolution-design.md`
- `docs/architecture/hook-signal-chain.md`
- `docs/architecture/session-id-reconciliation.md`
- `src/extensions/providers/claude-code-provider.ts`
- `src/extensions/providers/codex-provider.ts`
- `src/extensions/providers/opencode-provider.ts`
- `AGENTS.md`

## What This Addendum Changes

The earlier substrate spec allowed Stoa-native checkpoint and evolution storage.

Direct mode removes that latitude for the initial implementation:

- no Stoa-owned checkpoint artifact format
- no Stoa-owned transcript-normalization format
- no Stoa-owned line-attribution algorithm
- no Stoa-owned evolution event schema
- no Stoa-owned validation report schema
- no Stoa-owned memory graph

Stoa still owns:

- project/session/worktree mapping
- import cursors and native-ref indexes
- local operator annotations keyed by native refs
- approve/reject command dispatch
- renderer projections over imported native artifacts

## Direct Mode Scope

### Git Only

Direct mode is git-only.

This is a breaking design choice and is intentional.

The earlier broader substrate spec supported non-git workspaces. That is not the direct framework path.

Reasons:

- Entire committed checkpoints live on a git branch.
- Entire temporary checkpoints live on git shadow branches.
- Evolver requires git and uses git for blast radius, review, and rollback.

Stoa must reject enabling direct mode for a project path that is not inside a git worktree.

When a project path points at a nested folder inside a repository, direct mode must resolve and persist the actual git repo root separately.

### Provider Scope

Initial direct-mode provider scope is the intersection of:

- providers Stoa already launches
- providers Entire already supports with built-in agents

That gives:

- Claude Code
- Codex
- OpenCode

Practical release gate:

- Codex and OpenCode are mandatory for the first end-to-end direct-mode slice.
- Claude Code is allowed in the target design, but should not be called complete until it has at least one real Stoa -> provider -> Entire -> Stoa smoke run.

### Version Scope

Entire must be pinned to checkpoint v1 initially.

Reasons:

- Entire changelog explicitly marks v2 as work in progress.
- `full.jsonl` is already being renamed to `raw_transcript`.
- importing moving native storage without version gating is a design error.

Direct mode therefore requires one of:

1. pinning Entire to a known v1-compatible release
2. explicitly configuring Entire to stay on v1
3. refusing startup when the checkpoint version is not v1

Evolver should be run from a pinned checkout or pinned release as well, but the stronger reason there is behavior stability plus GPL/process-boundary hygiene rather than a storage-version branch split.

## Architecture

### Core Thesis

The direct-mode architecture is:

```text
Stoa
  -> launches provider sessions in project repo
  -> coexists with Entire hook/plugin installation
  -> imports Entire checkpoint refs and metadata
  -> provisions isolated git worktrees for candidate evolution
  -> launches Evolver as a separate process against those worktrees
  -> imports Evolver native assets and review state
  -> exposes approve/reject controls in Stoa UI
  -> delegates actual solidify / rollback behavior back to Evolver
```

### Ownership Table

| Domain | Source of truth | Stoa role |
|---|---|---|
| Checkpoint transcript | Entire | import refs only |
| Checkpoint metadata | Entire | import refs only |
| Line attribution | Entire | display only |
| Token usage inside checkpoint | Entire | display only |
| Evolution events | Evolver | import refs only |
| Review state | Evolver | import refs only |
| Memory graph | Evolver | display only |
| Validation report | Evolver | display only |
| Failed capsule memory | Evolver | display only |
| Project/session mapping | Stoa | own |
| Native ref indexes | Stoa | own |
| Worktree lifecycle | Stoa | own |
| Local operator annotations | Stoa | own |
| Approve/reject command dispatch | Stoa | own |

## Join Model

### Repository Join

The top-level join is the git repository root.

Every direct-mode record must be anchored to:

- Stoa project
- repo root
- active branch / commit
- optional isolated worktree path

### Session Join

Direct mode intentionally keeps two IDs:

- Stoa local session ID:
  - primary key for local runtime routing, PTY ownership, webhook auth, and persisted Stoa session state
- provider-native session ID:
  - external join key for Entire checkpoints, Entire lifecycle events, provider resume, and imported framework refs

Direct mode does not require a whole-stack replacement of Stoa's internal session primary key.

What it requires is narrower:

- Stoa must stop pretending its local session ID is the cross-system join key
- Stoa must persist the provider-native session ID as the canonical external join key for direct mode

The intended alignment is:

- Stoa `externalSessionId`
- Entire `CommittedMetadata.session_id`
- Entire `Event.SessionID`
- provider-native `session_id`

For the inspected Entire agents, this alignment already exists for Claude Code, Codex, and OpenCode.

### Codex Breaking Change

Current Stoa Codex integration still normalizes `thread_id` / `thread-id`.

Current Stoa Codex resume/discovery flow also uses a discovered external ID from Codex session files.

Direct mode must not declare the Codex hook `session_id` canonical until the pinned Codex build proves these IDs are the same identity family:

- hook payload `session_id`
- Codex session-file `meta.id`
- the resume ID accepted by `codex resume <id>`

After that proof exists, direct mode standardizes the stored external join key on provider `session_id`, because that is what Entire records.

Direct mode does not carry a dual-field compatibility path for `thread_id` / `thread-id`.

If the pinned Codex build does not prove identity equivalence, Codex direct mode is blocked pending upstream clarification or patching.

### Checkpoint and Evolution Join

Stoa should not derive meaning from diffs alone.

Instead it should persist explicit refs:

```ts
interface DirectFrameworkRefs {
  projectId: string
  stoaSessionId: string
  providerSessionId: string
  repoRoot: string
  providerType: 'claude-code' | 'codex' | 'opencode'

  entireCheckpointId: string | null
  entireCheckpointCommitSha: string | null
  entireSessionRef: string | null

  evolverRunId: string | null
  evolverRepoRoot: string | null
  evolverWorktreePath: string | null
  evolverEvolutionDir: string | null
  evolverAssetsDir: string | null

  createdAt: string
  updatedAt: string
}
```

These refs are allowed Stoa-owned state because they are indexes and joins, not replacement domain models.

These refs must be persisted in Stoa state as a thin join index.

### Checkpoint-to-Evolver Bridge

The concrete bridge between Entire and Evolver is an imported commit anchor, not a Stoa snapshot format.

The direct path is:

1. Stoa selects an Entire checkpoint by `checkpoint_id` and imported commit SHA
2. Stoa creates an isolated evolution worktree from that imported commit anchor
3. Stoa launches Evolver against that worktree
4. Stoa imports native Evolver assets keyed back to the source checkpoint ref and provider session ID
5. approve/reject stays delegated to Evolver native review commands

Direct mode does not invent an intermediate Stoa checkpoint artifact between Entire and Evolver.

## Entire Integration

### Import Rule

Stoa imports Entire native artifacts.

Stoa does not copy them into a `.stoa/checkpoints` format and does not rewrite them into a Stoa-native checkpoint store.

### What Stoa Reads From Entire

At minimum:

- checkpoint ID
- commit SHA
- per-session `metadata.json`
- root `metadata.json`
- transcript file path ref
- prompt file path ref
- `initial_attribution`
- token usage
- summary

### What Stoa Must Not Rebuild

Direct mode forbids Stoa from rebuilding:

- `CommittedMetadata`
- `CheckpointSummary`
- `InitialAttribution`
- transcript chunking / reassembly
- checkpoint branch layout
- checkpoint condensation semantics

### Hook / Plugin Composition

Direct mode uses Entire's native agent integrations rather than replacing them.

Provider-specific implications:

- Claude Code:
  - Stoa currently writes `.claude/settings.local.json`
  - Entire writes `.claude/settings.json`
  - these can coexist
  - this avoids a direct collision with Entire, but Stoa still rewrites its own local file
  - Stoa should not try to subsume Entire's Claude hook manager

- OpenCode:
  - Stoa writes `.opencode/plugins/stoa-status.ts`
  - Entire writes `.opencode/plugins/entire.ts`
  - these naturally coexist

- Codex:
  - Stoa currently overwrites `.codex/config.toml` and `.codex/hooks.json`
  - Stoa also generates `.codex/notify-stoa.mjs` and `.codex/hook-stoa.mjs`
  - Entire also manages `.codex/hooks.json` and mutates `.codex/config.toml`
  - direct mode cannot keep Stoa's current overwrite/install pattern
  - this is the only serious provider-config collision with Entire in the initial scope

### Codex Resolution

For Codex direct mode, the preferred choices are:

1. preferred initial path:
   - Entire owns `.codex/hooks.json` and `.codex/config.toml`
   - Stoa disables its Codex sidecar installer in direct mode
2. if live Codex signals are later required:
   - prefer a small upstream Entire patch or shared helper so Stoa composes through Entire's merge/install path
3. only if upstream composition is unavailable:
   - Stoa may add its own composition logic, but it must cover both `.codex/hooks.json` and `.codex/config.toml`
   - and it must reuse Entire's semantics rather than inventing a second incompatible merger

The critical rules are:

- Stoa must not overwrite `.codex/config.toml` in direct mode
- Stoa must not overwrite `.codex/hooks.json` in direct mode
- Stoa must not require the legacy notify/thread-id sidecar path as a direct-mode prerequisite

### Provider Install Policy Gate

Current Stoa always calls `installSidecar()` on provider start.

Direct mode needs an explicit provider-installation policy gate before implementation starts.

Equivalent policies are acceptable as long as Stoa can express at least:

- Stoa-managed install
- Entire-managed install
- compose-with-Entire install
- disabled

Without this gate, direct mode cannot safely coexist with Entire.

## Evolver Integration

### Process Boundary

Evolver remains a separate process.

Stoa does not import Evolver internals as an application library.

Reasons:

- Evolver is GPL-3.0-or-later
- the published repo is increasingly optimized for CLI/process usage
- several GEP core files are obfuscated in current releases
- process-boundary integration is the lowest-custom-logic path

### Checkout / Fork Rule

It is acceptable and preferred to keep a pinned Evolver checkout or fork in the workspace.

Examples:

- `research/upstreams/evolver`
- a project-local patched fork
- a pinned external install

This fits the user requirement:

- clone upstream freely
- inspect source directly
- patch upstream locally if a small patch avoids large Stoa-side bridge logic

### Execution Topology

Stoa should launch Evolver against an isolated worktree, not the active workspace.

Recommended pattern:

```text
main repo
  -> current human/agent workspace
  -> Entire checkpoints recorded here

isolated evolution worktree
  -> checked out from a selected commit or checkpoint anchor
  -> Evolver run happens here
  -> rollback / reject is confined here
```

### Required Evolver Env / Path Control

Stoa should use Evolver's existing env-based path controls instead of inventing a wrapper storage model.

Useful controls already present in Evolver:

- `EVOLVER_REPO_ROOT`
- `EVOLUTION_DIR`
- `GEP_ASSETS_DIR`
- `EVOLVER_SESSION_SCOPE`

This lets Stoa isolate:

- the repo target
- the evolution state dir
- the GEP asset dir
- per-run or per-session scopes

### Review Flow

Direct mode should use Evolver's native review flow:

- `evolver --review` / `evolver review`
- `evolver review --approve`
- `evolver review --reject`

Stoa may present richer UI around this flow, but must not replace the underlying review state machine with a Stoa-native one.

That means:

- Stoa can render diff, validation summary, blast radius estimate, gene, and signals
- Stoa can store UI annotations keyed by run ID
- Stoa should still delegate approve/reject execution to Evolver commands

### Rollback Rule

Because Evolver's default rollback is destructive, direct mode must never run Evolver review or solidify against the active workspace.

The isolated worktree boundary is mandatory, not optional.

## Stoa-Owned Bridge Logic

The allowed bridge surface is intentionally narrow.

### Allowed

- import cursors for Entire checkpoint refs
- import cursors for Evolver asset/event refs
- repo/project/session/worktree mapping
- provider session join refs
- isolated worktree provisioning
- env var injection for Evolver path control
- thin command orchestration for `entire` and `evolver`
- provider installation policy gating
- UI-level annotations keyed by native refs
- read models that index native Entire/Evolver artifacts for the renderer
- small upstream patches when that is cheaper and cleaner than new Stoa-side logic

### Forbidden

- reimplementing Entire checkpoint storage layout
- reimplementing Entire transcript normalization
- reimplementing Entire attribution
- reimplementing Entire checkpoint summary generation
- reimplementing Evolver selector / mutation / memory graph / validation pipelines
- defining a second Stoa-native evolution event schema that competes with Evolver
- implementing custom Stoa rollback semantics for Evolver failures
- copying Entire or Evolver native artifacts into a parallel Stoa canonical store

## UI and Product Surface

### Stoa UI Role

Stoa remains a desktop orchestration and review surface.

It is not integrating Entire's hosted web platform.

The direct-mode UI should therefore behave as:

- a local shell for live sessions
- a local review surface for imported Entire checkpoints
- a local review surface for pending Evolver runs

### Renderer Rule

Renderer contracts may project imported native artifacts into typed UI data.

That is allowed.

But those renderer contracts must remain projections over imported refs, not silent replacement domain models.

## Implementation Phases

### Phase 0: Pin and Smoke

Deliverables:

- pin Entire v1-compatible version
- pin Evolver checkout or release
- add provider installation policy gating for direct mode
- reject non-git project paths for direct mode
- resolve and persist git repo root for direct-mode joins
- persist `DirectFrameworkRefs`
- prove one Codex identity smoke showing hook `session_id`, session-file `meta.id`, and resume ID are the same identifier on the pinned build
- codify direct-mode provider scope
- prove one manual smoke for Codex and one for OpenCode

No broad Stoa UI work yet.

### Phase 1: Entire Direct Import

Deliverables:

- read Entire native checkpoint refs
- map provider session ID to Entire session ID
- render imported checkpoint metadata, summary, attribution, and transcript refs
- keep Stoa from rewriting provider config in ways that destroy Entire hooks/plugins

### Phase 2: Codex Direct-Mode Cleanup

Deliverables:

- direct mode disables Codex overwrite-style installer behavior
- direct mode no longer requires the legacy notify/thread-id path
- if live Codex runtime signals are needed, they compose through Entire-owned or upstream-patched install logic
- standardize stored Codex external join refs on provider `session_id` after the pinned-build identity proof

### Phase 3: Evolver Runner Boundary

Deliverables:

- isolated worktree provisioning
- Evolver process launch with explicit repo/state/asset paths
- import of native validation report, event refs, memory graph refs, and pending review state

### Phase 4: Review-Gated Evolution

Deliverables:

- Stoa approve action delegates to Evolver approve path
- Stoa reject action delegates to Evolver reject path
- imported review status shows accepted / rejected / failed / pending

## Acceptance Criteria

- Entire remains the source of truth for checkpoint transcript, checkpoint metadata, and attribution.
- Evolver remains the source of truth for evolution events, review state, validation reports, and memory graph.
- Stoa stores only refs, joins, imported status projections, local annotations, and orchestration state for direct mode.
- Direct mode is git-only.
- Direct mode is rejected for project paths outside git worktrees.
- Entire is pinned to checkpoint v1 initially.
- Evolver runs only against isolated git worktrees, never the active workspace.
- Stoa local session IDs remain local routing/auth/runtime keys, while provider session IDs are the canonical external join keys.
- Codex direct mode no longer depends on the legacy notify/thread-id path as its canonical join model or required installer.
- Codex direct mode does not overwrite `.codex/config.toml` or `.codex/hooks.json`.
- Claude direct mode does not overwrite Entire's `.claude/settings.json`.
- OpenCode direct mode continues to coexist through separate plugin files.
- No Stoa implementation work introduces a parallel checkpoint or evolution storage model.

## Risks

- Entire checkpoint v2 and later may force importer changes.
- Codex is the hardest initial provider because its direct-mode proof depends on ID-family verification plus `.codex/config.toml` and `.codex/hooks.json` ownership cleanup.
- Evolver GPL means bundling or linking needs stricter review than subprocess orchestration.
- Evolver failure-retention semantics still need a live verification pass on the pinned version.
- Entire Codex integration still has limitations around subagent/task visibility compared with agents that expose richer task hooks.

## Recommendation

Proceed with direct mode only under this boundary:

- Entire and Evolver stay primary
- Stoa stays thin
- Codex hook ownership is fixed before implementation
- isolated worktrees are mandatory

If any requirement pressures Stoa to rebuild Entire or Evolver internals, that requirement should be rejected or pushed upstream rather than implemented locally.
