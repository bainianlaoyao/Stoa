---
date: 2026-04-26
topic: Entire + Evolver bridge schema fit
status: completed
mode: context-gathering
sources: 4
---

## Context Report: Entire + Evolver Bridge Schema Fit

### Why This Was Gathered

This report validates whether the proposed direct-native bridge can connect Entire checkpoint data to Evolver memory/evolution state without Stoa inventing a second checkpoint or memory schema.

### Summary

The bridge is reasonable if implemented as small CLI/API patches in the pinned Entire and Evolver forks. Entire already exposes the source-side identity and evidence fields needed to anchor an evolution run, while Evolver already exposes target-side path controls, run state, review state, and native memory asset files. The missing layer is stable machine-readable command output and bridge metadata propagation, not new domain logic in Stoa.

### Key Findings

- Entire committed checkpoint metadata already contains the minimum source anchor: `checkpoint_id`, `session_id`, agent type, model, turn id, summary, and initial attribution. This is enough to bind an Evolver run to a provider-native session and a checkpoint evidence record.

- Entire root checkpoint summary already maps session file refs through `sessions` and aggregates token usage / attribution. Stoa can import refs and summary data instead of reconstructing transcript storage or attribution.

- Evolver already supports external path control for the target repo, memory dir, evolution dir, GEP assets dir, and per-session scope. This makes isolated worktree execution and per-run asset isolation a native fit.

- Evolver native asset storage already defines the memory surfaces Stoa should import as refs: `genes.json`, `capsules.json`, `events.jsonl`, `failed_capsules.json`, and related JSONL stores. Stoa should not copy these into a canonical Stoa memory graph.

- Evolver review state already revolves around `evolution_solidify_state.json` with `last_run.run_id`, `selected_gene_id`, `signals`, `mutation`, pending detection, and approve/reject commands. Stoa needs JSON output for these operations, not a replacement review state machine.

### Evidence Chain

| Finding | Source | Location |
|---|---|---|
| Entire metadata has checkpoint/session/provider/summary/attribution fields | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go` | lines 426-470 |
| Entire summary maps checkpoint sessions and combined attribution | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go` | lines 515-524 |
| Entire committed checkpoint listing exposes checkpoint id, latest session id, agent, and session ids | `research/upstreams/entire-cli/cmd/entire/cli/checkpoint/checkpoint.go` | lines 381-408 |
| Evolver accepts explicit repo root via `EVOLVER_REPO_ROOT` | `research/upstreams/evolver/src/gep/paths.js` | lines 9, 24-28 |
| Evolver exposes memory/evolution/assets/session-scope path controls | `research/upstreams/evolver/src/gep/paths.js` | lines 102-125 |
| Evolver native assets are path-addressable files | `research/upstreams/evolver/src/gep/assetStore.js` | lines 169-175 |
| Evolver appends events and failed capsules through native stores | `research/upstreams/evolver/src/gep/assetStore.js` | lines 261-263, 387-397 |
| Evolver review state uses `last_run.run_id`, gene id, signals, mutation, and approve/reject branches | `research/upstreams/evolver/index.js` | lines 615-750 |

### Interface Fit

| Bridge Need | Entire Source | Evolver Target | Fit |
|---|---|---|---|
| Source checkpoint identity | `CommittedMetadata.checkpoint_id`, `CheckpointSummary.checkpoint_id` | New bridge metadata on run/state/event | Direct |
| Provider session join | `CommittedMetadata.session_id` | New bridge metadata on run/state/event | Direct |
| Provider type | `CommittedMetadata.agent` | New bridge metadata or run label | Direct |
| Commit/worktree anchor | checkpoint commit selected by Stoa importer | `EVOLVER_REPO_ROOT` isolated worktree | Direct |
| Evidence summary | `CommittedMetadata.summary`, transcript refs | Evolver signals/run metadata | Needs explicit bridge metadata |
| Memory assets | no memory ownership | `assets/gep/*`, `memory/evolution/*` | Direct |
| Review state | no review ownership | `evolution_solidify_state.json`, `review --approve/--reject` | Direct with JSON output patch |

### Required Patch Surface

- Entire fork:
  - Add read-only machine commands for listing and exporting checkpoint refs as JSON.
  - Include checkpoint id, commit/ref anchor, session id, provider/agent, model, summary, transcript refs, prompt refs, attribution refs, and checkpoint format version.
  - Refuse unsupported checkpoint versions rather than emitting ambiguous data.

- Evolver fork:
  - Add `--json` output for `run`, `review`, `review --approve`, and `review --reject`.
  - Accept `STOA_SOURCE_CHECKPOINT_ID`, `STOA_SOURCE_CHECKPOINT_SHA`, `STOA_PROVIDER_SESSION_ID`, and `STOA_PROJECT_ID`.
  - Persist those bridge refs into native run/state/event metadata so later memory graph and asset references can be traced back to the Entire evidence anchor.

- Stoa:
  - Call the patched CLIs as subprocesses.
  - Store only bridge refs, worktree paths, import cursors, and native asset paths.
  - Do not parse human stdout, reassemble Entire transcripts, recalculate attribution, or define a Stoa memory graph.

### Risks / Unknowns

- [!] Entire v2 is already present in source, so the first bridge slice should pin/refuse anything except the selected checkpoint format.
- [!] Evolver `index.js` is command-oriented and some GEP internals are obfuscated, so JSON output should be added at stable CLI boundaries rather than by importing internals into Stoa.
- [?] The exact checkpoint commit SHA for a committed checkpoint export must be defined precisely in the Entire patch: either the metadata-branch commit containing the checkpoint record or the user-code commit/trailer anchor. Stoa should use one named field for each if both are needed.

## Context Handoff: Entire + Evolver Bridge Schema Fit

Start here: `research/2026-04-26-entire-evolver-bridge-schema-fit.md`

Context only. Use this saved report as the schema-fit evidence for the direct-native bridge design.
