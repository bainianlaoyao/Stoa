---
date: 2026-04-28
topic: Task 7 direct-memory migration
status: completed
mode: context-gathering
sources: 11
---

## Context Report: Task 7 Direct-Memory Migration

### Why This Was Gathered
Bounded repo inspection for Task 7 prep: identify which existing direct-memory contracts and tests should survive into the new memory runtime, and which Entire-specific fields should be removed.

### Summary
The contracts worth preserving live in the Evolver run/review/publish path, not in the Entire bridge path. `src/shared/direct-memory.ts` still defines both the useful machine-facing Evolver JSON shapes and stale Entire-era provenance/index types; Task 7 should keep the run/review/publish result shapes that are still consumed by helpers, but replace Entire-derived checkpoint provenance with runtime/session provenance from `src/shared/memory-runtime.ts`.

### Key Findings
- Preserve the generic JSON command runner behavior and its error surface from `src/core/direct-memory/command-runner.ts`. It is the base abstraction both `EntireClient` and `EvolverClient` rely on today. Source: `src/core/direct-memory/command-runner.ts:10`, `src/core/direct-memory/command-runner.ts:19`, `src/core/direct-memory/command-runner.ts:51`.
- Preserve the Evolver command contract from `src/core/direct-memory/evolver-client.ts`: `run`, `review`, `review --approve`, and `review --reject`, plus the repo/path env wiring. Source: `src/core/direct-memory/evolver-client.ts:22`, `src/core/direct-memory/evolver-client.ts:44`, `src/core/direct-memory/evolver-client.ts:66`.
- Preserve publish helper behavior from `src/core/direct-memory/published-context-builder.ts`: provider-target JSONL hook projection, generic fallback to `memory_graph`, source ref normalization, and “only include refs that exist” behavior. Source: `src/core/direct-memory/published-context-builder.ts:20`, `src/core/direct-memory/published-context-builder.ts:42`, `src/core/direct-memory/published-context-builder.ts:117`, `src/core/direct-memory/published-context-builder.ts:220`.
- Preserve publish delivery behavior from `src/core/direct-memory/context-delivery.ts`: target-based file naming, SHA-256 hash output, and Claude managed-block refresh. Source: `src/core/direct-memory/context-delivery.ts:14`, `src/core/direct-memory/context-delivery.ts:18`, `src/core/direct-memory/context-delivery.ts:35`, `src/core/direct-memory/context-delivery.ts:88`.
- Entire checkpoint contracts are now legacy input shapes. `EntireStoaCheckpointRef`, `EntireStoaCheckpointExport`, `EntireStoaSessionExport`, and `EntireClient` exist only to talk to the removed Entire bridge. Source: `src/shared/direct-memory.ts:7`, `src/shared/direct-memory.ts:21`, `src/shared/direct-memory.ts:32`, `src/core/direct-memory/entire-client.ts:27`.
- Entire-derived provenance is already considered stale in the new runtime store. The new persisted runtime record replaces by `(projectId, stoaSessionId)` and explicitly verifies that `entireCheckpointId` is absent. Source: `src/shared/memory-runtime.ts:55`, `src/core/memory/runtime-state-store.test.ts:100`, `src/core/memory/runtime-state-store.test.ts:129`.

### Answers

#### 1. Files that currently define the run/review/publish JSON contracts and helper behavior

Keep or port behavior from these files:

- `src/shared/direct-memory.ts`
  - Evolver run/review/publish JSON shapes:
    - `EvolverBridgeRefs` at `src/shared/direct-memory.ts:46`
    - `EvolverArtifactRefs` at `src/shared/direct-memory.ts:55`
    - `EvolverStoaRunResult` at `src/shared/direct-memory.ts:70`
    - `EvolverStoaReviewState` at `src/shared/direct-memory.ts:87`
    - `PublishedContextSourceRef` at `src/shared/direct-memory.ts:101`
    - `EvolverPublishedContext` at `src/shared/direct-memory.ts:119`
- `src/core/direct-memory/command-runner.ts`
  - JSON process execution, parse rules, and `JsonCommandError`: `src/core/direct-memory/command-runner.ts:10`, `src/core/direct-memory/command-runner.ts:19`, `src/core/direct-memory/command-runner.ts:51`
