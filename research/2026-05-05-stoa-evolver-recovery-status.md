# Stoa × Evolver Recovery Status

Date: 2026-05-05
Repo: `D:\Data\DEV\ultra_simple_panel`
Branch: `main`
HEAD: `7999d84e202865bf61b38bffabcc720c77dff9c6`

## Current repository state

- No tracked-file edits are currently in progress from this recovery checkpoint.
- Current dirty worktree is untracked-only:
  - `.sisyphus/ralph-loop.local.md`
  - `MEMORY.md`
  - `USER.md`
  - `docs/superpowers/plans/2026-05-05-vscode-terminal-parity.md`
  - `research/2026-05-04-backlog-replay-architecture.md`
  - `research/2026-05-05-stoa-evolver-first-round-experiment-boundary.md`
  - `research/2026-05-05-terminal-emulator-research.md`
  - `research/2026-05-05-vscode-terminal-parity-research.md`
  - `research/2026-05-05-vscode-terminal-stack.md`
  - `src/extensions/providers/evolver-project-runtime.ts`

## What has already been done

- `experiment:first-round` was reframed to match the restored Stoa-side upstream lifecycle boundary.
- `scripts/run-real-first-round-experiment.ts` now reports:
  - `recallPathAligned`
  - `solidifyPathAligned`
  - `distillRequiredByScenario`
  - `distillObservedInScenario`
- Boundary doc added:
  - [research/2026-05-05-stoa-evolver-first-round-experiment-boundary.md](/D:/Data/DEV/ultra_simple_panel/research/2026-05-05-stoa-evolver-first-round-experiment-boundary.md)
- Historical report was marked as historical:
  - [research/2026-05-03-stoa-evolver-final-experiment-report.md](/D:/Data/DEV/ultra_simple_panel/research/2026-05-03-stoa-evolver-final-experiment-report.md)

## Latest verified commands

- `npm run typecheck`
- `npx vitest run src/core/memory/evolver-engine-adapter.test.ts src/core/memory/runtime-host.test.ts src/core/memory/turn-maintenance-runner.test.ts src/main/session-event-bridge.test.ts src/extensions/providers/claude-code-provider.test.ts`
- `npm run experiment:first-round`

These were passing at the last checkpoint except the experiment verdict itself still showed lifecycle misalignment.

## Latest real experiment verdict

Source:
- [experiment-report.json](/D:/Data/DEV/ultra_simple_panel/.tmp/stoa-evolver-exp-ARbwMK/experiment-report.json)

Key verdict fields:

- `recallPathAligned = true`
- `solidifyPathAligned = false`
- `distillRequiredByScenario = false`
- `distillObservedInScenario = false`
- `overallAligned = false`

Interpretation:

- Session-start recall path is working.
- The stop-triggered `solidify` path is still broken.
- This first-round suite does not require `distill`, so lack of distill here is not itself the failure.

## Confirmed root cause

The failure is not the experiment design. The failure is a real Stoa-to-upstream protocol-state gap before `solidify()`.

Current Stoa adapter:
- [src/core/memory/evolver-engine-adapter.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-engine-adapter.ts)

Current behavior in `stageTurn()`:
- Writes only a thin top-level state object:
  - `project_root`
  - `stoa_session_id`
  - `provider_session_id`
  - `turn_id`
  - `evidence_refs`

But upstream `solidify` expects a valid `last_run` payload carrying mutation/personality information.

Latest failing staged state:
- [evolution_solidify_state.json](/D:/Data/DEV/ultra_simple_panel/.tmp/stoa-evolver-exp-ARbwMK/incident-session1/.stoa/memory/evolver/evolution/evolution_solidify_state.json)

Observed failure artifacts:
- [failed_capsules.json](/D:/Data/DEV/ultra_simple_panel/.tmp/stoa-evolver-exp-ARbwMK/incident-session1/.stoa/memory/evolver/assets/gep/failed_capsules.json)
- [events.jsonl](/D:/Data/DEV/ultra_simple_panel/.tmp/stoa-evolver-exp-ARbwMK/incident-session1/.stoa/memory/evolver/assets/gep/events.jsonl)

Exact upstream protocol failure seen in artifacts:

- `missing_or_invalid_mutation`
- `missing_or_invalid_personality_state`

The failed event currently shows:

- `mutation_id: null`
- `personality_state: null`

## Upstream facts already confirmed

Do not modify vendored upstream:
- [research/upstreams/evolver](/D:/Data/DEV/ultra_simple_panel/research/upstreams/evolver)

Useful upstream entry points already confirmed:

- `research/upstreams/evolver/src/gep/mutation.js`
- `research/upstreams/evolver/src/gep/personality.js`

Confirmed behavior from direct probes:

1. `selectPersonalityForRun(...)` does **not** return a bare `PersonalityState`.
2. It returns a wrapper object with fields like:
   - `personality_state`
   - `personality_key`
   - `personality_known`
   - `personality_mutations`
3. `isValidPersonalityState(selection.personality_state) === true`
4. `buildMutation({ signals, selectedGene, personalityState: selection.personality_state })` returns a valid `Mutation`
5. `isValidMutation(...) === true`

This means the next fix must unpack the wrapper correctly and write the inner `personality_state`, not the wrapper object itself.

## Most likely next fix

Only change Stoa-side glue. Do not touch upstream.

Primary file to change:
- [src/core/memory/evolver-engine-adapter.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-engine-adapter.ts)

Planned change:

- Enrich `stageTurn()` so it writes a minimal upstream-compatible `last_run` block before calling `solidify()`
- Reuse upstream helpers directly:
  - `selectPersonalityForRun(...)`
  - `buildMutation(...)`
  - `normalizePersonalityState(...)`
  - `normalizeMutation(...)`
- Expected `last_run` candidates to populate:
  - `run_id`
  - `signals`
  - `selected_gene_id`
  - `mutation`
  - `mutation_id`
  - `personality_state`
  - `personality_key`
  - possibly a minimal `intent` / `selected_by` / `source_type` if upstream consumption requires them

## Tests to update next

- [src/core/memory/evolver-engine-adapter.test.ts](/D:/Data/DEV/ultra_simple_panel/src/core/memory/evolver-engine-adapter.test.ts)

Add assertions that `stageTurn()` writes upstream-compatible `last_run` state instead of only the thin top-level state.

## Verification sequence to resume with

After implementing the adapter fix:

1. `npm run typecheck`
2. `npx vitest run src/core/memory/evolver-engine-adapter.test.ts src/core/memory/runtime-host.test.ts src/core/memory/turn-maintenance-runner.test.ts src/main/session-event-bridge.test.ts src/extensions/providers/claude-code-provider.test.ts`
3. `npm run experiment:first-round`

Expected improvement target:

- `solidifyPathAligned = true`
- no more `missing_or_invalid_mutation`
- no more `missing_or_invalid_personality_state`

## Important boundary reminders

- Do not modify `research/upstreams/evolver`
- Keep all glue in Stoa
- No hardcoded fake memory logic
- No tool-specific special cases like `uv/pip`
- No compatibility/migration layer; breaking change is allowed
- No E2E during this intermediate debug loop unless explicitly requested
