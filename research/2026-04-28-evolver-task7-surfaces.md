---
date: 2026-04-28
topic: evolver task7 surfaces
status: completed
mode: context-gathering
sources: 15
---

## Context Report: Evolver Task 7 Surfaces

### Why This Was Gathered
Task 7 needs upstream alignment for the currently exposed review/distill/publish surfaces before adding Stoa-specific commands.

### Summary
Upstream `index.js` exposes `run`, `solidify`, `review`, and `distill` directly. `review` is a CLI-only presentation layer around `evolution_solidify_state.json`, `loadGenes()`, and git diff capture; `distill` is backed by stable `skillDistiller` exports; publish is not a top-level CLI branch but is exposed via `skillPublisher` module functions. The durable state we need already lives under `getEvolutionDir()` and `getGepAssetsDir()`.

### Key Findings
- `run` delegates to `evolve.run()` and leaves pending review state in `evolution_solidify_state.json`.
- `solidify` prints JSON for `gene`, `event`, and `capsule`, then can auto-trigger distillation.
- `distill` is already split cleanly into `prepareDistillation()` and `completeDistillation()`.
- `review` has no dedicated upstream export API; approve flows through `solidify()`, reject is implemented inline in `index.js`.
- Publish is module-only today: `geneToSkillMd()`, `publishSkillToHub()`, and `updateSkillOnHub()`.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| `run` branch matches `run`/`/evolve`/default and calls `evolve.run()` | `research/upstreams/evolver/index.js` | `research/upstreams/evolver/index.js:134` |
| `solidify` branch prints `gene`, `event`, `capsule` JSON and may prepare distillation | `research/upstreams/evolver/index.js` | `research/upstreams/evolver/index.js:447` |
| `distill` CLI reads `--response-file` and calls `completeDistillation()` | `research/upstreams/evolver/index.js` | `research/upstreams/evolver/index.js:583` |
| `review` CLI reads `evolution_solidify_state.json`, selected gene, and git diff | `research/upstreams/evolver/index.js` | `research/upstreams/evolver/index.js:615` |
| Approve path reuses `solidify()` and waits on `hubReviewPromise` | `research/upstreams/evolver/index.js` | `research/upstreams/evolver/index.js:703` |
| Reject path does git rollback and marks `last_solidify.rejected` | `research/upstreams/evolver/index.js` | `research/upstreams/evolver/index.js:721` |
| `skillPublisher` exposes `geneToSkillMd`, `publishSkillToHub`, `updateSkillOnHub` | `research/upstreams/evolver/src/gep/skillPublisher.js` | `research/upstreams/evolver/src/gep/skillPublisher.js:60`, `research/upstreams/evolver/src/gep/skillPublisher.js:245`, `research/upstreams/evolver/src/gep/skillPublisher.js:309`, `research/upstreams/evolver/src/gep/skillPublisher.js:346` |
| Distiller exports include `prepareDistillation`, `completeDistillation`, `distillRequestPath`, state helpers | `research/upstreams/evolver/test/skillDistiller.test.js` | `research/upstreams/evolver/test/skillDistiller.test.js:7` |
| `prepareDistillation()` writes prompt/request files with `DistillationRequest` payload | `research/upstreams/evolver/test/skillDistiller.test.js` | `research/upstreams/evolver/test/skillDistiller.test.js:390` |
| `completeDistillation()` persists gene, updates distiller state, removes request file | `research/upstreams/evolver/test/skillDistiller.test.js` | `research/upstreams/evolver/test/skillDistiller.test.js:516` |
| Core workspace dirs come from `getEvolutionDir()` and `getGepAssetsDir()` | `research/upstreams/evolver/src/gep/paths.js` | `research/upstreams/evolver/src/gep/paths.js:114`, `research/upstreams/evolver/src/gep/paths.js:123` |
| Gene/capsule/event/candidate/failed-capsule files live in `assets/gep` | `research/upstreams/evolver/src/gep/assetStore.js` | `research/upstreams/evolver/src/gep/assetStore.js:169` |
| Asset call log lives at `{evolution_dir}/asset_call_log.jsonl` | `research/upstreams/evolver/src/gep/assetCallLog.js` | `research/upstreams/evolver/src/gep/assetCallLog.js:1` |
| Local state awareness expects `evolution_solidify_state.json`, `memory_graph.jsonl`, and `evolution_narrative.md` in evolution dir | `research/upstreams/evolver/src/gep/localStateAwareness.js` | `research/upstreams/evolver/src/gep/localStateAwareness.js:138`, `research/upstreams/evolver/src/gep/localStateAwareness.js:177`, `research/upstreams/evolver/src/gep/localStateAwareness.js:182` |
| Memory graph tests use `MEMORY_GRAPH_PATH` override and assert writes to `memory_graph.jsonl` | `research/upstreams/evolver/test/memoryGraph.test.js` | `research/upstreams/evolver/test/memoryGraph.test.js:46`, `research/upstreams/evolver/test/memoryGraph.test.js:171` |

### Risks / Unknowns
- `review` export is not a first-class upstream module API. Any Stoa "review export" command will need to either wrap `index.js` review logic or reimplement its read-only composition from `evolution_solidify_state.json`, `loadGenes()`, and git diff capture.
- `hubReview.js` is exported only as `submitHubReview`; its private persistence details are obfuscated and not covered by dedicated tests in this repo snapshot.

## Context Handoff: Evolver Task 7 Surfaces

Start here: `research/2026-04-28-evolver-task7-surfaces.md`

Context only. Use the saved report as the source of truth.