- `src/core/direct-memory/evolver-client.ts`
  - Evolver CLI commands and env mapping: `src/core/direct-memory/evolver-client.ts:22`, `src/core/direct-memory/evolver-client.ts:44`, `src/core/direct-memory/evolver-client.ts:66`
- `src/core/direct-memory/published-context-builder.ts`
  - Published JSONL creation and source ref assembly: `src/core/direct-memory/published-context-builder.ts:20`, `src/core/direct-memory/published-context-builder.ts:53`, `src/core/direct-memory/published-context-builder.ts:117`
- `src/core/direct-memory/context-delivery.ts`
  - Writing generated context artifacts, hash calculation, and Claude companion file management: `src/core/direct-memory/context-delivery.ts:18`, `src/core/direct-memory/context-delivery.ts:35`, `src/core/direct-memory/context-delivery.ts:46`, `src/core/direct-memory/context-delivery.ts:88`

Legacy-only and likely replace/remove:

- `src/core/direct-memory/entire-client.ts` and the Entire checkpoint interfaces in `src/shared/direct-memory.ts:7-44`

#### 2. Exact types/fields still needed vs stale after Entire removal

Still needed for Task 7 machine interfaces:

- `EvolverStoaRunResult`
  - Keep: `ok`, `run_id`, `repo_root`, `memory_dir`, `evolution_dir`, `gep_assets_dir`, `session_scope`, `selected_gene_id`, `signals`, `review_status`, `exit_code`, `artifact_refs`, `error`
  - Source: `src/shared/direct-memory.ts:70`
- `EvolverArtifactRefs`
  - Definitely still used by current publish helpers: `review_state_ref`, `genes_ref`, `capsules_ref`, `events_ref`, `failed_capsules_ref`, `memory_graph_ref`, `stdout_ref`, `stderr_ref`
  - Source use: `src/core/direct-memory/published-context-builder.ts:158`, `src/core/direct-memory/published-context-builder.ts:167`, `src/core/direct-memory/published-context-builder.ts:174`, `src/core/direct-memory/published-context-builder.ts:181`, `src/core/direct-memory/published-context-builder.ts:188`, `src/core/direct-memory/published-context-builder.ts:195`, `src/core/direct-memory/published-context-builder.ts:202`, `src/core/direct-memory/published-context-builder.ts:209`
- `EvolverStoaReviewState`
  - Keep: `ok`, `status`, `run_id`, `selected_gene_id`, `signals`, `mutation_id`, `review_state_ref`, `diff_ref`, `validation_report_ref`, `error`
  - Source: `src/shared/direct-memory.ts:87`
- `PublishedContextTarget`, `PublishedContextFormat`, `PublishedContextSourceRef`, `EvolverPublishedContext`
  - Keep for publish/delivery flow, especially `target`, `format`, `run_id`, `source_refs`, `content`, `metadata.generated_at`, `metadata.token_budget`, `metadata.selection_policy`, `error`
  - Source: `src/shared/direct-memory.ts:3`, `src/shared/direct-memory.ts:5`, `src/shared/direct-memory.ts:101`, `src/shared/direct-memory.ts:119`
- Slimmed run invocation identity
  - Still needed conceptually: `project_id`, `stoa_session_id`, `provider_session_id`
  - Current source is `EvolverBridgeRefs`, but only these three fields are runtime-native. Source: `src/shared/direct-memory.ts:46`
- New runtime persistence replacements already exist
  - `MemoryRunRecord`: `projectId`, `stoaSessionId`, `runId`, `worktreePath`, `memoryDir`, `evolutionDir`, `gepAssetsDir`, `reviewStateRef`, `updatedAt`
  - `PublishedMemoryRecord`: `projectId`, `stoaSessionId`, `consumer`, `deliveryState`, `runId`, `publishedHash`, `updatedAt`
  - Source: `src/shared/memory-runtime.ts:55`, `src/shared/memory-runtime.ts:67`

Stale because Entire was removed:

- Entire bridge types
  - `EntireStoaCheckpointRef`, `EntireStoaCheckpointExport`, `EntireStoaSessionExport`
  - Source: `src/shared/direct-memory.ts:7`, `src/shared/direct-memory.ts:21`, `src/shared/direct-memory.ts:32`
