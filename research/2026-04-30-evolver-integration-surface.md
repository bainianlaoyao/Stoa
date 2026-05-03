---
date: 2026-04-30
topic: evolver integration surface
status: completed
mode: context-gathering
sources: 13
---

## Context Report: Evolver Integration Surface

### Why This Was Gathered
Determine the smallest real callable integration from Stoa into the vendored upstream `research/upstreams/evolver` without modifying upstream and without depending on CLI binaries.

### Summary
The thinnest viable Stoa facade is to treat Evolver as a small set of directly-required library modules, not as an embedded CLI or hook system. The cleanest direct-call module is `src/gep/questionGenerator.js` for session-start recall/advice and post-review/solidify suggestion generation; for per-turn outcome recording and review/solidify/distill lifecycle, the available upstream surfaces are much more entangled, partially obfuscated, and side-effect-heavy, so Stoa should avoid calling the top-level CLI, adapter scripts, and lifecycle managers directly.

### Key Findings
- `index.js` is a CLI command router with daemon, review, solidify, fetch, setup-hooks, and ATP behaviors mixed together; it is not a thin embeddable API surface.
- Evolver’s own README describes the main runtime shape as CLI-first and stdout-artifact-based, with hooks as optional integration glue.
- `src/gep/questionGenerator.js` is a clean, readable, narrowly scoped module with explicit exports `generateQuestions` and `generateUrgentQuestions`; it directly matches Stoa’s session-start advice and post-lifecycle recommendation use cases.
- `src/adapters/scripts/evolver-session-start.js` is script-like glue: it finds install roots, reads a JSONL file, formats strings, and writes JSON to stdout. It is better treated as a reference implementation than as a dependency entrypoint.
- Adapter modules such as `src/adapters/codex.js` and `src/adapters/claudeCode.js` are config-installers for hook files and documentation injection, not runtime APIs.
- `src/ops/lifecycle.js` is a process supervisor for loop mode, spawning `node ... index.js --loop`; it is operational glue, not a library seam.
- `skillDistiller` and `solidify` expose many useful functions, but the vendored source is obfuscated and the exported surface is inferred mainly from tests; that makes them higher-risk direct dependencies.
- `solidify` is also deeply coupled to git state, filesystem assets, validations, hub review, PR creation, and failure-mode side effects.

### Evidence Chain
| Finding | Source | Location |
|---------|--------|----------|
| Package entrypoint is `index.js` and `evolver` binary maps to it | `research/upstreams/evolver/package.json` | line 5 |
| CLI scripts include `run`, `solidify`, `review` and others | `research/upstreams/evolver/package.json` | line 27 |
| README positions Evolver as CLI-first, with separate hook integrations | `research/upstreams/evolver/README.md` | line 67 |
| README says first run prints a GEP prompt artifact to stdout | `research/upstreams/evolver/README.md` | line 106 |
| README says hook/platform integrations are optional runtime wiring | `research/upstreams/evolver/README.md` | line 130 |
| `index.js` requires `./src/evolve` and `./src/gep/solidify` at startup | `research/upstreams/evolver/index.js` | line 12 |
| `index.js` exports only `main`, `readJsonSafe`, `rejectPendingRun`, `isPendingSolidify` | `research/upstreams/evolver/index.js` | line 1093 |
| `questionGenerator` documents two entry points and exports them directly | `research/upstreams/evolver/src/gep/questionGenerator.js` | line 8 |
| `questionGenerator` public API starts at `generateQuestions` | `research/upstreams/evolver/src/gep/questionGenerator.js` | line 308 |
| `questionGenerator` exports `generateQuestions` and `generateUrgentQuestions` | `research/upstreams/evolver/src/gep/questionGenerator.js` | line 415 |
| `questionGenerator` has direct unit coverage for both standard and urgent paths | `research/upstreams/evolver/test/questionGenerator.test.js` | line 19 |
| `evolver-session-start.js` is a standalone stdin/stdout script for memory injection | `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | line 3 |
| `evolver-session-start.js` writes `agent_message` and `additionalContext` JSON | `research/upstreams/evolver/src/adapters/scripts/evolver-session-start.js` | line 149 |
| Codex adapter builds hook config that shells out to session-start/signal/session-end scripts | `research/upstreams/evolver/src/adapters/codex.js` | line 8 |
| Claude adapter does the same for Claude Code settings | `research/upstreams/evolver/src/adapters/claudeCode.js` | line 8 |
| Lifecycle module is a loop process manager that spawns `node ... --loop` | `research/upstreams/evolver/src/ops/lifecycle.js` | line 1 |
| Lifecycle `start()` explicitly spawns `node [script] --loop` | `research/upstreams/evolver/src/ops/lifecycle.js` | line 131 |
| `solidify` helper functions are consumed directly in tests, but source is obfuscated | `research/upstreams/evolver/test/solidifyLearning.test.js` | line 3 |
| `skillDistiller` exports many functions used directly in tests, but source is obfuscated | `research/upstreams/evolver/test/skillDistiller.test.js` | line 7 |

### Risks / Unknowns
- [!] `solidify.js`, `skillDistiller.js`, and several adjacent GEP modules are obfuscated in the vendored tree, so API stability must be inferred from tests rather than from readable source.
- [!] `solidify` appears tightly coupled to git, on-disk assets, validation commands, hub review, and optional PR flows, which makes it costly to embed safely as a direct runtime dependency.
- [!] There is no clearly exported, readable “record outcome” library surface in the vendored tree comparable in cleanliness to `questionGenerator`.

## Context Handoff: Evolver Integration Surface

Start here: `research/2026-04-30-evolver-integration-surface.md`

Context only. Use the saved report as the source of truth.