- Entire client
  - `EntireClient` and default Entire bridge binary resolution
  - Source: `src/core/direct-memory/entire-client.ts:19`, `src/core/direct-memory/entire-client.ts:27`
- Entire-derived fields inside `EvolverBridgeRefs`
  - `source_checkpoint_id`
  - `checkpoint_metadata_commit_sha`
  - `source_worktree_commit_sha`
  - Source: `src/shared/direct-memory.ts:50`
- Entire-derived env vars in `EvolverClient.run`
  - `STOA_SOURCE_CHECKPOINT_ID`
  - `STOA_CHECKPOINT_METADATA_COMMIT_SHA`
  - `STOA_SOURCE_WORKTREE_COMMIT_SHA`
  - Source: `src/core/direct-memory/evolver-client.ts:59`
- Entire-derived fields inside `EvolverPublishedContext`
  - `source_checkpoint_id`
  - likely `bridge` if it continues to carry Entire provenance instead of session/runtime provenance
  - Source: `src/shared/direct-memory.ts:123`, `src/shared/direct-memory.ts:132`
- `MemoryEvolutionBridgeRef` as a whole is stale in current form
  - Entire-only fields: `entireCheckpointId`, `entireCheckpointMetadataCommitSha`, `entireSourceWorktreeCommitSha`
  - The new runtime store already replaces this role with `MemoryRunRecord` plus `PublishedMemoryRecord`
  - Source: `src/shared/direct-memory.ts:136`, `src/shared/memory-runtime.ts:55`, `src/shared/memory-runtime.ts:67`
- Probably stale unless another downstream consumer is added:
  - `genes_jsonl_ref`
  - `capsules_jsonl_ref`
  - `candidates_ref`
  - `external_candidates_ref`
  - Reason: no current Task 7-side consumer under `src/core/memory` and no current publish helper reads them
  - Source definitions: `src/shared/direct-memory.ts:58`, `src/shared/direct-memory.ts:62`

#### 3. Tests worth porting/adapting

For `src/core/memory/evolver-client.test.ts`:

- `src/core/direct-memory/evolver-client.test.ts`
  - Keep the run invocation test pattern:
    - command + argsPrefix wiring
    - env propagation of repo/path/session fields
    - round-trip typed result fixture
  - Source: `src/core/direct-memory/evolver-client.test.ts:19`
  - Adaptation: remove Entire env assertions and assert only runtime-native identity envs plus path envs
- `src/core/direct-memory/evolver-client.test.ts`
  - Keep the review delegation test pattern for `review`, `approveReview`, `rejectReview`
  - Source: `src/core/direct-memory/evolver-client.test.ts:86`

For command-runner coverage:

- `src/core/direct-memory/command-runner.test.ts`
  - Port directly:
    - parses JSON stdout on success (`src/core/direct-memory/command-runner.test.ts:5`)
    - preserves stderr/stdout/exitCode in `JsonCommandError` on non-zero exit (`src/core/direct-memory/command-runner.test.ts:18`)
    - throws on invalid JSON stdout (`src/core/direct-memory/command-runner.test.ts:40`)

Useful publish-side tests if Task 7 keeps publish/delivery in the new runtime:

- `src/core/direct-memory/published-context-builder.test.ts`
  - Keep provider-target publication behavior and empty-memory-graph fallback
  - Source: `src/core/direct-memory/published-context-builder.test.ts:19`, `src/core/direct-memory/published-context-builder.test.ts:125`
  - Adaptation: replace Entire checkpoint fixtures with session-evidence or materialized runtime inputs
- `src/core/direct-memory/context-delivery.test.ts`
  - Keep generated file path/hash behavior, Claude managed-block refresh, and failed publish rejection
  - Source: `src/core/direct-memory/context-delivery.test.ts:42`, `src/core/direct-memory/context-delivery.test.ts:50`, `src/core/direct-memory/context-delivery.test.ts:72`, `src/core/direct-memory/context-delivery.test.ts:117`, `src/core/direct-memory/context-delivery.test.ts:131`

Tests not worth porting except as deletion targets:

- `src/core/direct-memory/entire-client.test.ts`
  - Entire bridge only; obsolete after Task 7
- `src/shared/direct-memory.test.ts`
  - Only the Evolver run/publish example in `src/shared/direct-memory.test.ts:40` is useful as a fixture reference
  - The Entire checkpoint example and `MemoryEvolutionBridgeRef` example encode stale shapes

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Evolver run/review contract types live in shared direct-memory | `src/shared/direct-memory.ts` | `src/shared/direct-memory.ts:46`, `src/shared/direct-memory.ts:70`, `src/shared/direct-memory.ts:87` |
| Published context contract lives in shared direct-memory | `src/shared/direct-memory.ts` | `src/shared/direct-memory.ts:101`, `src/shared/direct-memory.ts:119` |
| JSON command runner behavior and error surface | `src/core/direct-memory/command-runner.ts` | `src/core/direct-memory/command-runner.ts:19`, `src/core/direct-memory/command-runner.ts:51` |
| Evolver client run env includes Entire-derived variables | `src/core/direct-memory/evolver-client.ts` | `src/core/direct-memory/evolver-client.ts:49`, `src/core/direct-memory/evolver-client.ts:59` |
| Publish helper consumes only a subset of artifact refs | `src/core/direct-memory/published-context-builder.ts` | `src/core/direct-memory/published-context-builder.ts:158`, `src/core/direct-memory/published-context-builder.ts:167`, `src/core/direct-memory/published-context-builder.ts:174`, `src/core/direct-memory/published-context-builder.ts:181`, `src/core/direct-memory/published-context-builder.ts:188`, `src/core/direct-memory/published-context-builder.ts:195`, `src/core/direct-memory/published-context-builder.ts:202`, `src/core/direct-memory/published-context-builder.ts:209` |
| Publish delivery writes hashes and Claude managed block | `src/core/direct-memory/context-delivery.ts` | `src/core/direct-memory/context-delivery.ts:18`, `src/core/direct-memory/context-delivery.ts:31`, `src/core/direct-memory/context-delivery.ts:88` |
| Entire client and Entire checkpoint types are legacy-only | `src/core/direct-memory/entire-client.ts`, `src/shared/direct-memory.ts` | `src/core/direct-memory/entire-client.ts:27`, `src/shared/direct-memory.ts:7`, `src/shared/direct-memory.ts:21`, `src/shared/direct-memory.ts:32` |
| New runtime store no longer persists Entire identity | `src/core/memory/runtime-state-store.test.ts` | `src/core/memory/runtime-state-store.test.ts:100`, `src/core/memory/runtime-state-store.test.ts:129` |
| New runtime run/publish persistence shapes | `src/shared/memory-runtime.ts` | `src/shared/memory-runtime.ts:55`, `src/shared/memory-runtime.ts:67` |
| Best base test for new memory evolver client is existing direct-memory evolver client test | `src/core/direct-memory/evolver-client.test.ts` | `src/core/direct-memory/evolver-client.test.ts:19`, `src/core/direct-memory/evolver-client.test.ts:86` |
| Best base test for new command runner is existing direct-memory command-runner test | `src/core/direct-memory/command-runner.test.ts` | `src/core/direct-memory/command-runner.test.ts:5`, `src/core/direct-memory/command-runner.test.ts:18`, `src/core/direct-memory/command-runner.test.ts:40` |

### Risks / Unknowns
- [!] `source_checkpoint_id` and `bridge` may still be expected by an external Evolver CLI binary even though the local repo no longer wants Entire. The repo evidence only proves they are not consumed by the new runtime store.
- [!] `genes_jsonl_ref`, `capsules_jsonl_ref`, `candidates_ref`, and `external_candidates_ref` look stale from in-repo consumers, but that is an inference from current references, not a guarantee about off-repo tooling.
- [?] Task 7 may choose to preserve JSON field names for wire compatibility while changing only the input/provenance source. If so, the type split should happen at the adapter layer, not necessarily in the raw CLI contract.

## Context Handoff: Task 7 Direct-Memory Migration

Start here: `research/2026-04-28-task-7-direct-memory-migration.md`

Context only. Use the saved report as the source of truth.
